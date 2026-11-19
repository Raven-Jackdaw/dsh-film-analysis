// 剪辑与成片：EDL（剪辑决策表）→ ffmpeg trim/concat 渲染。
// 两个方案共用：A=自动粗剪（planAutoEdit），B=手动剪辑（normalizeClips）。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError, outputFile, requireFile, runBinaryBuffer } from './toolchain.js';
import { videoProbe } from './video.js';

const MAX_CLIPS = 60;
const MAX_SPEED = 2;
const MIN_SPEED = 0.5;

function roundTo(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const EDIT_MODES = {
  commentary: { id: 'commentary', name: '电影解说型', maxShot: 8, minShot: 2 },
  analysis: { id: 'analysis', name: '拉片教学型', maxShot: 20, minShot: 3 },
  highlight: { id: 'highlight', name: '高光传播型', maxShot: 4, minShot: 1.5 },
  lesson: { id: 'lesson', name: '课堂微课型', maxShot: 12, minShot: 3 },
};

/** 校验并规范化手动剪辑片段。 */
export function normalizeClips(rawClips, duration) {
  if (!Array.isArray(rawClips) || rawClips.length === 0) throw new ToolError('bad-argument', 'clips 不能为空');
  if (rawClips.length > MAX_CLIPS) throw new ToolError('bad-argument', `片段数量不能超过 ${MAX_CLIPS}`);
  const total = Number(duration);
  const clips = [];
  for (const [index, item] of rawClips.entries()) {
    const source = Array.isArray(item)
      ? { in: Number(item[0]), out: Number(item[1]) }
      : item && typeof item === 'object'
        ? { in: Number(item.in ?? item.start), out: Number(item.out ?? item.end), speed: item.speed, volume: item.volume, mute: item.mute }
        : null;
    if (!source) throw new ToolError('bad-argument', `第 ${index + 1} 个片段格式不正确`);
    const inPoint = clamp(source.in, 0, total);
    const outPoint = clamp(source.out, 0, total);
    if (!(outPoint > inPoint)) throw new ToolError('bad-argument', `第 ${index + 1} 个片段起止时间无效`);
    const speed = clamp(Number(source.speed) || 1, MIN_SPEED, MAX_SPEED);
    const volume = clamp(Number.isFinite(Number(source.volume)) ? Number(source.volume) : 1, 0, 2);
    clips.push({
      in: roundTo(inPoint, 3),
      out: roundTo(outPoint, 3),
      speed: roundTo(speed, 3),
      volume: roundTo(volume, 2),
      mute: Boolean(source.mute),
    });
  }
  const outputDuration = clips.reduce((sum, clip) => sum + (clip.out - clip.in) / clip.speed, 0);
  if (outputDuration > 2 * 60 * 60) throw new ToolError('bad-argument', '成片时长超过 2 小时上限');
  return { clips, outputDuration: roundTo(outputDuration, 3) };
}

/** 自动粗剪：按模式把镜头压到合理长度，并把总时长收进目标时长。 */
export function planAutoEdit(shots, options = {}) {
  const mode = EDIT_MODES[options.mode] ? options.mode : 'commentary';
  const config = EDIT_MODES[mode];
  const targetSeconds = Math.max(10, Number(options.targetSeconds) || 180);
  const sourceShots = Array.isArray(shots) ? shots : [];
  if (sourceShots.length === 0) throw new ToolError('bad-argument', '缺少镜头列表，无法自动粗剪');
  let clips = sourceShots
    .filter((shot) => Number(shot.end) > Number(shot.start))
    .map((shot) => {
      const start = Number(shot.start) || 0;
      const end = Number(shot.end) || start;
      const keep = Math.min(end - start, config.maxShot);
      return { in: roundTo(start, 3), out: roundTo(start + keep, 3), sourceOut: roundTo(end, 3), speed: 1, volume: 1, mute: false };
    })
    .filter((clip) => clip.out - clip.in >= 0.5);
  if (clips.length === 0) throw new ToolError('bad-argument', '没有可用镜头');

  let total = clips.reduce((sum, clip) => sum + (clip.out - clip.in) / clip.speed, 0);
  // 总时长不足目标：优先把长镜头片段补齐（不超出原镜头范围）。
  if (total < targetSeconds * 0.92) {
    const candidates = [...clips].sort((a, b) => (b.sourceOut - b.out) - (a.sourceOut - a.out));
    for (const clip of candidates) {
      const need = targetSeconds - total;
      if (need <= 0.5) break;
      const extra = (clip.sourceOut || clip.out) - clip.out;
      if (extra <= 0.2) continue;
      const add = Math.min(extra, need);
      clip.out = roundTo(clip.out + add, 3);
      total += add;
    }
  }
  // 总时长超出目标：从最长片段开始压缩，直到目标内（每段不低于 minShot）。
  let guard = 0;
  while (total > targetSeconds + 0.5 && guard < 500) {
    guard += 1;
    let longestIndex = 0;
    for (let i = 1; i < clips.length; i += 1) {
      const current = (clips[i].out - clips[i].in) / clips[i].speed;
      const best = (clips[longestIndex].out - clips[longestIndex].in) / clips[longestIndex].speed;
      if (current > best) longestIndex = i;
    }
    const clip = clips[longestIndex];
    const currentDuration = (clip.out - clip.in) / clip.speed;
    if (currentDuration <= config.minShot + 0.01) {
      // 都已到最短，删掉最短片段中的最后一个，继续收时长
      if (clips.length <= 1) break;
      const shortestIndex = clips.reduce(
        (best, item, index) => ((item.out - item.in) / item.speed < (clips[best].out - clips[best].in) / clips[best].speed ? index : best),
        0,
      );
      clips.splice(shortestIndex, 1);
    } else {
      const cut = Math.min(currentDuration - config.minShot, total - targetSeconds, 1);
      clip.out = roundTo(clip.out - cut, 3);
      if (clip.out - clip.in < config.minShot) clip.out = roundTo(clip.in + config.minShot, 3);
    }
    total = clips.reduce((sum, item) => sum + (item.out - item.in) / item.speed, 0);
  }
  return {
    mode,
    modeName: config.name,
    targetSeconds,
    clips,
    outputDuration: roundTo(total, 3),
  };
}

function escapeFilterPath(file) {
  return String(file).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** 渲染 EDL 为 MP4（trim + 变速 + 拼接；可选烧录字幕）。 */
export async function renderEdit(toolchain, options = {}) {
  const videoPath = requireFile(options.videoPath, 'videoPath');
  const probe = await videoProbe(toolchain, videoPath);
  const normalized = normalizeClips(options.clips, probe.duration);
  const clips = normalized.clips;
  const out = outputFile(toolchain, options.outputName || 'edit', 'mp4', 'edits');
  const narrationPath = options.narrationPath && existsSync(options.narrationPath) ? options.narrationPath : null;
  mkdirSync(join(toolchain.dirs.root, 'edits'), { recursive: true });
  const hasAudio = Boolean(probe.hasAudio);
  const filters = [];
  for (const [index, clip] of clips.entries()) {
    const duration = clip.out - clip.in;
    filters.push(
      `[0:v]trim=start=${clip.in}:end=${clip.out},setpts=(PTS-STARTPTS)/${clip.speed},setsar=1[v${index}]`,
    );
    if (hasAudio && !clip.mute) {
      filters.push(
        `[0:a]atrim=start=${clip.in}:end=${clip.out},asetpts=PTS-STARTPTS,atempo=${clip.speed},volume=${clip.volume}[a${index}]`,
      );
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${roundTo(duration / clip.speed, 3)}[a${index}]`);
    }
  }
  const concatInputs = clips.map((_, index) => `[v${index}][a${index}]`).join('');
  filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[vcat][acat]`);
  let videoMap = '[vcat]';
  if (options.subtitlesPath) {
    filters.push(`[vcat]ass=${escapeFilterPath(options.subtitlesPath)}[vsub]`);
    videoMap = '[vsub]';
  }
  let audioMap = '[acat]';
  if (narrationPath) {
    filters.push('[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.0,asplit=2[narr][narr_sc]');
    if (hasAudio) {
      filters.push('[acat]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[orig]');
      filters.push('[orig][narr_sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck]');
      filters.push('[duck][narr]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]');
    } else {
      filters.push('[narr]loudnorm=I=-16:TP=-1.5:LRA=11[aout]');
    }
    audioMap = '[aout]';
  }
  const inputArgs = narrationPath ? ['-i', videoPath, '-i', narrationPath] : ['-i', videoPath];
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputArgs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    videoMap,
    '-map',
    audioMap,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
  const { buffer } = await runBinaryBuffer(toolchain.ffmpegPath, args, toolchain, {
    timeoutMs: 30 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 1024,
  });
  writeFileSync(out.path, buffer);
  return {
    ok: true,
    outputPath: out.path,
    url: out.url,
    clips,
    sourceDuration: roundTo(probe.duration, 3),
    outputDuration: normalized.outputDuration,
    hasAudio,
  };
}
