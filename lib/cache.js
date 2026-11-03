// 深度拉片缓存：帧/接触表/OCR/转写结果按「文件路径 + mtime + 参数」缓存，避免重复抽帧与重复调用。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function cacheRoot(toolchain) {
  const root = join(toolchain.dirs.root, 'cache');
  mkdirSync(root, { recursive: true });
  return root;
}

function cacheFile(toolchain, namespace, key) {
  const dir = join(cacheRoot(toolchain), namespace);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(String(key)).digest('hex').slice(0, 40);
  return join(dir, `${hash}.json`);
}

function fileStamp(path) {
  try {
    const stat = statSync(path);
    return `${stat.size}-${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

export function readCache(toolchain, namespace, key) {
  try {
    const file = cacheFile(toolchain, namespace, key);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeCache(toolchain, namespace, key, value) {
  try {
    writeFileSync(cacheFile(toolchain, namespace, key), JSON.stringify(value), 'utf8');
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

/** 缓存版抽帧：同一视频/时间点/尺寸只抽一次。 */
export async function cachedExtractFrames(toolchain, videoPath, { times, scale = 720 }) {
  const { extractFrames } = await import('./video.js');
  const key = `frames|${videoPath}|${fileStamp(videoPath)}|${scale}`;
  const manifest = readCache(toolchain, 'frames', key) || { frames: {} };
  const requested = times.map((time) => Number(time));
  const missing = requested.filter((time) => {
    const hit = manifest.frames[String(time)];
    return !hit || !hit.path || !existsSync(hit.path);
  });
  if (missing.length > 0) {
    const extracted = await extractFrames(toolchain, videoPath, { times: missing, scale });
    for (const frame of extracted.frames || []) {
      manifest.frames[String(Number(frame.time).toFixed(3))] = { time: frame.time, path: frame.path, url: frame.url };
    }
    writeCache(toolchain, 'frames', key, manifest);
  }
  const frames = [];
  for (const time of requested) {
    const hit = manifest.frames[String(Number(time).toFixed(3))];
    if (hit && hit.path && existsSync(hit.path)) frames.push({ time: hit.time, path: hit.path, url: hit.url });
  }
  return { ok: true, frames };
}

/** 缓存版接触表。 */
export async function cachedContactSheet(toolchain, videoPath, { times, cols = 3, width = 420 }) {
  const { contactSheet } = await import('./video.js');
  const key = `sheet|${videoPath}|${fileStamp(videoPath)}|${cols}|${width}|${times.map((t) => Number(t).toFixed(3)).join(',')}`;
  const hit = readCache(toolchain, 'sheets', key);
  if (hit && hit.outputPath && existsSync(hit.outputPath)) return hit;
  const sheet = await contactSheet(toolchain, { videoPath, times, cols, width });
  const value = { ok: true, outputPath: sheet.outputPath, url: sheet.url, width: sheet.width, height: sheet.height };
  writeCache(toolchain, 'sheets', key, value);
  return value;
}

/** OCR 结果缓存（key 由调用方给出引擎倾向）。 */
export function cachedOcrResult(toolchain, imagePath, engineHint) {
  const key = `ocr|${imagePath}|${fileStamp(imagePath)}|${engineHint}`;
  return readCache(toolchain, 'ocr', key);
}

export function saveOcrResult(toolchain, imagePath, engineHint, result) {
  const key = `ocr|${imagePath}|${fileStamp(imagePath)}|${engineHint}`;
  writeCache(toolchain, 'ocr', key, result);
}

/** 转写结果缓存。 */
export function cachedTranscription(toolchain, videoPath, options = {}) {
  const key = `whisper|${videoPath}|${fileStamp(videoPath)}|${JSON.stringify(options)}`;
  return readCache(toolchain, 'transcribe', key);
}

export function saveTranscription(toolchain, videoPath, options, result) {
  const key = `whisper|${videoPath}|${fileStamp(videoPath)}|${JSON.stringify(options)}`;
  writeCache(toolchain, 'transcribe', key, result);
}
