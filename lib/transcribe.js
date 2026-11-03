// 本地 faster-whisper 转写：把视频音轨转成带时间码台词，供分析 prompt 使用。
// 需要本机 Python + faster-whisper 模型（插件 config 可指定 pythonPath / whisperModelPath）。
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError, requireFile, runBinaryBuffer, runPython, parsePythonJson } from './toolchain.js';
import { videoProbe } from './video.js';
import { cachedTranscription, saveTranscription } from './cache.js';

const SCRIPT_PATH = fileURLToPath(new URL('./python/transcribe.py', import.meta.url));

export function transcribeAvailable(toolchain) {
  return Boolean(toolchain && toolchain.pythonPath && toolchain.whisperModelPath) && existsSync(SCRIPT_PATH);
}

export async function transcribe(toolchain, videoPath, params = {}) {
  const abs = requireFile(videoPath, 'videoPath');
  if (!transcribeAvailable(toolchain)) {
    throw new ToolError(
      'transcribe-unavailable',
      '本地转写需要 Python + faster-whisper 模型（可在插件配置 pythonPath / whisperModelPath 指定）',
    );
  }
  const options = { language: String(params.language || 'zh'), device: String(params.device || 'cpu'), computeType: String(params.computeType || 'int8'), model: toolchain.whisperModelPath };
  const cached = cachedTranscription(toolchain, abs, options);
  if (cached) return { ...cached, cached: true };
  const probe = await videoProbe(toolchain, abs);
  const wavPath = join(toolchain.dirs.tmp, `audio-${Date.now()}.wav`);
  // 注意：ffmpeg 子进程不能写 workspace 之外（沙箱），所以用 stdout 输出 WAV，再由 Host 落盘。
  const { buffer } = await runBinaryBuffer(
    toolchain.ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
    toolchain,
    { timeoutMs: 600000, maxBuffer: 256 * 1024 * 1024 },
  );
  writeFileSync(wavPath, buffer);
  try {
    const started = Date.now();
    const { stdout } = await runPython(
      toolchain,
      SCRIPT_PATH,
      [wavPath, toolchain.whisperModelPath, String(params.language || 'zh'), String(params.device || 'cpu'), String(params.computeType || 'int8')],
      { timeoutMs: Number(params.timeoutMs) || 3600000, maxBuffer: 32 * 1024 * 1024 },
    );
    const data = parsePythonJson(stdout, '本地转写');
    if (!data.ok) throw new ToolError('transcribe-failed', String(data.error || '本地转写失败'));
    const segments = (Array.isArray(data.segments) ? data.segments : [])
      .map((segment) => ({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || Number(segment.start) || 0,
        text: String(segment.text || '').trim(),
      }))
      .filter((segment) => segment.text !== '');
    const finalResult = {
      ok: true,
      engine: 'faster-whisper',
      language: String(params.language || 'zh'),
      device: String(params.device || 'cpu'),
      computeType: String(params.computeType || 'int8'),
      duration: probe.duration,
      segments,
      count: segments.length,
      timings: { totalMs: Date.now() - started },
    };
    saveTranscription(toolchain, abs, options, finalResult);
    return finalResult;
  } finally {
    try {
      rmSync(wavPath, { force: true });
    } catch {
      /* 临时文件清理失败忽略 */
    }
  }
}
