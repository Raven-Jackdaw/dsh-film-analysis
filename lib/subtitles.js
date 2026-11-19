// 字幕：SRT / ASS 生成与样式预设（软字幕优先，可选烧录）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError } from './toolchain.js';

export const SUBTITLE_PRESETS = {
  classic: {
    id: 'classic',
    name: '经典单行',
    description: '底部居中、白字黑边、最多两行',
    maxChars: 18,
    maxLines: 2,
    alignment: 2,
    fontSize: 56,
    marginV: 90,
    outline: 3,
    borderStyle: 1,
    backColour: '&H00000000',
  },
  dual: {
    id: 'dual',
    name: '解说双行',
    description: '解说在上、对白在下，字号小一档',
    maxChars: 18,
    maxLines: 2,
    alignment: 2,
    fontSize: 52,
    marginV: 110,
    outline: 3,
    borderStyle: 1,
    backColour: '&H00000000',
  },
  teaching: {
    id: 'teaching',
    name: '教学半透明条',
    description: '底部半透明底条、白字，适合课堂/投屏',
    maxChars: 20,
    maxLines: 2,
    alignment: 2,
    fontSize: 52,
    marginV: 100,
    outline: 2,
    borderStyle: 3,
    backColour: '&H80000000',
  },
  vertical: {
    id: 'vertical',
    name: '竖屏大字',
    description: '竖屏短视频用，字大、每行不超过 10 字',
    maxChars: 10,
    maxLines: 2,
    alignment: 2,
    fontSize: 76,
    marginV: 240,
    outline: 4,
    borderStyle: 1,
    backColour: '&H00000000',
  },
};

function roundTo(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function normalizeCues(cues) {
  if (!Array.isArray(cues) || cues.length === 0) throw new ToolError('bad-argument', '字幕 cues 不能为空');
  const result = [];
  for (const [index, cue] of cues.entries()) {
    if (!cue || typeof cue !== 'object') continue;
    const start = Number(cue.start);
    const end = Number(cue.end ?? cue.start);
    const text = String(cue.text || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || text === '') continue;
    result.push({ start: roundTo(start, 3), end: roundTo(end, 3), text });
    if (result.length >= 500) break;
  }
  if (result.length === 0) throw new ToolError('bad-argument', '没有有效字幕条目');
  return result.sort((a, b) => a.start - b.start);
}

/** 按字符数折行（中文按字、英文按词优先）。 */
export function wrapSubtitleText(text, maxChars, maxLines = 2) {
  const source = String(text || '').trim();
  if (!source) return '';
  const chars = Array.from(source);
  if (chars.length <= maxChars) return source;
  const lines = [];
  let current = '';
  for (const char of chars) {
    current += char;
    if (Array.from(current).length >= maxChars) {
      lines.push(current);
      current = '';
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  const merged = lines.slice(0, maxLines);
  let rest = chars.slice(merged.join('').length).join('');
  rest = rest.trim();
  if (rest) {
    const last = merged[maxLines - 1];
    merged[maxLines - 1] = `${Array.from(last).slice(0, Math.max(1, maxChars - 1)).join('')}…`;
  }
  return merged.join('\n');
}

export function srtTimestamp(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const ms = Math.round((value - Math.floor(value)) * 1000);
  const total = Math.floor(value);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
}

export function assTimestamp(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const cs = Math.round((value - Math.floor(value)) * 100);
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}.${String(cs).padStart(2, '0')}`;
}

/** 生成 SRT（保留折行，纯文本样式）。 */
export function buildSrt(cues, presetId = 'classic') {
  const preset = SUBTITLE_PRESETS[presetId] || SUBTITLE_PRESETS.classic;
  const lines = normalizeCues(cues).map((cue, index) => {
    const text = wrapSubtitleText(cue.text, preset.maxChars, preset.maxLines);
    return `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${text}`;
  });
  return lines.join('\n\n');
}

/** 生成 ASS（含样式预设）。 */
export function buildAss(cues, presetId = 'classic') {
  const preset = SUBTITLE_PRESETS[presetId] || SUBTITLE_PRESETS.classic;
  const header = [
    '[Script Info]',
    'Title: film-analysis subtitles',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Microsoft YaHei,${preset.fontSize},&H00FFFFFF,&H000000FF,&H00000000,${preset.backColour},0,0,0,0,100,100,0,0,${preset.borderStyle},${preset.outline},1,${preset.alignment},40,40,${preset.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const rows = normalizeCues(cues).map((cue) => {
    const text = wrapSubtitleText(cue.text, preset.maxChars, preset.maxLines).replace(/\n/g, '\\N');
    return `Dialogue: 0,${assTimestamp(cue.start)},${assTimestamp(cue.end)},Default,,0,0,0,,${text}`;
  });
  return header.concat(rows).join('\n');
}

/** 把字幕写成文件，返回路径与 URL。 */
export function writeSubtitles(toolchain, cues, presetId = 'classic', baseName = 'subtitle') {
  const preset = SUBTITLE_PRESETS[presetId] || SUBTITLE_PRESETS.classic;
  const dir = join(toolchain.dirs.root, 'subtitles');
  mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const srtName = `${baseName}-${preset.id}-${stamp}.srt`;
  const assName = `${baseName}-${preset.id}-${stamp}.ass`;
  const srtPath = join(dir, srtName);
  const assPath = join(dir, assName);
  const normalized = normalizeCues(cues);
  writeFileSync(srtPath, buildSrt(normalized, preset.id), 'utf8');
  writeFileSync(assPath, buildAss(normalized, preset.id), 'utf8');
  return {
    ok: true,
    preset: preset.id,
    count: normalized.length,
    srtPath,
    srtUrl: `/film-analysis/output/subtitles/${encodeURIComponent(srtName)}`,
    assPath,
    assUrl: `/film-analysis/output/subtitles/${encodeURIComponent(assName)}`,
  };
}
