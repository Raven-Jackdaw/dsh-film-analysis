// 面板 HTTP 接口：invoke 统一分发、文件上传、输出文件与任意可读媒体文件的服务。
// 面板动作与 agent 工具共用 lib/service.js 的同一批操作。
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ToolError, outputFile } from './toolchain.js';
import { uploadExtension } from './service.js';

const INVOKE_PATH = '/film-analysis/api/invoke';
const UPLOAD_PATH = '/film-analysis/api/upload';
const FILE_PATH = '/film-analysis/api/file';
const OUTPUT_PREFIX = '/film-analysis/output/';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml',
};

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;

function mimeFor(pathLike) {
  return MIME_BY_EXT[extname(pathLike).toLowerCase()] ?? 'application/octet-stream';
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(body.length));
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(new ToolError('too-large', `请求体超过限制（${Math.round(limit / 1024 / 1024)}MB）`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

function serveFile(req, res, absPath) {
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '文件不存在' } });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '不是文件' } });
    return;
  }
  const total = stat.size;
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-type', mimeFor(absPath));
  res.setHeader('cache-control', 'private, max-age=30');
  const range = typeof req.headers.range === 'string' ? req.headers.range : null;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${total}`);
      res.end();
      return;
    }
    let start = match[1] === '' ? null : Number(match[1]);
    let end = match[2] === '' ? null : Number(match[2]);
    if (start === null && end === null) {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${total}`);
      res.end();
      return;
    }
    if (start === null) {
      start = Math.max(0, total - end);
      end = total - 1;
    } else if (end === null || end >= total) {
      end = total - 1;
    }
    if (start > end || start >= total) {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${total}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('content-length', String(end - start + 1));
    res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(absPath, { start, end }).pipe(res);
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-length', String(total));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(absPath).pipe(res);
}

function isInside(root, candidate) {
  const rootResolved = resolve(root);
  const target = resolve(candidate);
  return target === rootResolved || target.startsWith(rootResolved + sep);
}

/** 注册面板路由；返回统一 disposer。 */
export function registerRoutes(ctx, service) {
  const toolchain = service.toolchain;
  const disposers = [];

  const reject = (req, res) => {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return true;
    }
    const connection = ctx.get('connection');
    const rejection = typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : undefined;
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: INVOKE_PATH,
      handler: async (req, res) => {
        if (reject(req, res)) return;
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只用 POST' } });
          return;
        }
        let payload;
        try {
          const raw = await readBody(req, MAX_JSON_BYTES);
          payload = JSON.parse(raw.toString('utf8') || '{}');
        } catch (error) {
          const message = error instanceof ToolError ? error.message : `请求 JSON 无法解析：${error?.message ?? error}`;
          sendJson(res, 400, { ok: false, error: { code: 'bad-request', message } });
          return;
        }
        const action = typeof payload?.action === 'string' ? payload.action : '';
        const params = payload?.params && typeof payload.params === 'object' ? payload.params : {};
        try {
          const data = await service.invoke(action, params);
          sendJson(res, 200, { ok: true, data });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            error: {
              code: error?.code ?? 'error',
              message: String(error?.message ?? error),
            },
          });
        }
      },
    }),
  );

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: UPLOAD_PATH,
      handler: async (req, res) => {
        if (reject(req, res)) return;
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只用 POST' } });
          return;
        }
        const url = new URL(String(req.url ?? '/'), 'http://localhost');
        const name = String(url.searchParams.get('name') ?? 'upload');
        let buffer;
        try {
          buffer = await readBody(req, MAX_UPLOAD_BYTES);
        } catch (error) {
          sendJson(res, 413, { ok: false, error: { code: error?.code ?? 'too-large', message: String(error?.message ?? error) } });
          return;
        }
        if (buffer.length === 0) {
          sendJson(res, 400, { ok: false, error: { code: 'empty-body', message: '上传内容为空' } });
          return;
        }
        const ext = uploadExtension(name, buffer);
        const out = outputFile(toolchain, 'upload', ext.replace('.', ''), 'uploads');
        writeFileSync(out.path, buffer);
        sendJson(res, 200, {
          ok: true,
          data: { path: out.path, url: out.url, name, sizeBytes: buffer.length },
        });
      },
    }),
  );

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: FILE_PATH,
      handler: async (req, res) => {
        if (reject(req, res)) return;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只用 GET' } });
          return;
        }
        const url = new URL(String(req.url ?? '/'), 'http://localhost');
        const target = String(url.searchParams.get('path') ?? '');
        if (target.trim() === '') {
          sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: '缺少 path 参数' } });
          return;
        }
        const abs = normalize(target);
        const lower = abs.toLowerCase();
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi'];
        if (!allowed.some((ext) => lower.endsWith(ext))) {
          sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '只允许读取图片/视频文件' } });
          return;
        }
        serveFile(req, res, abs);
      },
    }),
  );

  disposers.push(
    ctx.webServer.register({
      kind: 'prefix',
      path: OUTPUT_PREFIX,
      handler: async (req, res) => {
        if (reject(req, res)) return;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只用 GET' } });
          return;
        }
        const url = new URL(String(req.url ?? '/'), 'http://localhost');
        let remainder = url.pathname.slice(OUTPUT_PREFIX.length);
        try {
          remainder = decodeURIComponent(remainder);
        } catch {
          sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: '路径编码无效' } });
          return;
        }
        const abs = join(toolchain.dirs.root, remainder);
        if (!isInside(toolchain.dirs.root, abs)) {
          sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '路径越界' } });
          return;
        }
        serveFile(req, res, abs);
      },
    }),
  );

  return () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      try {
        dispose();
      } catch {
        // 忽略重复释放
      }
    }
  };
}
