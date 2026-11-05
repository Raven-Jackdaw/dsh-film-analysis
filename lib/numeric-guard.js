// 数值幻觉防护：画幅比/亮度等实测数值必须引用实测，不得自行推断。
// 两层：① 提示词硬约束（buildMeasuredDataRules）；② 输出事后校验 + 自动重试（findAspectMismatch + buildAspectCorrectionHint）。

/** 解析 "16:9" / "2.39:1" / "2.4:1" 等画幅标签为归一化比例（宽/高 ≥ 1）。 */
export function parseAspectLabel(label) {
  if (typeof label !== 'string') return null;
  const match = /^\s*(\d{1,2}(?:\.\d{1,3})?)\s*[:：]\s*(\d{1,2}(?:\.\d{1,3})?)\s*$/.exec(label);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  const ratio = width / height;
  return ratio >= 1 ? ratio : 1 / ratio;
}

// 时间码：mm:ss.ss（如 06:16.87）、hh:mm:ss.ss；等长替换为空格后做画幅匹配，避免误报。
const TIMECODE_RE = /\b\d{1,2}:\d{2}(?:\.\d{1,3})?\b/g;
const TIME_RANGE_RE = /\b\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?\b/g;
// 出现这些词时，画幅声明视为“推断/冲突说明”，不计为错误。
const INFERRED_CONTEXT_RE =
  /推测|待核实|遮幅|黑边|上下黑|画面内|有效画幅|观感|疑似|冲突|不一致|不予采用|不采用|非实测|勿用|JSON|镜头表|字段/;

/** 把时间码替换成等长空格（保持 match.index 与原文一致）。 */
function maskTimecodes(text) {
  return text
    .replace(TIME_RANGE_RE, (m) => ' '.repeat(m.length))
    .replace(TIMECODE_RE, (m) => ' '.repeat(m.length));
}

/**
 * 收集文本中的画幅比声明，排除时间码（00:16.47 / 06:16.87）、帧率（25fps）等。
 * inferred=true 表示该声明旁边已有“推测/遮幅/画面内/冲突说明”等限定词，视为合理的推断表述。
 */
export function collectAspectClaims(text) {
  const source = String(text || '');
  // 先用等长空格遮蔽时间码：06:16.87 → "        "，防止被当成 6:16.87 的画幅比。
  const masked = maskTimecodes(source);
  const claims = [];
  const ratioPattern = /(\d{1,2}(?:\.\d{1,3})?)\s*[:：]\s*(\d{1,2}(?:\.\d{1,3})?)/g;
  let match;
  while ((match = ratioPattern.exec(masked)) !== null) {
    const widthText = match[1];
    const heightText = match[2];
    if (widthText.length === 2 && widthText.startsWith('0')) continue; // 06:9 之类非法画幅
    if (heightText.includes('.')) continue; // 画幅比分母为整数；带小数的是时间码/数值
    if (widthText.length === 2 && heightText.length === 2 && Number(widthText) <= 9) continue; // 06:16 形式是时间
    const width = Number(widthText);
    const height = Number(heightText);
    if (!width || !height) continue;
    const ratio = width / height;
    const normalized = ratio >= 1 ? ratio : 1 / ratio;
    // 合理画幅范围 1.15–3.2；时间码/帧率比例基本都落在范围外
    if (normalized < 1.15 || normalized > 3.2) continue;
    const raw = source.slice(match.index, match.index + match[0].length);
    const context = source.slice(Math.max(0, match.index - 30), Math.min(source.length, match.index + raw.length + 30));
    claims.push({
      raw,
      ratio: Number(normalized.toFixed(3)),
      index: match.index,
      inferred: INFERRED_CONTEXT_RE.test(context),
    });
  }
  // “画幅比 1.85”“遮幅 2.39”这类只写单值的声明
  const ratioOnlyPattern = /(?:画幅比?|宽高比|比例|遮幅)[^\d]{0,8}(\d\.\d{1,3})/g;
  while ((match = ratioOnlyPattern.exec(masked)) !== null) {
    const ratio = Number(match[1]);
    if (!Number.isFinite(ratio) || ratio < 1.15 || ratio > 3.2) continue;
    // 已有 "2.39:1" 之类完整声明时，不再重复记录 "遮幅 2.39"
    if (claims.some((claim) => Math.abs(claim.ratio - ratio) < 0.02 && Math.abs(claim.index - match.index) < 30)) continue;
    const context = source.slice(Math.max(0, match.index - 30), Math.min(source.length, match.index + match[0].length + 30));
    claims.push({
      raw: source.slice(match.index, match.index + match[0].length).trim(),
      ratio: Number(ratio.toFixed(3)),
      index: match.index,
      inferred: INFERRED_CONTEXT_RE.test(context),
    });
  }
  claims.sort((a, b) => a.index - b.index);
  return claims;
}

/**
 * 校验文本中的画幅声明与实测画幅是否一致。
 * @returns {{measuredLabel: string|null, measured: number|null, claims: Array, mismatch: Array, allowed: Array}}
 */
export function findAspectMismatch(text, measuredAspectLabel, tolerance = 0.08) {
  const measured = parseAspectLabel(measuredAspectLabel);
  if (!measured) {
    return { measuredLabel: null, measured: null, claims: [], mismatch: [], allowed: [] };
  }
  const claims = collectAspectClaims(text);
  const threshold = measured * tolerance;
  const mismatch = [];
  const allowed = [];
  for (const claim of claims) {
    if (claim.inferred) {
      allowed.push(claim);
    } else if (Math.abs(claim.ratio - measured) > threshold) {
      mismatch.push(claim);
    } else {
      allowed.push(claim);
    }
  }
  return { measuredLabel: measuredAspectLabel, measured: Number(measured.toFixed(3)), claims, mismatch, allowed };
}

/** 生成“画幅校验失败”的重试要求（拼接在提示词后）。 */
export function buildAspectCorrectionHint(result) {
  const measuredLabel = result && result.measuredLabel ? result.measuredLabel : 'unknown';
  const wrong = (result && result.mismatch ? result.mismatch : []).map((item) => item.raw).join('、');
  return [
    '【数值校验失败，必须修正】',
    `你输出的画幅比（${wrong || '未知'}）与实测值不一致。实测容器画幅为 ${measuredLabel}（来自 ffprobe 元数据），这是唯一可引用的画幅比。`,
    `请重写全文：`,
    `1. 画幅比只能写实测值 ${measuredLabel}，不得自行推断/改写成其他比例（常见错误：把 16:9 写成 2.39:1 或 2.4:1）。`,
    '2. 如果确实想描述画面内有效画幅（例如遮幅），必须写成“画面内有效画幅约 X（推测，基于遮幅）”，并同时保留实测容器画幅。',
    '3. 亮度、对比度、饱和度、色温等数值只能引用给定数据中的实测值，不得编造或凭观感估算。',
    '4. 镜头时长、镜号、时间码以给定数据为准。',
  ].join('\n');
}

/** 生成提示词中的“数值硬约束”段落（各分析入口复用）。 */
export function buildMeasuredDataRules(options = {}) {
  const lines = ['【数值硬约束（必须遵守）】'];
  const aspectLabel = options.aspectLabel ? String(options.aspectLabel) : '';
  if (aspectLabel && aspectLabel !== 'unknown') {
    lines.push(
      `- 画幅比：只能引用实测值 ${aspectLabel}（来自 ffprobe 元数据），不得自行推断或改写成其他比例；常见错误是把 16:9 写成 2.39:1 / 2.4:1。`,
    );
    lines.push(
      '- 如果画面有遮幅、要描述“画面内有效画幅”，必须写“画面内有效画幅约 X（推测，基于遮幅）”，且保留实测容器画幅，不能把推断值当成实测值。',
    );
  } else {
    lines.push('- 画幅比未测到：不要写具体画幅比；确实需要描述时写“画幅比未测到（待核实）”。');
  }
  const measured = [];
  if (Number.isFinite(Number(options.meanLuma))) measured.push(`平均亮度 meanLuma=${options.meanLuma}`);
  if (Number.isFinite(Number(options.contrast))) measured.push(`对比度 rmsContrast=${options.contrast}`);
  if (Number.isFinite(Number(options.saturation))) measured.push(`饱和度 saturationMean=${options.saturation}`);
  if (options.colorTempLabel) measured.push(`色温倾向=${options.colorTempLabel}`);
  if (measured.length > 0) {
    lines.push(`- 实测画面指标：${measured.join('；')}。引用亮度/对比度/饱和度/色温时必须使用这些数值（或写“未测到”），不得编造、换算或凭观感估算其他数字。`);
  } else {
    lines.push('- 亮度/对比度/饱和度/色温未测到：不要写具体数值；需要描述时写“未测到（待核实）”。');
  }
  lines.push('- 镜头时长、总时长、镜号、时间码以给定数据为准，不得改写或虚构。');
  lines.push('- 如果画面观感与实测值冲突，以实测值为准，并写成“观感上像 X，实测为 Y”。');
  for (const extra of Array.isArray(options.extra) ? options.extra : []) {
    if (extra) lines.push(`- ${extra}`);
  }
  return lines.join('\n');
}

/** 把校验结果转成可展示的警告文案。 */
export function describeAspectWarnings(result) {
  if (!result || !Array.isArray(result.mismatch) || result.mismatch.length === 0) return [];
  return result.mismatch.map(
    (item) => `画幅比 ${item.raw} 与实测 ${result.measuredLabel} 不一致（已自动重试；仍不一致请人工核对）`,
  );
}
