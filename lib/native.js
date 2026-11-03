// 原生图像库解析：优先复用 DSH 运行时自带的 sharp。
// 同一进程只允许加载一份 libvips：插件自带 sharp 与 DSH 的 sharp 版本不同，
// 两份 libvips 同时加载会让颜色空间操作报 "colourspace: parameter space not set"。
import { createRequire } from 'node:module';

let cached = null;
let resolvedFrom = null;
let fallback = false;

function loadFrom(entry) {
  const requireFrom = createRequire(entry);
  const resolved = requireFrom.resolve('sharp');
  return { sharp: requireFrom('sharp'), resolved };
}

export function getSharp() {
  if (cached) return cached;
  // 1) DSH CLI 入口（process.argv[1]）向上解析到 dsh 安装目录的 sharp。
  const entry = process.argv[1];
  if (typeof entry === 'string' && entry.trim() !== '') {
    try {
      const loaded = loadFrom(entry);
      cached = loaded.sharp;
      resolvedFrom = loaded.resolved;
      return cached;
    } catch {
      // 继续尝试插件自带副本
    }
  }
  // 2) 回退：插件安装目录自带的 sharp（部署缺少 DSH sharp 时）。
  const own = createRequire(import.meta.url);
  const loaded = loadFrom(import.meta.url);
  cached = loaded.sharp;
  resolvedFrom = loaded.resolved;
  fallback = true;
  return cached;
}

export function sharpInfo() {
  if (!cached) return { loaded: false };
  return {
    loaded: true,
    resolvedFrom,
    fallback,
    version: cached.versions?.sharp ?? null,
    vips: cached.versions?.vips ?? null,
  };
}
