// 阶段2 spike（已验证通过）：
// 1) opus-codec 0.2.0 能在 Windows + MSVC(BuildTools 18) 下编译捆绑的 libopus
//    —— 前提是把 VS 自带的 cmake 加入 PATH（本机无需单独安装 cmake）。
// 2) 真实编码一帧 20ms/48k/立体声 PCM，验证 API 与 @discordjs/opus 对齐的参数。
use opus_codec::encoder::Encoder;
use opus_codec::{Application, Channels, SampleRate};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 与现有 @discordjs/opus 输出字节级对齐：48k / 立体声 / VoIP 应用档
    let mut encoder = Encoder::new(SampleRate::Hz48000, Channels::Stereo, Application::Voip)?;

    // 20ms @ 48k 立体声 = 960 样本/声道 × 2 声道 = 1920 个 i16 = 3840 字节
    let pcm: Vec<i16> = vec![0; 960 * 2];
    let mut out = vec![0u8; 4000];
    let n = encoder.encode(&pcm, &mut out)?;
    println!(
        "OK: 编码一帧 3840 字节静音 PCM -> {} 字节 Opus (20ms/48k/stereo/VoIP)",
        n
    );
    Ok(())
}
