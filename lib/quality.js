// 分析质量自检与知识关联：本地启发式计算，不调用模型。
import * as KB from './knowledge.js';
import { TERMS } from './norms.js';

const DIMENSION_NAMES = ['景别', '景深', '焦距', '角度', '机位', '光线', '影调', '色彩', '色调', '构图', '镜头运动', '声音', '剪辑', '蒙太奇', '场面调度'];

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

/** 术语误用/矛盾检查（规则级，只提示不阻断）。 */
export function detectTermConflicts(text) {
  const warnings = [];
  const source = String(text || '');
  // 推镜（物理移动）与变焦（光学变化）在同一段里混用，容易矛盾
  if (/推镜头|推镜/.test(source) && /变焦/.test(source)) {
    warnings.push('文中同时出现“推镜头”与“变焦”，请确认是物理推进还是光学变焦（透视是否变化）。');
  }
  // 固定镜头 + 运动描述
  if (/固定镜头/.test(source) && /(摇镜|移镜|跟镜|升降|推镜|拉镜)/.test(source)) {
    warnings.push('文中同时出现“固定镜头”与运动描述，请确认机位是否真的固定。');
  }
  // 长镜头 + “没有剪辑”断言
  if (/长镜头/.test(source) && /(没有剪辑(?!点)|无剪辑(?!点)|不剪辑(?!点))/.test(source)) {
    warnings.push('“长镜头”不等于“没有剪辑”，请改为“镜头内部无切点/以调度替代剪辑”。');
  }
  // 画幅矛盾（容器 vs 内容）
  if (/16\s*:\s*9/.test(source) && /2\.(35|39)\s*:\s*1/.test(source) && !/遮幅|画面内|有效画幅|推测|待核实/.test(source)) {
    warnings.push('文中同时出现 16:9 与 2.35/2.39:1，请区分“容器画幅”与“画面内有效画幅（遮幅）”。');
  }
  return warnings;
}

/** 分析质量自检：证据密度、维度覆盖、术语命中、结构、长度、不确定性。 */
export function assessAnalysisQuality(text) {
  const source = String(text || '');
  const chars = source.replace(/\s+/g, '').length;
  const citations = countMatches(source, /\d{1,2}:\d{2}(?:\.\d+)?|镜号\s*\d+/g);
  const dimensions = DIMENSION_NAMES.filter((name) => source.includes(name));
  const termNames = TERMS.filter((term) => term.term && source.includes(term.term)).map((term) => term.term);
  const hasTable = /^\s*\|.+\|/m.test(source);
  const speculation = countMatches(source, /推测|待核实|可能|大约/g);
  const evidenceTags = countMatches(source, /证据[：:]/g);
  const warnings = detectTermConflicts(source);

  let score = 0;
  score += Math.min(1, citations / 25) * 30;
  score += Math.min(1, dimensions.length / 8) * 20;
  score += Math.min(1, termNames.length / 18) * 15;
  score += hasTable ? 10 : 0;
  score += Math.min(1, chars / 2500) * 15;
  score += speculation <= Math.max(6, chars / 200) ? 10 : 4;
  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  const grade = normalizedScore >= 85 ? 'A' : normalizedScore >= 70 ? 'B' : 'C';
  return {
    score: normalizedScore,
    grade,
    citations,
    dimensions: dimensions.length,
    dimensionNames: dimensions,
    termHits: termNames.length,
    termNames: termNames.slice(0, 12),
    hasTable,
    chars,
    speculation,
    evidenceTags,
    warnings,
  };
}

/** 知识关联：命中知识库片例名称与专业规范术语。 */
export function findRelated(text, limit = 6) {
  const source = String(text || '');
  const films = [];
  const filmList = Array.isArray(KB.FILMS) ? KB.FILMS : [];
  const termNames = new Set(TERMS.map((term) => term.term));
  const genericTitles = new Set(['构图', '景别', '光线', '影调', '色彩', '色调', '声音', '剪辑', '镜头', '镜头运动', '角度', '场面调度', '表演', '美术', '叙事', '节奏', '风格', '主题', '视点', '蒙太奇', '导演', '电影', '影片', '观众']);
  for (const film of filmList) {
    const title = String(film && film.title ? film.title : '').trim();
    if (title.length >= 2 && source.includes(title) && !termNames.has(title) && !genericTitles.has(title)) {
      films.push({ title, use: String(film.use || '').slice(0, 80), cite: String(film.cite || '') });
      if (films.length >= limit) break;
    }
  }
  const terms = [];
  for (const term of TERMS) {
    if (term.term && source.includes(term.term)) {
      terms.push({ term: term.term, category: term.category, definition: term.definition });
      if (terms.length >= limit) break;
    }
  }
  return { films, terms };
}
