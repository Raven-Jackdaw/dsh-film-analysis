// 注册 9 个 agent 工具；工具与面板 API 共用 service.invoke 的实现。
function fail(error) {
  return {
    ok: false,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'error',
      message: String(error?.message ?? error),
    },
  };
}

function render(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 1) }];
}

function resultSchema(extra = {}) {
  return {
    type: 'object',
    properties: { ok: { type: 'boolean' }, ...extra },
    required: ['ok'],
  };
}

const IMAGE_PATH = {
  type: 'string',
  description: '图片的绝对路径（jpg/jpeg/png/webp/gif/bmp/tif）。支持工作区外路径。',
};
const VIDEO_PATH = {
  type: 'string',
  description: '视频的绝对路径（mp4/mov/mkv/webm/avi）。',
};
const ANALYSIS_OPTIONS_SCHEMA = {
  template: {
    type: 'string',
    enum: ['auto', 'homework', 'exam', 'review', 'shoot', 'quick'],
    description: '分析模板：auto=自动、homework=课程作业、exam=考研/艺考答题、review=影评、shoot=拍摄参考、quick=快速检查。',
  },
  focus: {
    type: 'array',
    items: { type: 'string' },
    description: '聚焦维度（可选）：景别/景深与焦距/角度与视点/光线与影调/色彩与色调/构图/镜头运动/剪辑与蒙太奇/声音与声画/场面调度。',
  },
  language: {
    type: 'string',
    enum: ['zh', 'bilingual', 'en'],
    description: '输出语言：zh=中文（默认）、bilingual=中英对照、en=English。',
  },
};
const OUTPUT_PROPS = {
  outputPath: { type: 'string' },
  url: { type: 'string' },
  width: { type: 'integer' },
  height: { type: 'integer' },
};

export function createToolDefinitions(service) {
  const invoke = (action, params) => service.invoke(action, params);

  return [
    {
      name: 'film_image_metrics',
      description:
        '测量单张影视画面/剧照：宽高、画幅比、平均亮度、对比度(RMS)、色温倾向(R-B)、饱和度、边缘密度、16 桶亮度直方图。用于客观描述影调与色彩基调。入参为图片绝对路径。',
      parameters: {
        type: 'object',
        properties: { imagePath: IMAGE_PATH },
        required: ['imagePath'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      output: { schema: resultSchema(), render },
      async execute(args) {
        try {
          return await invoke('metrics', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_image_palette',
      description:
        '提取画面的主色板：按占比降序返回颜色 hex 与占比（默认 k=8）。用于分析色彩基调、色块构成与美术配色。',
      parameters: {
        type: 'object',
        properties: {
          imagePath: IMAGE_PATH,
          k: { type: 'integer', minimum: 2, maximum: 16, description: '主色数量，默认 8。' },
        },
        required: ['imagePath'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      output: { schema: resultSchema({ colors: { type: 'array', items: { type: 'object' } } }), render },
      async execute(args) {
        try {
          return await invoke('palette', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_image_zoom',
      description:
        '裁剪画面局部并放大，输出 PNG（用于看清表演、道具、字幕等细节）。x/y/w/h 为 0–1 的比例坐标；scale 为放大倍数（默认 1，上限 8）。',
      parameters: {
        type: 'object',
        properties: {
          imagePath: IMAGE_PATH,
          x: { type: 'number', minimum: 0, maximum: 1, description: '裁剪区左上角 x 比例，默认 0。' },
          y: { type: 'number', minimum: 0, maximum: 1, description: '裁剪区左上角 y 比例，默认 0。' },
          w: { type: 'number', minimum: 0.01, maximum: 1, description: '裁剪区宽度比例，默认 1。' },
          h: { type: 'number', minimum: 0.01, maximum: 1, description: '裁剪区高度比例，默认 1。' },
          scale: { type: 'number', minimum: 1, maximum: 8, description: '放大倍数，默认 1。' },
        },
        required: ['imagePath'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      output: { schema: resultSchema(OUTPUT_PROPS), render },
      async execute(args) {
        try {
          return await invoke('zoom', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_image_enhance',
      description:
        '调整画面并输出 PNG：亮度、对比度、饱和度（-1~1）、锐化（0~1）、暗部提亮（0~1）。可用于看清暗部细节或模拟不同影调。',
      parameters: {
        type: 'object',
        properties: {
          imagePath: IMAGE_PATH,
          brightness: { type: 'number', minimum: -1, maximum: 1, description: '亮度增减，默认 0。' },
          contrast: { type: 'number', minimum: -1, maximum: 1, description: '对比度增减，默认 0。' },
          saturation: { type: 'number', minimum: -1, maximum: 1, description: '饱和度增减，默认 0。' },
          sharpen: { type: 'number', minimum: 0, maximum: 1, description: '锐化强度，默认 0。' },
          shadows: { type: 'number', minimum: 0, maximum: 1, description: '暗部提亮强度，默认 0。' },
        },
        required: ['imagePath'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      output: { schema: resultSchema(OUTPUT_PROPS), render },
      async execute(args) {
        try {
          return await invoke('enhance', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_image_overlay',
      description:
        '在画面上叠加标注并输出 PNG：三分/黄金分割/中心/网格辅助线、景别框（矩形）、轴线（直线）、视线/运动箭头、文字标签。所有坐标为 0–1 比例。返回 outputPath 与 url，可用 read_image 查看结果。',
      parameters: {
        type: 'object',
        properties: {
          imagePath: IMAGE_PATH,
          guides: {
            type: 'array',
            description: "辅助线，如 ['thirds','golden','center'] 或 [{type:'grid',divisions:3}]。",
            items: { oneOf: [{ type: 'string' }, { type: 'object' }] },
          },
          boxes: {
            type: 'array',
            description: '矩形框（景别框/重点区域）：[{x,y,w,h,label?}]，坐标 0–1。',
            items: { type: 'object' },
          },
          lines: {
            type: 'array',
            description: '直线（轴线/关系线）：[{x1,y1,x2,y2,label?}]，坐标 0–1。',
            items: { type: 'object' },
          },
          arrows: {
            type: 'array',
            description: '箭头（视线/运动方向）：[{x1,y1,x2,y2,label?}]，坐标 0–1。',
            items: { type: 'object' },
          },
          labels: {
            type: 'array',
            description: '文字标签：[{x,y,text,scale?}]，坐标 0–1。',
            items: { type: 'object' },
          },
          frame: { type: 'boolean', description: '是否画一个内边框，默认 false。' },
        },
        required: ['imagePath'],
        additionalProperties: false,
      },
      timeoutMs: 90000,
      output: { schema: resultSchema(OUTPUT_PROPS), render },
      async execute(args) {
        try {
          return await invoke('overlay', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_video_probe',
      description:
        '读取视频元信息：时长、分辨率、帧率、编码、码率、画幅比、旋转、音频流信息。用于分析镜头运动前的素材检查。',
      parameters: {
        type: 'object',
        properties: { videoPath: VIDEO_PATH },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      output: { schema: resultSchema(), render },
      async execute(args) {
        try {
          return await invoke('probe', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_frame_extract',
      description:
        '从视频抽取指定时间点的帧，输出 JPG 并返回每个文件的绝对路径与 url。参数二选一：times（秒数组，最多 60 个）或 range（{start,end,step} 秒）；都不传则均匀抽 9 帧。scale 为输出宽度（像素，可选）。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          times: { type: 'array', items: { type: 'number', minimum: 0 }, description: '抽帧时间点（秒）。' },
          range: {
            type: 'object',
            properties: {
              start: { type: 'number', minimum: 0 },
              end: { type: 'number', minimum: 0 },
              step: { type: 'number', minimum: 0.05 },
            },
            description: '按区间抽帧：起始、结束、步长（秒）。',
          },
          count: { type: 'integer', minimum: 1, maximum: 24, description: '不传 times/range 时的均匀抽帧数，默认 9。' },
          scale: { type: 'integer', minimum: 64, maximum: 7680, description: '输出宽度像素，可选。' },
        },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 180000,
      output: { schema: resultSchema({ frames: { type: 'array', items: { type: 'object' } }, count: { type: 'integer' } }), render },
      async execute(args) {
        try {
          return await invoke('extractFrames', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_contact_sheet',
      description:
        '生成接触表（多帧拼图 PNG）供整体观察镜头/镜头序列。两种输入：videoPath（自动均匀抽帧，可用 times/count）或 frames（已有图片路径数组）。cols 为列数（默认 3），width 为单格宽度像素（默认 420）。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          times: { type: 'array', items: { type: 'number', minimum: 0 }, description: '视频抽帧时间点（秒）。' },
          count: { type: 'integer', minimum: 1, maximum: 36, description: '自动抽帧数量，默认 9。' },
          frames: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, time: { type: 'number' } },
              required: ['path'],
            },
            description: '已有帧图片：[{path,time?}]。',
          },
          cols: { type: 'integer', minimum: 1, maximum: 6, description: '列数，默认 3。' },
          width: { type: 'integer', minimum: 160, maximum: 960, description: '单格宽度像素，默认 420。' },
        },
        additionalProperties: false,
      },
      timeoutMs: 240000,
      output: { schema: resultSchema({ ...OUTPUT_PROPS, count: { type: 'integer' } }), render },
      async execute(args) {
        try {
          return await invoke('contactSheet', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_image_ocr',
      description:
        'OCR 识别画面中的中文字幕/文字（tesseract chi_sim，离线）。返回整段文本、逐行文本、置信度与行框。首次调用需初始化引擎，可能耗时数十秒。',
      parameters: {
        type: 'object',
        properties: { imagePath: IMAGE_PATH },
        required: ['imagePath'],
        additionalProperties: false,
      },
      timeoutMs: 300000,
      output: {
        schema: resultSchema({
          text: { type: 'string' },
          lines: { type: 'array', items: { type: 'object' } },
          count: { type: 'integer' },
        }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('ocr', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_scene_detect',
      description:
        '检测视频中的镜头切换（ffmpeg scene 分数）。返回视频时长、镜头总数，以及每个镜头的起止时间与时长（时间码单位秒）。threshold 默认 0.32（0.05–0.9，越高切点越少）。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          threshold: {
            type: 'number',
            minimum: 0.05,
            maximum: 0.9,
            description: '场景切换阈值，默认 0.32。',
          },
        },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 300000,
      isConcurrencySafe: () => true,
      output: {
        schema: resultSchema({
          shots: { type: 'array', items: { type: 'object' } },
          totalShots: { type: 'integer' },
          duration: { type: 'number' },
        }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('sceneDetect', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_auto_shots',
      description:
        '自动拉片：检测镜头，并为每个镜头抽取一张代表帧（JPG）+ 画面测量数据。返回镜头列表（序号、起止时间、代表帧绝对路径与 url、metrics）。maxShots 默认 12（1–40），镜头多时等距抽样并标记 truncated。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          threshold: {
            type: 'number',
            minimum: 0.05,
            maximum: 0.9,
            description: '场景切换阈值，默认 0.32。',
          },
          maxShots: {
            type: 'integer',
            minimum: 1,
            maximum: 40,
            description: '最多返回镜头数，默认 12。',
          },
        },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 600000,
      output: {
        schema: resultSchema({
          shots: { type: 'array', items: { type: 'object' } },
          totalShots: { type: 'integer' },
          returned: { type: 'integer' },
          truncated: { type: 'boolean' },
        }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('autoShots', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_ai_analyze_shot',
      description:
        '一键 AI 分析镜头片段：自动做片段级运动/亮度/声音分析并抽取代表帧，调用会话默认模型直接返回八维视听语言分析文本（不经过对话）。参数：videoPath、start、end（秒）、shotIndex?、totalShots?、frames?（[{time,path}]，省略则自动抽 3 帧）。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          start: { type: 'number', minimum: 0, description: '片段起点（秒）。' },
          end: { type: 'number', minimum: 0, description: '片段终点（秒）。' },
          shotIndex: { type: 'integer', minimum: 1, description: '镜号（可选，用于提示词）。' },
          totalShots: { type: 'integer', minimum: 1, description: '镜头总数（可选）。' },
          frames: {
            type: 'array',
            description: '代表帧 [{time,path}]（可选，省略则自动抽 3 帧）。',
            items: {
              type: 'object',
              properties: { time: { type: 'number' }, path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
          detail: {
            type: 'string',
            enum: ['fast', 'detailed'],
            description: '分析详细度：fast=快速精简；detailed=详细（默认）。',
          },
          ...ANALYSIS_OPTIONS_SCHEMA,
          subtitles: {
            type: 'array',
            description: '台词/字幕（可选）：[{start,end,text}]（秒）。',
            items: {
              type: 'object',
              properties: { start: { type: 'number' }, end: { type: 'number' }, text: { type: 'string' } },
              required: ['text'],
            },
          },
          context: {
            type: 'object',
            description: '用户提供的背景（可选）：{title,genre,story,characters,note}。',
            properties: {
              title: { type: 'string' },
              genre: { type: 'string' },
              story: { type: 'string' },
              characters: { type: 'string' },
              note: { type: 'string' },
            },
          },        required: ['videoPath', 'start', 'end'],
        additionalProperties: false,
      },
      timeoutMs: 600000,
      output: {
        schema: resultSchema({
          mode: { type: 'string' },
          text: { type: 'string' },
          clip: { type: 'object' },
        }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('aiAnalyzeShot', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_ai_video_report',
      description:
        '整片拉片报告：一次模型调用覆盖整段视频，输出全片分镜表 + 逐镜头讲解 + 节奏结构 + 风格主题（调用会话默认模型，不经对话）。参数：videoPath、shots（自动拉片的镜头列表，每项 {index,start,end,duration,frames?,metrics?}）。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          shots: {
            type: 'array',
            description: '镜头列表（来自 film_auto_shots 的 shots）。',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                start: { type: 'number' },
                end: { type: 'number' },
                duration: { type: 'number' },
                longShot: { type: 'boolean' },
                frames: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { time: { type: 'number' }, path: { type: 'string' }, url: { type: 'string' } },
                  },
                },
                metrics: { type: 'object' },
              },
              required: ['start', 'end'],
            },
          },
        },
          detail: {
            type: 'string',
            enum: ['fast', 'detailed'],
            description: '分析详细度：fast=快速精简；detailed=详细（默认）。',
          },
          ...ANALYSIS_OPTIONS_SCHEMA,
          subtitles: {
            type: 'array',
            description: '台词/字幕（可选）：[{start,end,text}]（秒）。',
            items: {
              type: 'object',
              properties: { start: { type: 'number' }, end: { type: 'number' }, text: { type: 'string' } },
              required: ['text'],
            },
          },
          context: {
            type: 'object',
            description: '用户提供的背景（可选）：{title,genre,story,characters,note}。',
            properties: {
              title: { type: 'string' },
              genre: { type: 'string' },
              story: { type: 'string' },
              characters: { type: 'string' },
              note: { type: 'string' },
            },
          },        required: ['videoPath', 'shots'],
        additionalProperties: false,
      },
      timeoutMs: 600000,
      output: {
        schema: resultSchema({ mode: { type: 'string' }, text: { type: 'string' }, shots: { type: 'array', items: { type: 'object' } } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('aiAnalyzeVideoReport', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_transcribe',
      description:
        '本地 Whisper 转写：把视频音轨转成带时间码的中文台词（需要本机 Python + faster-whisper，长音频较慢）。参数：videoPath、language?。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          language: { type: 'string', description: '语言代码，默认 zh。' },
        },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 3600000,
      output: {
        schema: resultSchema({ segments: { type: 'array', items: { type: 'object' } }, count: { type: 'integer' } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('transcribe', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_deep_analyze',
      description:
        '深度分段拉片（同步）：按镜头/时长把视频切成 2–4 分钟分段，逐段做证据化分析（强制镜号/时间码），再滚动摘要汇总为整片报告。参数：videoPath、tier?（fast/standard/precise）、shots?（自动拉片结果）、subtitles?、context?。长视频耗时数分钟。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          tier: { type: 'string', enum: ['fast', 'standard', 'precise'], description: '档位，默认 standard。' },
          ...ANALYSIS_OPTIONS_SCHEMA,
          shots: { type: 'array', description: '镜头列表（可选，来自 film_auto_shots）。', items: { type: 'object' } },
          subtitles: {
            type: 'array',
            description: '台词/字幕（可选）：[{start,end,text}]。',
            items: { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' }, text: { type: 'string' } }, required: ['text'] },
          },
          context: { type: 'object', description: '影片背景（可选）。' },
        },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 3600000,
      output: {
        schema: resultSchema({ segments: { type: 'array', items: { type: 'object' } }, finalText: { type: 'string' }, stats: { type: 'object' } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('deepAnalyze', args);
        } catch (error) {
          return fail(error);
        }
      },
    },    {
      name: 'film_edit_video',
      description:
        '按剪辑方案渲染成片。mode=auto：自动粗剪（按 editMode 与 targetSeconds 自动切镜头，输出原声视频）；mode=manual：手动片段（clips 数组，每段 {in,out,speed?,mute?}）。输出 MP4（H.264+AAC），配音轨待后续能力接入。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          mode: { type: 'string', enum: ['auto', 'manual'], description: 'auto=自动粗剪；manual=手动剪辑。' },
          editMode: { type: 'string', enum: ['commentary', 'analysis', 'highlight', 'lesson'], description: '成片模式：电影解说/拉片教学/高光传播/课堂微课。' },
          targetSeconds: { type: 'number', description: '目标成片时长（秒），默认 180。' },
          shots: { type: 'array', description: '镜头列表（可选，auto 模式；省略则自动检测）。', items: { type: 'object' } },
          clips: {
            type: 'array',
            description: '手动片段（manual 模式必填）：[{in,out,speed?,mute?}]。',
            items: { type: 'object' },
          },
          outputName: { type: 'string', description: '输出文件名前缀（可选）。' },
        },
        required: ['videoPath', 'mode'],
        additionalProperties: false,
      },
      timeoutMs: 1800000,
      output: {
        schema: resultSchema({ outputPath: { type: 'string' }, url: { type: 'string' }, outputDuration: { type: 'number' } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke(args.mode === 'manual' ? 'manualEdit' : 'autoEdit', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_narration_script',
      description:
        '把分析报告压缩成口播稿（不合成音频）：按模式/目标时长抽取句子，返回口播稿、字数、预估时长和分块，供后续 TTS 使用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '分析报告 Markdown（来自深度拉片/整片报告）。' },
          mode: { type: 'string', enum: ['commentary', 'analysis', 'highlight', 'lesson'], description: '口播模式，默认 commentary。' },
          targetSeconds: { type: 'number', description: '目标口播时长（秒），默认 180。' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: resultSchema({ script: { type: 'string' }, chars: { type: 'number' }, chunks: { type: 'array', items: { type: 'object' } } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('narrationScript', args);
        } catch (error) {
          return fail(error);
        }
      },
    },
    {
      name: 'film_build_subtitles',
      description:
        '生成字幕文件（SRT + ASS）：传入 cues（[{start,end,text}]）与样式预设（classic/dual/teaching/vertical），返回两种格式路径与 URL，供播放器外挂或后续烧录。',
      parameters: {
        type: 'object',
        properties: {
          cues: {
            type: 'array',
            description: '字幕条目：[{start,end,text}]（秒）。',
            items: { type: 'object' },
          },
          preset: { type: 'string', enum: ['classic', 'dual', 'teaching', 'vertical'], description: '字幕样式预设，默认 classic。' },
          baseName: { type: 'string', description: '输出文件名前缀（可选）。' },
        },
        required: ['cues'],
        additionalProperties: false,
      },
      output: {
        schema: resultSchema({ srtUrl: { type: 'string' }, assUrl: { type: 'string' }, count: { type: 'number' } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('subtitles', args);
        } catch (error) {
          return fail(error);
        }
      },
    },    {
      name: 'film_narrate_video',
      description:
        '生成带讲解音轨的成片：把分析报告压缩为口播稿，用内置普通语音（sherpa-onnx）合成音轨，与原视频剪辑混音并输出 MP4（可选烧录字幕）；同时返回 WAV 与 SRT/ASS。配音引擎标准档随包，Plus 语音包待发布。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          text: { type: 'string', description: '分析报告 Markdown（用于生成口播稿）。' },
          script: { type: 'string', description: '直接给口播稿（可选，给了就不再从 text 生成）。' },
          mode: { type: 'string', enum: ['commentary', 'analysis', 'highlight', 'lesson'], description: '成片/口播模式。' },
          editMode: { type: 'string', enum: ['commentary', 'analysis', 'highlight', 'lesson'], description: '剪辑模式（可选，默认同 mode）。' },
          targetSeconds: { type: 'number', description: '目标成片时长（秒），默认 180。' },
          voiceTier: { type: 'string', enum: ['standard', 'plus'], description: '语音档位，默认 standard（Plus 需语音包）。' },
          preset: { type: 'string', enum: ['classic', 'dual', 'teaching', 'vertical'], description: '字幕样式，默认 classic。' },
          burnSubtitles: { type: 'boolean', description: '是否把字幕烧录进画面，默认 false。' },
          speed: { type: 'number', description: '语速 0.7–1.3，默认 1。' },
          sid: { type: 'number', description: '说话人编号（普通语音模型支持多音色，默认 0）。' },
          clips: { type: 'array', description: '手动片段（可选）；省略则自动粗剪。', items: { type: 'object' } },
          shots: { type: 'array', description: '镜头列表（可选）。', items: { type: 'object' } },
        },
        required: ['videoPath'],
        additionalProperties: false,
      },
      timeoutMs: 1800000,
      output: {
        schema: resultSchema({
          outputPath: { type: 'string' },
          url: { type: 'string' },
          outputDuration: { type: 'number' },
          narration: { type: 'object' },
          subtitles: { type: 'object' },
        }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('narrateVideo', args);
        } catch (error) {
          return fail(error);
        }
      },
    },    {
      name: 'film_clip_analyze',
      description:
        '片段分析（普通版）：对一段视频（≤120 秒）按时间顺序抽多帧，结合片段运动/亮度/声音测量与（可选）网络资料，逼近片段分析、推断镜头内运动与剪辑；明确区分实测与推断。接入可读视频模型后将升级为“片段分析 Max”。',
      parameters: {
        type: 'object',
        properties: {
          videoPath: VIDEO_PATH,
          start: { type: 'number', description: '片段开始（秒）。' },
          end: { type: 'number', description: '片段结束（秒），单次最长 120 秒。' },
          frameCount: { type: 'number', description: '抽帧数量 3–8，默认 8。' },
          webQuery: { type: 'string', description: '联网检索关键词（影片名/导演等，可选）。' },
          webUrls: { type: 'array', description: '额外抓取的网页 URL（可选，最多 3 个）。', items: { type: 'string' } },
          web: { type: 'boolean', description: '是否联网补充资料；默认 false，需同时填 webQuery。' },
          template: { type: 'string', enum: ['auto', 'homework', 'exam', 'review', 'shoot', 'quick'], description: '分析模板。' },
          focus: { type: 'array', description: '聚焦维度（可选）。', items: { type: 'string' } },
          language: { type: 'string', enum: ['zh', 'bilingual', 'en'], description: '输出语言。' },
        },
        required: ['videoPath', 'start', 'end'],
        additionalProperties: false,
      },
      timeoutMs: 300000,
      output: {
        schema: resultSchema({ text: { type: 'string' }, quality: { type: 'object' }, web: { type: 'object' }, frames: { type: 'array', items: { type: 'object' } } }),
        render,
      },
      async execute(args) {
        try {
          return await invoke('clipAnalyzeNormal', args);
        } catch (error) {
          return fail(error);
        }
      },
    },    {
      name: 'film_web_search',
      description: '联网检索影片/导演/背景资料（走 DSH 的 web 能力，回退 DuckDuckGo/维基百科）：返回来源标题、摘要与 URL，供分析引用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词（影片名/导演/片名+年份）。' },
          urls: { type: 'array', description: '额外抓取的网页 URL（可选）。', items: { type: 'string' } },
        },
        required: ['query'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      output: { schema: resultSchema({ snippets: { type: 'array', items: { type: 'object' } }, provider: { type: 'string' } }), render },
      async execute(args) {
        try {
          return await invoke('webSearch', args);
        } catch (error) {
          return fail(error);
        }
      },
    },  ];
}
