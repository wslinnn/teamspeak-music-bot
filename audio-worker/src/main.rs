//! TS 音乐机器人 —— 独立音频 Worker（阶段2 最小可用原型）
//!
//! 职责：接收 Node 主进程通过 TCP 下发的控制指令，派生**外部 ffmpeg** 子进程解码为
//! 48k/s16le/立体声 PCM，按 20ms 严格帧节拍做音量/闪避增益、Opus 编码（opus-codec，
//! 与 @discordjs/opus 同源 libopus），再把原始 Opus 帧通过同一 TCP 连接回传。
//! 不碰 TS 协议、不碰音源 API、不碰业务逻辑（见 docs/rust-audio-worker-plan.md）。
//!
//! 传输：开发态用 127.0.0.1 loopback TCP（Windows 友好）；Linux 可后续改 UDS。
//! 协议：每条消息 = 1 字节 type + 4 字节大端 length + payload。
//!   C 控制(Node→Worker, JSON)；E 事件(Worker→Node, JSON)；F 音频帧(Worker→Node, 原始 Opus 字节)。

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use opus_codec::{Application, Bitrate, Channels, Encoder, SampleRate};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, Notify};

const FRAME_MS: u64 = 20;
const PCM_FRAME_BYTES: usize = 3840; // 20ms * 48000Hz * 2ch * 2bytes
const HIGH_WATER: usize = 640 * 1024;
const LOW_WATER: usize = 256 * 1024;

/// 单次播放会话的可变状态（在多个任务间共享）。
struct Session {
    pcm: Vec<u8>,
    ffmpeg_alive: bool,
    paused: bool,
    /// 是否存在进行中的播放会话：play 置 true；自然耗尽 / stop 置 false。
    /// 帧循环据此区分「会话刚耗尽 → 恰好发一次 trackEnd」与「空转 → 静默」。
    active: bool,
    /// 本代会话已上报过 error 事件：置位后帧循环不再发 trackEnd。
    /// Node 侧对 error 与 trackEnd 都会触发切歌，双事件会一次跳两首
    /// （旧 node 后端两事件互斥，必须保持该不变量）。
    /// read_loop 记录的待上报失败（零产出 / 读错误）。**不在 read_loop 直接发送**：
    /// 本地文件解码极快时 EOF 可能早于帧循环消费任何数据，此刻 real_frames==0
    /// 是误报。由帧循环在缓冲排空、会话转换的那一刻统一判定，保证每个 play
    /// 会话恰好一个终态事件（trackEnd 或 error，天然互斥）。
    pending_fail: Option<(String, String)>, // (code, msg)
    /// 真实数据帧计数（不含欠载静音帧）：零产出失败判定的依据。
    /// frames_played 含静音帧（时间线计数，供进度计算），不能用作产出判定。
    real_frames: u64,
    volume: f64,
    // ducking（语音闪避）增益斜坡状态
    duck_start_gain: f64,
    duck_target_gain: f64,
    duck_started_at: Instant,
    duck_dur_ms: f64,
    /// 代际号：每次 play/stop 自增，用于隔离过期的 ffmpeg 读取任务。
    generation: u64,
    frames_played: u64,
    seek_offset: f64,
    last_url: String,
    last_dur: f64,
}

impl Session {
    fn new() -> Self {
        Self {
            pcm: Vec::new(),
            ffmpeg_alive: false,
            paused: false,
            active: false,
            pending_fail: None,
            real_frames: 0,
            volume: 75.0,
            duck_start_gain: 1.0,
            duck_target_gain: 1.0,
            duck_started_at: Instant::now(),
            duck_dur_ms: 0.0,
            generation: 0,
            frames_played: 0,
            seek_offset: 0.0,
            last_url: String::new(),
            last_dur: 0.0,
        }
    }

    /// 当前时刻的 ducking 增益（0=静音，1=不变）。
    fn ducking_at(&self, now: Instant) -> f64 {
        if self.duck_dur_ms <= 0.0 {
            return self.duck_target_gain;
        }
        let elapsed = now.duration_since(self.duck_started_at).as_millis() as f64;
        let p = (elapsed / self.duck_dur_ms).clamp(0.0, 1.0);
        self.duck_start_gain + (self.duck_target_gain - self.duck_start_gain) * p
    }
}

/// 解析命令行：--port=<p>（0=系统分配）与 --ffmpeg=<bin>（默认 "ffmpeg"）。
fn parse_args() -> (String, String) {
    let mut port = String::new();
    let mut ffmpeg = String::from("ffmpeg");
    for a in std::env::args() {
        if let Some(p) = a.strip_prefix("--port=") {
            port = p.to_string();
        } else if let Some(f) = a.strip_prefix("--ffmpeg=") {
            ffmpeg = f.to_string();
        }
    }
    (port, ffmpeg)
}

fn new_encoder() -> Encoder {
    let mut enc = Encoder::new(SampleRate::Hz48000, Channels::Stereo, Application::Voip)
        .expect("创建 Opus 编码器失败（opus-codec）");
    // 128kbps 立体声音乐码率；后续阶段用 A/B 比对微调。
    let _ = enc.set_bitrate(Bitrate::Custom(128_000));
    enc
}

/// 音量曲线（与 TS 端 volumeToFactor 完全一致）：0.2x + 0.8x^8，x=vol/100。
fn volume_to_factor(volume: f64) -> f32 {
    let x = (volume.clamp(0.0, 100.0) / 100.0) as f32;
    0.2 * x + 0.8 * x.powi(8)
}

/// 对一帧 PCM（3840 字节 s16le）应用线性增益（含跨帧斜坡），返回 i16 样本。
/// 逻辑逐行移植自 player.ts 的 applyVolume。
fn apply_gain(pcm: &[u8], start_factor: f32, end_factor: f32) -> Vec<i16> {
    let n = pcm.len() / 2; // i16 样本数
    let mut out = Vec::with_capacity(n);
    if start_factor >= 1.0 && end_factor >= 1.0 {
        for i in (0..pcm.len()).step_by(2) {
            out.push(i16::from_le_bytes([pcm[i], pcm[i + 1]]));
        }
        return out;
    }
    let stereo_frames = (n / 2).max(1);
    for f in 0..stereo_frames {
        let progress = if stereo_frames <= 1 {
            0.0
        } else {
            f as f64 / (stereo_frames - 1) as f64
        };
        let factor =
            (start_factor as f64 + (end_factor as f64 - start_factor as f64) * progress) as f32;
        let base = (f * 2) as usize;
        for k in 0..2 {
            let si16 = base + k;
            if si16 >= n {
                break;
            }
            let byte_i = si16 * 2;
            let s = i16::from_le_bytes([pcm[byte_i], pcm[byte_i + 1]]);
            let v = (s as f32 * factor).round().clamp(-32768.0, 32767.0) as i16;
            out.push(v);
        }
    }
    out
}

/// 构造 ffmpeg 参数：复刻 player.ts buildFfmpegArgs 的解码/输出部分。
fn ffmpeg_args(url: &str, seek: f64) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    if url.starts_with("http") {
        a.extend_from_slice(&[
            "-reconnect".into(),
            "1".into(),
            "-reconnect_at_eof".into(),
            "1".into(),
            "-reconnect_streamed".into(),
            "1".into(),
            "-reconnect_delay_max".into(),
            "30".into(),
            "-reconnect_on_network_error".into(),
            "1".into(),
            "-reconnect_on_http_error".into(),
            "4xx,5xx".into(),
        ]);
    }
    a.push("-i".into());
    a.push(url.to_string());
    if seek > 0.0 {
        a.push("-ss".into());
        a.push(seek.to_string());
    }
    a.extend_from_slice(&[
        "-f".into(),
        "s16le".into(),
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "2".into(),
        "-acodec".into(),
        "pcm_s16le".into(),
        "-".into(),
    ]);
    a
}

// ---- 帧协议 ----

async fn write_frame(writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>, type_byte: u8, payload: &[u8]) {
    let mut w = writer.lock().await;
    let mut hdr = [0u8; 5];
    hdr[0] = type_byte;
    hdr[1..5].copy_from_slice(&(payload.len() as u32).to_be_bytes());
    let _ = w.write_all(&hdr).await;
    let _ = w.write_all(payload).await;
    let _ = w.flush().await;
}

fn ev_payload(e: &str, extra: Option<(&str, Value)>) -> Vec<u8> {
    let mut obj = serde_json::Map::new();
    obj.insert("e".to_string(), Value::String(e.to_string()));
    if let Some((k, v)) = extra {
        obj.insert(k.to_string(), v);
    }
    json!(obj).to_string().into_bytes()
}

async fn send_event(writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>, e: &str) {
    write_frame(writer, b'E', &ev_payload(e, None)).await;
}

async fn send_progress(writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>, pos_ms: u64) {
    write_frame(writer, b'E', &ev_payload("progress", Some(("pos_ms", json!(pos_ms))))).await;
}

async fn send_error(writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>, code: &str, msg: &str) {
    let obj = json!({
        "e": "error",
        "code": code,
        "msg": msg.chars().take(256).collect::<String>(),
    });
    write_frame(writer, b'E', obj.to_string().as_bytes()).await;
}

/// 读取一帧（type + u32 BE len + payload），payload 写入 `buf`。
async fn read_frame<R: AsyncReadExt + Unpin>(r: &mut R, buf: &mut Vec<u8>) -> std::io::Result<(u8, usize)> {
    let mut hdr = [0u8; 5];
    r.read_exact(&mut hdr).await?;
    let len = u32::from_be_bytes([hdr[1], hdr[2], hdr[3], hdr[4]]) as usize;
    buf.resize(len, 0);
    r.read_exact(buf).await?;
    Ok((hdr[0], len))
}

// ---- ffmpeg 读取任务（带背压，并捕获 stderr 用于错误上报） ----

async fn ffmpeg_read_loop(
    session: Arc<Mutex<Session>>,
    mut stdout: tokio::process::ChildStdout,
    mut stderr: tokio::process::ChildStderr,
    mut child: Child,
    writer: Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    notify: Arc<Notify>,
    gen: u64,
) {
    let mut buf = vec![0u8; 8192];
    let mut stderr_buf = vec![0u8; 4096];
    let mut stderr_text = String::new();
    let mut stderr_done = false;

    loop {
        // 背压：缓冲超 HIGH_WATER 时停读，等帧循环释放通知。
        {
            let s = session.lock().await;
            if s.generation != gen {
                let _ = child.start_kill();
                return; // 已切换曲目，退出过期任务
            }
            if s.pcm.len() >= HIGH_WATER {
                drop(s);
                // 200ms 超时兜底：stop 后帧循环不再排水，通知可能永不到来，
                // 靠超时回环检查 generation，及时回收等待中的读任务。
                let _ = tokio::time::timeout(Duration::from_millis(200), notify.notified()).await;
                continue;
            }
        }
        tokio::select! {
            // 读超时兜底：stdout 停滞（源挂起等）时也能周期性回到循环头检查
            // generation，让 stop/切歌及时杀掉子进程，避免僵尸 ffmpeg。
            r = tokio::time::timeout(Duration::from_millis(200), stdout.read(&mut buf)) => {
                match r {
                    Err(_elapsed) => continue,
                    Ok(Ok(0)) => break, // EOF：ffmpeg 自然结束
                    Ok(Ok(n)) => {
                        let mut s = session.lock().await;
                        if s.generation != gen {
                            let _ = child.start_kill();
                            return;
                        }
                        s.pcm.extend_from_slice(&buf[..n]);
                    }
                    Ok(Err(e)) => {
                        let mut s = session.lock().await;
                        if s.generation == gen {
                            // 记录待上报失败，由帧循环在会话转换时统一发出
                            s.pending_fail =
                                Some(("ffmpeg_read".to_string(), e.to_string()));
                        }
                        drop(s);
                        break;
                    }
                }
            }
            r = stderr.read(&mut stderr_buf), if !stderr_done => {
                match r {
                    Ok(0) => stderr_done = true,
                    Ok(n) => {
                        stderr_text.push_str(&String::from_utf8_lossy(&stderr_buf[..n]));
                        // 上界 64KB，防长播/重连风暴下无界增长（只留尾部供错误上报）
                        if stderr_text.len() > 64 * 1024 {
                            let mut start = stderr_text.len() - 32 * 1024;
                            while !stderr_text.is_char_boundary(start) {
                                start += 1;
                            }
                            stderr_text.drain(..start);
                        }
                    }
                    Err(_) => stderr_done = true,
                }
            }
        }
    }

    // stdout EOF：等待子进程退出，取出退出码用于错误研判。
    // 只做记录、不发事件——此刻 pcm 缓冲可能还有大量未消费数据（本地文件
    // 解码快于帧消耗），帧循环会在缓冲排空的会话转换点统一判定并发送。
    let status = child.wait().await;
    let mut s = session.lock().await;
    if s.generation == gen {
        s.ffmpeg_alive = false;
        if let Ok(st) = status {
            let code = st.code().unwrap_or(-1);
            let tail = stderr_text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            // 真实帧为 0 时才构成失败（在帧循环转换点复核，这里的 real_frames
            // 只是初判，避免白白格式化消息）
            if s.real_frames == 0 {
                s.pending_fail = Some((
                    "ffmpeg_no_output".to_string(),
                    format!("ffmpeg 退出码 {code} 但 0 字节产出。stderr: {tail}"),
                ));
            }
        }
    }
}

// ---- 会话控制 ----

async fn stop_session(session: &Arc<Mutex<Session>>) {
    let mut s = session.lock().await;
    s.generation += 1;
    s.pcm.clear();
    s.ffmpeg_alive = false;
    s.paused = false;
    // 会话标记失效：既避免 stop 误触发 trackEnd，也避免 play 切换窗口期的竞态。
    s.active = false;
    s.pending_fail = None;
    s.frames_played = 0;
    s.real_frames = 0;
}

async fn handle_play(
    session: &Arc<Mutex<Session>>,
    writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    notify: &Arc<Notify>,
    url: String,
    seek: f64,
    dur: f64,
    ffmpeg_bin: &str,
) {
    stop_session(session).await;
    let args = ffmpeg_args(&url, seek);
    let mut cmd = Command::new(ffmpeg_bin);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            send_error(writer, "ffmpeg_spawn", &e.to_string()).await;
            return;
        }
    };
    let stdout = child.stdout.take().expect("ffmpeg stdout 应为 piped");
    let stderr = child.stderr.take().expect("ffmpeg stderr 应为 piped");
    let gen = {
        let mut s = session.lock().await;
        s.pcm.clear();
        s.ffmpeg_alive = true;
        s.paused = false;
        s.active = true;
        s.pending_fail = None;
        s.frames_played = 0;
        s.real_frames = 0;
        s.seek_offset = seek;
        s.last_url = url.clone();
        s.last_dur = dur;
        s.generation += 1;
        s.generation
    };
    let rs = session.clone();
    let rn = notify.clone();
    let rw = writer.clone();
    tokio::spawn(async move {
        ffmpeg_read_loop(rs, stdout, stderr, child, rw, rn, gen).await;
    });
    send_event(writer, "ready").await;
}

// ---- 20ms 帧循环 ----

async fn frame_loop(
    session: Arc<Mutex<Session>>,
    writer: Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    notify: Arc<Notify>,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(FRAME_MS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_gen = 0u64;
    let mut encoder: Option<Encoder> = None;
    let mut out_buf = vec![0u8; 4096];

    loop {
        interval.tick().await;
        let now = Instant::now();

        // 快照本帧所需状态（ffmpeg_alive 在下方取帧时另行读取）
        let (gen, paused, volume, dstart, dend) = {
            let s = session.lock().await;
            (
                s.generation,
                s.paused,
                s.volume,
                s.ducking_at(now),
                s.ducking_at(now + Duration::from_millis(FRAME_MS)),
            )
        };

        if gen != last_gen {
            encoder = None; // 新曲目：丢弃旧编码器，首次出帧时惰性重建
            last_gen = gen;
        }
        if paused {
            continue;
        }

        // 取一帧 PCM / 判定结束 / 欠载补静音
        enum Tick {
            /// 缓冲中的真实 PCM 帧。
            Real(Vec<u8>),
            /// 中途欠载的静音垫帧：保 20ms 时间线连续。
            Silence,
            /// 会话数据耗尽且正常：上报 trackEnd。
            JustEnded,
            /// 会话数据耗尽且失败（零真实产出/读错误）：上报 error，不 trackEnd。
            /// Node 侧对 error 与 trackEnd 都触发切歌，二者必须互斥。
            Failed(String, String),
            /// 无进行中的会话（尚未 play / 已结束 / 已 stop / 首个数据块未到）：静默。
            Idle,
        }
        let tick = {
            let mut s = session.lock().await;
            if s.pcm.len() >= PCM_FRAME_BYTES {
                let fb = s.pcm[..PCM_FRAME_BYTES].to_vec();
                s.pcm.drain(..PCM_FRAME_BYTES);
                if s.pcm.len() < LOW_WATER {
                    notify.notify_one();
                }
                Tick::Real(fb)
            } else if !s.ffmpeg_alive {
                // 缓冲已排空 + 源已结束：会话终态转换点，此刻判定失败与否
                if s.active {
                    s.active = false;
                    match s.pending_fail.take() {
                        Some((code, msg)) => Tick::Failed(code, msg),
                        None => Tick::JustEnded,
                    }
                } else {
                    Tick::Idle
                }
            } else if s.real_frames == 0 && s.pcm.is_empty() {
                // 首个数据块尚未到达：不发帧（与 node 后端一致，时间线从真实
                // 数据开始）；否则坏源会先铺一串静音帧，污染零产出判定
                Tick::Idle
            } else {
                Tick::Silence // 中途欠载：补静音帧保连续
            }
        };

        let base = volume_to_factor(volume);
        let sf = base * dstart as f32;
        let ef = base * dend as f32;

        match tick {
            Tick::JustEnded => {
                send_event(&writer, "trackEnd").await;
            }
            Tick::Failed(code, msg) => {
                send_error(&writer, &code, &msg).await;
            }
            Tick::Idle => {}
            Tick::Real(fb) => {
                encode_and_send(&session, &writer, encoder.get_or_insert_with(new_encoder), &mut out_buf, fb, sf, ef, true).await;
            }
            Tick::Silence => {
                let pcm = vec![0u8; PCM_FRAME_BYTES];
                encode_and_send(&session, &writer, encoder.get_or_insert_with(new_encoder), &mut out_buf, pcm, sf, ef, false).await;
            }
        }
    }
}

/// 增益→Opus 编码→回传 F 帧；真实帧单独计数（供"零产出"失败判定）。
async fn encode_and_send(
    session: &Arc<Mutex<Session>>,
    writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    encoder: &mut Encoder,
    out_buf: &mut [u8],
    pcm: Vec<u8>,
    start_factor: f32,
    end_factor: f32,
    is_real: bool,
) {
    let pcm_i16 = apply_gain(&pcm, start_factor, end_factor);
    match encoder.encode(&pcm_i16, out_buf) {
        Ok(n) => {
            write_frame(writer, b'F', &out_buf[..n]).await;
            let mut s = session.lock().await;
            s.frames_played += 1;
            if is_real {
                s.real_frames += 1;
            }
            if s.frames_played % 50 == 0 {
                let pos_ms = (s.seek_offset * 1000.0) as u64 + s.frames_played * FRAME_MS;
                drop(s);
                send_progress(writer, pos_ms).await;
            }
        }
        Err(e) => send_error(writer, "opus_encode", &format!("{e:?}")).await,
    }
}

// ---- 主入口 ----

#[tokio::main]
async fn main() -> Result<()> {
    let (port_arg, ffmpeg_bin) = parse_args();
    let bind = if port_arg.is_empty() {
        "127.0.0.1:0".to_string()
    } else {
        format!("127.0.0.1:{port_arg}")
    };
    let listener = TcpListener::bind(&bind).await?;
    let local = listener.local_addr()?;
    // Node 侧从 stderr 解析 "LISTENING <port>"
    eprintln!("LISTENING {}", local.port());

    let (stream, _) = listener.accept().await?;
    let (mut rd, wr) = stream.into_split();
    let session = Arc::new(Mutex::new(Session::new()));
    let notify = Arc::new(Notify::new());
    let writer = Arc::new(Mutex::new(wr));

    // 帧循环常驻，跨多次 play 复用
    {
        let fs = session.clone();
        let fw = writer.clone();
        let fn_ = notify.clone();
        tokio::spawn(async move {
            frame_loop(fs, fw, fn_).await;
        });
    }

    let mut buf = Vec::new();
    loop {
        let (type_byte, _len) = match read_frame(&mut rd, &mut buf).await {
            Ok(x) => x,
            Err(_) => break, // 连接断开
        };
        if type_byte != b'C' {
            continue;
        }
        let v: Value = match serde_json::from_slice(&buf) {
            Ok(x) => x,
            Err(e) => {
                send_error(&writer, "bad_json", &e.to_string()).await;
                continue;
            }
        };
        let cmd = v.get("c").and_then(|c| c.as_str()).unwrap_or("");
        match cmd {
            "play" => {
                let url = v["url"].as_str().unwrap_or("").to_string();
                let seek = v["seek"].as_f64().unwrap_or(0.0);
                let dur = v["dur"].as_f64().unwrap_or(0.0);
                handle_play(&session, &writer, &notify, url, seek, dur, &ffmpeg_bin).await;
            }
            "stop" => stop_session(&session).await,
            "pause" => {
                let mut s = session.lock().await;
                s.paused = true;
            }
            "resume" => {
                let mut s = session.lock().await;
                s.paused = false;
            }
            "seek" => {
                // MVP：用上次 URL 重新播放到目标秒（与 player.ts 行为一致）
                let sec = v["sec"].as_f64().unwrap_or(0.0);
                let (url, dur) = {
                    let s = session.lock().await;
                    (s.last_url.clone(), s.last_dur)
                };
                if !url.is_empty() {
                    handle_play(&session, &writer, &notify, url, sec, dur, &ffmpeg_bin).await;
                }
            }
            "set_volume" => {
                let vol = v["vol"].as_f64().unwrap_or(75.0);
                let mut s = session.lock().await;
                s.volume = vol;
            }
            "set_ducking" => {
                let gain = v["gain"].as_f64().unwrap_or(1.0);
                let ramp = v["ramp_ms"].as_f64().unwrap_or(0.0);
                let mut s = session.lock().await;
                let now = Instant::now();
                s.duck_start_gain = s.ducking_at(now);
                s.duck_target_gain = gain.clamp(0.0, 1.0);
                s.duck_started_at = now;
                s.duck_dur_ms = if ramp > 0.0 && (gain - s.duck_start_gain).abs() > 1e-6 {
                    ramp
                } else {
                    0.0
                };
            }
            _ => send_error(&writer, "unknown_cmd", cmd).await,
        }
    }

    // 退出前清理 ffmpeg
    stop_session(&session).await;
    Ok(())
}
