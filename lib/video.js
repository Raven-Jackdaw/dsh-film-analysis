// 视频：ffprobe 元信息、按时间抽帧、接触表拼图。
import { getSharp } from './native.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { ToolError, outputFile, requireFile, runBinary, runBinaryBuffer } from './toolchain.js';

function parseFps(value) {
  if (typeof value !== 'string' || value.trim() === '') return 0;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num)) return 0;
  if (!Number.isFinite(den) || den === 0) return num;
  return num / den;
}

function aspectLabel(ratio) {
  const standards = [
    [1, '1:1'], [1.3333, '4:3'], [1.5, '3:2'], [1.7778, '16:9'], [1.85, '1.85:1'],
    [2, '2:1'], [2.35, '2.35:1'], [2.39, '2.39:1'], [0.5625, '9:16'], [0.75, '3:4'],
  ];
  let best = `${ratio.toFixed(2)}:1`;
  let bestDelta = Infinity;
  for (const [value, label] of standards) {
    const delta = Math.abs(ratio - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = label;
    }
  }
  return bestDelta <= 0.06 * ratio ? best : `${ratio.toFixed(2)}:1`;
}

export async function videoProbe(toolchain, videoPath) {
  const abs = requireFile(videoPath, 'videoPath');
  const { stdout } = await runBinary(
    toolchain.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs],
    toolchain,
    { timeoutMs: 60000 },
  );
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new ToolError('probe-failed', 'ffprobe 输出无法解析');
  }
  const streams = Array.isArray(json.streams) ? json.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new ToolError('not-video', `文件没有视频流：${abs}`);
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const duration = Number(json.format?.duration ?? video.duration) || 0;
  const ratio = width && height ? width / height : 0;
  return {
    ok: true,
    duration: Number(duration.toFixed(3)),
    durationLabel: `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`,
    width,
    height,
    aspectRatio: Number(ratio.toFixed(3)),
    aspectLabel: ratio ? aspectLabel(ratio) : 'unknown',
    fps: Number(parseFps(video.r_frame_rate).toFixed(3)),
    codec: video.codec_name ?? '',
    profile: video.profile ?? '',
    pixFmt: video.pix_fmt ?? '',
    bitrate: Number(json.format?.bit_rate ?? video.bit_rate) || 0,
    sizeBytes: Number(json.format?.size) || 0,
    rotation: Number(video.tags?.rotate ?? 0) || 0,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? '',
    channels: Number(audio?.channels) || 0,
    sampleRate: Number(audio?.sample_rate) || 0,
    container: json.format?.format_name ?? '',
  };
}

/** 解析抽帧时间点：times 优先；否则用 range(start,end,step)；都没有则取均匀 N 帧。 */
export function resolveTimes(duration, params = {}) {
  const list = [];
  if (Array.isArray(params.times) && params.times.length > 0) {
    for (const value of params.times) {
      const t = Number(value);
      if (Number.isFinite(t) && t >= 0) list.push(t);
    }
  } else if (params.range && typeof params.range === 'object') {
    const start = Math.max(0, Number(params.range.start) || 0);
    const end = Number(params.range.end) || duration;
    const step = Math.max(0.05, Number(params.range.step) || Math.max(1, (end - start) / 9));
    for (let t = start; t < Math.min(end, duration); t += step) list.push(Number(t.toFixed(3)));
  } else {
    const count = Math.max(1, Math.min(24, Number(params.count) || 9));
    const usable = Math.max(0.1, duration - 0.1);
    for (let i = 0; i < count; i += 1) {
      list.push(Number((((i + 0.5) / count) * usable).toFixed(3)));
    }
  }
  return list.slice(0, 60);
}

function scaleFilter(scale) {
  const width = Number(scale);
  if (!Number.isFinite(width) || width <= 0) return null;
  const bounded = Math.max(64, Math.min(7680, Math.round(width)));
  return `scale=${bounded}:-2:flags=lanczos`;
}

/** 抽取一帧并返回图片字节（ffmpeg 只写 stdout，由 Host 进程写入磁盘）。 */
async function extractFrameBuffer(toolchain, videoPath, time, scale, format = 'jpg') {
  const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', videoPath, '-frames:v', '1'];
  const filter = scaleFilter(scale);
  if (filter) args.push('-vf', filter);
  if (format === 'png') {
    args.push('-f', 'image2pipe', '-c:v', 'png', 'pipe:1');
  } else {
    args.push('-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1');
  }
  const { buffer } = await runBinaryBuffer(toolchain.ffmpegPath, args, toolchain);
  return buffer;
}

export async function extractFrames(toolchain, videoPath, params = {}) {
  const abs = requireFile(videoPath, 'videoPath');
  let duration = Number(params.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    const probe = await videoProbe(toolchain, abs);
    duration = probe.duration;
  }
  const times = resolveTimes(duration, params);
  if (times.length === 0) throw new ToolError('bad-argument', '没有可抽取的时间点');
  const frames = [];
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i];
    const out = outputFile(toolchain, `frame-${String(i + 1).padStart(2, '0')}`, 'jpg');
    const buffer = await extractFrameBuffer(toolchain, abs, time, params.scale, 'jpg');
    writeFileSync(out.path, buffer);
    frames.push({ index: i + 1, time, path: out.path, url: out.url });
  }
  return { ok: true, count: frames.length, duration: Number(duration.toFixed(3)), frames };
}

export async function contactSheet(toolchain, params = {}) {
  const sharp = getSharp();
  const cols = Math.max(1, Math.min(6, Number(params.cols) || 3));
  const cellWidth = Math.max(160, Math.min(960, Number(params.width) || 420));
  let frames = [];
  if (Array.isArray(params.frames) && params.frames.length > 0) {
    frames = params.frames
      .filter((item) => item && typeof item.path === 'string')
      .map((item, index) => ({
        index: index + 1,
        time: Number(item.time) || 0,
        path: requireFile(item.path, `frames[${index}].path`),
      }));
  } else if (typeof params.videoPath === 'string' && params.videoPath.trim() !== '') {
    const abs = requireFile(params.videoPath, 'videoPath');
    const probe = await videoProbe(toolchain, abs);
    const times = resolveTimes(probe.duration, params);
    for (let i = 0; i < times.length; i += 1) {
      const buffer = await extractFrameBuffer(toolchain, abs, times[i], cellWidth, 'jpg');
      frames.push({ index: i + 1, time: times[i], buffer });
    }
  }
  if (frames.length === 0) throw new ToolError('bad-argument', 'frames 或 videoPath 至少提供一个');
  const limited = frames.slice(0, Math.max(1, Math.min(36, Number(params.maxFrames) || 36)));
  const rows = Math.ceil(limited.length / cols);
  const cellHeight = Math.round(cellWidth * 0.625);
  const labelHeight = Math.max(18, Math.round(cellWidth * 0.075));
  const gap = Math.max(2, Math.round(cellWidth * 0.012));
  const sheetWidth = cols * cellWidth + (cols + 1) * gap;
  const sheetHeight = rows * (cellHeight + labelHeight) + (rows + 1) * gap;
  const composites = [];
  const labelSvgs = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const frame = limited[index];
      if (!frame) break;
      const left = gap + col * (cellWidth + gap);
      const top = gap + row * (cellHeight + labelHeight + gap);
      const buffer = await sharp(frame.buffer ?? frame.path)
        .rotate()
        .resize({ width: cellWidth, height: cellHeight, fit: 'cover', position: 'centre' })
        .jpeg({ quality: 86 })
        .toBuffer();
      composites.push({ input: buffer, left, top });
      const label = `${String(frame.index).padStart(2, '0')}  ${formatTime(frame.time)}`;
      labelSvgs.push(
        `<text x="${left}" y="${top + cellHeight + labelHeight * 0.8}" font-size="${Math.round(labelHeight * 0.72)}" font-family="'Microsoft YaHei',sans-serif" fill="#ffffff">${label}</text>`,
      );
      index += 1;
    }
  }
  const out = outputFile(toolchain, 'contact-sheet', 'png');
  const sheet = sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: { r: 18, g: 20, b: 24 },
    },
  });
  const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">${labelSvgs.join('')}</svg>`;
  composites.push({ input: Buffer.from(labelSvg), left: 0, top: 0 });
  const info = await sheet.composite(composites).png().toFile(out.path);
  return {
    ok: true,
    outputPath: out.path,
    url: out.url,
    width: info.width,
    height: info.height,
    count: index,
    cols,
    rows,
  };
}

export function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** 读取帧文件为 Buffer（供外部使用）。 */
export function readFrameBuffer(path) {
  return readFileSync(path);
}
