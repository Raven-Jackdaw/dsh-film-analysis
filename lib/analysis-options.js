// 分析选项：模板（作业/答题/影评/拍摄/速查）、聚焦维度、输出语言。
export const TEMPLATES = {
  auto: { id: 'auto', name: '自动', instruction: '' },
  homework: {
    id: 'homework',
    name: '课程作业',
    instruction:
      '按课程作业/汇报要求输出：结构清晰、有理论依据与画面证据，可直接整理成作业或汇报稿；结尾附 3 条汇报可用的核心结论。',
  },
  exam: {
    id: 'exam',
    name: '考研/艺考答题',
    instruction:
      '按考试答题要求输出：先给结论句，再列判据与例证，分点作答；定义准确、术语规范、避免口语化与文学化铺陈。',
  },
  review: {
    id: 'review',
    name: '影评/观后感',
    instruction:
      '按影评要求输出：观点鲜明、有个人判断与论证；减少术语堆砌，重点解释形式如何服务主题与情绪。',
  },
  shoot: {
    id: 'shoot',
    name: '拍摄参考',
    instruction:
      '按拍摄参考要求输出：给出可执行参数（景别/机位/焦段/光位/运动/时长/剪辑点）与仿拍方案；理论分析从简。',
  },
  quick: {
    id: 'quick',
    name: '快速检查',
    instruction: '只输出最关键判断与证据，控制在 800 字内，不展开推导；不确定处标注待核实。',
  },
};

export const FOCUS_DIMENSIONS = [
  { id: 'shotSize', name: '景别' },
  { id: 'depthFocal', name: '景深与焦距' },
  { id: 'anglePosition', name: '角度与视点' },
  { id: 'lightTone', name: '光线与影调' },
  { id: 'colorPalette', name: '色彩与色调' },
  { id: 'composition', name: '构图' },
  { id: 'cameraMovement', name: '镜头运动' },
  { id: 'editing', name: '剪辑与蒙太奇' },
  { id: 'sound', name: '声音与声画' },
  { id: 'miseEnScene', name: '场面调度' },
];

export const OUTPUT_LANGUAGES = {
  zh: { id: 'zh', name: '中文' },
  bilingual: { id: 'bilingual', name: '中英对照' },
  en: { id: 'en', name: 'English' },
};

function normalizeFocus(focus) {
  if (!Array.isArray(focus)) return [];
  const byId = new Map(FOCUS_DIMENSIONS.map((item) => [item.id, item.name]));
  const byName = new Map(FOCUS_DIMENSIONS.map((item) => [item.name, item.name]));
  const result = [];
  for (const value of focus) {
    const key = String(value || '').trim();
    if (!key) continue;
    const name = byId.get(key) || byName.get(key);
    if (name && !result.includes(name)) result.push(name);
  }
  return result;
}

/** 生成注入提示词的分析选项块（模板/聚焦/语言），空选项返回空串。 */
export function buildAnalysisOptionsBlock(options = {}) {
  const template = TEMPLATES[String(options.template || 'auto')] || TEMPLATES.auto;
  const focus = normalizeFocus(options.focus);
  const language = String(options.language || 'zh');
  const lines = [];
  if (template.instruction) {
    lines.push('【输出模板】');
    lines.push(template.instruction);
    lines.push('');
  }
  if (focus.length > 0) {
    lines.push('【本次聚焦维度】');
    lines.push(`- 重点分析：${focus.join('、')}；其他维度用 1–2 句带过，不要平均用力。`);
    lines.push('');
  }
  if (language === 'bilingual') {
    lines.push('【输出语言】');
    lines.push('- 中文为主，每个小节标题与小节结论后附一句英文摘要（English summary）。');
    lines.push('');
  } else if (language === 'en') {
    lines.push('【输出语言】');
    lines.push('- 使用英文输出分析正文，专业术语首次出现时用括号标注中文（如 shot size（景别））。');
    lines.push('');
  }
  return lines.join('\n');
}

export function normalizeAnalysisOptions(params = {}) {
  return {
    template: TEMPLATES[String(params.template || 'auto')] ? String(params.template || 'auto') : 'auto',
    focus: normalizeFocus(params.focus),
    language: OUTPUT_LANGUAGES[String(params.language || 'zh')] ? String(params.language || 'zh') : 'zh',
  };
}
