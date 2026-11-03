// 中文 OCR：tesseract.js + 随包 langdata（chi_sim），首次调用时初始化并复用 worker。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSharp } from './native.js';
import { rapidOcr, rapidOcrAvailable } from './rapidocr.js';
import { cachedOcrResult, saveOcrResult } from './cache.js';
import { ToolError, requireFile } from './toolchain.js';

const require = createRequire(import.meta.url);

let workerPromise = null;

function localLangPath() {
  try {
    const entry = require.resolve('@tesseract.js-data/chi_sim/package.json');
    return join(dirname(entry), '4.0.0_best_int');
  } catch {
    return null;
  }
}

function getWorker() {
  if (workerPromise) return workerPromise;
  const langPath = localLangPath();
  const { createWorker } = require('tesseract.js');
  workerPromise = createWorker('chi_sim', 1, {
    ...(langPath ? { langPath } : {}),
    gzip: true,
    cacheMethod: 'none',
    logger: () => {},
  }).catch((error) => {
    workerPromise = null;
    throw new ToolError('ocr-init-failed', `OCR 引擎初始化失败：${error?.message ?? error}`);
  });
  return workerPromise;
}

/** 识别图片中的中文字幕/文字，返回整段文本与逐行结果。 */
export async function imageOcr(imagePath, params = {}) {
  const abs = requireFile(imagePath, 'imagePath');
  const engineHint = params && params.toolchain && rapidOcrAvailable(params.toolchain) ? 'rapidocr' : 'tesseract';
  if (params && params.toolchain) {
    const cached = cachedOcrResult(params.toolchain, abs, engineHint);
    if (cached) return { ...cached, cached: true };
  }
  if (params && params.toolchain && rapidOcrAvailable(params.toolchain)) {
    try {
      const rapid = await rapidOcr(params.toolchain, abs);
      if (rapid && rapid.text) {
        saveOcrResult(params.toolchain, abs, 'rapidocr', rapid);
        return rapid;
      }
    } catch {
      /* RapidOCR 失败时回退 tesseract */
    }
  }
  let buffer;
  try {
    // 预处理提升小字幕可读性：灰度 + 归一化 + 小图放大 2 倍。
    const sharp = getSharp();
    const meta = await sharp(abs).rotate().metadata();
    let pipeline = sharp(abs).rotate().grayscale().normalize();
    if ((meta.width ?? 0) > 0 && meta.width < 1600) {
      pipeline = pipeline.resize({ width: Math.min(3200, Math.round(meta.width * 2)) });
    }
    buffer = await pipeline.png().toBuffer();
  } catch (error) {
    try {
      buffer = readFileSync(abs);
    } catch (readError) {
      throw new ToolError('read-failed', `无法读取图片：${abs}（${readError?.message ?? readError}）`);
    }
  }
  const worker = await getWorker();
  let result;
  try {
    // blocks:true 才会返回逐行结构（默认只返回整段 text）。
    result = await worker.recognize(buffer, {}, { text: true, blocks: true });
  } catch (error) {
    throw new ToolError('ocr-failed', `OCR 识别失败：${error?.message ?? error}`);
  }
  const data = result?.data ?? {};
  const lines = [];
  for (const block of Array.isArray(data.blocks) ? data.blocks : []) {
    for (const paragraph of Array.isArray(block.paragraphs) ? block.paragraphs : []) {
      for (const line of Array.isArray(paragraph.lines) ? paragraph.lines : []) {
        const text = String(line.text ?? '').trim();
        if (text === '') continue;
        lines.push({
          text,
          confidence: Number(line.confidence ?? 0),
          bbox: line.bbox
            ? { x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 }
            : null,
        });
      }
    }
  }
  // 按阅读顺序（先上后下、先左后右）排序
  lines.sort((a, b) => {
    const ay = a.bbox?.y0 ?? 0;
    const by = b.bbox?.y0 ?? 0;
    if (Math.abs(ay - by) > 8) return ay - by;
    return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0);
  });
  const finalResult = {
    ok: true,
    engine: 'tesseract',
    lang: 'chi_sim',
    text: String(data.text ?? '').trim(),
    lines,
    count: lines.length,
    meanConfidence: lines.length
      ? Number((lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length).toFixed(1))
      : 0,
  };
  if (params && params.toolchain) saveOcrResult(params.toolchain, abs, 'tesseract', finalResult);
  return finalResult;
}

/** 插件卸载时终止 worker。 */
export async function disposeOcr() {
  if (!workerPromise) return;
  const current = workerPromise;
  workerPromise = null;
  try {
    const worker = await current;
    await worker?.terminate?.();
  } catch {
    // 忽略卸载期错误
  }
}
