// 口播稿生成（解说视频模式的文字部分）：从分析报告抽取/压缩为可朗读的口播稿。
// 不调用模型、不合成音频；输出带字数与预估时长的分块，供后续 TTS 使用。
import { ToolError } from './toolchain.js';

export const NARRATION_MODES = {
  commentary: { id: 'commentary', name: '电影解说型', sections: ['摘要', '总览', '核心结论', '段落定位', '风格与主题'] },
  analysis: { id: 'analysis', name: '拉片教学型', sections: ['段落定位', '剪辑结构', '剪辑技巧', '视听语言', '光线', '构图', '声音', '风格与主题', '摘要'] },
  highlight: { id: 'highlight', name: '高光传播型', sections: ['核心结论', '摘要', '总览'] },
  lesson: { id: 'lesson', name: '课堂微课型', sections: ['段落定位', '剪辑结构', '视听语言', '摘要', '核心结论'] },
};

const CHARS_PER_SECOND = 4.2;

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|.*\|/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)、]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉口播里不适合朗读的时间码/证据括号。 */
function cleanForSpeech(text) {
  return String(text || '')
    .replace(/（[^）]*(?:镜号|镜\s*\d|00:|时间码|证据)[^）]*）/g, '')
    .replace(/\([^)]*(?:镜号|00:|timecode)[^)]*\)/gi, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  const normalized = String(text || '').replace(/\r/g, '\n');
  const parts = normalized
    .split(/(?<=[。！？；!?;])\s*|\n+/)
    .map((item) => stripMarkdown(item))
    .map((item) => cleanForSpeech(item))
    .map((item) => item.replace(/^[，、,；;：:]\s*/, '').trim())
    .map((item) => item.replace(/[；;，,、]+$/g, '').trim())
    .filter((item) => item.length >= 8 && item.length <= 160);
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result;
}

function extractSections(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim(), lines: [] };
      continue;
    }
    const numbered = /^\s*\d+[.、]\s*\*\*(.+?)\*\*/.exec(line);
    if (numbered) {
      if (current) sections.push(current);
      current = { title: numbered[1].replace(/[：:].*$/, '').trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * 生成口播稿。
 * @param {string} text 分析报告（Markdown）
 * @param {{targetSeconds?:number, mode?:string, maxChars?:number}} options
 */
export function buildNarrationScript(text, options = {}) {
  const source = String(text || '').trim();
  if (!source) throw new ToolError('bad-argument', '缺少分析文本，无法生成口播稿');
  const mode = NARRATION_MODES[String(options.mode || 'commentary')] ? String(options.mode || 'commentary') : 'commentary';
  const modeConfig = NARRATION_MODES[mode];
  const targetSeconds = Math.max(20, Math.min(1800, Number(options.targetSeconds) || 180));
  const budget = Math.max(80, Math.min(6000, Number(options.maxChars) || Math.round(targetSeconds * CHARS_PER_SECOND)));

  const sections = extractSections(source);
  const prioritySections = sections.filter((section) => modeConfig.sections.some((keyword) => section.title.includes(keyword)));
  const otherSections = sections.filter((section) => !prioritySections.includes(section));

  const ordered = [];
  const pushSentences = (list) => {
    for (const sentence of list) {
      if (!ordered.includes(sentence)) ordered.push(sentence);
    }
  };
  for (const section of prioritySections) pushSentences(splitSentences(section.lines.join(' ')));
  pushSentences(splitSentences(otherSections.map((section) => section.lines.join(' ')).join(' ')));
  if (ordered.length === 0) pushSentences(splitSentences(stripMarkdown(source)));

  const picked = [];
  let chars = 0;
  for (const sentence of ordered) {
    if (chars >= budget) break;
    if (chars + sentence.length > budget * 1.15 && picked.length > 0) continue;
    picked.push(sentence);
    chars += sentence.length;
  }
  const script = picked.join('。').replace(/[；;]?。/g, '。').replace(/。。+/g, '。').replace(/。$/, '') + '。';
  const chunks = [];
  let buffer = '';
  for (const sentence of picked) {
    if (buffer && (buffer + sentence).length > 110) {
      chunks.push(buffer);
      buffer = '';
    }
    buffer += (buffer ? '。' : '') + sentence;
  }
  if (buffer) chunks.push(buffer);
  const chunked = chunks.map((chunk, index) => {
    const cleanedChunk = chunk.replace(/[；;]?。/g, '。').replace(/。。+/g, '。').replace(/。$/, '');
    const chunkText = `${cleanedChunk}。`;
    return {
      index: index + 1,
      text: chunkText,
      chars: Array.from(chunkText).length,
      estimatedSeconds: Number((Array.from(chunkText).length / CHARS_PER_SECOND).toFixed(2)),
    };
  });
  return {
    ok: true,
    mode,
    modeName: modeConfig.name,
    targetSeconds,
    sourceChars: Array.from(source).length,
    script,
    chars: Array.from(script).length,
    estimatedSeconds: Number((Array.from(script).length / CHARS_PER_SECOND).toFixed(2)),
    chunks: chunked,
  };
}
