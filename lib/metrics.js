// 图像度量：亮度、对比度(RMS)、色温倾向(R-B)、饱和度、边缘密度、16 桶亮度直方图。
import { getSharp } from './native.js';
import { ToolError, requireFile } from './toolchain.js';

const MAX_ANALYSIS_EDGE = 1280;

/** 读取降采样后的 RGB 像素（用于度量与色板）。 */
export async function readRgbPixels(imagePath) {
  const sharp = getSharp();
  const abs = requireFile(imagePath, 'imagePath');
  try {
    const { data, info } = await sharp(abs)
      .rotate()
      .resize({ width: MAX_ANALYSIS_EDGE, height: MAX_ANALYSIS_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  } catch (error) {
    throw new ToolError('decode-failed', `无法解码图片：${abs}（${error?.message ?? error}）`);
  }
}

function lumaAt(data, index) {
  // Rec.709 亮度
  return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

export function aspectLabel(ratio) {
  const standards = [
    [1, '1:1'],
    [1.3333, '4:3'],
    [1.5, '3:2'],
    [1.6, '16:10'],
    [1.7778, '16:9'],
    [1.85, '1.85:1'],
    [2, '2:1'],
    [2.35, '2.35:1'],
    [2.39, '2.39:1'],
    [0.5625, '9:16'],
    [0.75, '3:4'],
    [2.4, '2.4:1'],
  ];
  let best = standards[0][1];
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

export function colorTempLabel(rb) {
  if (rb >= 12) return '明显偏暖（红/黄）';
  if (rb >= 4) return '略偏暖';
  if (rb <= -12) return '明显偏冷（蓝/青）';
  if (rb <= -4) return '略偏冷';
  return '接近中性';
}

export async function imageMetrics(imagePath) {
  const { data, width, height } = await readRgbPixels(imagePath);
  const pixels = width * height;
  const histogram = new Array(16).fill(0);
  let sumLuma = 0;
  let sumLumaSq = 0;
  let sumSat = 0;
  let sumR = 0;
  let sumB = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 3;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const y = lumaAt(data, o);
    sumLuma += y;
    sumLumaSq += y * y;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    sumSat += max === 0 ? 0 : (max - min) / max;
    sumR += r;
    sumB += b;
    histogram[Math.min(15, Math.max(0, Math.floor((y / 256) * 16)))] += 1;
  }
  const meanLuma = sumLuma / pixels;
  const variance = Math.max(0, sumLumaSq / pixels - meanLuma * meanLuma);
  const rmsContrast = Math.sqrt(variance);

  // 边缘密度：灰度 Sobel 平均梯度幅值 / 阈值像素占比（两值取前者更稳）。
  let edgeSum = 0;
  let edgeCount = 0;
  const gray = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) gray[i] = lumaAt(data, i * 3);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx =
        -gray[idx - width - 1] - 2 * gray[idx - 1] - gray[idx + width - 1] +
        gray[idx - width + 1] + 2 * gray[idx + 1] + gray[idx + width + 1];
      const gy =
        -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1] +
        gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      edgeSum += mag;
      if (mag > 96) edgeCount += 1;
    }
  }
  const inner = Math.max(1, (width - 2) * (height - 2));
  const aspectRatio = width / height;
  return {
    ok: true,
    width,
    height,
    aspectRatio: Number(aspectRatio.toFixed(3)),
    aspectLabel: aspectLabel(aspectRatio),
    meanLuma: Number(meanLuma.toFixed(1)),
    meanLumaPercent: Number(((meanLuma / 255) * 100).toFixed(1)),
    rmsContrast: Number(rmsContrast.toFixed(1)),
    contrastLevel: rmsContrast < 30 ? '低反差（平）' : rmsContrast < 55 ? '中等反差' : rmsContrast < 80 ? '高反差' : '极高反差',
    colorTempRB: Number(((sumR - sumB) / pixels).toFixed(1)),
    colorTempLabel: colorTempLabel((sumR - sumB) / pixels),
    saturationMean: Number((sumSat / pixels).toFixed(3)),
    edgeDensity: Number((edgeSum / inner / 4).toFixed(2)),
    edgeRatio: Number(((edgeCount / inner) * 100).toFixed(1)),
    histogram: histogram.map((count, index) => ({ bin: index, count, share: Number((count / pixels).toFixed(4)) })),
  };
}
