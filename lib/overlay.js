// 画面标注：辅助线（三分/黄金分割/中心/网格）、景别框、轴线、视线/运动箭头、文字标签 → PNG。
import { getSharp } from './native.js';
import { ToolError, outputFile, requireFile } from './toolchain.js';

const GUIDE_COLOR = '#ffd43b';
const BOX_COLOR = '#ff4d4f';
const LINE_COLOR = '#40c4ff';
const ARROW_COLOR = '#ff9f43';
const TEXT_COLOR = '#ffffff';
const TEXT_BG = 'rgba(0,0,0,0.62)';

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textWidth(text, fontSize) {
  let width = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0x2e80 ? fontSize : fontSize * 0.58;
  }
  return width;
}

function textLabel(text, x, y, fontSize, color = TEXT_COLOR, anchor = 'start') {
  const value = String(text ?? '').trim();
  if (value === '') return '';
  const width = textWidth(value, fontSize) + fontSize * 0.7;
  const height = fontSize * 1.5;
  let boxX = x;
  if (anchor === 'middle') boxX = x - width / 2;
  if (anchor === 'end') boxX = x - width;
  const boxY = y - height * 0.82;
  return (
    `<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${(fontSize * 0.25).toFixed(1)}" fill="${TEXT_BG}"/>` +
    `<text x="${(boxX + fontSize * 0.35).toFixed(1)}" y="${(boxY + height * 0.72).toFixed(1)}" font-size="${fontSize}" font-family="'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif" fill="${color}">${escapeXml(value)}</text>`
  );
}

function arrowHead(x1, y1, x2, y2, color, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a = size;
  const leftX = x2 - a * Math.cos(angle - Math.PI / 6);
  const leftY = y2 - a * Math.sin(angle - Math.PI / 6);
  const rightX = x2 - a * Math.cos(angle + Math.PI / 6);
  const rightY = y2 - a * Math.sin(angle + Math.PI / 6);
  return `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}" fill="${color}"/>`;
}

function normalizeGuides(guides) {
  if (!Array.isArray(guides)) return [];
  return guides
    .map((guide) => (typeof guide === 'string' ? { type: guide } : guide))
    .filter((guide) => guide && typeof guide.type === 'string');
}

function buildSvg(width, height, spec) {
  const unit = Math.max(2, Math.round(width * 0.0022));
  const fontSize = Math.max(18, Math.round(width * 0.021));
  const items = [];

  for (const guide of normalizeGuides(spec.guides)) {
    const color = typeof guide.color === 'string' ? guide.color : GUIDE_COLOR;
    const dash = ' stroke-dasharray="' + unit * 6 + ' ' + unit * 4 + '"';
    if (guide.type === 'thirds') {
      for (const ratio of [1 / 3, 2 / 3]) {
        items.push(`<line x1="${(width * ratio).toFixed(1)}" y1="0" x2="${(width * ratio).toFixed(1)}" y2="${height}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
        items.push(`<line x1="0" y1="${(height * ratio).toFixed(1)}" x2="${width}" y2="${(height * ratio).toFixed(1)}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
      }
    } else if (guide.type === 'golden') {
      for (const ratio of [0.382, 0.618]) {
        items.push(`<line x1="${(width * ratio).toFixed(1)}" y1="0" x2="${(width * ratio).toFixed(1)}" y2="${height}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
        items.push(`<line x1="0" y1="${(height * ratio).toFixed(1)}" x2="${width}" y2="${(height * ratio).toFixed(1)}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
      }
    } else if (guide.type === 'center') {
      items.push(`<line x1="${width / 2}" y1="0" x2="${width / 2}" y2="${height}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
      items.push(`<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
    } else if (guide.type === 'grid') {
      const divisions = Math.max(2, Math.min(12, Number(guide.divisions) || 3));
      for (let i = 1; i < divisions; i += 1) {
        const x = (width * i) / divisions;
        const y = (height * i) / divisions;
        items.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
        items.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="${unit}"${dash}/>`);
      }
    }
  }

  if (spec.frame === true) {
    const margin = Math.round(Math.min(width, height) * 0.06);
    items.push(
      `<rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" fill="none" stroke="${BOX_COLOR}" stroke-width="${unit * 1.5}" stroke-dasharray="${unit * 8} ${unit * 5}"/>`,
    );
  }

  for (const box of Array.isArray(spec.boxes) ? spec.boxes : []) {
    const color = typeof box.color === 'string' ? box.color : BOX_COLOR;
    const x = Number(box.x) * width;
    const y = Number(box.y) * height;
    const w = Number(box.w) * width;
    const h = Number(box.h) * height;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    items.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${unit * 2}"/>`);
    if (box.label) items.push(textLabel(box.label, x + unit * 3, y - unit * 2, fontSize, color));
  }

  for (const line of Array.isArray(spec.lines) ? spec.lines : []) {
    const color = typeof line.color === 'string' ? line.color : LINE_COLOR;
    const x1 = Number(line.x1) * width;
    const y1 = Number(line.y1) * height;
    const x2 = Number(line.x2) * width;
    const y2 = Number(line.y2) * height;
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    items.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${unit * 2}" stroke-dasharray="${unit * 10} ${unit * 6}"/>`);
    if (line.label) items.push(textLabel(line.label, (x1 + x2) / 2, (y1 + y2) / 2, fontSize, color, 'middle'));
  }

  for (const arrow of Array.isArray(spec.arrows) ? spec.arrows : []) {
    const color = typeof arrow.color === 'string' ? arrow.color : ARROW_COLOR;
    const x1 = Number(arrow.x1) * width;
    const y1 = Number(arrow.y1) * height;
    const x2 = Number(arrow.x2) * width;
    const y2 = Number(arrow.y2) * height;
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    items.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${unit * 2.4}"/>`);
    items.push(arrowHead(x1, y1, x2, y2, color, unit * 7));
    if (arrow.label) items.push(textLabel(arrow.label, (x1 + x2) / 2, (y1 + y2) / 2, fontSize, color, 'middle'));
  }

  for (const label of Array.isArray(spec.labels) ? spec.labels : []) {
    const color = typeof label.color === 'string' ? label.color : TEXT_COLOR;
    const x = Number(label.x) * width;
    const y = Number(label.y) * height;
    if (![x, y].every(Number.isFinite)) continue;
    items.push(textLabel(label.text, x, y, Math.round(fontSize * (Number(label.scale) || 1)), color));
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    items.join('') +
    '</svg>'
  );
}

/** 在图上叠加标注并输出 PNG。 */
export async function imageOverlay(toolchain, imagePath, spec = {}) {
  const sharp = getSharp();
  const abs = requireFile(imagePath, 'imagePath');
  let meta;
  try {
    meta = await sharp(abs).rotate().metadata();
  } catch (error) {
    throw new ToolError('decode-failed', `无法解码图片：${abs}（${error?.message ?? error}）`);
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new ToolError('decode-failed', '无法读取图片尺寸');
  const svg = buildSvg(width, height, spec);
  const out = outputFile(toolchain, 'overlay', 'png');
  try {
    const info = await sharp(abs)
      .rotate()
      .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
      .removeAlpha()
      .png()
      .toFile(out.path);
    return {
      ok: true,
      outputPath: out.path,
      url: out.url,
      width: info.width,
      height: info.height,
      applied: {
        guides: normalizeGuides(spec.guides).length,
        boxes: (spec.boxes ?? []).length,
        lines: (spec.lines ?? []).length,
        arrows: (spec.arrows ?? []).length,
        labels: (spec.labels ?? []).length,
        frame: spec.frame === true,
      },
    };
  } catch (error) {
    throw new ToolError('overlay-failed', `生成标注图失败：${error?.message ?? error}`);
  }
}
