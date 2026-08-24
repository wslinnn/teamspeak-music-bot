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
/// 与 player.ts 的 BROWSER_UA 保持一致（CDN 头用）
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
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
    /// 外部 PCM 模式（Spotify 边车）：无 ffmpeg、无 EOF，欠载补静音，
    /// 曲目结束由 Node 控制器调 stop 驱动（对齐 player.ts externalMode）。
    external: bool,
    /// 本代会话已上报过 error 事件：置位后帧循环不再发 trackEnd。
    /// Node 侧对 error 与 trackEnd 都会触发切歌，双事件会一次跳两首
    /// （旧 node 后端两事件互斥，必须保持该不变量）。
    /// stdout 管道读错误（罕见）。由帧循环在会话转换点上报。
    read_error: Option<String>,
    /// EOF 事实记录（退出码 + stderr 尾部），**无条件记录、不做任何判定**：
    /// 本地文件解码可能快于帧消费，EOF 时刻 real_frames==0 是常态而非失败。
    /// 零产出判定完全交给帧循环在缓冲排空的转换点执行（届时 real_frames
    /// 才是终值），保证每个 play 会话恰好一个终态事件（trackEnd 或 error）。
    eof_tail: Option<(i32, String)>,
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
    /// 普通模式连续空转 tick 数（node 的 emptyFrameAttempts，看门狗用）
    empty_ticks: u64,
    /// 帧循环看门狗请求杀 ffmpeg（read_loop 周期唤醒时执行）
    kill_requested: bool,
    /// 本次会话由看门狗终止（而非源自身失败）：终态走 trackEnd 而非
    /// ffmpeg_no_output error——与 node 端 shouldEndOnStall 恒发 trackEnd 一致
    stall_ended: bool,
}

impl Session {
    fn new() -> Self {
        Self {
            pcm: Vec::new(),
            ffmpeg_alive: false,
            paused: false,
            active: false,
            external: false,
            read_error: None,
            eof_tail: None,
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
            empty_ticks: 0,
            kill_requested: false,
            stall_ended: false,
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
    // Bitrate::Auto 与 node 端 @discordjs/opus 默认一致（libopus AUTO，
    // 实测同素材 ~101kbps），保证 A/B 听感与带宽对齐。
    let _ = enc.set_bitrate(Bitrate::Auto);
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
    let is_http = url.starts_with("http://") || url.starts_with("https://");

    // CDN 头（与 player.ts buildFfmpegArgs 逐条对齐）：B站/网易云的 CDN
    // 会拒绝无 Referer/UA 的请求，缺失会导致自动跳歌
    if is_http && (url.contains("bilivideo") || url.contains("bilibili")) {
        a.push("-headers".into());
        a.push(format!(
            "Referer: https://www.bilibili.com
User-Agent: {}
",
            BROWSER_UA
        ));
    } else if is_http && (url.contains("music.126.net") || url.contains("music.163.com")) {
        a.push("-headers".into());
        a.push(format!(
            "Referer: https://music.163.com/
User-Agent: {}
",
            BROWSER_UA
        ));
    }

    if is_http {
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

async fn send_progress(
    writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    pos_ms: u64,
    pcm_level: usize,
) {
    // 附带 pcm 缓冲水位（字节），Node 侧据此对外部 PCM 流做 pause/resume 闭环背压
    let obj = json!({ "e": "progress", "pos_ms": pos_ms, "pcm": pcm_level });
    write_frame(writer, b'E', obj.to_string().as_bytes()).await;
}

/// 暂停期间也周期上报缓冲水位（外部 PCM 模式下生产者不会停，
/// Node 需要水位反馈来暂停 Readable，否则长时间暂停会撞 8MB 上限）
async fn send_buffer_level(writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>, pcm_level: usize) {
    let obj = json!({ "e": "buffer", "pcm": pcm_level });
    write_frame(writer, b'E', obj.to_string().as_bytes()).await;
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
            let mut s = session.lock().await;
            if s.generation != gen {
                let _ = child.start_kill();
                return; // 已切换曲目，退出过期任务
            }
            if s.kill_requested {
                // 帧循环看门狗触发（#89 卡死流）：杀掉 ffmpeg → stdout EOF →
                // 缓冲排空 → 帧循环转换点走 trackEnd（与 node 端恒 trackEnd 一致，
                // 即便 0 真实帧也不归类为 ffmpeg_no_output）
                s.kill_requested = false;
                s.stall_ended = true;
                drop(s);
                let _ = child.start_kill();
            } else if s.pcm.len() >= HIGH_WATER {
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
                            s.read_error = Some(e.to_string());
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

    // stdout EOF：等待子进程退出。只记录事实（退出码 + stderr 尾部），
    // 不做任何失败判定——此刻 pcm 缓冲可能还有大量未消费数据，real_frames
    // 还会增长；零产出与否由帧循环在缓冲排空的转换点用终值判定。
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
            s.eof_tail = Some((code, tail));
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
    s.external = false;
    s.read_error = None;
    s.eof_tail = None;
    s.frames_played = 0;
    s.real_frames = 0;
    // 看门狗状态同样复位：陈旧的 kill_requested 会误杀下一曲的 ffmpeg
    s.empty_ticks = 0;
    s.kill_requested = false;
    s.stall_ended = false;
}

async fn handle_play(
    session: &Arc<Mutex<Session>>,
    writer: &Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    notify: &Arc<Notify>,
    url: String,
    seek: f64,
    dur: f64,
    ffmpeg_bin: &str,
    external: bool,
) {
    stop_session(session).await;
    if external {
        // 外部 PCM：无 ffmpeg、无 EOF，PCM 经 'P' 帧喂入
        {
            let mut s = session.lock().await;
            s.pcm.clear();
            s.ffmpeg_alive = false;
            s.paused = false;
            s.active = true;
            s.external = true;
            s.read_error = None;
            s.eof_tail = None;
            s.frames_played = 0;
            s.real_frames = 0;
            s.seek_offset = seek;
            s.last_url = url.clone();
            s.last_dur = dur;
            s.empty_ticks = 0;
            s.kill_requested = false;
            s.stall_ended = false;
            s.generation += 1;
        }
        send_event(writer, "ready").await;
        return;
    }
    // 普通模式：先 spawn、后原子置位（alive=true 与 gen 同一把锁）。若先置
    // active 再 spawn，帧循环会在窗口期看到 active && !alive 误发 trackEnd。
    let args = ffmpeg_args(&url, seek);
    let mut cmd = Command::new(ffmpeg_bin);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Linux：父进程（worker）死亡时内核自动 SIGKILL 子进程，杜绝孤儿 ffmpeg
    // （Windows 等价手段由 Node 侧 taskkill /T 兜底）
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            Ok(())
        });
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            // stop_session 已置 inactive，无需再动会话状态
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
        s.external = false;
        s.read_error = None;
        s.eof_tail = None;
        s.frames_played = 0;
        s.real_frames = 0;
        s.seek_offset = seek;
        s.last_url = url.clone();
        s.last_dur = dur;
        s.empty_ticks = 0;
        s.kill_requested = false;
        s.stall_ended = false;
        s.generation += 1;
        s.generation
    };
    let rs = session.clone();
    let rn = notify.clone();
    tokio::spawn(async move {
        ffmpeg_read_loop(rs, stdout, stderr, child, rn, gen).await;
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
    let mut paused_ticks: u64 = 0;
    let mut encoder: Option<Encoder> = None;
    let mut out_buf = vec![0u8; 4096];

    loop {
        interval.tick().await;
        let now = Instant::now();

        // 快照本帧所需状态（ffmpeg_alive 在下方取帧时另行读取）
        let (gen, paused, external, volume, dstart, dend) = {
            let s = session.lock().await;
            (
                s.generation,
                s.paused,
                s.external,
                s.volume,
                s.ducking_at(now),
                s.ducking_at(now + Duration::from_millis(FRAME_MS)),
            )
        };

        if gen != last_gen {
            // 新曲目仅更新代际标记；编码器跨曲复用（node 端全程单实例，
            // 每曲重建会带来首帧编码状态的细微差异）
            last_gen = gen;
        }
        if paused {
            // 外部 PCM 模式：暂停时生产者仍在喂入，每 500ms 上报水位供 Node 背压
            if external && paused_ticks % 25 == 0 {
                let level = {
                    let s = session.lock().await;
                    s.pcm.len()
                };
                send_buffer_level(&writer, level).await;
            }
            paused_ticks += 1;
            continue;
        }
        paused_ticks = 0;

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
                s.empty_ticks = 0; // 有数据即重置空转计数（node 的 emptyFrameAttempts 语义）
                Tick::Real(fb)
            } else if s.external {
                // 外部 PCM：流无 EOF，欠载补静音保时间线；曲目结束由控制器
                // 调 stop 驱动（stop 置 active=false → Idle），不发 trackEnd
                if s.active {
                    if s.real_frames == 0 && s.pcm.is_empty() {
                        Tick::Idle // 首块 PCM 未到
                    } else {
                        Tick::Silence
                    }
                } else {
                    Tick::Idle
                }
            } else if !s.ffmpeg_alive {
                // 缓冲已排空 + 源已结束：会话终态转换点，此刻 real_frames 是终值
                if s.active {
                    s.active = false;
                    let eof = s.eof_tail.take();
                    if let Some(e) = s.read_error.take() {
                        Tick::Failed("ffmpeg_read".to_string(), e)
                    } else if s.stall_ended {
                        // 看门狗终止：恒走 trackEnd（node 端 shouldEndOnStall 语义）
                        Tick::JustEnded
                    } else if s.real_frames == 0 && eof.is_some() {
                        let (code, tail) = eof.unwrap();
                        Tick::Failed(
                            "ffmpeg_no_output".to_string(),
                            format!("ffmpeg 退出码 {code} 但 0 真实帧产出。stderr: {tail}"),
                        )
                    } else {
                        Tick::JustEnded
                    }
                } else {
                    Tick::Idle
                }
            } else if !s.active {
                Tick::Idle
            } else {
                // 普通模式欠载：与 node 端一致——不发帧（不补静音），累计空转
                // tick 做卡死看门狗（node 的 shouldEndOnStall / #89）：
                // 近结尾（≤5s 或时长未知）250 tick ≈ 5s，远结尾 3000 tick ≈ 60s，
                // 触发后请求杀掉 ffmpeg → EOF → 缓冲排空 → 自然 trackEnd
                s.empty_ticks += 1;
                let elapsed = s.seek_offset + (s.frames_played as f64) * FRAME_MS as f64 / 1000.0;
                let near_end = if s.last_dur > 0.0 {
                    (s.last_dur - elapsed) <= 5.0
                } else {
                    true // 时长未知时保守处理（node 同款）
                };
                let threshold: u64 = if near_end { 250 } else { 3000 };
                if s.empty_ticks >= threshold {
                    s.empty_ticks = 0;
                    s.kill_requested = true; // read_loop 周期唤醒时执行 start_kill
                }
                Tick::Idle
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
                let level = s.pcm.len();
                drop(s);
                send_progress(writer, pos_ms, level).await;
            }
        }
        Err(e) => send_error(writer, "opus_encode", &format!("{e:?}")).await,
    }
}

// ---- 主入口 ----

#[tokio::main]
async fn main() -> Result<()> {
    // Linux 下尽力提升调度优先级（renice 负值需要 CAP_SYS_NICE，失败静默）
    #[cfg(unix)]
    {
        let _ = unsafe { libc::nice(-5) };
    }

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
        if type_byte == b'P' {
            // 外部 PCM 喂入（Spotify 边车）：原样进缓冲；上限 8MB 防异常生产者
            let mut s = session.lock().await;
            if s.external && s.active {
                if s.pcm.len() + buf.len() <= 8 * 1024 * 1024 {
                    s.pcm.extend_from_slice(&buf);
                } else {
                    drop(s);
                    let _ = send_error(&writer, "pcm_overflow", "external PCM buffer over 8MB").await;
                }
            }
            continue;
        }
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
                let external = v["external"].as_bool().unwrap_or(false);
                handle_play(&session, &writer, &notify, url, seek, dur, &ffmpeg_bin, external).await;
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
                    handle_play(&session, &writer, &notify, url, sec, dur, &ffmpeg_bin, false).await;
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
