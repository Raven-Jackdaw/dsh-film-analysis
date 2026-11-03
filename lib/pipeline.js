// 分段多次拉片流水线：切段 → 段证据包 → 段级 AI 分析（强制时间码/镜号）→ 滚动摘要 → 全片汇总。
// 供 jobs.js（后台任务）与 tools.js（同步调用）共用。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError, requireFile } from './toolchain.js';
import { extractFrames, contactSheet, videoProbe } from './video.js';

const SYSTEM_PROMPT =
  '你是一位专业的影视视听语言拉片助手，熟悉张菁《影视视听语言》与阿里洪《电影语言的语法》的分析框架。你的结论必须落到具体镜头号与时间码，无法确认的信息要标注“推测/待核实”，不要编造。';

export const TIERS = {
  fast: { segmentSeconds: 240, maxShots: 24, frames: 3, maxTokens: 8000, words: '900–1300' },
  standard: { segmentSeconds: 180, maxShots: 20, frames: 4, maxTokens: 12000, words: '1400–2000' },
  precise: { segmentSeconds: 120, maxShots: 16, frames: 6, maxTokens: 16000, words: '2000–2800' },
};

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function roundTo(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function pickEvenly(list, count) {
  if (list.length <= count) return list;
  const result = [];
  for (let i = 0; i < count; i += 1) {
    result.push(list[Math.round((i * (list.length - 1)) / (count - 1))]);
  }
  return result;
}

/** 用户导入的台词/字幕规范化。 */
function normalizeSubtitles(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  const lines = [];
  for (const item of subtitles) {
    if (!item || typeof item !== 'object') continue;
    const start = Number(item.start);
    const end = Number(item.end ?? item.start);
    const text = String(item.text || '').trim();
    if (text === '') continue;
    lines.push({ start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null, text });
  }
  return lines;
}

function subtitleTextForRange(subtitles, start, end) {
  const lines = normalizeSubtitles(subtitles).filter((line) => {
    if (line.start === null || line.end === null) return true;
    return line.end >= start - 0.5 && line.start <= end + 0.5;
  });
  return lines
    .slice(0, 200)
    .map((line) => `[${line.start === null ? '--' : formatTime(line.start)}] ${line.text.slice(0, 140)}`)
    .join('\n');
}

function formatUserContext(context) {
  if (!context || typeof context !== 'object') return '';
  const mapping = [
    ['title', '作品'],
    ['genre', '类型/年代/导演'],
    ['story', '剧情梗概'],
    ['characters', '人物关系'],
    ['note', '补充说明'],
  ];
  const parts = [];
  for (const [key, label] of mapping) {
    const value = String(context[key] || '').trim();
    if (value) parts.push(`- ${label}：${value.slice(0, 900)}`);
  }
  return parts.join('\n');
}

function shotMetricsSummary(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  return {
    meanLuma: metrics.meanLuma,
    contrastLevel: metrics.contrastLevel,
    colorTempLabel: metrics.colorTempLabel,
    saturation: metrics.saturationMean,
    aspect: metrics.aspectLabel,
  };
}

/** 按镜头边界切段；超长镜头（>120s）再切成不超过 90s 的单元。 */
export function planSegments(shots, options = {}) {
  const tier = TIERS[options.tier] ? options.tier : 'standard';
  const config = TIERS[tier];
  const segmentSeconds = clamp(options.segmentSeconds, 60, 480, config.segmentSeconds);
  const maxShotsPerSegment = Math.round(clamp(options.maxShotsPerSegment, 5, 40, config.maxShots));
  const units = [];
  for (const shot of Array.isArray(shots) ? shots : []) {
    const start = Number(shot.start) || 0;
    const end = Number(shot.end) || start;
    const duration = Math.max(0, end - start);
    if (duration > 120) {
      const parts = Math.ceil(duration / 90);
      const step = duration / parts;
      for (let i = 0; i < parts; i += 1) {
        units.push({
          shotIndex: shot.index,
          start: roundTo(start + step * i, 3),
          end: roundTo(start + step * (i + 1), 3),
          duration: roundTo(step, 3),
          longShot: true,
          part: i + 1,
          parts,
          metrics: shot.metrics || null,
        });
      }
    } else {
      units.push({
        shotIndex: shot.index,
        start: roundTo(start, 3),
        end: roundTo(end, 3),
        duration: roundTo(duration, 3),
        longShot: duration >= 20,
        metrics: shot.metrics || null,
      });
    }
  }
  const segments = [];
  let current = null;
  for (const unit of units) {
    if (!current) {
      current = { start: unit.start, end: unit.end, shots: [unit] };
      continue;
    }
    const nextDuration = unit.end - current.start;
    if (nextDuration > segmentSeconds) {
      segments.push(current);
      current = { start: unit.start, end: unit.end, shots: [unit] };
      continue;
    }
    current.shots.push(unit);
    current.end = unit.end;
    if (current.shots.length >= maxShotsPerSegment) {
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);
  return segments.map((segment, index) => ({
    index: index + 1,
    start: roundTo(segment.start, 3),
    end: roundTo(segment.end, 3),
    duration: roundTo(segment.end - segment.start, 3),
    shots: segment.shots,
  }));
}

function buildSegmentPrompt(info) {
  const { segment, totalSegments, subtitles, context, previousSummary, tier, shotsTotal, videoDuration } = info;
  const words = TIERS[tier] ? TIERS[tier].words : TIERS.standard.words;
  const lines = [];
  lines.push('【分段拉片请求】');
  lines.push('请分析下面这一段影片，输出结构化拉片笔记；结论必须引用镜号与时间码。');
  lines.push('');
  lines.push('一、段落信息');
  lines.push(`- 第 ${segment.index}/${totalSegments} 段：${formatTime(segment.start)} – ${formatTime(segment.end)}（时长 ${formatTime(segment.duration)}）`);
  lines.push(`- 本段镜头数：${segment.shots.length}；全片镜头总数：${shotsTotal}；全片时长：${formatTime(videoDuration)}`);
  lines.push('');
  lines.push('二、本段镜头表（自动检测；长镜头已按 ≤90 秒拆分为子单元）');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      segment.shots.map((shot) => ({
        shotIndex: shot.shotIndex,
        start: shot.start,
        end: shot.end,
        duration: shot.duration,
        longShot: Boolean(shot.longShot),
        part: shot.part || null,
        metrics: shotMetricsSummary(shot.metrics),
      })),
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('');
  const subtitleText = subtitleTextForRange(info.subtitles, segment.start, segment.end);
  if (subtitleText) {
    lines.push('三、本段台词/字幕（带时间码，可信）');
    lines.push('```text');
    lines.push(subtitleText);
    lines.push('```');
    lines.push('');
  }
  const contextText = formatUserContext(info.context);
  if (contextText) {
    lines.push('四、影片背景（用户提供，可信）');
    lines.push(contextText);
    lines.push('');
  }
  if (previousSummary) {
    lines.push('五、上一段摘要（用于衔接，不要重复其内容）');
    lines.push(previousSummary.slice(0, 400));
    lines.push('');
  }
  lines.push('六、代表帧');
  lines.push('随消息附本段代表帧（每镜一张）与一张段内 3 列时间序列接触表；请结合它们判断运动、走位与调度。');
  lines.push('');
  lines.push('七、输出结构（直接输出 Markdown）');
  lines.push('1. **段落定位**：时间码、镜头数、叙事功能与情绪基调（3–5 句）。');
  lines.push('2. **分镜表**：每镜一行：镜号｜时间码｜时长｜景别｜角度机位｜镜头运动｜画面内容｜声音｜功能。');
  lines.push('3. **视听语言分析**：按剪辑结构（叙事顺序/段落/声音）、剪辑技巧（时长/节拍/组合）、光色构图、镜头运动逐项分析；每条结论后写（镜号 X / 00:12）。');
  lines.push('4. **本段摘要**：不超过 200 字，概括本段剧情、人物关系变化与视听手法，供下一段衔接。');
  lines.push('5. **待核实**：列出无法从画面/数据确认的信息（人物身份、剧情前史等）。');
  lines.push(`要求：具体到镜号与时间码；不要泛泛而谈；不确定处标注“推测”；篇幅 ${words} 字。`);
  lines.push('');
  lines.push('（本段分析由“影视画面分析器”分段流水线生成。）');
  return lines.join('\n');
}

function buildAggregatePrompt(info) {
  const { segments, summaries, rhythm, context, videoMeta, tier } = info;
  const lines = [];
  lines.push('【全片拉片汇总请求】');
  lines.push('请基于各分段的拉片结果与全片节奏统计，输出最终整片拉片报告。');
  lines.push('');
  lines.push('一、影片信息');
  lines.push(`- 时长：${formatTime(videoMeta.duration)}；镜头数：${videoMeta.shotsTotal}`);
  lines.push(`- 分段数：${segments.length}`);
  const contextText = formatUserContext(context);
  if (contextText) {
    lines.push('');
    lines.push('二、影片背景（用户提供，可信）');
    lines.push(contextText);
  }
  lines.push('');
  lines.push('三、全片节奏统计');
  lines.push('```json');
  lines.push(JSON.stringify(rhythm, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('四、各分段拉片摘要');
  segments.forEach((segment, index) => {
    lines.push(`### 第 ${segment.index} 段（${formatTime(segment.start)} – ${formatTime(segment.end)}，${segment.duration.toFixed(1)}s）`);
    lines.push(summaries[index] || '（本段无摘要）');
    lines.push('');
  });
  lines.push('五、各分段完整笔记（可能较长，用于提取证据）');
  info.segmentNotes.forEach((note, index) => {
    lines.push(`#### 第 ${segments[index].index} 段笔记`);
    lines.push(String(note || '').slice(0, 2500));
    lines.push('');
  });
  lines.push('六、输出结构（直接输出 Markdown）');
  lines.push('1. **总览**：类型/场景/人物关系/整体风格（4–6 句）。');
  lines.push('2. **剪辑结构分析**：叙事顺序、叙事段落、叙事音乐与声音（引用段号/镜号/时间码）。');
  lines.push('3. **剪辑技巧分析**：剪辑时长分布、剪辑规律（节拍组合）、剪辑组合（引用节奏统计数据）。');
  lines.push('4. **逐段讲解**：每个分段 3–5 句，指出关键镜头（引用镜号/时间码）。');
  lines.push('5. **视听语言总设计**：景别策略/机位/运动/光线/色彩/构图/表演/美术。');
  lines.push('6. **节奏与结构曲线**：用文字描述镜头长度与切点密度变化、情绪曲线。');
  lines.push('7. **风格与主题**：形式如何服务主题。');
  lines.push('8. **拉片笔记**：3 条可操作建议 + 1 条重拍/仿拍方案。');
  lines.push('9. **待核实**：列出无法确认的信息。');
  lines.push(`要求：引用镜号/时间码/段号；不要重复各段原文，做提炼与串联；篇幅 ${tier === 'fast' ? '1800–2500' : '3000–4500'} 字。`);
  lines.push('');
  lines.push('（本报告由“影视画面分析器”分段流水线汇总生成。）');
  return lines.join('\n');
}

async function streamText(ctx, options) {
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') throw new ToolError('llm-unavailable', '宿主没有可用的模型服务');
  let text = '';
  let reasoningLength = 0;
  let usage = null;
  let finishKind = null;
  let failure = null;
  for await (const chunk of llm.stream(options)) {
    if (!chunk) continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoningLength += chunk.text.length;
    else if (chunk.type === 'usage' && chunk.usage) usage = chunk.usage;
    else if (chunk.type === 'finish') {
      const reason = chunk.reason;
      finishKind = reason && reason.kind ? reason.kind : null;
      if (reason && (reason.kind === 'error' || reason.kind === 'aborted')) failure = reason.failure || reason;
    }
  }
  if (failure) throw new ToolError(String(failure.code || 'llm-failed'), String(failure.message || '模型调用失败'));
  return { text: text.trim(), reasoningLength, usage, finishKind };
}

/** 解析段级输出中的“本段摘要”（兼容 Markdown 粗体/编号标题）。 */
export function extractSummary(markdown) {
  const text = String(markdown || '').replace(/\*\*/g, '');
  const match = /本段摘要[^\n]*\n+([\s\S]{1,1200})/.exec(text);
  if (match && match[1]) {
    const block = match[1].split(/\n\s*#{1,6}\s*/)[0].split(/\n\s*(?:5\s*[.、]|五、|待核实)/)[0];
    const cleaned = block.replace(/\s+/g, ' ').trim().replace(/^[：:\s]+/, '');
    if (cleaned) return cleaned.slice(0, 300);
  }
  return text.replace(/\s+/g, ' ').slice(0, 200);
}

function usageCost(usage) {
  if (!usage) return null;
  const input = Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0) + Number(usage.cacheWriteTokens || 0);
  const cost = (input / 1e6) * 2 + (Number(usage.outputTokens || 0) / 1e6) * 8;
  return roundTo(cost, 4);
}

/**
 * 运行分段流水线（同步）。onProgress 可接收阶段/进度回调，用于任务状态落盘。
 * 返回 { ok, segments:[{...result}], finalText, stats, timings }。
 */
export async function runDeepAnalysis(ctx, toolchain, params = {}) {
  const videoPath = requireFile(params.videoPath, 'videoPath');
  const tier = TIERS[params.tier] ? params.tier : 'standard';
  const config = TIERS[tier];
  const started = Date.now();
  const timings = {};

  const probe = await videoProbe(toolchain, videoPath);
  const rawShots = Array.isArray(params.shots) ? params.shots : [];
  if (rawShots.length === 0) throw new ToolError('bad-argument', '需要 shots 参数（自动拉片的镜头列表）');
  const shots = rawShots.map((shot, index) => ({
    index: Number(shot.index) || index + 1,
    start: Number(shot.start) || 0,
    end: Number(shot.end) || 0,
    duration: Number(shot.duration) || Math.max(0, (Number(shot.end) || 0) - (Number(shot.start) || 0)),
    metrics: shot.metrics && typeof shot.metrics === 'object' ? shot.metrics : null,
  }));

  const segments = planSegments(shots, { tier, segmentSeconds: params.segmentSeconds, maxShotsPerSegment: params.maxShotsPerSegment });
  const total = segments.length;
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null;
  const provider = String(params.provider || selection?.provider || '');
  const model = String(params.model || selection?.model || '');
  if (provider === '' || model === '') throw new ToolError('model-unavailable', '当前会话没有可用的默认模型');

  const rhythm = {
    shotCount: shots.length,
    totalDuration: roundTo(probe.duration, 2),
    meanShot: roundTo(probe.duration / Math.max(1, shots.length), 2),
    sequence: shots.map((shot) => roundTo(shot.duration, 2)),
  };

  const results = [];
  const summaries = [];
  let previousSummary = '';
  const usageTotals = { input: 0, output: 0, cost: 0 };

  for (let i = 0; i < segments.length; i += 1) {
    if (typeof params.shouldStop === 'function' && params.shouldStop()) {
      throw new ToolError('cancelled', '任务已取消');
    }
    const segment = segments[i];
    const segmentStarted = Date.now();
    const prompt = buildSegmentPrompt({
      segment,
      totalSegments: total,
      subtitles: params.subtitles,
      context: params.context,
      previousSummary,
      tier,
      shotsTotal: shots.length,
      videoDuration: probe.duration,
    });

    // 证据包：代表帧（每镜一张，最多 6 张）+ 段内接触表
    const pickShots = pickEvenly(segment.shots, Math.min(config.frames, 6));
    const times = pickShots.map((shot) => roundTo((shot.start + shot.end) / 2, 3));
    const content = [{ type: 'text', text: prompt }];
    let imageCount = 0;
    try {
      const extracted = await extractFrames(toolchain, videoPath, { times, scale: 1280 });
      const attachments = ctx.get('attachments');
      if (attachments && typeof attachments.saveImages === 'function' && attachments.imageLimits && extracted.frames.length > 0) {
        const limit = Math.max(0, Math.min(8, Number(attachments.imageLimits.maxImagesPerMessage) || 0));
        const chosen = extracted.frames.slice(0, Math.max(1, limit - 1));
        const refs = await attachments.saveImages(
          chosen.map((frame, index) => ({ data: readFileSync(frame.path), mediaType: 'image/jpeg', name: `seg-${segment.index}-${index + 1}.jpg` })),
        );
        for (const ref of refs) content.push({ type: 'image', attachment: ref });
        imageCount = refs.length;
        if (limit > refs.length) {
          try {
            const sheet = await contactSheet(toolchain, { videoPath, times, cols: 3, width: 420 });
            const [sheetRef] = await attachments.saveImages([{ data: readFileSync(sheet.outputPath), mediaType: 'image/png', name: `seg-${segment.index}-sheet.png` }]);
            if (sheetRef) {
              content.push({ type: 'image', attachment: sheetRef });
              imageCount += 1;
            }
          } catch {
            /* 接触表失败忽略 */
          }
        }
      }
    } catch {
      /* 抽帧失败时仅用文字证据 */
    }

    let result = await streamText(ctx, {
      provider,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      maxTokens: config.maxTokens,
    });
    // 思考型模型可能把预算耗在 reasoning 上：空结果且 finish=max-tokens 时加大预算重试一次。
    if (!result.text && result.finishKind === 'max-tokens') {
      result = await streamText(ctx, {
        provider,
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        maxTokens: config.maxTokens + 8000,
      });
    }
    if (!result.text) {
      throw new ToolError(
        'empty-analysis',
        `第 ${segment.index} 段分析没有返回内容（finish=${result.finishKind || '?'}，usage=${JSON.stringify(result.usage || null)}）`,
      );
    }
    // 证据约束：引用（镜号/时间码）太少时追加要求重试一次。
    let citations = (result.text.match(/\d{1,2}:\d{2}|镜号\s*\d+/g) || []).length;
    let retried = false;
    if (citations < 5) {
      retried = true;
      const retryContent = content.concat([
        {
          type: 'text',
          text: '（补充要求）请重写本段分析：确保至少 8 处引用镜号或时间码，每条关键结论后标注（镜号 X / mm:ss），不要遗漏。',
        },
      ]);
      result = await streamText(ctx, {
        provider,
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: retryContent }],
        maxTokens: config.maxTokens,
      });
      citations = (result.text.match(/\d{1,2}:\d{2}|镜号\s*\d+/g) || []).length;
    }
    if (result.usage) {
      usageTotals.input += Number(result.usage.inputTokens || 0) + Number(result.usage.cacheReadTokens || 0) + Number(result.usage.cacheWriteTokens || 0);
      usageTotals.output += Number(result.usage.outputTokens || 0);
    }
    const cost = usageCost(result.usage);
    if (cost !== null) usageTotals.cost += cost;
    const summary = extractSummary(result.text);
    summaries.push(summary);
    previousSummary = summary;
    results.push({
      index: segment.index,
      start: segment.start,
      end: segment.end,
      duration: segment.duration,
      markdown: result.text,
      summary,
      imageCount,
      citations,
      retried,
      timings: { totalMs: Date.now() - segmentStarted },
      usage: result.usage || null,
      estimatedCostCny: cost,
    });
    if (typeof params.onProgress === 'function') {
      params.onProgress({ phase: 'segment', completed: i + 1, total, segment: results[results.length - 1], usageTotals });
    }
  }
  timings.segmentsMs = Date.now() - started;

  // 汇总
  const aggregateStarted = Date.now();
  const aggregatePrompt = buildAggregatePrompt({
    segments,
    summaries,
    rhythm,
    context: params.context,
    videoMeta: { duration: probe.duration, shotsTotal: shots.length },
    segmentNotes: results.map((item) => item.markdown),
    tier,
  });
  const aggregateMax = tier === 'fast' ? 12000 : tier === 'precise' ? 20000 : 16000;
  let aggregateResult = await streamText(ctx, {
    provider,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: aggregatePrompt }] }],
    maxTokens: aggregateMax,
  });
  if (!aggregateResult.text && aggregateResult.finishKind === 'max-tokens') {
    aggregateResult = await streamText(ctx, {
      provider,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: aggregatePrompt }] }],
      maxTokens: aggregateMax + 8000,
    });
  }
  if (!aggregateResult.text) {
    throw new ToolError(
      'empty-analysis',
      `全片汇总没有返回内容（finish=${aggregateResult.finishKind || '?'}，usage=${JSON.stringify(aggregateResult.usage || null)}）`,
    );
  }
  if (aggregateResult.usage) {
    usageTotals.input += Number(aggregateResult.usage.inputTokens || 0) + Number(aggregateResult.usage.cacheReadTokens || 0) + Number(aggregateResult.usage.cacheWriteTokens || 0);
    usageTotals.output += Number(aggregateResult.usage.outputTokens || 0);
  }
  const aggregateCost = usageCost(aggregateResult.usage);
  if (aggregateCost !== null) usageTotals.cost += aggregateCost;
  timings.aggregateMs = Date.now() - aggregateStarted;
  timings.totalMs = Date.now() - started;

  // 全片分镜总表（数据生成，不依赖模型）
  const shotTable = ['| 镜号 | 时间码 | 时长 | 备注 |', '|---|---|---|---|']
    .concat(
      shots.map((shot) => `| ${shot.index} | ${formatTime(shot.start)}–${formatTime(shot.end)} | ${shot.duration.toFixed(2)}s | ${shot.duration >= 20 ? '长镜头' : ''} |`),
    )
    .join('\n');

  return {
    ok: true,
    tier,
    videoPath,
    duration: roundTo(probe.duration, 3),
    shotsTotal: shots.length,
    shots: shots.map((shot) => ({
      index: shot.index,
      start: shot.start,
      end: shot.end,
      duration: shot.duration,
      longShot: shot.duration >= 20,
      meanLuma: shot.metrics && shot.metrics.meanLuma !== undefined ? shot.metrics.meanLuma : null,
    })),
    rhythm,
    segments: results,
    finalText: aggregateResult.text,
    shotTable,
    stats: {
      segments: total,
      usage: { inputTokens: usageTotals.input, outputTokens: usageTotals.output },
      estimatedCostCny: roundTo(usageTotals.cost, 4),
    },
    timings,
    provider,
    model,
  };
}

/** 把流水线结果写成 Markdown 文件内容。 */
export function renderDeepMarkdown(result) {
  const lines = [];
  lines.push(`# 分段拉片报告（${result.tier}）`);
  lines.push('');
  lines.push(`> 片段：${result.videoPath}`);
  lines.push(`> 时长：${formatTime(result.duration)}；镜头数：${result.shotsTotal}；分段数：${result.stats.segments}`);
  lines.push(`> 模型：${result.provider}/${result.model}；token：${result.stats.usage.inputTokens}+${result.stats.usage.outputTokens}；费用估算：¥${result.stats.estimatedCostCny}`);
  lines.push('');
  lines.push('## 全片分镜总表');
  lines.push(result.shotTable);
  lines.push('');
  lines.push(result.finalText);
  lines.push('');
  for (const segment of result.segments) {
    lines.push(`\n---\n\n## 第 ${segment.index} 段（${formatTime(segment.start)} – ${formatTime(segment.end)}）\n`);
    lines.push(segment.markdown);
  }
  return lines.join('\n');
}
