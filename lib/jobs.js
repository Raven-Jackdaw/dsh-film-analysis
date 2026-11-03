// 深度拉片后台任务：状态落盘、进度查询、取消、断点续跑（刷新/重启后可继续未完成段）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ToolError } from './toolchain.js';
import { runDeepAnalysis, renderDeepMarkdown } from './pipeline.js';

const activeJobs = new Set();
const STALL_MS = 120000;

function jobsRoot(toolchain) {
  const dir = join(toolchain.dirs.root, 'jobs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function jobPath(toolchain, jobId) {
  if (typeof jobId !== 'string' || !/^[a-z0-9-]+$/i.test(jobId)) {
    throw new ToolError('bad-argument', 'jobId 格式不正确');
  }
  return join(jobsRoot(toolchain), `${jobId}.json`);
}

function saveJob(toolchain, job) {
  job.updatedAt = Date.now();
  try {
    writeFileSync(jobPath(toolchain, job.id), JSON.stringify(job), 'utf8');
  } catch {
    /* 状态写入失败不阻断后台任务 */
  }
}

function loadJobFile(toolchain, jobId) {
  const file = jobPath(toolchain, jobId);
  if (!existsSync(file)) throw new ToolError('not-found', `任务不存在：${jobId}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ToolError('not-found', `任务状态损坏：${jobId}`);
  }
}

export function getDeepJob(toolchain, jobId) {
  const job = loadJobFile(toolchain, jobId);
  if (job.status === 'running' && !activeJobs.has(jobId) && Date.now() - (job.updatedAt || job.createdAt || 0) > STALL_MS) {
    job.status = 'stalled';
    job.error = '任务已中断（可能因刷新/重启）；可点击“继续任务”从未完成段恢复。';
    saveJob(toolchain, job);
  }
  return job;
}

export function cancelDeepJob(toolchain, jobId) {
  const job = getDeepJob(toolchain, jobId);
  if (job.status === 'running' || job.status === 'pending' || job.status === 'stalled') {
    job.status = 'cancelled';
    job.progress = { ...(job.progress || {}), phase: 'cancelled' };
    saveJob(toolchain, job);
  }
  return getDeepJob(toolchain, jobId);
}

function launch(toolchain, ctx, job, params, completedSegments) {
  activeJobs.add(job.id);
  const shouldStop = () => {
    try {
      return loadJobFile(toolchain, job.id).status === 'cancelled';
    } catch {
      return true;
    }
  };
  const runner = async () => {
    try {
      const result = await runDeepAnalysis(ctx, toolchain, {
        ...params,
        completedSegments,
        shouldStop,
        onProgress: (info) => {
          const current = loadJobFile(toolchain, job.id);
          current.progress = { phase: info.phase, completed: info.completed, total: info.total };
          current.segments = current.segments || [];
          current.segments[info.completed - 1] = {
            index: info.segment.index,
            start: info.segment.start,
            end: info.segment.end,
            duration: info.segment.duration,
            summary: info.segment.summary,
            markdown: info.segment.markdown,
            citations: info.segment.citations,
            retried: info.segment.retried,
            estimatedCostCny: info.segment.estimatedCostCny,
          };
          if (info.usageTotals) {
            current.usage = {
              inputTokens: info.usageTotals.input,
              outputTokens: info.usageTotals.output,
              estimatedCostCny: info.usageTotals.cost,
            };
          }
          saveJob(toolchain, current);
        },
      });
      const current = loadJobFile(toolchain, job.id);
      if (current.status === 'cancelled') return;
      current.status = 'done';
      current.progress = { phase: 'done', completed: result.segments.length, total: result.segments.length };
      current.segments = result.segments.map((segment) => ({
        index: segment.index,
        start: segment.start,
        end: segment.end,
        duration: segment.duration,
        summary: segment.summary,
        markdown: segment.markdown,
        citations: segment.citations,
        retried: segment.retried,
        estimatedCostCny: segment.estimatedCostCny,
      }));
      current.result = {
        finalText: result.finalText,
        shotTable: result.shotTable,
        shots: result.shots || [],
        rhythm: result.rhythm || null,
        stats: result.stats,
        timings: result.timings,
        tier: result.tier,
        duration: result.duration,
        shotsTotal: result.shotsTotal,
      };
      current.markdown = renderDeepMarkdown(result);
      saveJob(toolchain, current);
    } catch (error) {
      try {
        const current = loadJobFile(toolchain, job.id);
        if (current.status !== 'cancelled') {
          current.status = 'error';
          current.error = String((error && error.message) || error);
          saveJob(toolchain, current);
        }
      } catch {
        /* 忽略 */
      }
    } finally {
      activeJobs.delete(job.id);
    }
  };
  void runner();
}

export function startDeepJob(ctx, toolchain, params = {}) {
  const id = `deep-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const job = {
    id,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    videoPath: String(params.videoPath || ''),
    tier: String(params.tier || 'standard'),
    progress: { phase: 'starting', completed: 0, total: null },
    segments: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostCny: 0 },
    error: null,
    params: {
      videoPath: params.videoPath,
      tier: params.tier,
      subtitles: params.subtitles,
      context: params.context,
      shots: params.shots,
      segmentSeconds: params.segmentSeconds,
      maxShotsPerSegment: params.maxShotsPerSegment,
    },
  };
  saveJob(toolchain, job);
  launch(toolchain, ctx, job, params, []);
  return { ok: true, jobId: id, status: 'running', tier: job.tier };
}

/** 从未完成的段继续任务（刷新/DSH 重启后恢复）。 */
export function resumeDeepJob(ctx, toolchain, jobId) {
  const job = loadJobFile(toolchain, jobId);
  if (activeJobs.has(jobId)) return { ok: true, jobId, status: 'running', resumed: false };
  if (job.status === 'done') return { ok: true, jobId, status: 'done', resumed: false };
  const params = job.params || {};
  if (!params.videoPath || !Array.isArray(params.shots) || params.shots.length === 0) {
    throw new ToolError('cannot-resume', '任务缺少原始参数（videoPath/shots），无法恢复；请重新启动深度拉片');
  }
  const completedSegments = (Array.isArray(job.segments) ? job.segments : []).filter((segment) => segment && segment.markdown);
  job.status = 'running';
  job.error = null;
  job.progress = { phase: 'resuming', completed: completedSegments.length, total: job.progress ? job.progress.total : null };
  saveJob(toolchain, job);
  launch(toolchain, ctx, job, params, completedSegments);
  return { ok: true, jobId, status: 'running', resumed: true, completed: completedSegments.length };
}
