// 主色板：对降采样像素做确定性 k-means 量化，输出 hex + 占比。
import { readRgbPixels, } from './metrics.js';

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

export async function imagePalette(imagePath, k = 8) {
  const { data, width, height } = await readRgbPixels(imagePath);
  const pixels = width * height;
  const requested = Math.max(2, Math.min(16, Number(k) || 8));
  const maxSamples = 24000;
  const step = Math.max(1, Math.floor(pixels / maxSamples));
  const samples = [];
  for (let i = 0; i < pixels; i += step) {
    const o = i * 3;
    samples.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (samples.length === 0) samples.push([0, 0, 0]);

  // 确定性初始化：按亮度排序后等距取种子。
  const sorted = samples
    .map((rgb) => ({ rgb, luma: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] }))
    .sort((a, b) => a.luma - b.luma);
  const centroids = [];
  for (let i = 0; i < requested; i += 1) {
    const pick = sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) / requested) * sorted.length))];
    centroids.push([...pick.rgb]);
  }

  const assignments = new Int32Array(samples.length).fill(-1);
  for (let iteration = 0; iteration < 14; iteration += 1) {
    let changed = false;
    for (let s = 0; s < samples.length; s += 1) {
      const [r, g, b] = samples[s];
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const [cr, cg, cb] = centroids[c];
        const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[s] !== best) changed = true;
      assignments[s] = best;
    }
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let s = 0; s < samples.length; s += 1) {
      const c = assignments[s];
      const [r, g, b] = samples[s];
      sums[c][0] += r;
      sums[c][1] += g;
      sums[c][2] += b;
      sums[c][3] += 1;
    }
    for (let c = 0; c < centroids.length; c += 1) {
      if (sums[c][3] === 0) continue;
      centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
    if (!changed && iteration > 2) break;
  }

  const counts = new Array(centroids.length).fill(0);
  for (let s = 0; s < samples.length; s += 1) counts[assignments[s]] += 1;
  const colors = centroids
    .map((rgb, index) => ({
      hex: rgbToHex(rgb[0], rgb[1], rgb[2]),
      rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])],
      share: Number((counts[index] / samples.length).toFixed(4)),
    }))
    .filter((color) => color.share > 0.0005)
    .sort((a, b) => b.share - a.share);
  return { ok: true, k: colors.length, colors };
}
