// Plus 语音包：自动下载 / 校验 / 解压 / 安装（MeloTTS 中文模型，sherpa-onnx 格式）。
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ToolError } from './toolchain.js';

const require = createRequire(import.meta.url);

export const PLUS_PACK = {
  id: 'plus-melo-zh-en',
  label: '高级语音 Plus（MeloTTS 中文）',
  url: 'https://github.com/Raven-Jackdaw/dsh-film-analysis/releases/download/voicepack-plus-v1/voicepack-plus-melo-zh-en-v1.zip',
  sha256: '',
  minBytes: 80 * 1024 * 1024,
  expectedFiles: ['tokens.txt', 'lexicon.txt'],
};

function packDir(toolchain) {
  return join(toolchain.dirs.root, 'voicepacks', PLUS_PACK.id);
}

function findModelFile(dir) {
  try {
    const { readdirSync } = require('node:fs');
    return readdirSync(dir).find((name) => name.endsWith('.onnx')) || null;
  } catch {
    return null;
  }
}

export function plusVoicepackStatus(toolchain) {
  const dir = packDir(toolchain);
  const model = existsSync(dir) ? findModelFile(dir) : null;
  const installed = Boolean(model && PLUS_PACK.expectedFiles.every((name) => existsSync(join(dir, name))));
  let sizeBytes = 0;
  if (installed) {
    try {
      sizeBytes = statSync(join(dir, model)).size;
    } catch {
      sizeBytes = 0;
    }
  }
  return {
    ok: true,
    id: PLUS_PACK.id,
    label: PLUS_PACK.label,
    installed,
    dir,
    model,
    sizeBytes,
    expectedBytes: 159 * 1024 * 1024,
    url: PLUS_PACK.url,
  };
}

export function plusVoicepackDir(toolchain) {
  return packDir(toolchain);
}

async function downloadFile(url, targetPath, onProgress) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new ToolError('voicepack-download', `下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  mkdirSync(join(targetPath, '..', ''), { recursive: true });
  const hash = createHash('sha256');
  let received = 0;
  const nodeStream = Readable.fromWeb(response.body);
  nodeStream.on('data', (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    if (typeof onProgress === 'function' && total > 0) onProgress(Math.round((received / total) * 100));
  });
  await pipeline(nodeStream, createWriteStream(targetPath));
  return { hash: hash.digest('hex'), size: received };
}

function safeExtract(zipPath, stagingDir) {
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch {
    throw new ToolError('voicepack-extract', '缺少解压依赖 adm-zip，请重新安装完整插件包');
  }
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('/') || name.includes('../') || name.includes('..\\')) {
      throw new ToolError('voicepack-extract', `语音包包含不安全路径：${entry.entryName}`);
    }
  }
  zip.extractAllTo(stagingDir, true);
}

/** 自动下载并安装 Plus 语音包。 */
export async function downloadPlusVoicepack(toolchain, options = {}) {
  const current = plusVoicepackStatus(toolchain);
  if (current.installed) return { ...current, alreadyInstalled: true };
  const url = String(options.url || PLUS_PACK.url);
  if (!/^https?:\/\//i.test(url)) throw new ToolError('bad-argument', '语音包下载地址无效');
  const dir = packDir(toolchain);
  const downloads = join(toolchain.dirs.root, 'voicepacks', 'downloads');
  mkdirSync(downloads, { recursive: true });
  const zipPath = join(downloads, `${PLUS_PACK.id}.zip`);
  const staging = join(toolchain.dirs.root, 'voicepacks', `${PLUS_PACK.id}.staging`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const downloaded = await downloadFile(url, zipPath, options.onProgress);
    if (downloaded.size < PLUS_PACK.minBytes) throw new ToolError('voicepack-download', `语音包过小（${downloaded.size} 字节），可能下载失败`);
    if (PLUS_PACK.sha256 && downloaded.hash.toLowerCase() !== PLUS_PACK.sha256.toLowerCase()) {
      throw new ToolError('voicepack-checksum', '语音包 SHA256 校验失败');
    }
    safeExtract(zipPath, staging);
    // 允许 zip 内有一层目录
    const top = readdirSync(staging);
    const root = top.length === 1 && statSync(join(staging, top[0])).isDirectory() ? join(staging, top[0]) : staging;
    const model = findModelFile(root);
    if (!model || !PLUS_PACK.expectedFiles.every((name) => existsSync(join(root, name)))) {
      throw new ToolError('voicepack-structure', '语音包结构不完整：缺少 onnx 模型 / tokens / lexicon');
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, '..'), { recursive: true });
    renameSync(root, dir);
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify(
        { id: PLUS_PACK.id, source: url, sha256: downloaded.hash, size: downloaded.size, installedAt: new Date().toISOString() },
        null,
        2,
      ),
      'utf8',
    );
    rmSync(zipPath, { force: true });
    return { ...plusVoicepackStatus(toolchain), installed: true, downloaded: downloaded.size, sha256: downloaded.hash };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
