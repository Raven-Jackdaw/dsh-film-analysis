// 语音合成（标准档 sherpa-onnx + 中文 VITS；Plus 语音包预留）。
// 输出 WAV 与逐句时间轴，供解说视频混音与字幕使用。
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError, outputFile } from './toolchain.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STANDARD_MODEL_DIR = join(ROOT, 'runtime', 'tts', 'models', 'fanchen-C');

const engineCache = new Map();

function loadSherpa() {
  try {
    return require('sherpa-onnx-node');
  } catch (error) {
    throw new ToolError(
      'tts-engine-missing',
      `语音引擎未安装（sherpa-onnx-node）：${error?.message ?? error}；请重新安装完整插件包。`,
    );
  }
}

function findOnnx(dir) {
  try {
    return readdirSync(dir).find((name) => name.endsWith('.onnx')) || null;
  } catch {
    return null;
  }
}

function getModelDir(tier, explicitDir) {
  if (explicitDir && existsSync(explicitDir)) return explicitDir;
  if (tier === 'plus') {
    const voicepack = process.env.DSH_FILM_VOICEPACK_PATH;
    if (voicepack && existsSync(voicepack)) return voicepack;
    return null;
  }
  return existsSync(STANDARD_MODEL_DIR) ? STANDARD_MODEL_DIR : null;
}

function getEngine(tier, explicitDir) {
  const key = `${tier || 'standard'}:${explicitDir || ''}`;
  if (engineCache.has(key)) return engineCache.get(key);
  const sherpa = loadSherpa();
  const modelDir = getModelDir(tier, explicitDir);
  if (!modelDir) {
    throw new ToolError('tts-model-missing', '语音模型未安装：请使用标准档或下载 Plus 语音包');
  }
  const modelName = findOnnx(modelDir);
  if (!modelName) throw new ToolError('tts-model-broken', `语音模型文件缺失：${modelDir}`);
  const model = join(modelDir, modelName);
  const tokens = join(modelDir, 'tokens.txt');
  const lexicon = join(modelDir, 'lexicon.txt');
  if (![model, tokens, lexicon].every((file) => existsSync(file))) {
    throw new ToolError('tts-model-broken', `语音模型文件不完整：${modelDir}`);
  }
  const tts = new sherpa.OfflineTts({
    model: { vits: { model, tokens, lexicon } },
    maxNumSentences: 1,
    numThreads: 2,
    provider: 'cpu',
  });
  engineCache.set(key, tts);
  return tts;
}

/** 把 Float32 单声道采样写成 16-bit PCM WAV。 */
function encodeWav(samples, sampleRate) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

function splitText(text, maxChars = 80) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const sentences = source.split(/(?<=[。！？；!?;])\s*/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) chunks.push(sentence.slice(i, i + maxChars));
    } else {
      chunks.push(sentence);
    }
  }
  return chunks;
}

/**
 * 合成讲解音轨。
 * @returns {{ok:true,wavPath:string,url:string,duration:number,sampleRate:number,chunks:Array,timings:Object}}
 */
export async function synthesizeNarration(toolchain, options = {}) {
  const text = String(options.text || '').trim();
  if (!text) throw new ToolError('bad-argument', '缺少口播文本');
  const started = Date.now();
  const tier = options.voiceTier === 'plus' ? 'plus' : 'standard';
  const speed = Math.max(0.7, Math.min(1.3, Number(options.speed) || 1));
  const sid = Math.max(0, Math.min(1000, Number(options.sid) || 0));
  const tts = getEngine(tier, options.modelDir);
  const pieces = [];
  const chunks = [];
  let cursor = 0;
  const gap = tier === 'plus' ? 0.22 : 0.25;
  for (const [index, part] of splitText(text, 80).entries()) {
    const audio = tts.generate({ text: part, sid, speed, generationConfig: { speed, sid } });
    const samples = audio.samples instanceof Float32Array ? audio.samples : new Float32Array(audio.samples);
    const sampleRate = Number(audio.sampleRate) || 16000;
    const start = cursor;
    pieces.push(samples);
    const duration = samples.length / sampleRate;
    cursor += duration;
    chunks.push({ index: index + 1, text: part, start: Number(start.toFixed(3)), end: Number(cursor.toFixed(3)), duration: Number(duration.toFixed(3)) });
    const pauseSamples = Math.round(sampleRate * gap);
    pieces.push(new Float32Array(pauseSamples));
    cursor += gap;
  }
  if (pieces.length === 0) throw new ToolError('tts-empty', '语音合成没有生成音频');
  const sampleRate = 16000;
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const piece of pieces) {
    samples.set(piece, offset);
    offset += piece.length;
  }
  const out = outputFile(toolchain, 'narration', 'wav', 'narration');
  mkdirSync(join(toolchain.dirs.root, 'narration'), { recursive: true });
  writeFileSync(out.path, encodeWav(samples, sampleRate));
  return {
    ok: true,
    tier,
    wavPath: out.path,
    url: out.url,
    duration: Number(cursor.toFixed(3)),
    sampleRate,
    chunks,
    timings: { totalMs: Date.now() - started },
  };
}

/** 读取模型支持的说话人数量（用于音色选择）。 */
export function getVoiceMeta(tier, modelDir) {
  const tts = getEngine(tier, modelDir);
  return { numSpeakers: tts.numSpeakers, sampleRate: tts.sampleRate };
}

/** 生成一段音色试听音频。 */
export async function auditionVoice(toolchain, options = {}) {
  const text = String(options.text || '这是影视画面分析器的音色试听示例。').slice(0, 120);
  const result = await synthesizeNarration(toolchain, {
    text,
    voiceTier: options.voiceTier,
    sid: options.sid,
    speed: options.speed,
    modelDir: options.modelDir,
  });
  return { ok: true, url: result.url, wavPath: result.wavPath, duration: result.duration, sid: Number(options.sid) || 0 };
}

/** 语音档位状态（Plus 语音包是否已安装）。 */
export function voiceEngineStatus(toolchain) {  const standard = existsSync(STANDARD_MODEL_DIR);
  let plus = false;
  if (toolchain?.dirs?.root) {
    const dir = join(toolchain.dirs.root, 'voicepacks', 'plus-melo-zh-en');
    plus = existsSync(dir) && Boolean(findOnnx(dir));
  }
  return {
    ok: true,
    standard: { available: standard, label: '普通语音（随包）', engine: 'sherpa-onnx' },
    plus: { available: plus, label: '高级语音（Plus · MeloTTS 模型包）', engine: 'sherpa-onnx' },
  };
}
