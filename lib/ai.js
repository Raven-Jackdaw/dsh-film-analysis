// 一键 AI 分析：Host 侧直接调用 ctx.llm，把镜头片段的代表帧 + 运动/声音/客观数据
// 交给会话默认模型，返回可直接在面板里展示的八维分析文本（不再需要把提示词发到对话）。
import { existsSync, readFileSync } from 'node:fs';
import { ToolError, requireFile } from './toolchain.js';
import { analyzeClip, extractFrames, audioStats } from './video.js';
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
  lines.push('【镜头片段拉片分析请求】');
  lines.push('请分析下面这个镜头片段，输出一份"专业拉片讲解"级别的详细分析。');
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
  lines.push('说明：motion.class 是相邻帧全局位移与差异的初步判断（固定/横移/摇/手持），请结合代表帧修正；brightness.flicker 越大明暗变化越强；transitions 提示淡入/淡出；audio 含音量、静音比例与静默段数。');
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
  lines.push('五、拉片公式（必须逐项覆盖）');
  lines.push('A. 剪辑结构三向：');
  lines.push('  ① 叙事顺序：本镜头在故事时间线/成片顺序中的位置，信息是提前释放、延后公布还是隐藏；这样安排对观众情绪的作用。');
  lines.push('  ② 叙事段落：本镜头是否是一个段落的开始/中段/结束；它如何开始、如何结束，与前后段落之间用什么方法过渡（硬切/叠化/动作衔接/声音先入/遮挡转场等）。');
  lines.push('  ③ 叙事音乐与声音：音乐类型/乐器/情绪属性（结合音量数据判断段落情绪），音效、人声对白、静音停顿如何设计；声音与画面的关系（声画同步/对位）。');
  lines.push('B. 剪辑技巧三向：');
  lines.push('  ① 剪辑时长：镜头持续时长是多少，与前后镜头相比是长是短，剪辑师用这个时长如何处理当下情绪（快表激烈、慢表悲伤/压抑等）。');
  lines.push('  ② 剪辑规律：观察节拍与组合规律（几个镜头一组循环、动作与声音组合的节拍、重复结构等），本镜头属于什么节拍位置。');
  lines.push('  ③ 剪辑组合：是否属于三短一长/三长一短/快切组/长短对比等组合，作用是什么（制造视觉对比、打破平铺秩序等）。');
  lines.push('C. 视听语言：景别、景深与焦距、角度机位、光线影调、色彩色调、构图、镜头运动、表演与美术、剪辑衔接、主题隐喻。');
  lines.push('');
  lines.push('六、输出结构（直接输出 Markdown，内容要具体、有证据、有推断链）');
  lines.push('1. **镜头概览**：位置、时长、景别、人物与动作/对白，3–5 句。');
  lines.push('2. **分镜表**：一行表格，列为：镜号｜时间码｜时长｜景别｜角度机位｜镜头运动｜画面内容｜声音｜剪辑/衔接。');
  lines.push('3. **剪辑结构分析**：按 A①A②A③ 逐项展开，每项给出判断 + 画面/数据依据 + 效果。');
  lines.push('4. **剪辑技巧分析**：按 B①B②B③ 逐项展开，引用时长、节拍、组合等证据。');
  lines.push('5. **八维语言拆解**：表格输出 8 维（景别/景深与焦距/角度和机位/光线和影调/色彩色调/构图/镜头运动/声音线索），每维：判断 + 画面依据 + 导演意图与观众效果 + 专业术语。');
  lines.push('6. **逐帧时间线解读**：按代表帧时间点逐张描述画面里发生了什么、构图/视线/动作/空间的变化，串起镜头内部的时间流动；长镜头重点写镜头内调度与空间转换。');
  lines.push('7. **声音设计**：音乐/音效/对白/静音，结合音量与静默数据说明情绪与段落感。');
  lines.push('8. **叙事与情绪功能**：该镜头在段落中的作用、与前后镜头的轴线/节奏衔接（信息不足处标注推测）。');
  lines.push('9. **拉片笔记**：3 条可操作建议 + 1 条"如果重拍/仿拍会怎么处理"。');
  lines.push('要求：具体到时间码与画面证据；不要空泛套话；不确定处明确标注"推测"；引用给定数值。');
  lines.push('**篇幅**：2500–4000 字，宁可信息密度高也不要重复；确保在输出上限内完整写完。');
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
  const targetFrameCount = duration >= 20 ? 5 : 3;
  const selected = pickEvenly(frames, targetFrameCount);
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
    const maxAllowed = Math.max(0, Math.min(8, Number(attachments.imageLimits.maxImagesPerMessage) || 0));
    const desired = Math.min(selected.length, maxAllowed);
    const attempts = [desired, Math.min(3, desired), Math.min(1, desired)].filter(
      (count, index, list) => count > 0 && list.indexOf(count) === index,
    );
    for (const count of attempts) {
      try {
        const refs = await attachments.saveImages(
          selected.slice(0, count).map((frame, index) => ({
            data: readFileSync(frame.path),
            mediaType: 'image/jpeg',
            name: `shot-${shotIndex}-${index + 1}.jpg`,
          })),
        );
        for (const ref of refs) content.push({ type: 'image', attachment: ref });
        imageCount = refs.length;
        break;
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
      maxTokens: Number(options.maxTokens) || 12000,
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
      const retry = await collect([{ role: 'user', content }], { maxTokens: 20000 });
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

function summarizeRhythm(shots) {
  const durations = shots.map((shot) => Number(shot.duration) || 0);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const buckets = { fastUnder2s: 0, normal2to10s: 0, longOver10s: 0 };
  for (const value of durations) {
    if (value < 2) buckets.fastUnder2s += 1;
    else if (value <= 10) buckets.normal2to10s += 1;
    else buckets.longOver10s += 1;
  }
  // 找重复的镜头时长节拍组合（2–5 个镜头为一组，四舍五入到 0.5 秒后比较）。
  const rounded = durations.map((value) => Math.round(value * 2) / 2);
  let repeatedPattern = null;
  for (let length = 2; length <= 5; length += 1) {
    const counts = new Map();
    for (let i = 0; i + length <= rounded.length; i += 1) {
      const key = rounded.slice(i, i + length).join(',');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key, repeat] of counts) {
      if (repeat >= 2 && (!repeatedPattern || repeat > repeatedPattern.repeat)) {
        repeatedPattern = { pattern: key.split(',').map(Number), length, repeat };
      }
    }
  }
  return {
    shotCount: durations.length,
    totalDuration: roundTo(total, 2),
    mean: roundTo(total / Math.max(1, durations.length), 2),
    median: roundTo(sorted[Math.floor(sorted.length / 2)] || 0, 2),
    min: roundTo(durations.length ? Math.min(...durations) : 0, 2),
    max: roundTo(durations.length ? Math.max(...durations) : 0, 2),
    buckets,
    repeatedPattern,
    sequence: durations.map((value) => roundTo(value, 2)),
  };
}

function buildVideoReportPrompt(info) {
  const { shots, picks, totalShots, rhythm, shotAudio, duration } = info;
  const lines = [];
  lines.push('【整片拉片报告请求】');
  lines.push('请根据镜头表、节奏统计、每镜头声音数据与代表帧，输出一份可对标"专业拉片讲解视频"的详细分析报告。');
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
  lines.push('三、自动节奏统计（镜头时长序列、快慢分布、重复节拍组合）');
  lines.push('```json');
  lines.push(JSON.stringify(rhythm, null, 2));
  lines.push('```');
  lines.push('说明：repeatedPattern 是自动找出的重复时长组合（节拍规律线索）；buckets 是镜头时长的快/中/长分布。');
  lines.push('');
  if (Array.isArray(shotAudio) && shotAudio.length > 0) {
    lines.push('四、每镜头声音数据（音量/静音，用于判断段落情绪与声音设计）');
    lines.push('```json');
    lines.push(JSON.stringify(shotAudio, null, 2));
    lines.push('```');
    lines.push('');
  }
  lines.push('五、代表帧');
  lines.push(`随消息附上 ${picks.length} 张代表帧，顺序与下列对应：`);
  for (const pick of picks) lines.push(`- 镜号 ${pick.shot}：${formatTime(pick.time)}`);
  lines.push('');
  lines.push('六、拉片公式（参考阿次《适合所有人的拉片公式》，必须逐项覆盖）');
  lines.push('A. 剪辑结构三向：');
  lines.push('  ① 叙事顺序：故事时间线 vs 成片顺序（信息提前/延后/隐藏释放），整片属于顺叙/倒叙/插叙/隐藏式结构，关键信息在什么时间点公布、为什么。');
  lines.push('  ② 叙事段落：全片可分几个叙事段落，各自的开始与结束方式，段落之间用什么方法过渡（硬切/叠化/动作衔接/声音先入/遮挡转场等），段落节奏如何变化。');
  lines.push('  ③ 叙事音乐与声音：音乐类型/乐器/情绪属性（用每镜头音量与静音数据推断情绪段落），音效、人声对白、静音的设计；声画同步或对位。');
  lines.push('B. 剪辑技巧三向：');
  lines.push('  ① 剪辑时长：镜头时长分布（引用 rhythm 数据）与情绪处理——什么时候用短镜头/快切，什么时候用长镜头/慢节奏，和人物心理、叙事重量的关系。');
  lines.push('  ② 剪辑规律：整片的节拍规律（几个镜头一组循环、动作与声音组合、重复结构；引用 repeatedPattern），如何制造"日复一日/压迫/递进"等感受。');
  lines.push('  ③ 剪辑组合：三短一长/三长一短/快切组/长短对比等组合在哪里出现，作用是什么（视觉对比、打破平铺秩序、制造节奏）。');
  lines.push('C. 视听语言：景别策略、景深与焦距、角度机位、光线影调、色彩色调、构图、镜头运动、表演与美术、主题隐喻。');
  lines.push('');
  lines.push('七、输出结构（直接输出 Markdown，内容具体、有证据、有推断链）');
  lines.push('1. **总览**：片段类型/场景/人物关系/整体风格，4–6 句。');
  lines.push('2. **剪辑结构分析**：按 A①A②A③ 逐项展开，引用时间码与节奏/声音数据。');
  lines.push('3. **剪辑技巧分析**：按 B①B②B③ 逐项展开，引用时长分布、重复节拍与组合证据。');
  lines.push('4. **全片分镜表**：每个镜头一行：镜号｜时间码｜时长｜景别｜角度机位｜镜头运动｜画面内容｜声音/对白｜剪辑与衔接。');
  lines.push('5. **逐镜头讲解**：每镜 2–5 句，写"用了什么手段、为什么用、观众感受"，长镜头要写镜头内调度与空间变化。');
  lines.push('6. **视听语言总设计**：景别策略/机位/运动/光线/色彩/构图/表演/美术的整体设计。');
  lines.push('7. **节奏与结构曲线**：镜头长度序列、切点密度、段落划分与情绪曲线（可画简单的文字曲线）。');
  lines.push('8. **风格与主题**：归纳主导技术手段，说明形式如何服务主题。');
  lines.push('9. **拉片笔记**：3 条可操作建议 + 1 条"如果重拍/仿拍会怎么处理"。');
  lines.push('要求：具体到时间码与画面证据；不要空泛套话；不确定处标注"推测"；引用给定数值。');
  lines.push('**篇幅**：3000–4500 字，确保在输出上限内完整写完。');
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

  // 每镜头取一张代表帧（最多 8 张）；长镜头再补一张不同时间点的帧。
  const picks = [];
  for (const shot of shots) {
    if (picks.length >= 8) break;
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
  if (picks.length < 8) {
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
  const duration = shots.reduce((max, shot) => Math.max(max, shot.end), 0);
  const rhythm = summarizeRhythm(shots);
  const audioStarted = Date.now();
  const audioTargets = shots.length <= 8 ? shots : pickEvenly(shots, 8);
  const shotAudio = [];
  for (const shot of audioTargets) {
    try {
      const stats = await audioStats(toolchain, videoPath, shot.start, shot.end);
      if (stats) {
        shotAudio.push({
          index: shot.index,
          start: roundTo(shot.start, 2),
          end: roundTo(shot.end, 2),
          duration: roundTo(shot.duration, 2),
          meanVolumeDb: stats.meanVolumeDb,
          maxVolumeDb: stats.maxVolumeDb,
          silenceRatio: stats.silenceRatio,
          silenceSegments: stats.silenceSegments,
        });
      }
    } catch {
      /* 单个镜头声音统计失败不影响报告 */
    }
  }
  timings.audioMs = Date.now() - audioStarted;
  timings.prepareMs = Date.now() - started;

  const prompt = buildVideoReportPrompt({ shots, picks, totalShots: shots.length, rhythm, shotAudio, duration });
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
    const maxAllowed = Math.max(0, Math.min(8, Number(attachments.imageLimits.maxImagesPerMessage) || 0));
    const desired = Math.min(picks.length, maxAllowed);
    const attempts = [desired, Math.min(4, desired), Math.min(2, desired)].filter(
      (count, index, list) => count > 0 && list.indexOf(count) === index,
    );
    for (const count of attempts) {
      try {
        const refs = await attachments.saveImages(
          picks.slice(0, count).map((pick, index) => ({
            data: readFileSync(pick.path),
            mediaType: 'image/jpeg',
            name: `report-shot-${pick.shot}-${index + 1}.jpg`,
          })),
        );
        for (const ref of refs) content.push({ type: 'image', attachment: ref });
        imageCount = refs.length;
        break;
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
    result = await streamModelOnce(llm, { provider, model, messages, maxTokens: 16000 });
    if (result.text === '' && result.finishKind === 'max-tokens') {
      result = await streamModelOnce(llm, { provider, model, messages, maxTokens: 24000 });
    }
  } catch (error) {
    if (mode === 'vision') {
      const fallbackText = `${prompt}\n\n（注意：当前模型无法接收图片，请只依据镜头表与客观数据分析，并说明这一限制。）`;
      result = await streamModelOnce(llm, { provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: fallbackText }] }], maxTokens: 16000 });
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
