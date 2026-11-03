// 图像操作：裁剪放大、亮度/对比度/饱和度/锐化/暗部提亮。
import { getSharp } from './native.js';
import { ToolError, outputFile, requireFile } from './toolchain.js';

const MAX_OUTPUT_EDGE = 8192;

async function openImage(imagePath) {
  const sharp = getSharp();
  const abs = requireFile(imagePath, 'imagePath');
  try {
    return sharp(abs).rotate();
  } catch (error) {
    throw new ToolError('decode-failed', `无法解码图片：${abs}（${error?.message ?? error}）`);
  }
}

function clampRatio(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/** 裁剪区域并放大 → PNG。x/y/w/h 为 0–1 比例，scale 为放大倍数。 */
export async function imageZoom(toolchain, imagePath, params = {}) {
  const sharp = getSharp();
  const base = await openImage(imagePath);
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new ToolError('decode-failed', '无法读取图片尺寸');
  const x = clampRatio(params.x, 0);
  const y = clampRatio(params.y, 0);
  const w = Math.max(0.02, clampRatio(params.w, 1));
  const h = Math.max(0.02, clampRatio(params.h, 1));
  const left = Math.max(0, Math.min(width - 2, Math.round(x * width)));
  const top = Math.max(0, Math.min(height - 2, Math.round(y * height)));
  const cropW = Math.max(2, Math.min(width - left, Math.round(w * width)));
  const cropH = Math.max(2, Math.min(height - top, Math.round(h * height)));
  const rawScale = Number(params.scale);
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? Math.min(8, rawScale) : 1;
  const targetW = Math.min(MAX_OUTPUT_EDGE, Math.max(2, Math.round(cropW * Math.max(scale, 1))));
  const out = outputFile(toolchain, 'zoom', 'png');
  let image = sharp(await base.extract({ left, top, width: cropW, height: cropH }).toBuffer());
  if (targetW > cropW) image = image.resize({ width: targetW });
  const info = await image.png().toFile(out.path);
  return {
    ok: true,
    outputPath: out.path,
    url: out.url,
    width: info.width,
    height: info.height,
    crop: { left, top, width: cropW, height: cropH, scale },
  };
}

/** 亮度/对比度/饱和度/锐化/暗部提亮 → PNG。参数为 -1..1（sharpen 为 0..1）。 */
export async function imageEnhance(toolchain, imagePath, params = {}) {
  const brightness = Math.max(-1, Math.min(1, Number(params.brightness) || 0));
  const contrast = Math.max(-1, Math.min(1, Number(params.contrast) || 0));
  const saturation = Math.max(-1, Math.min(1, Number(params.saturation) || 0));
  const sharpen = Math.max(0, Math.min(1, Number(params.sharpen) || 0));
  const shadows = Math.max(0, Math.min(1, Number(params.shadows) || 0));

  let image = await openImage(imagePath);
  if (brightness !== 0 || saturation !== 0) {
    image = image.modulate({
      brightness: Math.max(0.1, 1 + brightness * 0.8),
      saturation: Math.max(0, 1 + saturation * 0.8),
    });
  }
  if (contrast !== 0) {
    const factor = Math.max(0.1, 1 + contrast * 0.8);
    image = image.linear(factor, 128 * (1 - factor));
  }
  if (shadows > 0) {
    // 提亮暗部：libvips/sharp 的 gamma 只接受 1–3，>1 会抬升暗部与中间调。
    image = image.gamma(1 + shadows * 1.5);
  }
  if (sharpen > 0) image = image.sharpen({ sigma: 0.6 + sharpen * 1.2 });

  const out = outputFile(toolchain, 'enhance', 'png');
  const info = await image.removeAlpha().png().toFile(out.path);
  return {
    ok: true,
    outputPath: out.path,
    url: out.url,
    width: info.width,
    height: info.height,
    applied: { brightness, contrast, saturation, sharpen, shadows },
  };
}
