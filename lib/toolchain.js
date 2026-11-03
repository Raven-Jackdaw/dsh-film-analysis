// 工具链解析：内置 ffmpeg/ffprobe 二进制路径、插件数据目录、子进程调用。
// 工具链顺序：用户配置路径 → 随插件安装的 npm 包（@ffmpeg-installer / @ffprobe-installer）。
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** 错误：携带机器可读的 code，供工具与面板 API 返回。 */
export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

function resolvePackagePath(pkgName, configKey, config) {
  const configured = config?.[configKey];
  if (typeof configured === 'string' && configured.trim() !== '') {
    if (!existsSync(configured)) {
      throw new ToolError('toolchain-missing', `${configKey} 指定的路径不存在：${configured}`);
    }
    return configured;
  }
  try {
    const mod = require(pkgName);
    const p = typeof mod === 'string' ? mod : mod?.path;
    if (typeof p === 'string' && existsSync(p)) return p;
  } catch {
    // 落到下面的错误
  }
  throw new ToolError(
    'toolchain-missing',
    `未找到 ${pkgName} 提供的可执行文件；请在插件配置里设置 ${configKey} 指向 ffmpeg/ffprobe 可执行文件。`,
  );
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.dsh');
}

/** 解析工具链与目录；返回后续 lib 共用的句柄。 */
export function resolveToolchain(config = {}) {
  const ffmpegPath = resolvePackagePath('@ffmpeg-installer/ffmpeg', 'ffmpegPath', config);
  const ffprobePath = resolvePackagePath('@ffprobe-installer/ffprobe', 'ffprobePath', config);
  const dataRoot =
    typeof config.dataRoot === 'string' && config.dataRoot.trim() !== ''
      ? config.dataRoot
      : join(dshHome(), 'film-analysis');
  const dirs = {
    root: dataRoot,
    outputs: join(dataRoot, 'outputs'),
    uploads: join(dataRoot, 'uploads'),
    tmp: join(dataRoot, 'tmp'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return { ffmpegPath, ffprobePath, dirs, config };
}

let counter = 0;
/** 生成不冲突的输出文件名。 */
export function uniqueName(prefix, ext) {
  counter = (counter + 1) % 100000;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${stamp}-${counter}-${rand}.${ext}`;
}

/** 输出文件的绝对路径与面板可访问 URL。 */
export function outputFile(toolchain, prefix, ext, subdir = 'outputs') {
  const name = uniqueName(prefix, ext);
  const abs = join(toolchain.dirs.root, subdir, name);
  const url = `/film-analysis/output/${subdir}/${encodeURIComponent(name)}`;
  return { name, path: abs, url };
}

/** 运行 ffmpeg/ffprobe 子进程，TMP 指向插件数据目录，带超时，捕获 stdout/stderr。 */
export function runBinary(bin, args, toolchain, { timeoutMs = 120000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer,
        windowsHide: true,
        env: {
          ...process.env,
          TMP: toolchain.dirs.tmp,
          TEMP: toolchain.dirs.tmp,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim().split('\n').slice(-6).join('\n');
          rejectPromise(
            new ToolError(error.killed ? 'timeout' : 'ffmpeg-failed', `${error.message}${detail ? `\n${detail}` : ''}`),
          );
          return;
        }
        resolvePromise({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

/** 运行 ffmpeg/ffprobe 子进程，捕获二进制 stdout（用于把帧直接写回 Host，避免子进程写盘）。 */
export function runBinaryBuffer(bin, args, toolchain, { timeoutMs = 180000, maxBuffer = 128 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer,
        encoding: 'buffer',
        windowsHide: true,
        env: {
          ...process.env,
          TMP: toolchain.dirs.tmp,
          TEMP: toolchain.dirs.tmp,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr ?? '').toString().trim().split('\n').slice(-6).join('\n');
          rejectPromise(
            new ToolError(error.killed ? 'timeout' : 'ffmpeg-failed', `${error.message}${detail ? `\n${detail}` : ''}`),
          );
          return;
        }
        const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '');
        if (buffer.length === 0) {
          const detail = String(stderr ?? '').toString().trim().split('\n').slice(-4).join('\n');
          rejectPromise(new ToolError('ffmpeg-empty', `ffmpeg 未输出画面数据${detail ? `：${detail}` : ''}`));
          return;
        }
        resolvePromise({ buffer, stderr: String(stderr ?? '') });
      },
    );
  });
}

/** 断言输入文件存在。 */
export function requireFile(pathLike, label) {
  if (typeof pathLike !== 'string' || pathLike.trim() === '') {
    throw new ToolError('bad-argument', `${label} 不能为空`);
  }
  const abs = pathLike.trim();
  if (!existsSync(abs)) throw new ToolError('not-found', `${label} 不存在：${abs}`);
  return abs;
}

/** 归一化绝对路径（Windows）。 */
export function normalizePath(p) {
  return p.replace(/\//g, '\\');
}
