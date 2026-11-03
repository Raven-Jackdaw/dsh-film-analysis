// 一键 AI 分析：Host 侧直接调用 ctx.llm，把镜头片段的代表帧 + 运动/声音/客观数据
// 交给会话默认模型，返回可直接在面板里展示的八维分析文本（不再需要把提示词发到对话）。
import { existsSync, readFileSync } from 'node:fs';
import { ToolError, requireFile } from './toolchain.js';
import { analyzeClip, extractFrames } from './video.js';
import { imageMetrics } from './metrics.js';
import { imageOcr } from './ocr.js';

const SYSTEM_PROMPT =
  '你是一位专业的影视视听语言分析助手，熟悉张菁《影视视听语言》（第四版）与丹尼艾尔·阿里洪《电影语言的语法》的分析框架。你的任务是根据提供的镜头代表帧与客观测量数据，输出严谨、具体、可验证的中文视听语言分析。不要编造画面中不存在的信息；信息不足时明确说明这是推测并给出依据。';

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function pickEvenly(list, count) {
  if (list.length <= count) return list;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(list[Math.round((i * (list.length - 1)) / (count - 1))]);
  }
  return out;
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function buildClipPrompt(info) {
  const { shotIndex, totalShots, start, end, duration, frames, clip, metrics, ocr, neighbors } = info;
  const lines = [];
  lines.push('【镜头片段分析请求】');
  lines.push('请分析下面这个镜头片段，直接输出专业的拉片讲解式分析结果。');
  lines.push('');
  lines.push('一、片段信息');
  lines.push(`- 镜号：${shotIndex}${totalShots ? ` / 共 ${totalShots} 个镜头` : ''}`);
  lines.push(`- 时间码：${formatTime(start)} – ${formatTime(end)}（时长 ${formatTime(duration)}）`);
  lines.push(`- 代表帧：共 ${frames.length} 张，时间点 ${frames.map((frame) => formatTime(frame.time)).join(' / ')}`);
  if (neighbors && neighbors.prevShot) {
    lines.push(
      `- 前一镜头：${formatTime(neighbors.prevShot.start)} – ${formatTime(neighbors.prevShot.end)}（时长 ${formatTime(Math.max(0, neighbors.prevShot.end - neighbors.prevShot.start))}）`,
    );
  }
  if (neighbors && neighbors.nextShot) {
    lines.push(
      `- 后一镜头：${formatTime(neighbors.nextShot.start)} – ${formatTime(neighbors.nextShot.end)}（时长 ${formatTime(Math.max(0, neighbors.nextShot.end - neighbors.nextShot.start))}）`,
    );
  }
  lines.push('');
  lines.push('二、片段级客观测量（自动提取，不是单帧）');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        motion: clip.motion,
        brightness: clip.brightness,
        transitions: clip.transitions,
        audio: clip.audio,
        frameCount: clip.frameCount,
        sampleFps: clip.sampleFps,
      },
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('说明：motion.class 已根据相邻帧全局位移与差异给出初步判断（如固定/横移/摇/手持），请结合代表帧修正；brightness.flicker 越大表示明暗变化越强；transitions 提示淡入/淡出；audio 为音量与静音比例。');
  lines.push('');
  lines.push('三、代表帧的客观测量');
  lines.push('```json');
  lines.push(JSON.stringify(metrics || null, null, 2));
  lines.push('```');
  lines.push('');
  if (ocr && ocr.text) {
    lines.push('四、画面文字 OCR（自动识别，可能有噪声）');
    lines.push('```text');
    lines.push(ocr.text);
    lines.push('```');
    lines.push('');
  }
  lines.push('五、分析框架');
  lines.push('- 张菁版：视觉设计（美术/场景/服装/光线/色彩）→ 结构 → 语言拆解（景别/角度/运动/剪辑/声音）→ 风格与主题。');
  lines.push('- 阿里洪：关系线与三角形机位、内外反拍、中性方向与切换点、运动镜头规律、镜头内组接、电影分句法。');
  lines.push('- 以上代表帧来自同一个镜头片段，请把它们作为"连续时段"的证据：注意人物走位、机位/运动变化、空间转换与节奏。');
  lines.push('');
  lines.push('六、输出结构（直接输出 Markdown，要达到"专业拉片讲解视频"的内容密度）');
  lines.push('1. **镜头概览**：一句话概括本镜头（时间码、时长、景别、主要动作/对白）。');
  lines.push('2. **分镜表**：一行 Markdown 表格，列为：镜号｜时间码｜时长｜景别｜角度机位｜镜头运动｜画面内容｜声音｜剪辑/衔接。');
  lines.push('3. **八维语言拆解**：表格输出 8 个维度（景别/景深与焦距/角度和机位/光线和影调/色彩色调/构图/镜头运动/声音线索），每维写：判断 + 画面依据 + 导演意图与观众效果 + 专业术语。');
  lines.push('4. **片段级运动与声音**：结合 motion/brightness/audio 数据（引用具体数值）说明机位运动、人物调度、明暗节奏、音量与静默；长镜头要说明镜头内组接/空间转换。');
  lines.push('5. **叙事与情绪功能**：该镜头在段落中的作用，与前后镜头的衔接（关系线/轴线是否延续、节奏位置）。');
  lines.push('6. **拉片笔记**：3 条可操作建议 + 1 条"如果重拍/仿拍会怎么处理"。');
  lines.push('要求：具体到时间码与画面证据，避免空泛套话；信息不足处明确标注推测。');
  lines.push('**篇幅控制**：总字数 1200–1800 字，表格单元格简洁，不要重复同一观点，确保在输出上限内写完。');
  lines.push('');
  lines.push('（本分析由"影视画面分析器"调用会话默认模型生成。）');
  return lines.join('\n');
}

export async function aiAnalyzeShot(ctx, toolchain, params = {}) {
  const videoPath = requireFile(params.videoPath, 'videoPath');
  const start = Math.max(0, Number(params.start) || 0);
  const end = Number(params.end);
  if (!Number.isFinite(end) || end <= start) throw new ToolError('bad-argument', '片段起止时间无效');
  const duration = Number((end - start).toFixed(3));
  const shotIndex = Number(params.shotIndex) || 1;
  const totalShots = Number(params.totalShots) || 0;
  const timings = {};
  const started = Date.now();

  // 1) 片段级运动/亮度/声音分析
  const clipStarted = Date.now();
  const clip = await analyzeClip(toolchain, videoPath, { start, end });
  timings.clipMs = Date.now() - clipStarted;

  // 2) 代表帧：优先复用 autoShots 已生成的；否则现场抽 3 张
  let frames = Array.isArray(params.frames)
    ? params.frames
        .filter((frame) => frame && typeof frame.path === 'string' && existsSync(frame.path))
        .map((frame) => ({ time: Number(frame.time) || 0, path: frame.path, url: String(frame.url ?? '') }))
    : [];
  if (frames.length === 0) {
    const times = [0.2, 0.5, 0.8].map((ratio) => Number((start + duration * ratio).toFixed(3)));
    const extracted = await extractFrames(toolchain, videoPath, { times, scale: 720 });
    frames = extracted.frames.map((frame) => ({ time: frame.time, path: frame.path, url: frame.url }));
  }
  const selected = pickEvenly(frames, 3);
  const primary = selected[Math.floor((selected.length - 1) / 2)] || selected[0];

  let metrics = params.metrics && typeof params.metrics === 'object' ? params.metrics : null;
  if (!metrics) {
    try {
      metrics = await imageMetrics(primary.path);
    } catch {
      metrics = null;
    }
  }
  let ocr = null;
  try {
    const result = await imageOcr(primary.path);
    if (result && result.text) ocr = { text: String(result.text).slice(0, 2000), count: result.count };
  } catch {
    ocr = null;
  }
  timings.prepareMs = Date.now() - started;

  // 3) 组装模型请求
  const neighbors = {
    prevShot: params.prevShot && Number.isFinite(Number(params.prevShot.start)) ? params.prevShot : null,
    nextShot: params.nextShot && Number.isFinite(Number(params.nextShot.start)) ? params.nextShot : null,
  };
  const prompt = buildClipPrompt({ shotIndex, totalShots, start, end, duration, frames: selected, clip, metrics, ocr, neighbors });
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null;
  const provider = String(params.provider || selection?.provider || '');
  const model = String(params.model || selection?.model || '');
  if (provider === '' || model === '') throw new ToolError('model-unavailable', '当前会话没有可用的默认模型');
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') throw new ToolError('llm-unavailable', '宿主没有可用的模型服务');

  const content = [{ type: 'text', text: prompt }];
  let imageCount = 0;
  const attachments = ctx.get('attachments');
  if (attachments && typeof attachments.saveImages === 'function' && attachments.imageLimits) {
    const limit = Math.max(0, Math.min(3, Number(attachments.imageLimits.maxImagesPerMessage) || 0));
    const chosen = selected.slice(0, limit);
    if (chosen.length > 0) {
      try {
        const refs = await attachments.saveImages(
          chosen.map((frame, index) => ({
            data: readFileSync(frame.path),
            mediaType: 'image/jpeg',
            name: `shot-${shotIndex}-${index + 1}.jpg`,
          })),
        );
        for (const ref of refs) content.push({ type: 'image', attachment: ref });
        imageCount = refs.length;
      } catch {
        imageCount = 0;
      }
    }
  }

  const collect = async (messages, options = {}) => {
    let text = '';
    let reasoningLength = 0;
    let usage = null;
    let finishKind = null;
    let failure = null;
    for await (const chunk of llm.stream({
      provider,
      model,
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: Number(options.maxTokens) || 8000,
    })) {
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
  };

  let mode = imageCount > 0 ? 'vision' : 'text-only';
  let text = '';
  let usage = null;
  let reasoningLength = 0;
  let finishKind = null;
  const llmStarted = Date.now();
  try {
    const first = await collect([{ role: 'user', content }]);
    text = first.text;
    usage = first.usage;
    reasoningLength = first.reasoningLength;
    finishKind = first.finishKind;
    // 思考型模型可能把输出预算耗在 reasoning 上：加大预算重试一次。
    if (text === '' && finishKind === 'max-tokens') {
      const retry = await collect([{ role: 'user', content }], { maxTokens: 14000 });
      text = retry.text;
      usage = retry.usage || usage;
      reasoningLength += retry.reasoningLength || 0;
      finishKind = retry.finishKind;
    }
  } catch (error) {
    if (mode === 'vision') {
      // 视觉输入被拒绝：回退到纯文本（客观数据 + OCR）
      const fallbackText = `${prompt}\n\n（注意：当前模型无法接收图片，请只依据以上客观数据与 OCR 文本分析，并在开头说明这一限制。）`;
      const second = await collect([{ role: 'user', content: [{ type: 'text', text: fallbackText }] }]);
      text = second.text;
      usage = second.usage;
      reasoningLength = second.reasoningLength;
      finishKind = second.finishKind;
      mode = 'text-only';
    } else {
      throw error;
    }
  }
  timings.llmMs = Date.now() - llmStarted;
  timings.totalMs = Date.now() - started;
  if (!text) {
    throw new ToolError(
      'empty-analysis',
      `模型没有返回正文（finish=${finishKind || 'unknown'}，thinking≈${reasoningLength}字，usage=${JSON.stringify(usage || null)}）`,
    );
  }

  // 费用估算：按保守单价（输入 2 元/百万 token、输出 8 元/百万 token）上限计算。
  const inputTokens = usage
    ? Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0) + Number(usage.cacheWriteTokens || 0)
    : null;
  const estimatedCostCny =
    usage && Number.isFinite(inputTokens)
      ? roundTo((inputTokens / 1e6) * 2 + (Number(usage.outputTokens || 0) / 1e6) * 8, 4)
      : null;

  return {
    ok: true,
    mode,
    provider,
    model,
    text,
    truncated: finishKind === 'max-tokens',
    clip,
    metrics,
    ocr,
    frames: selected.map((frame) => ({ time: frame.time, path: frame.path, url: frame.url })),
    imageCount,
    timings,
    usage: usage || null,
    estimatedCostCny,
    duration,
    start: roundTo(start, 3),
    end: roundTo(end, 3),
  };
}

// ===========================================================================
// 整片拉片报告：一次模型调用覆盖整段视频（分镜表 + 逐镜头讲解 + 风格总结）。
// ===========================================================================

async function streamModelOnce(llm, options) {
  let text = '';
  let reasoningLength = 0;
  let usage = null;
  let finishKind = null;
  let failure = null;
  for await (const chunk of llm.stream({
    provider: options.provider,
    model: options.model,
    system: options.system || SYSTEM_PROMPT,
    messages: options.messages,
    maxTokens: Number(options.maxTokens) || 8000,
  })) {
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

function shotMetricsSummary(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  return {
    meanLuma: metrics.meanLuma,
    contrast: metrics.rmsContrast,
    contrastLevel: metrics.contrastLevel,
    colorTempLabel: metrics.colorTempLabel,
    saturation: metrics.saturationMean,
    aspect: metrics.aspectLabel,
  };
}

function buildVideoReportPrompt(info) {
  const { shots, picks, totalShots } = info;
  const duration = shots.reduce((max, shot) => Math.max(max, shot.end), 0);
  const lines = [];
  lines.push('【整片拉片报告请求】');
  lines.push('请根据下面的镜头表、代表帧与客观数据，输出一份可直接用于"拉片讲解"的整片分析报告。');
  lines.push('');
  lines.push('一、影片片段信息');
  lines.push(`- 片段时长：${formatTime(duration)}，共 ${totalShots} 个镜头`);
  lines.push(`- 镜头平均长度：${formatTime(duration / Math.max(1, totalShots))}`);
  lines.push('');
  lines.push('二、镜头表（自动检测）');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      shots.map((shot) => ({
        index: shot.index,
        start: shot.start,
        end: shot.end,
        duration: shot.duration,
        longShot: shot.duration >= 20,
        metrics: shotMetricsSummary(shot.metrics),
      })),
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('');
  lines.push('三、每镜头代表帧');
  lines.push(`随消息附上 ${picks.length} 张代表帧，顺序与下列对应：`);
  for (const pick of picks) lines.push(`- 镜号 ${pick.shot}：${formatTime(pick.time)}`);
  lines.push('');
  lines.push('四、输出结构（直接输出 Markdown）');
  lines.push('1. **总览**：片段类型/场景/人物关系/整体视听风格，3–5 句。');
  lines.push('2. **全片分镜表**：每个镜头一行，列为：镜号｜时间码｜时长｜景别｜角度机位｜镜头运动｜画面内容｜声音/对白｜剪辑与衔接。');
  lines.push('3. **逐镜头讲解**：按镜号逐个写 2–4 句，包含"用了什么手段、为什么用、观众感受"；长镜头要说明镜头内的调度与空间变化。');
  lines.push('4. **节奏与结构**：镜头长度变化、切点密度、段落划分与情绪曲线。');
  lines.push('5. **视觉与声音设计**：光线、色彩、构图、景别策略、声音/对白/静音的整体设计。');
  lines.push('6. **风格与主题**：归纳主导技术手段，说明形式如何服务主题。');
  lines.push('7. **拉片笔记**：3 条可操作建议 + 1 条"如果重拍/仿拍会怎么处理"。');
  lines.push('要求：具体到时间码与画面证据；信息不足处标注"推测"；总字数 2000–3000 字，确保写完不被截断。');
  lines.push('');
  lines.push('（本报告由"影视画面分析器"调用会话默认模型生成。）');
  return lines.join('\n');
}

export async function aiAnalyzeVideoReport(ctx, toolchain, params = {}) {
  const videoPath = requireFile(params.videoPath, 'videoPath');
  const started = Date.now();
  const timings = {};
  const rawShots = Array.isArray(params.shots) ? params.shots : [];
  if (rawShots.length === 0) throw new ToolError('bad-argument', '需要 shots 参数（自动拉片的镜头列表）');
  const shots = rawShots.map((shot, index) => {
    const start = Number(shot.start) || 0;
    const end = Number(shot.end) || 0;
    return {
      index: Number(shot.index) || index + 1,
      start: roundTo(start, 3),
      end: roundTo(end, 3),
      duration: roundTo(Number(shot.duration) || Math.max(0, end - start), 3),
      longShot: Boolean(shot.longShot) || end - start >= 20,
      frames: Array.isArray(shot.frames) ? shot.frames.filter((frame) => frame && typeof frame.path === 'string' && existsSync(frame.path)) : [],
      metrics: shot.metrics && typeof shot.metrics === 'object' ? shot.metrics : null,
    };
  });

  // 每镜头取一张代表帧（最多 6 张，控制图片 token 与耗时）。
  const picks = [];
  for (const shot of shots) {
    if (picks.length >= 6) break;
    let frame = shot.frames.length > 0 ? shot.frames[Math.floor((shot.frames.length - 1) / 2)] : null;
    if (!frame) {
      const time = Number((shot.start + shot.duration * 0.5).toFixed(3));
      try {
        const extracted = await extractFrames(toolchain, videoPath, { times: [time], scale: 720 });
        frame = extracted.frames && extracted.frames[0] ? extracted.frames[0] : null;
      } catch {
        frame = null;
      }
    }
    if (frame) picks.push({ shot: shot.index, time: Number(frame.time) || shot.start + shot.duration / 2, path: frame.path, url: frame.url || '' });
  }
  // 长镜头补第二张代表帧（最多 6 张），否则一个 3–6 分钟镜头只有一张图无法支撑逐段讲解。
  if (picks.length < 6) {
    const longest = shots
      .filter((shot) => shot.duration >= 90)
      .sort((a, b) => b.duration - a.duration)[0];
    if (longest) {
      let frame = longest.frames.length > 1 ? longest.frames[Math.floor((longest.frames.length - 1) * 0.75)] : null;
      if (!frame) {
        const time = Number((longest.start + longest.duration * 0.75).toFixed(3));
        try {
          const extracted = await extractFrames(toolchain, videoPath, { times: [time], scale: 720 });
          frame = extracted.frames && extracted.frames[0] ? extracted.frames[0] : null;
        } catch {
          frame = null;
        }
      }
      if (frame) {
        const position = picks.findIndex((pick) => pick.shot === longest.index);
        picks.splice(position >= 0 ? position + 1 : picks.length, 0, {
          shot: longest.index,
          time: Number(frame.time) || longest.start + longest.duration * 0.75,
          path: frame.path,
          url: frame.url || '',
        });
      }
    }
  }
  timings.prepareMs = Date.now() - started;

  const prompt = buildVideoReportPrompt({ shots, picks, totalShots: shots.length });
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null;
  const provider = String(params.provider || selection?.provider || '');
  const model = String(params.model || selection?.model || '');
  if (provider === '' || model === '') throw new ToolError('model-unavailable', '当前会话没有可用的默认模型');
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') throw new ToolError('llm-unavailable', '宿主没有可用的模型服务');

  const content = [{ type: 'text', text: prompt }];
  let imageCount = 0;
  const attachments = ctx.get('attachments');
  if (attachments && typeof attachments.saveImages === 'function' && attachments.imageLimits) {
    const limit = Math.max(0, Math.min(6, Number(attachments.imageLimits.maxImagesPerMessage) || 0));
    const chosen = picks.slice(0, limit);
    if (chosen.length > 0) {
      try {
        const refs = await attachments.saveImages(
          chosen.map((pick, index) => ({
            data: readFileSync(pick.path),
            mediaType: 'image/jpeg',
            name: `report-shot-${pick.shot}-${index + 1}.jpg`,
          })),
        );
        for (const ref of refs) content.push({ type: 'image', attachment: ref });
        imageCount = refs.length;
      } catch {
        imageCount = 0;
      }
    }
  }

  const messages = [{ role: 'user', content }];
  let mode = imageCount > 0 ? 'vision' : 'text-only';
  let result = null;
  const llmStarted = Date.now();
  try {
    result = await streamModelOnce(llm, { provider, model, messages, maxTokens: 9000 });
    if (result.text === '' && result.finishKind === 'max-tokens') {
      result = await streamModelOnce(llm, { provider, model, messages, maxTokens: 16000 });
    }
  } catch (error) {
    if (mode === 'vision') {
      const fallbackText = `${prompt}\n\n（注意：当前模型无法接收图片，请只依据镜头表与客观数据分析，并说明这一限制。）`;
      result = await streamModelOnce(llm, { provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: fallbackText }] }], maxTokens: 9000 });
      mode = 'text-only';
    } else {
      throw error;
    }
  }
  timings.llmMs = Date.now() - llmStarted;
  timings.totalMs = Date.now() - started;
  const text = result.text;
  if (!text) {
    throw new ToolError(
      'empty-analysis',
      `模型没有返回正文（finish=${result.finishKind || 'unknown'}，thinking≈${result.reasoningLength}字，usage=${JSON.stringify(result.usage || null)}）`,
    );
  }
  const usage = result.usage || null;
  const inputTokens = usage
    ? Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0) + Number(usage.cacheWriteTokens || 0)
    : null;
  const estimatedCostCny =
    usage && Number.isFinite(inputTokens)
      ? roundTo((inputTokens / 1e6) * 2 + (Number(usage.outputTokens || 0) / 1e6) * 8, 4)
      : null;
  return {
    ok: true,
    mode,
    provider,
    model,
    text,
    truncated: result.finishKind === 'max-tokens',
    shots: shots.map((shot) => ({ index: shot.index, start: shot.start, end: shot.end, duration: shot.duration, longShot: shot.longShot })),
    picks: picks.map((pick) => ({ shot: pick.shot, time: pick.time, path: pick.path, url: pick.url })),
    imageCount,
    timings,
    usage,
    estimatedCostCny,
  };
}
