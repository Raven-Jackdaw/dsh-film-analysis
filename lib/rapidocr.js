// RapidOCR（PP-OCRv4）桥：调用本机 Python 的 rapidocr_onnxruntime 做中文 OCR；
// 本机没有 Python/rapidocr 时由 ocr.js 回退到 tesseract.js。
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ToolError, requireFile, runPython, parsePythonJson } from './toolchain.js';

const SCRIPT_PATH = fileURLToPath(new URL('./python/rapidocr.py', import.meta.url));

export function rapidOcrAvailable(toolchain) {
  return Boolean(toolchain && toolchain.pythonPath) && existsSync(SCRIPT_PATH);
}

export async function rapidOcr(toolchain, imagePath, params = {}) {
  const abs = requireFile(imagePath, 'imagePath');
  if (!rapidOcrAvailable(toolchain)) {
    throw new ToolError('python-unavailable', 'RapidOCR 需要本地 Python（可在插件配置里设置 pythonPath 指向 python.exe）');
  }
  const { stdout } = await runPython(toolchain, SCRIPT_PATH, [abs], {
    timeoutMs: Number(params.timeoutMs) || 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const data = parsePythonJson(stdout, 'RapidOCR');
  if (!data.ok) throw new ToolError('ocr-failed', String(data.error || 'RapidOCR 识别失败'));
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const text = lines
    .map((line) => String(line.text || ''))
    .filter(Boolean)
    .join('\n');
  const confidences = lines.map((line) => Number(line.confidence) || 0);
  const meanConfidence = confidences.length > 0 ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 1000) / 10 : 0;
  return {
    ok: true,
    engine: 'rapidocr',
    lang: 'chi_sim',
    text,
    lines: lines.map((line) => ({
      text: String(line.text || ''),
      confidence: Math.round((Number(line.confidence) || 0) * 100),
      bbox: line.bbox,
    })),
    count: lines.length,
    meanConfidence,
  };
}
