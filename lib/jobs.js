// 深度拉片后台任务：任务状态落盘、进度查询、取消、刷新后可续。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ToolError } from './toolchain.js';
import { runDeepAnalysis, renderDeepMarkdown } from './pipeline.js';

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
  writeFileSync(jobPath(toolchain, job.id), JSON.stringify(job), 'utf8');
}

export function getDeepJob(toolchain, jobId) {
  const file = jobPath(toolchain, jobId);
  if (!existsSync(file)) throw new ToolError('not-found', `任务不存在：${jobId}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ToolError('not-found', `任务状态损坏：${jobId}`);
  }
}

export function cancelDeepJob(toolchain, jobId) {
  const job = getDeepJob(toolchain, jobId);
  if (job.status === 'running' || job.status === 'pending') {
    job.status = 'cancelled';
    job.progress = { ...job.progress, phase: 'cancelled' };
    saveJob(toolchain, job);
  }
  return getDeepJob(toolchain, jobId);
}

/** 启动后台深度拉片任务；立即返回 jobId，由客户端轮询 getJob。 */
export function startDeepJob(ctx, toolchain, params = {}) {
  const id = `deep-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const job = {
    id,
    status: 'running',
    createdAt: Date.now(),
    videoPath: String(params.videoPath || ''),
    tier: String(params.tier || 'standard'),
    progress: { phase: 'starting', completed: 0, total: null },
    segments: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostCny: 0 },
    error: null,
  };
  saveJob(toolchain, job);

  const shouldStop = () => {
    try {
      return getDeepJob(toolchain, id).status === 'cancelled';
    } catch {
      return true;
    }
  };

  const runner = async () => {
    try {
      const result = await runDeepAnalysis(ctx, toolchain, {
        ...params,
        shouldStop,
        onProgress: (info) => {
          const current = getDeepJob(toolchain, id);
          current.progress = { phase: info.phase, completed: info.completed, total: info.total };
          current.segments = current.segments || [];
          current.segments[info.completed - 1] = {
            index: info.segment.index,
            start: info.segment.start,
            end: info.segment.end,
            duration: info.segment.duration,
            summary: info.segment.summary,
            markdown: info.segment.markdown,
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
      const current = getDeepJob(toolchain, id);
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
        estimatedCostCny: segment.estimatedCostCny,
      }));
      current.result = {
        finalText: result.finalText,
        shotTable: result.shotTable,
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
        const current = getDeepJob(toolchain, id);
        if (current.status !== 'cancelled') {
          current.status = 'error';
          current.error = String((error && error.message) || error);
          saveJob(toolchain, current);
        }
      } catch {
        /* 任务文件不可写时放弃 */
      }
    }
  };

  void runner();
  return { ok: true, jobId: id, status: 'running', tier: job.tier };
}
