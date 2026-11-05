// 服务层：面板 API 与 agent 工具共用同一批操作（一个操作两个调用者）。
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { ToolError, normalizePath, requireFile, uploadLimit } from './toolchain.js';
import { imageMetrics } from './metrics.js';
import { imagePalette } from './palette.js';
import { imageZoom, imageEnhance } from './imageops.js';
import { imageOverlay } from './overlay.js';
import { videoProbe, extractFrames, contactSheet, sceneDetect, autoShots, analyzeClip } from './video.js';
import { imageOcr } from './ocr.js';
import { transcribe, transcribeAvailable } from './transcribe.js';
import { rapidOcrAvailable } from './rapidocr.js';
import { startDeepJob, getDeepJob, cancelDeepJob, resumeDeepJob } from './jobs.js';
import { buildNormsGroupsForPanel, getNormsSummary } from './norms.js';
import { runDeepAnalysis } from './pipeline.js';
import { aiAnalyzeShot } from './ai.js';
import { aiAnalyzeVideoReport } from './ai.js';
import { sharpInfo } from './native.js';

const SERVED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v',
]);

export function isServableFile(pathLike) {
  if (typeof pathLike !== 'string' || pathLike.trim() === '') return false;
  if (!existsSync(pathLike)) return false;
  const lower = pathLike.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return SERVED_EXTENSIONS.has(lower.slice(dot));
}

export function createService(toolchain, hostContext = null) {
  const service = {
    toolchain,
    ctx: hostContext,
    /** 面板 API 的动作分发（与工具共用实现）。 */
    async invoke(action, params = {}) {
      const p = params && typeof params === 'object' ? params : {};
      switch (action) {
        case 'health':
          return {
            ok: true,
            plugin: 'dsh-film-analysis',
            version: '0.3.9',
            dataRoot: toolchain.dirs.root,
            ffmpeg: toolchain.ffmpegPath,
            ffprobe: toolchain.ffprobePath,
            sharp: sharpInfo(),
            limits: { maxUploadBytes: uploadLimit(toolchain) },
            features: {
              rapidOcr: rapidOcrAvailable(toolchain),
              transcribe: transcribeAvailable(toolchain),
              pythonPath: toolchain.pythonPath ? 'found' : 'missing',
            },
          };
        case 'knowledge':
          return await loadKnowledge();
        case 'norms':
          return getNormsSummary();
        case 'metrics':
          return await imageMetrics(p.imagePath);
        case 'palette':
          return await imagePalette(p.imagePath, p.k);
        case 'zoom':
          return await imageZoom(toolchain, p.imagePath, p);
        case 'enhance':
          return await imageEnhance(toolchain, p.imagePath, p);
        case 'overlay':
          return await imageOverlay(toolchain, p.imagePath, p);
        case 'probe':
          return await videoProbe(toolchain, p.videoPath);
        case 'extractFrames':
          return await extractFrames(toolchain, p.videoPath, p);
        case 'sceneDetect':
          return await sceneDetect(toolchain, p.videoPath, p);
        case 'autoShots':
          return await autoShots(toolchain, p.videoPath, p);
        case 'clipStats':
          return await analyzeClip(toolchain, p.videoPath, p);
        case 'aiAnalyzeShot':
          if (!hostContext) throw new ToolError('llm-unavailable', '缺少宿主上下文，无法调用模型');
          return await aiAnalyzeShot(hostContext, toolchain, p);
        case 'aiAnalyzeVideoReport':
          if (!hostContext) throw new ToolError('llm-unavailable', '缺少宿主上下文，无法调用模型');
          return await aiAnalyzeVideoReport(hostContext, toolchain, p);
        case 'contactSheet':
          return await contactSheet(toolchain, p);
        case 'ocr':
          return await imageOcr(p.imagePath, { ...p, toolchain });
        case 'transcribe':
          return await transcribe(toolchain, p.videoPath, p);
        case 'startDeepAnalysis':
          if (!hostContext) throw new ToolError('llm-unavailable', '缺少宿主上下文，无法启动深度拉片');
          return startDeepJob(hostContext, toolchain, p);
        case 'getDeepJob':
          return getDeepJob(toolchain, p.jobId);
        case 'cancelDeepJob':
          return cancelDeepJob(toolchain, p.jobId);
        case 'resumeDeepJob':
          if (!hostContext) throw new ToolError('llm-unavailable', '缺少宿主上下文，无法恢复任务');
          return resumeDeepJob(hostContext, toolchain, p.jobId);
        case 'deepAnalyze': {
          if (!hostContext) throw new ToolError('llm-unavailable', '缺少宿主上下文，无法执行深度拉片');
          let shots = Array.isArray(p.shots) && p.shots.length > 0 ? p.shots : null;
          if (!shots) {
            const detected = await autoShots(toolchain, p.videoPath, { maxShots: 40 });
            shots = detected.shots;
          }
          return await runDeepAnalysis(hostContext, toolchain, { ...p, shots });
        }
        case 'fileUrl': {
          const abs = requireFile(p.path, 'path');
          return { ok: true, url: `/film-analysis/api/file?path=${encodeURIComponent(abs)}`, name: basename(abs) };
        }
        case 'saveUpload':
          throw new ToolError('bad-argument', 'saveUpload 只能通过上传接口调用');
        default:
          throw new ToolError('unknown-action', `未知的 action：${String(action)}`);
      }
    },
  };
  return service;
}

/** 面板上传文件的后缀：优先原文件名，其次魔数。 */
export function uploadExtension(name, buffer) {
  const lower = String(name ?? '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot >= 0) {
    const ext = lower.slice(dot);
    if (SERVED_EXTENSIONS.has(ext)) return ext;
  }
  // 按魔数猜测
  if (buffer && buffer.length > 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return '.png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF') return '.webp';
    if (buffer.slice(4, 8).toString('ascii') === 'ftyp') return '.mp4';
  }
  return '.bin';
}

export async function loadKnowledge() {
  try {
    // 带时间戳导入，确保知识库文件更新后无需重启 DSH 也能读到新数据。
    const mod = await import(`./knowledge.js?t=${Date.now()}`);
    return {
      ok: true,
      dimensions: Array.isArray(mod.DIMENSIONS) ? mod.DIMENSIONS : [],
      framework: mod.FRAMEWORK ?? { book1: null, book2: null },
      training: mod.TRAINING ?? {},
      films: Array.isArray(mod.FILMS) ? mod.FILMS : [],
      extraTopics: [...(Array.isArray(mod.EXTRA_TOPICS) ? mod.EXTRA_TOPICS : []), ...buildNormsGroupsForPanel()],
    };
  } catch (error) {
    throw new ToolError('knowledge-missing', `内置知识数据不可用：${error?.message ?? error}`);
  }
}

/** 面板/工具共用的统计：文件存在与大小。 */
export function fileStat(pathLike) {
  const abs = requireFile(pathLike, 'path');
  const stat = statSync(abs);
  return { path: normalizePath(abs), sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}
