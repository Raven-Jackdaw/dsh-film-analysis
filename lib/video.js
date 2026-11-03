// 视频：ffprobe 元信息、按时间抽帧、接触表拼图、场景检测/自动拉片。
import { getSharp } from './native.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { imageMetrics } from './metrics.js';
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

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 并发受限的 map（避免一次拉满 ffmpeg 进程）。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(Math.max(1, limit), items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** 从 ffmpeg showinfo 的 stderr 中解析场景切换时间点。 */
function parseSceneTimes(stderr) {
  const times = [];
  for (const line of String(stderr ?? '').split('\n')) {
    const match = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (match) times.push(Number(match[1]));
  }
  return times;
}

/** 场景/镜头检测：用 ffmpeg scene 分数切分镜头，返回时间区间列表。 */
export async function sceneDetect(toolchain, videoPath, params = {}) {
  const abs = requireFile(videoPath, 'videoPath');
  const threshold = clampNumber(params.threshold, 0.05, 0.9, 0.32);
  const probe = await videoProbe(toolchain, abs);
  const duration = Number(probe.duration) || 0;
  if (!(duration > 0)) throw new ToolError('probe-failed', '无法读取视频时长');
  // 默认全帧全分辨率检测以保证准确率；sampleFps>0 时才抽样（更快但可能漏检）。
  const sampleFps = clampNumber(params.sampleFps, 0, 30, 0);
  const filters = [];
  if (sampleFps > 0) filters.push(`fps=${sampleFps}`);
  filters.push(`select='gt(scene,${threshold})',showinfo`);
  const { stderr } = await runBinary(
    toolchain.ffmpegPath,
    ['-hide_banner', '-loglevel', 'info', '-i', abs, '-an', '-vf', filters.join(','), '-f', 'null', '-'],
    toolchain,
    { timeoutMs: 300000, maxBuffer: 128 * 1024 * 1024 },
  );
  const cuts = parseSceneTimes(stderr)
    .filter((time) => Number.isFinite(time) && time > 0.05 && time < duration - 0.05)
    .sort((a, b) => a - b);
  const bounds = [0, ...cuts, duration];
  const minShot = clampNumber(params.minShotDuration, 0.1, 5, 0.35);
  const rawShots = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start < 0.1) continue;
    rawShots.push({ start, end, duration: end - start });
  }
  // 合并过短的碎镜头（检测抖动造成），避免把一次切分拆成多个 0.2s 片段。
  const merged = [];
  for (const raw of rawShots) {
    if (merged.length > 0 && raw.duration < minShot) {
      const previous = merged[merged.length - 1];
      previous.end = raw.end;
      previous.duration = raw.end - previous.start;
    } else {
      merged.push({ ...raw });
    }
  }
  const shots = merged
    .filter((shot) => shot.duration >= minShot * 0.5)
    .map((shot, index) => ({
      index: index + 1,
      start: Number(shot.start.toFixed(3)),
      end: Number(shot.end.toFixed(3)),
      duration: Number(shot.duration.toFixed(3)),
    }));
  return {
    ok: true,
    duration: Number(duration.toFixed(3)),
    threshold,
    totalShots: shots.length,
    shots,
  };
}

const LONG_SHOT_SECONDS = 20;
const LETTERBOX_DARK = 16;

/** 自动检测并裁掉画面上下/左右的黑边（letterbox/pillarbox），避免测量被黑边污染。 */
async function trimLetterbox(buffer) {
  const sharp = getSharp();
  let pixels;
  try {
    pixels = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return buffer;
  }
  const { data, info } = pixels;
  const { width, height, channels } = info;
  if (!width || !height) return buffer;
  const stepX = Math.max(1, Math.floor(width / 160));
  const stepY = Math.max(1, Math.floor(height / 90));
  const luma = (x, y) => {
    const o = (y * width + x) * channels;
    return 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  };
  const rowMean = (y) => {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < width; x += stepX) {
      sum += luma(x, y);
      count += 1;
    }
    return sum / Math.max(1, count);
  };
  const colMean = (x) => {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y += stepY) {
      sum += luma(x, y);
      count += 1;
    }
    return sum / Math.max(1, count);
  };
  let top = 0;
  while (top < height - 2 && rowMean(top) < LETTERBOX_DARK) top += 1;
  let bottom = height - 1;
  while (bottom > top + 1 && rowMean(bottom) < LETTERBOX_DARK) bottom -= 1;
  let left = 0;
  while (left < width - 2 && colMean(left) < LETTERBOX_DARK) left += 1;
  let right = width - 1;
  while (right > left + 1 && colMean(right) < LETTERBOX_DARK) right -= 1;
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  if (cropWidth < width * 0.4 || cropHeight < height * 0.4) return buffer;
  if (cropWidth === width && cropHeight === height) return buffer;
  try {
    return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).jpeg({ quality: 92 }).toBuffer();
  } catch {
    return buffer;
  }
}

/** 自动拉片：检测镜头 + 抽代表帧（长镜头多帧）+ 客观测量（供面板一键分析）。 */
export async function autoShots(toolchain, videoPath, params = {}) {
  const startedAt = Date.now();
  const maxShots = Math.round(clampNumber(params.maxShots, 1, 40, 12));
  const detected = await sceneDetect(toolchain, videoPath, params);
  const sceneMs = Date.now() - startedAt;
  const abs = requireFile(videoPath, 'videoPath');
  const all = detected.shots;
  if (all.length === 0) throw new ToolError('no-shots', '未检测到镜头切换（可尝试调低 threshold）');
  let picked = all;
  let truncated = false;
  if (all.length > maxShots) {
    truncated = true;
    // 优先保留长镜头（信息量最大），剩余名额按时间轴等距补齐。
    const longs = all.filter((shot) => shot.duration >= LONG_SHOT_SECONDS).slice(0, maxShots);
    const rest = all.filter((shot) => !longs.includes(shot));
    const remaining = maxShots - longs.length;
    picked = [...longs];
    if (remaining > 0 && rest.length > 0) {
      for (let i = 0; i < remaining; i += 1) {
        const index = Math.round((i * (rest.length - 1)) / Math.max(1, remaining - 1));
        picked.push(rest[index]);
      }
    }
    picked.sort((a, b) => a.start - b.start);
  }
  const plans = picked.map((shot, i) => {
    const isLong = shot.duration >= LONG_SHOT_SECONDS;
    const frameCount = shot.duration >= 240 ? 5 : isLong ? 3 : 1;
    const times =
      frameCount === 1
        ? [Number((shot.start + shot.duration * 0.5).toFixed(3))]
        : Array.from({ length: frameCount }, (_, k) =>
            Number((shot.start + shot.duration * ((k + 1) / (frameCount + 1))).toFixed(3)),
          );
    return { shot, i, isLong, times };
  });
  const jobs = [];
  for (const plan of plans) for (let k = 0; k < plan.times.length; k += 1) jobs.push({ plan, k, time: plan.times[k] });
  // 并发 4 路抽帧（独立 ffmpeg 进程），比串行快数倍。
  const extracted = await mapLimit(jobs, 4, async (job) => {
    const rawBuffer = await extractFrameBuffer(toolchain, abs, job.time, 720, 'jpg');
    const buffer = await trimLetterbox(rawBuffer);
    const planIndex = String(job.plan.i + 1).padStart(2, '0');
    const name = job.plan.isLong ? `shot-${planIndex}-${job.k + 1}` : `shot-${planIndex}`;
    const out = outputFile(toolchain, name, 'jpg');
    writeFileSync(out.path, buffer);
    return { plan: job.plan, time: job.time, path: out.path, url: out.url };
  });
  const byPlan = new Map();
  for (const item of extracted) {
    if (!byPlan.has(item.plan)) byPlan.set(item.plan, []);
    byPlan.get(item.plan).push(item);
  }
  const shots = [];
  for (const plan of plans) {
    const frames = (byPlan.get(plan) ?? [])
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((frame) => ({ time: frame.time, path: frame.path, url: frame.url }));
    const primary = frames[Math.floor((frames.length - 1) / 2)] || frames[0];
    let metrics = null;
    try {
      metrics = await imageMetrics(primary.path);
    } catch {
      metrics = null;
    }
    // 长镜头再切成 60 秒左右的分析单元，便于面板逐段做拉片分析。
    let segments = [];
    if (plan.shot.duration > 90) {
      const count = Math.min(8, Math.ceil(plan.shot.duration / 60));
      const step = plan.shot.duration / count;
      segments = Array.from({ length: count }, (_, index) => ({
        index: index + 1,
        start: Number((plan.shot.start + step * index).toFixed(3)),
        end: Number((plan.shot.start + step * (index + 1)).toFixed(3)),
        duration: Number(step.toFixed(3)),
      }));
    }
    shots.push({
      index: plan.i + 1,
      start: plan.shot.start,
      end: plan.shot.end,
      duration: plan.shot.duration,
      time: primary.time,
      longShot: plan.isLong,
      frameCount: frames.length,
      frames,
      framePath: primary.path,
      frameUrl: primary.url,
      metrics,
      segments,
    });
  }
  return {
    ok: true,
    duration: detected.duration,
    threshold: detected.threshold,
    totalShots: detected.totalShots,
    returned: shots.length,
    truncated,
    maxShots,
    timings: { sceneMs, totalMs: Date.now() - startedAt },
    shots,
  };
}

// ===========================================================================
// 片段级分析：对 [start,end] 片段抽低分辨率灰度帧，估计运动方向/幅度，
// 统计亮度变化（淡入淡出/闪烁），并读取音量与静音比例。
// 用于让 AI 分析"片段"而不是只看一张静帧。
// ===========================================================================

const CLIP_SAMPLE_FPS = 4;
const CLIP_WIDTH = 64;
const CLIP_HEIGHT = 36;

function roundTo(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export async function audioStats(toolchain, videoPath, start, end) {
  const abs = requireFile(videoPath, 'videoPath');
  const from = Math.max(0, Number(start) || 0);
  const to = Number(end);
  if (!(Number.isFinite(to) && to > from)) return null;
  const duration = to - from;
  try {
    const { stderr } = await runBinary(
      toolchain.ffmpegPath,
      [
        '-hide_banner', '-nostats',
        '-ss', String(from), '-to', String(to), '-i', abs, '-vn',
        '-af', 'volumedetect,silencedetect=noise=-35dB:d=0.3',
        '-f', 'null', '-',
      ],
      toolchain,
      { timeoutMs: 180000, maxBuffer: 16 * 1024 * 1024 },
    );
    const meanMatch = /mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr);
    const maxMatch = /max_volume:\s*(-?[0-9.]+) dB/.exec(stderr);
    let silenceSeconds = 0;
    const silencePattern = /silence_duration:\s*([0-9.]+)/g;
    let match;
    while ((match = silencePattern.exec(stderr)) !== null) silenceSeconds += Number(match[1]);
    let peakCount = 0;
    const peakPattern = /silence_end:/g;
    while ((match = peakPattern.exec(stderr)) !== null) peakCount += 1;
    return {
      meanVolumeDb: meanMatch ? Number(meanMatch[1]) : null,
      maxVolumeDb: maxMatch ? Number(maxMatch[1]) : null,
      silenceSeconds: roundTo(silenceSeconds, 2),
      silenceRatio: roundTo(silenceSeconds / Math.max(0.001, duration), 3),
      silenceSegments: peakCount,
    };
  } catch {
    return null;
  }
}

export async function analyzeClip(toolchain, videoPath, params = {}) {
  const abs = requireFile(videoPath, 'videoPath');
  const start = Math.max(0, Number(params.start) || 0);
  const rawEnd = Number(params.end);
  if (!Number.isFinite(rawEnd) || rawEnd <= start) {
    throw new ToolError('bad-argument', '片段起止时间无效');
  }
  const end = rawEnd;
  const duration = Number((end - start).toFixed(3));
  const sampleFps = Math.round(clampNumber(params.fps, 2, 8, CLIP_SAMPLE_FPS));
  const width = CLIP_WIDTH;
  const height = CLIP_HEIGHT;
  // 长片段只解码关键帧（快很多），短片段全解码；关键帧采样仍能看出运动趋势。
  const useKeyframes = duration > 90 && params.full !== true;
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (useKeyframes) args.push('-skip_frame', 'nokey');
  args.push(
    '-ss', String(start), '-to', String(end), '-i', abs, '-an',
    '-vf', `fps=${sampleFps},scale=${width}:${height}`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  );

  const { buffer } = await runBinaryBuffer(toolchain.ffmpegPath, args, toolchain, {
    timeoutMs: 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const frameBytes = width * height;
  const frameCount = Math.floor(buffer.length / frameBytes);
  if (frameCount === 0) throw new ToolError('clip-empty', '片段没有可分析的画面');
  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(buffer.subarray(i * frameBytes, (i + 1) * frameBytes));
  }
  const lumaSeries = frames.map((frame) => {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) sum += frame[i];
    return sum / frame.length;
  });

  // 以相邻帧整帧差异最小的平移量估计全局运动（±5 像素，步长 2 加速）。
  // 最多少采样 120 对帧，长片段也不会因逐对匹配而变慢。
  const shifts = [];
  const radius = 5;
  const shiftStride = Math.max(1, Math.ceil(frames.length / 120));
  for (let i = shiftStride; i < frames.length; i += shiftStride) {
    const previous = frames[i - shiftStride];
    const current = frames[i];
    let bestDx = 0;
    let bestDy = 0;
    let bestScore = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        let sum = 0;
        let count = 0;
        const y0 = Math.max(2, -dy + 2);
        const y1 = Math.min(height - 2, height - 2 - Math.max(0, dy));
        const x0 = Math.max(2, -dx + 2);
        const x1 = Math.min(width - 2, width - 2 - Math.max(0, dx));
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const diff = previous[y * width + x] - current[(y + dy) * width + (x + dx)];
            sum += Math.abs(diff);
            count += 1;
          }
        }
        const score = sum / Math.max(1, count);
        if (score < bestScore) {
          bestScore = score;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    shifts.push({ dx: bestDx, dy: bestDy, diff: bestScore / 255 });
  }
  const average = (list, pick) => list.reduce((sum, item) => sum + pick(item), 0) / Math.max(1, list.length);
  const avgDx = average(shifts, (item) => item.dx);
  const avgDy = average(shifts, (item) => item.dy);
  const magnitude = Math.hypot(avgDx, avgDy);
  const jitter = average(shifts, (item) => Math.abs(item.dx - avgDx) + Math.abs(item.dy - avgDy));
  const frameDiff = average(shifts, (item) => item.diff);
  let motionClass = '固定镜头（接近静止）';
  if (frameDiff > 0.012 || magnitude > 1.2) {
    if (magnitude >= 1.2 && Math.abs(avgDx) >= Math.abs(avgDy)) motionClass = '横向运动（摇/移/跟）';
    else if (magnitude >= 1.2) motionClass = '纵向运动（摇/升降/跟）';
    else if (jitter > 2.2) motionClass = '手持/晃动';
    else if (frameDiff > 0.05) motionClass = '画面内部运动/快速变化';
    else motionClass = '轻微运动';
  }

  const brightnessChange = average(
    lumaSeries.slice(1).map((value, index) => Math.abs(value - lumaSeries[index])),
    (item) => item,
  );
  const brightness = {
    mean: roundTo(average(lumaSeries, (item) => item)),
    min: roundTo(Math.min(...lumaSeries)),
    max: roundTo(Math.max(...lumaSeries)),
    first: roundTo(lumaSeries[0]),
    last: roundTo(lumaSeries[lumaSeries.length - 1]),
    flicker: roundTo(brightnessChange, 2),
  };
  const transitions = {
    fadeIn: brightness.first < 40 && brightness.max > 60 && brightness.mean > brightness.first * 1.3,
    fadeOut: brightness.last < 40 && brightness.mean > brightness.last * 1.3,
  };

  const audio = await audioStats(toolchain, abs, start, end);

  return {
    ok: true,
    start: roundTo(start, 3),
    end: roundTo(end, 3),
    duration: roundTo(duration, 3),
    sampleFps,
    sampling: useKeyframes ? 'keyframes' : 'full',
    frameCount,
    motion: {
      class: motionClass,
      avgDx: roundTo(avgDx, 2),
      avgDy: roundTo(avgDy, 2),
      magnitude: roundTo(magnitude, 2),
      jitter: roundTo(jitter, 2),
      frameDiff: roundTo(frameDiff, 3),
    },
    brightness,
    transitions,
    audio,
  };
}
