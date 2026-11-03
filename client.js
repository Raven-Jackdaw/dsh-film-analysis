/**
 * 影视画面分析器 · Client 端（DSH Web UI 插件，单文件纯 JS）
 *
 * 结构（自上而下）：
 *   0. 常量与通用工具（路径/文件类型/格式化/下载/复制）
 *   1. Host API 客户端（POST /film-analysis/api/invoke、POST /api/upload、输出 URL）
 *   2. 模块级共享 store 与 localStorage 持久化（两个入口同一份状态，key = 'film-analysis:v1'）
 *   3. 数据整理与动作层（导入、度量、视频、标注、OCR、表单、镜头表、提示词/报告导出）
 *   4. 样式（<style> React 元素，只使用 --dsw-alias-* 等主题变量，类名 fa- 前缀）
 *   5. 通用 UI 组件（按钮/折叠区/状态条/字段/指标卡）
 *   6. 七个功能区块：A 导入 / B 测量 / C 八维表单 / D 标注 / E 提示词 / F 报告与镜头表 / G OCR
 *   7. AnalysisPanel（组合）、AnalysisView（conversation.view 全页）、AnalysisDock（composer.dock 窄条）
 *   8. locale 词典（zh / en）与 apply（注册词典、注册两个 slot）
 *
 * 约束：不 require 任何 @deepseek-ai/* 包（浏览器模块表只取 React）；不写 document.body；
 *       不替换 app 根；不读取其他插件 DOM。所有可见文案走 locale 的 t()。
 */
window.__ModuleLoader__.load({
  id: 'dsh-film-analysis',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;

    // =========================================================================
    // 0. 常量与通用工具
    // =========================================================================

    const NS = 'film-analysis';
    const API_BASE = '/film-analysis';
    const STORAGE_KEY = 'film-analysis:v1';
    const PERSIST_VERSION = 1;

    const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024; // 8GB，与 Host 默认上传上限一致
    const MAX_ANNOTATION_ITEMS = 80;
    const MAX_EXPORT_EDGE = 4096;
    const MAX_SHOT_ROWS = 200;

    /** 与 Host 路由/api 的媒体白名单保持一致（lib/service.js SERVED_EXTENSIONS）。 */
    const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'];
    const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi'];

    const DIMENSION_KEYS = ['shotSize', 'depthFocal', 'anglePosition', 'lightTone', 'colorPalette', 'composition', 'cameraMovement', 'sound'];
    const GRID_OPTIONS = ['none', 'thirds', 'golden'];
    const TOOL_OPTIONS = ['box', 'line', 'arrow', 'label'];
    const CSV_FIELDS = ['shot', 'time', 'size', 'angle', 'movement', 'content', 'sound', 'duration'];
    /** CSV 表头固定为中文，满足镜头表导出契约（界面列名另走 t()）。 */
    const CSV_HEADERS = ['镜号', '时间码', '景别', '角度和机位', '镜头运动', '画面内容', '声音', '时长'];
    const EMPTY_FORM_ENTRY = { term: '', basis: '', intent: '', cite: '' };

    function isRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function asString(value) {
      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      return String(value);
    }

    function asFiniteNumber(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function clampRatio(value) {
      const parsed = asFiniteNumber(value);
      if (parsed === null) return 0;
      return Math.min(1, Math.max(0, parsed));
    }

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function fileExtension(name) {
      const text = asString(name).split(/[\\/]/).pop() || '';
      const dot = text.lastIndexOf('.');
      return dot >= 0 ? text.slice(dot + 1).toLowerCase() : '';
    }

    function baseName(pathLike) {
      const text = asString(pathLike);
      const parts = text.split(/[\\/]/);
      return parts[parts.length - 1] || text;
    }

    function isImageFile(file) {
      if (!file) return false;
      const type = asString(file.type).toLowerCase();
      if (type.indexOf('image/') === 0) return true;
      return IMAGE_EXTENSIONS.indexOf(fileExtension(file.name)) >= 0;
    }

    function isVideoFile(file) {
      if (!file) return false;
      const type = asString(file.type).toLowerCase();
      if (type.indexOf('video/') === 0) return true;
      return VIDEO_EXTENSIONS.indexOf(fileExtension(file.name)) >= 0;
    }

    function formatBytes(bytes) {
      const value = asFiniteNumber(bytes);
      if (value === null || value <= 0) return '';
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
      return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function formatBitrate(bitsPerSecond) {
      const value = asFiniteNumber(bitsPerSecond);
      if (value === null || value <= 0) return '';
      if (value >= 1000000) return `${(value / 1000000).toFixed(2)} Mbps`;
      return `${(value / 1000).toFixed(0)} kbps`;
    }

    function formatSeconds(seconds) {
      const value = asFiniteNumber(seconds);
      if (value === null || value < 0) return '';
      const minutes = Math.floor(value / 60);
      const rest = value - minutes * 60;
      return `${pad2(minutes)}:${rest.toFixed(2).padStart(5, '0')}`;
    }

    function fileStamp(date) {
      const d = date instanceof Date ? date : new Date();
      return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    }

    function formatNumber(value, digits) {
      const parsed = asFiniteNumber(value);
      if (parsed === null) return '—';
      const places = typeof digits === 'number' ? digits : 1;
      return parsed.toFixed(places).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    }

    function formatPercent(share, digits) {
      const parsed = asFiniteNumber(share);
      if (parsed === null) return '—';
      const places = typeof digits === 'number' ? digits : 1;
      return `${(parsed * 100).toFixed(places)}%`;
    }

    /** Host 返回的 URL 是站内绝对路径（/film-analysis/...），原样使用。 */
    function assetUrl(url) {
      const text = asString(url);
      if (text === '') return '';
      if (/^(https?:|data:|blob:)/i.test(text)) return text;
      return text.charAt(0) === '/' ? text : `/${text}`;
    }

    function downloadBlob(fileName, blob) {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.click();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* 忽略释放失败 */
        }
      }, 4000);
    }

    function downloadText(fileName, text, mime) {
      downloadBlob(fileName, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
    }

    /** 复制文本：优先 Clipboard API，失败时退回到组件自身的 DOM 容器内临时 textarea。 */
    async function copyTextToClipboard(text, container) {
      const value = asString(text);
      if (value === '') return false;
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch {
        /* 落到 execCommand 回退 */
      }
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        area.style.opacity = '0';
        const host = container && container.appendChild ? container : document.documentElement;
        host.appendChild(area);
        area.focus();
        area.select();
        const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
        if (area.parentNode) area.parentNode.removeChild(area);
        return copied === true;
      } catch {
        return false;
      }
    }

    function escapeMarkdownCell(value) {
      return asString(value).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
    }

    function csvEscapeCell(value) {
      const text = asString(value);
      if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    }

    // =========================================================================
    // 翻译函数座位：apply 时绑定 ctx.locale.bind(NS)；组件另通过 props.t 使用。
    // =========================================================================

    let translate = (key) => key;

    function T(key, params) {
      try {
        const text = translate(key, params);
        return typeof text === 'string' && text !== '' ? text : key;
      } catch {
        return key;
      }
    }

    // =========================================================================
    // 1. Host API 客户端
    // =========================================================================

    class ApiError extends Error {
      constructor(code, message) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
      }
    }

    /** 解析 {ok:true,data}|{ok:false,error:{code,message}} 信封；非 2xx 也转成可读错误。 */
    async function unwrapResponse(response) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const detail = isRecord(payload) && isRecord(payload.error) ? asString(payload.error.message) : '';
        const code = isRecord(payload) && isRecord(payload.error) ? asString(payload.error.code) : '';
        throw new ApiError(code || `http-${response.status}`, detail || `HTTP ${response.status}`);
      }
      if (payload === null || payload === undefined) {
        throw new ApiError('bad-response', T('errors.badResponse'));
      }
      if (isRecord(payload) && payload.ok === false) {
        const error = isRecord(payload.error) ? payload.error : {};
        throw new ApiError(asString(error.code) || 'host-error', asString(error.message) || T('errors.hostError'));
      }
      if (isRecord(payload) && payload.ok === true) {
        return payload.data === undefined ? payload : payload.data;
      }
      return payload;
    }

    async function invoke(action, params) {
      let response;
      try {
        response = await fetch(`${API_BASE}/api/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, params: params || {} }),
        });
      } catch (error) {
        throw new ApiError('network', `${T('errors.network')}：${asString(error && error.message)}`);
      }
      return unwrapResponse(response);
    }

    async function uploadFile(file) {
      const name = asString(file && file.name) || `upload-${Date.now()}`;
      let response;
      try {
        response = await fetch(`${API_BASE}/api/upload?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'content-type': asString(file && file.type) || 'application/octet-stream' },
          body: file,
        });
      } catch (error) {
        throw new ApiError('network', `${T('errors.network')}：${asString(error && error.message)}`);
      }
      const data = await unwrapResponse(response);
      if (!isRecord(data) || asString(data.url) === '') {
        throw new ApiError('bad-response', T('errors.badResponse'));
      }
      return data;
    }

    function loadImageElement(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new ApiError('image-load', T('errors.imageLoad')));
        image.src = src;
      });
    }

    // =========================================================================
    // 2. 模块级共享 store + localStorage 持久化
    // =========================================================================

    function createEmptyAnnotation() {
      return {
        tool: 'box',
        grid: 'thirds',
        labelText: '',
        boxes: [],
        lines: [],
        arrows: [],
        labels: [],
        hostUrl: '',
        hostPath: '',
        seq: 0,
      };
    }

    function createEmptyShotRow(shotNumber) {
      return {
        shot: String(shotNumber),
        time: '',
        size: '',
        angle: '',
        movement: '',
        content: '',
        sound: '',
        duration: '',
      };
    }

    function defaultShotRows() {
      return [createEmptyShotRow(1), createEmptyShotRow(2), createEmptyShotRow(3)];
    }

    function emptyKnowledgeState() {
      return { data: null, loading: false, error: '' };
    }

    function createEmptyState() {
      return {
        image: null,
        video: null,
        pathInput: '',
        form: {},
        metrics: null,
        palette: null,
        paletteK: 8,
        annotation: createEmptyAnnotation(),
        shots: defaultShotRows(),
        ocr: null,
        prompt: '',
        status: null,
        busy: {},
        knowledge: emptyKnowledgeState(),
      };
    }

    function sanitizeImage(raw) {
      if (!isRecord(raw)) return null;
      const path = asString(raw.path);
      const url = asString(raw.url);
      const name = asString(raw.name);
      if (path === '' && url === '') return null;
      return { path, url, name };
    }

    function sanitizeProbe(raw) {
      if (!isRecord(raw)) return null;
      return raw;
    }

    function sanitizeFrame(raw) {
      if (!isRecord(raw)) return null;
      const url = asString(raw.url);
      const path = asString(raw.path);
      if (url === '' && path === '') return null;
      return { index: asFiniteNumber(raw.index) || 0, time: asFiniteNumber(raw.time) || 0, path, url };
    }

    function sanitizeVideo(raw) {
      if (!isRecord(raw)) return null;
      const path = asString(raw.path);
      const url = asString(raw.url);
      const name = asString(raw.name);
      if (path === '' && url === '') return null;
      const frames = Array.isArray(raw.frames) ? raw.frames.map(sanitizeFrame).filter(Boolean).slice(0, 24) : [];
      const sheet = isRecord(raw.contactSheet) && asString(raw.contactSheet.url) !== ''
        ? {
            url: asString(raw.contactSheet.url),
            width: asFiniteNumber(raw.contactSheet.width) || 0,
            height: asFiniteNumber(raw.contactSheet.height) || 0,
            count: asFiniteNumber(raw.contactSheet.count) || 0,
          }
        : null;
      return { path, url, name, probe: sanitizeProbe(raw.probe), frames, contactSheet: sheet };
    }

    function sanitizeAnnotationItem(raw, fields) {
      if (!isRecord(raw)) return null;
      const item = { id: asFiniteNumber(raw.id) || 0 };
      for (const field of fields) {
        const value = field === 'text' ? asString(raw[field]) : clampRatio(raw[field]);
        item[field] = value;
      }
      return item;
    }

    function sanitizeAnnotation(raw) {
      const annotation = createEmptyAnnotation();
      if (!isRecord(raw)) return annotation;
      if (TOOL_OPTIONS.indexOf(raw.tool) >= 0) annotation.tool = raw.tool;
      if (GRID_OPTIONS.indexOf(raw.grid) >= 0) annotation.grid = raw.grid;
      annotation.labelText = asString(raw.labelText).slice(0, 80);
      annotation.hostUrl = asString(raw.hostUrl);
      annotation.hostPath = asString(raw.hostPath);
      annotation.boxes = (Array.isArray(raw.boxes) ? raw.boxes : []).map((item) => sanitizeAnnotationItem(item, ['x', 'y', 'w', 'h'])).filter(Boolean).slice(0, MAX_ANNOTATION_ITEMS);
      annotation.lines = (Array.isArray(raw.lines) ? raw.lines : []).map((item) => sanitizeAnnotationItem(item, ['x1', 'y1', 'x2', 'y2'])).filter(Boolean).slice(0, MAX_ANNOTATION_ITEMS);
      annotation.arrows = (Array.isArray(raw.arrows) ? raw.arrows : []).map((item) => sanitizeAnnotationItem(item, ['x1', 'y1', 'x2', 'y2'])).filter(Boolean).slice(0, MAX_ANNOTATION_ITEMS);
      annotation.labels = (Array.isArray(raw.labels) ? raw.labels : []).map((item) => sanitizeAnnotationItem(item, ['x', 'y', 'text'])).filter(Boolean).slice(0, MAX_ANNOTATION_ITEMS);
      let seq = asFiniteNumber(raw.seq) || 0;
      for (const item of annotation.boxes.concat(annotation.lines, annotation.arrows, annotation.labels)) {
        if (item.id > seq) seq = item.id;
      }
      annotation.seq = seq;
      return annotation;
    }

    function sanitizeForm(raw) {
      const form = {};
      if (!isRecord(raw)) return form;
      const keys = Object.keys(raw).slice(0, 40);
      for (const key of keys) {
        const entry = raw[key];
        if (!isRecord(entry)) continue;
        form[key] = {
          term: asString(entry.term),
          basis: asString(entry.basis),
          intent: asString(entry.intent),
          cite: asString(entry.cite),
        };
      }
      return form;
    }

    function sanitizeShots(raw) {
      if (!Array.isArray(raw) || raw.length === 0) return defaultShotRows();
      const rows = [];
      for (const item of raw.slice(0, MAX_SHOT_ROWS)) {
        if (!isRecord(item)) continue;
        const row = {};
        for (const field of CSV_FIELDS) row[field] = asString(item[field]);
        rows.push(row);
      }
      return rows.length > 0 ? rows : defaultShotRows();
    }

    function sanitizeOcr(raw) {
      if (!isRecord(raw)) return null;
      const lines = (Array.isArray(raw.lines) ? raw.lines : [])
        .map((line) => (isRecord(line) ? { text: asString(line.text), confidence: asFiniteNumber(line.confidence) } : null))
        .filter(Boolean)
        .slice(0, 500);
      if (lines.length === 0 && asString(raw.text) === '') return null;
      return {
        text: asString(raw.text) || lines.map((line) => line.text).join('\n'),
        lines,
        count: asFiniteNumber(raw.count) || lines.length,
      };
    }

    function sanitizePalette(raw) {
      if (!isRecord(raw) || !Array.isArray(raw.colors)) return null;
      const colors = raw.colors
        .filter((color) => isRecord(color) && /^#[0-9a-f]{3,8}$/i.test(asString(color.hex)))
        .map((color) => ({ hex: asString(color.hex), share: asFiniteNumber(color.share) || 0 }))
        .slice(0, 16);
      return colors.length > 0 ? { colors } : null;
    }

    function hydrateState(raw) {
      const state = createEmptyState();
      if (!isRecord(raw) || raw.version !== PERSIST_VERSION) return state;
      state.image = sanitizeImage(raw.image);
      state.video = sanitizeVideo(raw.video);
      state.pathInput = asString(raw.pathInput);
      state.form = sanitizeForm(raw.form);
      state.metrics = isRecord(raw.metrics) ? raw.metrics : null;
      state.palette = sanitizePalette(raw.palette);
      state.paletteK = Math.min(16, Math.max(2, asFiniteNumber(raw.paletteK) || 8));
      state.annotation = sanitizeAnnotation(raw.annotation);
      state.shots = sanitizeShots(raw.shots);
      state.ocr = sanitizeOcr(raw.ocr);
      return state;
    }

    function readPersistedState() {
      try {
        const text = window.localStorage.getItem(STORAGE_KEY);
        if (!text) return null;
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    function writePersistedState(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* 隐私模式或配额不足时静默失败：面板仍可继续使用 */
      }
    }

    function createStore(initialState) {
      let state = initialState;
      const listeners = new Set();
      return {
        getSnapshot() {
          return state;
        },
        set(updater) {
          const next = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
          if (!next || next === state) return;
          state = next;
          for (const listener of Array.from(listeners)) {
            try {
              listener();
            } catch {
              /* 单个监听器的异常不影响其他订阅者 */
            }
          }
          schedulePersist();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    let persistTimer = null;

    function persistNow() {
      const state = store.getSnapshot();
      writePersistedState({
        version: PERSIST_VERSION,
        image: state.image,
        video: state.video,
        pathInput: state.pathInput,
        form: state.form,
        metrics: state.metrics,
        palette: state.palette,
        paletteK: state.paletteK,
        annotation: state.annotation,
        shots: state.shots,
        ocr: state.ocr,
      });
    }

    function schedulePersist() {
      if (persistTimer !== null) return;
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistNow();
      }, 250);
    }

    const store = createStore(hydrateState(readPersistedState()));

    let statusSeq = 0;

    /** 组件订阅 store 的最小实现（普通订阅 + useState，兼容无 uSES 的 React 版本）。 */
    function useStoreValue() {
      const [value, setValue] = useState(() => store.getSnapshot());
      useEffect(() => {
        let active = true;
        const unsubscribe = store.subscribe(() => {
          if (!active) return;
          setValue(store.getSnapshot());
        });
        setValue(store.getSnapshot());
        return () => {
          active = false;
          unsubscribe();
        };
      }, []);
      return value;
    }

    // =========================================================================
    // 3. 状态动作与数据整理
    // =========================================================================

    function flash(kind, text) {
      statusSeq += 1;
      store.set((state) => ({ ...state, status: { kind, text, seq: statusSeq } }));
    }

    function clearStatus(seq) {
      const current = store.getSnapshot().status;
      if (!current) return;
      if (typeof seq === 'number' && current.seq !== seq) return;
      store.set((state) => ({ ...state, status: null }));
    }

    function setBusy(key, value) {
      store.set((state) => {
        const current = Boolean(state.busy[key]);
        if (current === Boolean(value)) return state;
        const busy = { ...state.busy };
        if (value) busy[key] = true;
        else delete busy[key];
        return { ...state, busy };
      });
    }

    function isBusy(key) {
      return Boolean(store.getSnapshot().busy[key]);
    }

    function errorText(error) {
      if (!error) return T('errors.hostError');
      const message = asString(error.message) || String(error);
      return message || T('errors.hostError');
    }

    function fail(error) {
      flash('error', `${T('status.failed')}：${errorText(error)}`);
    }

    async function runTask(key, task) {
      if (isBusy(key)) return undefined;
      setBusy(key, true);
      try {
        return await task();
      } catch (error) {
        fail(error);
        return undefined;
      } finally {
        setBusy(key, false);
      }
    }

    function applyImage(image) {
      const previous = store.getSnapshot().image;
      const samePath = Boolean(previous && previous.path && image.path && previous.path === image.path);
      store.set((state) => {
        if (samePath) return { ...state, image, pathInput: image.path || state.pathInput };
        return {
          ...state,
          image,
          pathInput: image.path || state.pathInput,
          metrics: null,
          palette: null,
          ocr: null,
          annotation: createEmptyAnnotation(),
          prompt: '',
        };
      });
    }

    function applyVideo(video) {
      store.set((state) => {
        const previous = state.video;
        const samePath = Boolean(previous && previous.path && video.path && previous.path === video.path);
        if (samePath) return { ...state, video: { ...video, probe: video.probe || previous.probe } };
        return {
          ...state,
          video: { path: video.path, url: video.url, name: video.name, probe: video.probe || null, frames: [], contactSheet: null },
        };
      });
    }

    async function importImageFile(file) {
      if (!isImageFile(file)) {
        flash('warn', T('import.unsupported'));
        return;
      }
      if (asFiniteNumber(file.size) !== null && file.size > MAX_IMAGE_BYTES) {
        flash('error', T('import.tooLargeImage'));
        return;
      }
      await runTask('upload', async () => {
        const data = await uploadFile(file);
        applyImage({ path: asString(data.path), url: asString(data.url), name: asString(data.name) || asString(file.name) });
        flash('success', `${T('status.importedImage')}：${asString(data.name) || asString(file.name)}`);
      });
    }

    async function importVideoFile(file) {
      if (!isVideoFile(file)) {
        flash('warn', T('import.unsupported'));
        return;
      }
      if (asFiniteNumber(file.size) !== null && file.size > MAX_VIDEO_BYTES) {
        flash('error', T('import.tooLargeVideo'));
        return;
      }
      const data = await runTask('upload', async () => {
        const uploaded = await uploadFile(file);
        applyVideo({ path: asString(uploaded.path), url: asString(uploaded.url), name: asString(uploaded.name) || asString(file.name) });
        flash('success', `${T('status.importedVideo')}：${asString(uploaded.name) || asString(file.name)}`);
        return uploaded;
      });
      if (data) await probeVideo();
    }

    async function loadFromPath(kind) {
      const path = store.getSnapshot().pathInput.trim();
      if (path === '') {
        flash('warn', T('status.needPath'));
        return;
      }
      const loaded = await runTask('load', async () => {
        const data = await invoke('fileUrl', { path });
        const url = isRecord(data) ? asString(data.url) : '';
        if (url === '') throw new ApiError('bad-response', T('errors.badResponse'));
        if (kind === 'video') applyVideo({ path, url, name: baseName(path) });
        else applyImage({ path, url, name: baseName(path) });
        flash('success', `${T('status.pathLoaded')}：${baseName(path)}`);
        return { path, kind };
      });
      if (loaded && loaded.kind === 'video') await probeVideo();
    }

    function loadFromPathAuto() {
      const path = store.getSnapshot().pathInput.trim();
      if (path === '') {
        flash('warn', T('status.needPath'));
        return;
      }
      loadFromPath(VIDEO_EXTENSIONS.indexOf(fileExtension(path)) >= 0 ? 'video' : 'image');
    }

    function setPathInput(value) {
      store.set((state) => ({ ...state, pathInput: asString(value) }));
    }

    function removeImage() {
      store.set((state) => ({
        ...state,
        image: null,
        metrics: null,
        palette: null,
        ocr: null,
        annotation: createEmptyAnnotation(),
        prompt: '',
      }));
      flash('info', T('status.removed'));
    }

    function removeVideo() {
      store.set((state) => ({ ...state, video: null }));
      flash('info', T('status.removed'));
    }

    function setPaletteK(value) {
      const k = Math.min(16, Math.max(2, asFiniteNumber(value) || 8));
      store.set((state) => ({ ...state, paletteK: k }));
    }

    async function measureAll() {
      const image = store.getSnapshot().image;
      if (!image || image.path === '') {
        flash('warn', T('status.needImagePath'));
        return;
      }
      await runTask('metrics', async () => {
        const metrics = await invoke('metrics', { imagePath: image.path });
        let palette = null;
        let paletteError = null;
        try {
          palette = await invoke('palette', { imagePath: image.path, k: store.getSnapshot().paletteK });
        } catch (error) {
          paletteError = error;
        }
        store.set((state) => ({
          ...state,
          metrics: isRecord(metrics) ? metrics : null,
          palette: sanitizePalette(palette),
        }));
        if (paletteError) {
          flash('warn', `${T('status.paletteFailed')}：${errorText(paletteError)}`);
        } else {
          flash('success', T('status.measured'));
        }
      });
    }

    async function measurePaletteOnly() {
      const image = store.getSnapshot().image;
      if (!image || image.path === '') {
        flash('warn', T('status.needImagePath'));
        return;
      }
      await runTask('palette', async () => {
        const palette = await invoke('palette', { imagePath: image.path, k: store.getSnapshot().paletteK });
        store.set((state) => ({ ...state, palette: sanitizePalette(palette) }));
        flash('success', T('status.paletteDone'));
      });
    }

    function frameTimesFor(duration) {
      const value = asFiniteNumber(duration);
      if (value === null || value <= 0) return null;
      const count = 6;
      const times = [];
      for (let index = 0; index < count; index += 1) {
        times.push(Number((((index + 0.5) / count) * value).toFixed(2)));
      }
      return times;
    }

    async function probeVideo() {
      const video = store.getSnapshot().video;
      if (!video || video.path === '') {
        flash('warn', T('status.needVideoPath'));
        return;
      }
      await runTask('probe', async () => {
        const probe = await invoke('probe', { videoPath: video.path });
        store.set((state) => {
          if (!state.video || state.video.path !== video.path) return state;
          return { ...state, video: { ...state.video, probe: isRecord(probe) ? probe : null } };
        });
        flash('success', T('status.probed'));
      });
    }

    async function extractFrames() {
      const video = store.getSnapshot().video;
      if (!video || video.path === '') {
        flash('warn', T('status.needVideoPath'));
        return;
      }
      await runTask('frames', async () => {
        const probe = video.probe;
        const times = frameTimesFor(probe && probe.duration);
        const params = { videoPath: video.path };
        if (times) params.times = times;
        else params.count = 6;
        const data = await invoke('extractFrames', params);
        const frames = isRecord(data) && Array.isArray(data.frames) ? data.frames.map(sanitizeFrame).filter(Boolean) : [];
        store.set((state) => {
          if (!state.video) return state;
          return { ...state, video: { ...state.video, frames } };
        });
        flash('success', `${T('status.framesDone')}（${frames.length}）`);
      });
    }

    async function makeContactSheet() {
      const video = store.getSnapshot().video;
      if (!video || video.path === '') {
        flash('warn', T('status.needVideoPath'));
        return;
      }
      await runTask('sheet', async () => {
        const probe = video.probe;
        const times = frameTimesFor(probe && probe.duration);
        const params = { videoPath: video.path, cols: 3, width: 480 };
        if (times) params.times = times;
        else params.count = 6;
        const data = await invoke('contactSheet', params);
        if (!isRecord(data) || asString(data.url) === '') throw new ApiError('bad-response', T('errors.badResponse'));
        const sheet = { url: asString(data.url), width: asFiniteNumber(data.width) || 0, height: asFiniteNumber(data.height) || 0, count: asFiniteNumber(data.count) || 0 };
        store.set((state) => (state.video ? { ...state, video: { ...state.video, contactSheet: sheet } } : state));
        flash('success', T('status.sheetDone'));
      });
    }

    function useFrameAsImage(frame) {
      if (!isRecord(frame) || asString(frame.url) === '') {
        flash('warn', T('status.needImage'));
        return;
      }
      const video = store.getSnapshot().video;
      const label = `${video && video.name ? baseName(video.name) : 'frame'} @ ${formatSeconds(frame.time)}`;
      applyImage({ path: asString(frame.path), url: asString(frame.url), name: label });
      flash('success', T('status.frameSelected'));
    }

    async function runOcr() {
      const image = store.getSnapshot().image;
      if (!image || image.path === '') {
        flash('warn', T('status.needImagePath'));
        return;
      }
      await runTask('ocr', async () => {
        const data = await invoke('ocr', { imagePath: image.path, lang: 'chi_sim+eng' });
        const record = isRecord(data) ? data : {};
        const ocr = sanitizeOcr(record) || { text: '', lines: [], count: 0 };
        store.set((state) => ({ ...state, ocr }));
        flash('success', `${T('status.ocrDone')}（${ocr.lines.length}）`);
      });
    }

    function annotationCount(annotation) {
      if (!isRecord(annotation)) return 0;
      return annotation.boxes.length + annotation.lines.length + annotation.arrows.length + annotation.labels.length;
    }

    function annotationArrayKey(kind) {
      if (kind === 'box') return 'boxes';
      if (kind === 'line') return 'lines';
      if (kind === 'arrow') return 'arrows';
      return 'labels';
    }

    function addAnnotationItem(kind, geometry) {
      const current = store.getSnapshot().annotation;
      if (annotationCount(current) >= MAX_ANNOTATION_ITEMS) {
        flash('warn', T('annotate.limit'));
        return;
      }
      store.set((state) => {
        const annotation = state.annotation;
        if (annotationCount(annotation) >= MAX_ANNOTATION_ITEMS) return state;
        const key = annotationArrayKey(kind);
        const id = annotation.seq + 1;
        const entry = { ...geometry, id };
        return {
          ...state,
          annotation: {
            ...annotation,
            [key]: annotation[key].concat(entry),
            seq: id,
            hostUrl: '',
            hostPath: '',
          },
        };
      });
    }

    function deleteAnnotationItem(kind, id) {
      store.set((state) => {
        const annotation = state.annotation;
        const key = annotationArrayKey(kind);
        return {
          ...state,
          annotation: {
            ...annotation,
            [key]: annotation[key].filter((item) => item.id !== id),
            hostUrl: '',
            hostPath: '',
          },
        };
      });
    }

    function undoAnnotation() {
      store.set((state) => {
        const annotation = state.annotation;
        let latestKey = '';
        let latestItem = null;
        for (const key of ['boxes', 'lines', 'arrows', 'labels']) {
          for (const item of annotation[key]) {
            if (!latestItem || item.id > latestItem.id) {
              latestItem = item;
              latestKey = key;
            }
          }
        }
        if (!latestItem || latestKey === '') return state;
        return {
          ...state,
          annotation: {
            ...annotation,
            [latestKey]: annotation[latestKey].filter((item) => item.id !== latestItem.id),
            hostUrl: '',
            hostPath: '',
          },
        };
      });
    }

    function clearAnnotations() {
      store.set((state) => {
        const annotation = state.annotation;
        return {
          ...state,
          annotation: {
            ...createEmptyAnnotation(),
            tool: annotation.tool,
            grid: annotation.grid,
            labelText: annotation.labelText,
          },
        };
      });
      flash('info', T('status.cleared'));
    }

    function setAnnotationTool(tool) {
      if (TOOL_OPTIONS.indexOf(tool) < 0) return;
      store.set((state) => ({ ...state, annotation: { ...state.annotation, tool } }));
    }

    function setAnnotationGrid(grid) {
      if (GRID_OPTIONS.indexOf(grid) < 0) return;
      store.set((state) => ({ ...state, annotation: { ...state.annotation, grid } }));
    }

    function setAnnotationLabelText(text) {
      store.set((state) => ({ ...state, annotation: { ...state.annotation, labelText: asString(text).slice(0, 80) } }));
    }

    function updateFormField(dimensionKey, field, value) {
      store.set((state) => {
        const previous = isRecord(state.form[dimensionKey]) ? state.form[dimensionKey] : EMPTY_FORM_ENTRY;
        return {
          ...state,
          form: { ...state.form, [dimensionKey]: { ...EMPTY_FORM_ENTRY, ...previous, [field]: asString(value) } },
        };
      });
    }

    function resetForm() {
      store.set((state) => ({ ...state, form: {} }));
      flash('info', T('status.formReset'));
    }

    function updateShot(index, field, value) {
      if (CSV_FIELDS.indexOf(field) < 0) return;
      store.set((state) => ({
        ...state,
        shots: state.shots.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: asString(value) } : row)),
      }));
    }

    function addShotRow() {
      store.set((state) => {
        if (state.shots.length >= MAX_SHOT_ROWS) return state;
        let maxShot = 0;
        for (const row of state.shots) {
          const parsed = parseInt(asString(row.shot), 10);
          if (Number.isFinite(parsed) && parsed > maxShot) maxShot = parsed;
        }
        return { ...state, shots: state.shots.concat(createEmptyShotRow(maxShot + 1)) };
      });
    }

    function removeShotRow(index) {
      store.set((state) => ({ ...state, shots: state.shots.filter((row, rowIndex) => rowIndex !== index) }));
    }

    function normalizeDimensions(raw) {
      if (!Array.isArray(raw)) return [];
      const dimensions = [];
      for (const item of raw) {
        if (!isRecord(item)) continue;
        const key = asString(item.key);
        if (key === '') continue;
        const fallbackLabel = T(`dim.${key}`);
        const terms = (Array.isArray(item.terms) ? item.terms : [])
          .filter((term) => isRecord(term) && asString(term.term) !== '')
          .map((term) => ({
            term: asString(term.term),
            definition: asString(term.definition),
            cite: asString(term.cite),
            exam: asString(term.exam),
          }));
        dimensions.push({
          key,
          label: asString(item.label) || fallbackLabel,
          note: asString(item.note),
          terms,
        });
      }
      return dimensions;
    }

    function fallbackDimensions() {
      return DIMENSION_KEYS.map((key) => ({
        key,
        label: T(`dim.${key}`),
        note: T(`dim.${key}.note`),
        terms: [],
      }));
    }

    function dimensionsOf(state) {
      const data = state.knowledge && state.knowledge.data;
      if (data && Array.isArray(data.dimensions) && data.dimensions.length > 0) return data.dimensions;
      return fallbackDimensions();
    }

    function formEntryOf(state, dimensionKey) {
      const entry = state.form ? state.form[dimensionKey] : null;
      return isRecord(entry) ? { ...EMPTY_FORM_ENTRY, ...entry } : { ...EMPTY_FORM_ENTRY };
    }

    function isEntryFilled(entry) {
      return Boolean(entry && (entry.term !== '' || entry.basis !== '' || entry.intent !== '' || entry.cite !== ''));
    }

    function selectedTermOf(dimension, entry) {
      if (!dimension || !entry || entry.term === '') return null;
      for (const term of dimension.terms) {
        if (term.term === entry.term) return term;
      }
      return null;
    }

    async function ensureKnowledge(force) {
      const current = store.getSnapshot().knowledge;
      if (current.loading) return;
      if (!force && current.data) return;
      store.set((state) => ({ ...state, knowledge: { ...state.knowledge, loading: true, error: '' } }));
      try {
        const data = await invoke('knowledge', {});
        const record = isRecord(data) ? data : {};
        const dimensions = normalizeDimensions(record.dimensions);
        if (dimensions.length === 0) throw new ApiError('bad-knowledge', T('form.knowledgeFailed'));
        store.set((state) => ({
          ...state,
          knowledge: {
            data: {
              dimensions,
              framework: isRecord(record.framework) ? record.framework : null,
              films: Array.isArray(record.films) ? record.films : [],
            },
            loading: false,
            error: '',
          },
        }));
      } catch (error) {
        store.set((state) => ({ ...state, knowledge: { ...state.knowledge, loading: false, error: errorText(error) } }));
      }
    }

    function buildFrameworkSummary() {
      const state = store.getSnapshot();
      const data = state.knowledge && state.knowledge.data;
      const framework = data && data.framework;
      if (!isRecord(framework)) return T('prompt.noFramework');
      const lines = [];
      const book1 = framework.book1;
      if (isRecord(book1)) {
        const title = asString(book1.title) || T('report.frameworkBook1');
        const steps = Array.isArray(book1.steps) ? book1.steps : [];
        if (steps.length > 0) {
          lines.push(`${title}：`);
          for (const step of steps) {
            if (!isRecord(step)) continue;
            const name = asString(step.name) || asString(step.title);
            const detail = asString(step.detail) || asString(step.text);
            const cite = asString(step.cite);
            if (name === '' && detail === '') continue;
            lines.push(`- ${name}${detail ? `：${detail}` : ''}${cite ? `（${cite}）` : ''}`);
          }
        }
      }
      const book2 = framework.book2;
      if (isRecord(book2)) {
        const title = asString(book2.title) || T('report.frameworkBook2');
        const rules = Array.isArray(book2.rules) ? book2.rules : Array.isArray(book2.steps) ? book2.steps : [];
        if (rules.length > 0) {
          lines.push(`${title}：`);
          for (const rule of rules) {
            if (!isRecord(rule)) continue;
            const name = asString(rule.name) || asString(rule.title);
            const detail = asString(rule.detail) || asString(rule.text) || asString(rule.rule);
            const cite = asString(rule.cite);
            if (name === '' && detail === '') continue;
            lines.push(`- ${name}${detail ? `：${detail}` : ''}${cite ? `（${cite}）` : ''}`);
          }
        }
      }
      return lines.length > 0 ? lines.join('\n') : T('prompt.noFramework');
    }

    function buildOverlayParams(annotation) {
      const guides = [];
      if (annotation.grid === 'thirds') guides.push({ type: 'thirds' });
      else if (annotation.grid === 'golden') guides.push({ type: 'golden' });
      return {
        guides,
        boxes: annotation.boxes.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h })),
        lines: annotation.lines.map((item) => ({ x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 })),
        arrows: annotation.arrows.map((item) => ({ x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 })),
        labels: annotation.labels.map((item) => ({ x: item.x, y: item.y, text: item.text })),
      };
    }

    async function generateHostOverlay() {
      const state = store.getSnapshot();
      const image = state.image;
      if (!image || image.path === '') {
        flash('warn', T('status.needImagePath'));
        return;
      }
      const payload = buildOverlayParams(state.annotation);
      await runTask('overlay', async () => {
        const data = await invoke('overlay', Object.assign({ imagePath: image.path }, payload));
        if (!isRecord(data) || asString(data.url) === '') throw new ApiError('bad-response', T('errors.badResponse'));
        store.set((current) => ({
          ...current,
          annotation: {
            ...current.annotation,
            hostUrl: asString(data.url),
            hostPath: asString(data.outputPath),
          },
        }));
        flash('success', T('status.overlayDone'));
      });
    }

    function paintGrid(ctx, width, height, grid, color, lineWidth) {
      const ratios = grid === 'golden' ? [0.382, 0.618] : grid === 'thirds' ? [1 / 3, 2 / 3] : [];
      if (ratios.length === 0) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
      for (const ratio of ratios) {
        ctx.beginPath();
        ctx.moveTo(width * ratio, 0);
        ctx.lineTo(width * ratio, height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, height * ratio);
        ctx.lineTo(width, height * ratio);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawArrowHead(ctx, x1, y1, x2, y2, color, size) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function paintLabel(ctx, text, x, y, fontSize, color) {
      const value = asString(text);
      if (value === '') return;
      ctx.save();
      ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      const measured = ctx.measureText(value).width;
      const padding = fontSize * 0.35;
      const boxHeight = fontSize * 1.5;
      const boxX = x;
      const boxY = y - boxHeight;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      ctx.fillRect(boxX, boxY, measured + padding * 2, boxHeight);
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(value, boxX + padding, boxY + boxHeight / 2);
      ctx.restore();
    }

    /** 在给定尺寸的画布上按归一化坐标绘制网格与全部标注（显示与导出共用）。 */
    function paintAnnotations(ctx, width, height, annotation, draft) {
      if (width <= 0 || height <= 0) return;
      const unit = Math.max(1.5, Math.min(width, height) * 0.0035);
      const fontSize = Math.max(10, Math.min(width, height) * 0.03);
      paintGrid(ctx, width, height, annotation.grid, '#ffd43b', unit);
      ctx.save();
      ctx.lineWidth = unit * 2;
      ctx.strokeStyle = '#ff4d4f';
      for (const box of annotation.boxes) {
        ctx.strokeRect(box.x * width, box.y * height, box.w * width, box.h * height);
      }
      ctx.strokeStyle = '#40c4ff';
      for (const line of annotation.lines) {
        ctx.beginPath();
        ctx.moveTo(line.x1 * width, line.y1 * height);
        ctx.lineTo(line.x2 * width, line.y2 * height);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ff9f43';
      for (const arrow of annotation.arrows) {
        const x1 = arrow.x1 * width;
        const y1 = arrow.y1 * height;
        const x2 = arrow.x2 * width;
        const y2 = arrow.y2 * height;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        drawArrowHead(ctx, x1, y1, x2, y2, '#ff9f43', unit * 5);
      }
      ctx.restore();
      for (const label of annotation.labels) {
        paintLabel(ctx, label.text, label.x * width, label.y * height, fontSize, '#ffffff');
      }
      if (draft) {
        ctx.save();
        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = unit * 1.5;
        ctx.setLineDash([unit * 4, unit * 3]);
        if (draft.kind === 'box') {
          const x = Math.min(draft.x1, draft.x2) * width;
          const y = Math.min(draft.y1, draft.y2) * height;
          const w = Math.abs(draft.x2 - draft.x1) * width;
          const h = Math.abs(draft.y2 - draft.y1) * height;
          ctx.strokeRect(x, y, w, h);
        } else {
          ctx.beginPath();
          ctx.moveTo(draft.x1 * width, draft.y1 * height);
          ctx.lineTo(draft.x2 * width, draft.y2 * height);
          ctx.stroke();
          if (draft.kind === 'arrow') {
            drawArrowHead(ctx, draft.x1 * width, draft.y1 * height, draft.x2 * width, draft.y2 * height, '#ffd43b', unit * 5);
          }
        }
        ctx.restore();
      }
    }

    function composeAnnotationImage(url, annotation) {
      return loadImageElement(url).then(
        (image) =>
          new Promise((resolve, reject) => {
            const naturalWidth = image.naturalWidth || image.width || 1280;
            const naturalHeight = image.naturalHeight || image.height || 720;
            const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(naturalWidth, naturalHeight, 1));
            const width = Math.max(1, Math.round(naturalWidth * scale));
            const height = Math.max(1, Math.round(naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new ApiError('canvas', T('errors.canvasExport')));
              return;
            }
            ctx.drawImage(image, 0, 0, width, height);
            paintAnnotations(ctx, width, height, annotation, null);
            if (typeof canvas.toBlob !== 'function') {
              reject(new ApiError('canvas', T('errors.canvasExport')));
              return;
            }
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new ApiError('canvas', T('errors.canvasExport')));
            }, 'image/png');
          }),
      );
    }

    async function exportAnnotationPng() {
      const state = store.getSnapshot();
      const image = state.image;
      if (!image || image.url === '') {
        flash('warn', T('status.needImage'));
        return;
      }
      await runTask('png', async () => {
        const blob = await composeAnnotationImage(assetUrl(image.url), state.annotation);
        downloadBlob(`film-analysis-annotation-${fileStamp()}.png`, blob);
        flash('success', T('status.pngExported'));
      });
    }

    function buildPromptText() {
      const state = store.getSnapshot();
      const dimensions = dimensionsOf(state);
      const lines = [];
      lines.push('【影视画面分析请求】');
      lines.push('你是熟悉《影视视听语言》与《电影语言的语法》的分析助手。请依据下面的素材信息、客观测量数据、八维分析表单与两书分析框架，完成一次专业的画面视听语言分析。');
      lines.push('');
      lines.push('一、素材');
      if (state.image) {
        lines.push('- 类型：单帧画面');
        lines.push(`- 绝对路径：${state.image.path || '（未知）'}`);
        if (state.image.name) lines.push(`- 文件：${state.image.name}`);
        if (state.image.url) lines.push(`- 预览地址（若会话可直接读取图片，请查看该画面）：${assetUrl(state.image.url)}`);
      }
      if (state.video) {
        lines.push('- 类型：视频');
        lines.push(`- 绝对路径：${state.video.path || '（未知）'}`);
        const probe = state.video.probe;
        if (probe) {
          const audio = probe.hasAudio
            ? `音频 ${asString(probe.audioCodec) || '?'} ${asNumberOrDash(probe.channels)}ch/${asNumberOrDash(probe.sampleRate)}Hz`
            : '无音频流';
          lines.push(
            `- 元信息：${asNumberOrDash(probe.width)}×${asNumberOrDash(probe.height)}，${asString(probe.aspectLabel) || '画幅未知'}，${asString(probe.durationLabel) || formatSeconds(probe.duration)}，${asNumberOrDash(probe.fps)} fps，${asString(probe.codec) || '未知编码'}，${audio}`,
          );
        }
        if (state.video.frames.length > 0 || state.video.contactSheet) {
          lines.push(`- 已抽取关键帧 ${state.video.frames.length} 张${state.video.contactSheet ? '，并生成接触表' : ''}（可在会话中请我逐帧分析）。`);
        }
      }
      if (!state.image && !state.video) lines.push('- （尚未导入素材）');
      lines.push('');
      lines.push('二、客观测量数据');
      lines.push('```json');
      lines.push(
        JSON.stringify(
          {
            metrics: state.metrics || null,
            palette: state.palette && Array.isArray(state.palette.colors) ? state.palette.colors : null,
            annotationImage: state.annotation && state.annotation.hostUrl ? assetUrl(state.annotation.hostUrl) : null,
          },
          null,
          2,
        ),
      );
      lines.push('```');
      lines.push('');
      lines.push('三、八维分析表单（用户已填写的内容）');
      lines.push('| 维度 | 术语 | 画面依据 | 意图与效果 | 页码引用 |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const dimension of dimensions) {
        const entry = formEntryOf(state, dimension.key);
        lines.push(`| ${escapeMarkdownCell(dimension.label)} | ${escapeMarkdownCell(entry.term)} | ${escapeMarkdownCell(entry.basis)} | ${escapeMarkdownCell(entry.intent)} | ${escapeMarkdownCell(entry.cite)} |`);
      }
      lines.push('');
      lines.push('四、教材分析框架摘要');
      lines.push(buildFrameworkSummary());
      lines.push('');
      lines.push('五、输出要求');
      lines.push('1. 按八个维度逐一分析：先给判断，再给画面证据，最后说明导演/摄影的意图与观众效果。');
      lines.push('2. 术语使用两本教材的规范表述；页码引用以表单中给出的页码为准，不要编造页码。');
      lines.push('3. 指出该画面/镜头在整场戏中的功能（叙事、情绪、节奏、视线引导等）。');
      lines.push('4. 最后给出 3 条可操作的拍摄或拉片建议，并补一份分镜/镜头表建议（镜号、时间码、景别、角度和机位、镜头运动、画面内容、声音、时长）。');
      lines.push('');
      lines.push('（本提示词由“影视画面分析器”面板自动生成。）');
      return lines.join('\n');
    }

    function asNumberOrDash(value) {
      const parsed = asFiniteNumber(value);
      return parsed === null ? '—' : String(parsed);
    }

    async function generatePrompt() {
      const text = buildPromptText();
      store.set((state) => ({ ...state, prompt: text }));
      flash('success', T('status.promptReady'));
      return text;
    }

    function setPromptText(text) {
      store.set((state) => ({ ...state, prompt: asString(text) }));
    }

    function buildReportMarkdown() {
      const state = store.getSnapshot();
      const dimensions = dimensionsOf(state);
      const lines = [];
      const title = state.image ? `${T('report.title')} · ${state.image.name || baseName(state.image.path)}` : T('report.title');
      lines.push(`# ${title}`);
      lines.push('');
      lines.push(`> ${T('report.generatedAt')}：${new Date().toLocaleString()}`);
      lines.push('');
      lines.push(`## ${T('report.sectionMaterial')}`);
      if (state.image) {
        lines.push(`- ${T('report.imagePath')}：\`${state.image.path || ''}\``);
        if (state.image.url) lines.push(`- ${T('report.previewUrl')}：${assetUrl(state.image.url)}`);
      }
      if (state.video) {
        lines.push(`- ${T('report.videoPath')}：\`${state.video.path || ''}\``);
        const probe = state.video.probe;
        if (probe) {
          lines.push(
            `- ${T('report.videoMeta')}：${asNumberOrDash(probe.width)}×${asNumberOrDash(probe.height)} · ${asString(probe.aspectLabel) || '—'} · ${asString(probe.durationLabel) || formatSeconds(probe.duration)} · ${asNumberOrDash(probe.fps)} fps · ${asString(probe.codec) || '—'}`,
          );
          lines.push(
            `- ${T('report.videoAudio')}：${probe.hasAudio ? `${asString(probe.audioCodec) || '—'} ${asNumberOrDash(probe.channels)}ch/${asNumberOrDash(probe.sampleRate)}Hz` : T('report.videoNoAudio')}`,
          );
        }
        if (state.video.frames.length > 0) lines.push(`- ${T('report.frames')}：${state.video.frames.length}`);
        if (state.video.contactSheet) lines.push(`- ${T('report.contactSheet')}：${assetUrl(state.video.contactSheet.url)}`);
      }
      if (!state.image && !state.video) lines.push(`- ${T('report.noMaterial')}`);
      lines.push('');
      lines.push(`## ${T('report.sectionMetrics')}`);
      if (state.metrics) {
        const metrics = state.metrics;
        lines.push(`| ${T('report.metricName')} | ${T('report.metricValue')} |`);
        lines.push('| --- | --- |');
        lines.push(`| ${T('metrics.width')} | ${asNumberOrDash(metrics.width)} |`);
        lines.push(`| ${T('metrics.height')} | ${asNumberOrDash(metrics.height)} |`);
        lines.push(`| ${T('metrics.aspect')} | ${asString(metrics.aspectLabel) || asNumberOrDash(metrics.aspectRatio)} |`);
        lines.push(`| ${T('metrics.meanLuma')} | ${asNumberOrDash(metrics.meanLuma)}${asString(metrics.contrastLevel) ? `（${metrics.contrastLevel}）` : ''} |`);
        lines.push(`| ${T('metrics.contrast')} | ${asNumberOrDash(metrics.rmsContrast)} |`);
        lines.push(`| ${T('metrics.colorTemp')} | ${asNumberOrDash(metrics.colorTempRB)}${asString(metrics.colorTempLabel) ? `（${metrics.colorTempLabel}）` : ''} |`);
        lines.push(`| ${T('metrics.saturation')} | ${asNumberOrDash(metrics.saturationMean)} |`);
        lines.push(`| ${T('metrics.edge')} | ${asNumberOrDash(metrics.edgeDensity)}${asFiniteNumber(metrics.edgeRatio) !== null ? `（${T('metrics.edgeRatio')} ${asNumberOrDash(metrics.edgeRatio)}%）` : ''} |`);
        lines.push('');
        if (Array.isArray(metrics.histogram) && metrics.histogram.length > 0) {
          lines.push(`### ${T('metrics.histogram')}`);
          lines.push('');
          lines.push(metrics.histogram.map((bin) => `${asNumberOrDash(bin.bin)}: ${asNumberOrDash(bin.count)}`).join(' · '));
          lines.push('');
        }
      } else {
        lines.push(T('metrics.empty'));
        lines.push('');
      }
      lines.push(`### ${T('metrics.palette')}`);
      if (state.palette && state.palette.colors.length > 0) {
        lines.push('');
        lines.push(`| ${T('report.paletteColor')} | ${T('metrics.share')} |`);
        lines.push('| --- | --- |');
        for (const color of state.palette.colors) {
          lines.push(`| \`${color.hex}\` | ${formatPercent(color.share, 1)} |`);
        }
      } else {
        lines.push(T('metrics.paletteEmpty'));
      }
      lines.push('');
      lines.push(`## ${T('report.sectionDimensions')}`);
      lines.push('');
      lines.push(`| ${T('report.dimension')} | ${T('render.term')} | ${T('render.basis')} | ${T('render.intent')} | ${T('render.cite')} |`);
      lines.push('| --- | --- | --- | --- | --- |');
      for (const dimension of dimensions) {
        const entry = formEntryOf(state, dimension.key);
        lines.push(`| ${escapeMarkdownCell(dimension.label)} | ${escapeMarkdownCell(entry.term)} | ${escapeMarkdownCell(entry.basis)} | ${escapeMarkdownCell(entry.intent)} | ${escapeMarkdownCell(entry.cite)} |`);
      }
      lines.push('');
      lines.push(`## ${T('report.sectionFramework')}`);
      lines.push('');
      lines.push(buildFrameworkSummary());
      lines.push('');
      const films = state.knowledge && state.knowledge.data ? state.knowledge.data.films : [];
      if (Array.isArray(films) && films.length > 0) {
        lines.push(`### ${T('report.films')}`);
        lines.push('');
        for (const film of films.slice(0, 40)) {
          if (!isRecord(film)) continue;
          const filmTitle = asString(film.title);
          if (filmTitle === '') continue;
          lines.push(`- 《${filmTitle}》${asString(film.use) ? `：${asString(film.use)}` : ''}${asString(film.cite) ? `（${asString(film.cite)}）` : ''}`);
        }
        lines.push('');
      }
      lines.push(`## ${T('report.sectionAnnotation')}`);
      lines.push('');
      lines.push(`- ${T('annotate.list')}：${annotationCount(state.annotation)} ${T('report.items')}`);
      lines.push(`- ${T('report.hostOverlay')}：${state.annotation.hostUrl ? assetUrl(state.annotation.hostUrl) : T('report.none')}`);
      lines.push('');
      if (state.ocr && state.ocr.lines.length > 0) {
        lines.push(`## ${T('report.sectionOcr')}`);
        lines.push('');
        lines.push('```text');
        lines.push(state.ocr.text || state.ocr.lines.map((line) => line.text).join('\n'));
        lines.push('```');
        lines.push('');
      }
      const shotRows = state.shots.filter((shot) => CSV_FIELDS.some((field) => asString(shot[field]) !== ''));
      if (shotRows.length > 0) {
        lines.push(`## ${T('report.sectionShots')}`);
        lines.push('');
        lines.push(`| ${CSV_HEADERS.join(' | ')} |`);
        lines.push(`| ${CSV_FIELDS.map(() => '---').join(' | ')} |`);
        for (const shot of shotRows) {
          lines.push(`| ${CSV_FIELDS.map((field) => escapeMarkdownCell(shot[field])).join(' | ')} |`);
        }
        lines.push('');
      }
      lines.push('---');
      lines.push(T('report.footer'));
      return lines.join('\n');
    }

    function buildShotsCsv() {
      const rows = [CSV_HEADERS.slice()];
      for (const shot of store.getSnapshot().shots) {
        rows.push(CSV_FIELDS.map((field) => asString(shot[field])));
      }
      const body = rows.map((row) => row.map(csvEscapeCell).join(',')).join('\r\n');
      return `\uFEFF${body}\r\n`;
    }

    function exportReport() {
      try {
        downloadText(`film-analysis-report-${fileStamp()}.md`, buildReportMarkdown(), 'text/markdown;charset=utf-8');
        flash('success', T('status.reportSaved'));
      } catch (error) {
        fail(error);
      }
    }

    function exportShotsCsv() {
      try {
        downloadText(`film-analysis-shot-list-${fileStamp()}.csv`, buildShotsCsv(), 'text/csv;charset=utf-8');
        flash('success', T('status.csvSaved'));
      } catch (error) {
        fail(error);
      }
    }

    async function copyWithFeedback(text, container) {
      const copied = await copyTextToClipboard(text, container);
      if (copied) flash('success', T('status.copied'));
      else flash('error', T('common.copyFailed'));
      return copied;
    }

    // =========================================================================
    // 4. 样式（全部来自主题变量；图片/色板/画布标注为允许的例外）
    // =========================================================================

    const STYLE_TEXT = `
.fa-root {
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  box-sizing: border-box;
}
.fa-root *, .fa-root *::before, .fa-root *::after { box-sizing: border-box; }
.fa-root button, .fa-root input, .fa-root select, .fa-root textarea { font-family: inherit; }
/* ---- 全页入口 ---- */
.fa-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}
.fa-view-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px clamp(14px, 3.5vw, 40px) 48px;
  overscroll-behavior: contain;
}
.fa-view-head { max-width: 1040px; margin: 0 auto 14px; }
.fa-view-head-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fa-view-title { font-size: 20px; font-weight: 600; margin: 0; }
.fa-view-sub { color: var(--dsw-alias-label-secondary); font-size: 13px; margin-top: 4px; }
/* ---- dock 入口 ---- */
.fa-dock { width: 100%; background: var(--dsw-alias-bg-base); }
.fa-dock-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 3px 10px;
}
.fa-dock-thumb {
  width: 26px;
  height: 26px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  flex: none;
  display: block;
}
.fa-dock-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
  flex: none;
}
.fa-dock-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); flex: none; }
.fa-dock-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.fa-dock-body {
  max-height: 60vh;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 10px 12px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
/* ---- 主面板 ---- */
.fa-panel { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
.fa-panel-status { max-width: 1040px; margin: 0 auto 10px; }
/* ---- 折叠区块 ---- */
.fa-section {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.fa-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 12px;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fa-section-head:hover { background: var(--dsw-alias-bg-layer-2); }
.fa-section-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.fa-section-caret { width: 12px; flex: none; color: var(--dsw-alias-label-secondary); }
.fa-section-title { font-weight: 600; font-size: 13px; flex: none; }
.fa-section-summary {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fa-section-body {
  padding: 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fa-stack { display: flex; flex-direction: column; gap: 8px; }
.fa-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fa-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 640px) { .fa-grid2 { grid-template-columns: minmax(0, 1fr); } }
.fa-grow { flex: 1; min-width: 180px; }
.fa-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.fa-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; }
.fa-divider { height: 1px; background: var(--dsw-alias-border-l1); margin: 2px 0; }
/* ---- 按钮 ---- */
.fa-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.fa-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); }
.fa-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.fa-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.fa-btn-primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-weight: 600;
}
.fa-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.88; }
.fa-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); background: transparent; }
.fa-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.fa-btn-ghost { background: transparent; border-color: transparent; }
.fa-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
.fa-btn-sm { min-height: 24px; padding: 2px 8px; font-size: 12px; border-radius: 6px; }
.fa-btn-active { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.fa-btn-block { width: 100%; }
.fa-link { color: var(--dsw-alias-brand-primary); text-decoration: none; cursor: pointer; }
.fa-link:hover { text-decoration: underline; }
/* ---- 表单控件 ---- */
.fa-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fa-label { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.fa-input, .fa-select, .fa-textarea {
  width: 100%;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}
.fa-input::placeholder, .fa-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.85; }
.fa-input:focus, .fa-select:focus, .fa-textarea:focus {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
  border-color: var(--dsw-alias-brand-primary);
}
.fa-textarea { resize: vertical; min-height: 54px; }
.fa-hidden-input { display: none; }
/* ---- 状态条 / 徽标 / 空态 ---- */
.fa-status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.fa-status-text { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
.fa-status-close {
  flex: none;
  background: transparent;
  border: 0;
  color: inherit;
  opacity: 0.7;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.fa-status-close:hover { opacity: 1; }
.fa-status-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.fa-status-success { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.fa-status-warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.fa-status-info { color: var(--dsw-alias-label-secondary); }
.fa-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  white-space: nowrap;
}
.fa-badge-ok { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.fa-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.fa-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 4px 0; }
.fa-empty-block {
  border: 1px dashed var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 14px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.fa-spinner {
  width: 12px;
  height: 12px;
  flex: none;
  display: inline-block;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  animation: fa-spin 0.8s linear infinite;
}
@keyframes fa-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .fa-spinner { animation: none; } }
/* ---- 导入 ---- */
.fa-drop {
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
}
.fa-drop:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.fa-drop-active { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); }
.fa-drop-hint { font-size: 13px; }
.fa-media { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fa-media-img {
  display: block;
  max-width: 100%;
  max-height: 420px;
  align-self: flex-start;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.fa-video {
  display: block;
  width: 100%;
  max-width: 720px;
  max-height: 340px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.fa-thumb-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.fa-thumb {
  width: 140px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  display: flex;
  flex-direction: column;
}
.fa-thumb-img { width: 100%; height: 78px; object-fit: cover; display: block; background: var(--dsw-alias-bg-layer-1); }
.fa-thumb-body { padding: 4px 6px 6px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.fa-thumb-time { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
/* ---- 指标 / 直方图 / 色板 ---- */
.fa-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (min-width: 760px) { .fa-metric-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.fa-metric {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 7px 9px;
  background: var(--dsw-alias-bg-layer-2);
  min-width: 0;
}
.fa-metric-label { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fa-metric-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.fa-metric-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fa-histogram { display: flex; align-items: flex-end; gap: 2px; height: 66px; padding-top: 4px; }
.fa-hist-col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 0; }
.fa-hist-bar {
  width: 100%;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--dsw-alias-brand-primary);
  opacity: 0.72;
}
.fa-hist-axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.fa-palette { display: flex; flex-wrap: wrap; gap: 6px; }
.fa-swatch { width: 76px; min-width: 0; }
.fa-swatch-color { height: 34px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); }
.fa-swatch-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); text-align: center; font-variant-numeric: tabular-nums; }
/* ---- 表单 ---- */
.fa-dim {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dsw-alias-bg-layer-2);
  min-width: 0;
}
.fa-dim-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.fa-dim-index { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: none; }
.fa-dim-title { font-weight: 600; font-size: 13px; }
.fa-dim-note { font-size: 11px; color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.fa-def {
  border-left: 2px solid var(--dsw-alias-brand-primary);
  padding: 6px 9px;
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fa-def-cite { color: var(--dsw-alias-label-secondary); font-size: 11px; }
/* ---- 标注画布 ---- */
.fa-stage-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
}
.fa-stage-img { display: block; max-width: 100%; max-height: 46vh; height: auto; user-select: none; }
.fa-stage-canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
.fa-stage-error { padding: 16px; font-size: 12px; color: var(--dsw-alias-state-error-primary); line-height: 1.5; }
.fa-ann-list { display: flex; flex-direction: column; gap: 2px; }
.fa-ann-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.fa-ann-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ---- 表格 ---- */
.fa-table-wrap { overflow-x: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.fa-table { border-collapse: collapse; width: 100%; min-width: 780px; font-size: 12px; }
.fa-table th, .fa-table td {
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
  padding: 0;
  text-align: left;
  vertical-align: middle;
}
.fa-table th {
  padding: 6px 8px;
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
  background: var(--dsw-alias-bg-layer-2);
  white-space: nowrap;
}
.fa-table th:last-child, .fa-table td:last-child { border-right: 0; }
.fa-table tr:last-child td { border-bottom: 0; }
.fa-cell-input {
  width: 100%;
  min-width: 64px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 0;
}
.fa-cell-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.fa-row-delete {
  color: var(--dsw-alias-state-error-primary);
  background: transparent;
  border: 0;
  padding: 6px 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.fa-row-delete:disabled { opacity: 0.4; cursor: not-allowed; }
/* ---- OCR ---- */
.fa-ocr-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 4px;
}
.fa-ocr-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.fa-ocr-line:hover { background: var(--dsw-alias-bg-layer-2); }
.fa-ocr-line:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.fa-ocr-text { flex: 1; min-width: 0; word-break: break-word; }
.fa-ocr-conf { flex: none; font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.fa-ocr-full {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 8px;
  max-height: 180px;
  overflow: auto;
  margin: 0;
}
.fa-prompt-preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.55;
}
`;

    function FaStyles() {
      return h('style', null, STYLE_TEXT);
    }

    // =========================================================================
    // 5. 通用 UI 组件
    // =========================================================================

    function FaButton(props) {
      const variant = props.variant || 'default';
      const classes = ['fa-btn'];
      if (variant === 'primary') classes.push('fa-btn-primary');
      else if (variant === 'danger') classes.push('fa-btn-danger');
      else if (variant === 'ghost') classes.push('fa-btn-ghost');
      if (props.small) classes.push('fa-btn-sm');
      if (props.block) classes.push('fa-btn-block');
      if (props.pressed) classes.push('fa-btn-active');
      return h(
        'button',
        {
          type: 'button',
          className: classes.join(' '),
          onClick: props.onClick,
          disabled: Boolean(props.disabled) || Boolean(props.busy),
          'aria-label': props.ariaLabel || props.label,
          'aria-busy': props.busy ? 'true' : undefined,
          'aria-pressed': props.pressed === undefined ? undefined : props.pressed ? 'true' : 'false',
          title: props.title || props.ariaLabel || props.label,
        },
        props.busy ? h('span', { className: 'fa-spinner', 'aria-hidden': 'true' }) : null,
        h('span', null, props.label),
      );
    }

    function FaBadge(props) {
      const classes = ['fa-badge'];
      if (props.kind === 'ok') classes.push('fa-badge-ok');
      else if (props.kind === 'warn') classes.push('fa-badge-warn');
      return h('span', { className: classes.join(' ') }, props.text);
    }

    function FaEmpty(props) {
      return h('div', { className: props.block ? 'fa-empty-block' : 'fa-empty' }, props.text);
    }

    function FaField(props) {
      return h(
        'label',
        { className: 'fa-field' },
        props.label ? h('span', { className: 'fa-label' }, props.label) : null,
        props.children,
        props.hint ? h('span', { className: 'fa-hint' }, props.hint) : null,
      );
    }

    function FaSection(props) {
      const [open, setOpen] = useState(Boolean(props.defaultOpen));
      return h(
        'section',
        { className: 'fa-section', 'data-open': open ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'fa-section-head',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: 'fa-section-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
          h('span', { className: 'fa-section-title' }, props.title),
          props.summary ? h('span', { className: 'fa-section-summary' }, props.summary) : null,
        ),
        open ? h('div', { className: 'fa-section-body' }, props.children) : null,
      );
    }

    function FaStatusBanner(props) {
      const status = props.status;
      useEffect(() => {
        if (!status) return undefined;
        const timeout = setTimeout(() => clearStatus(status.seq), status.kind === 'error' ? 15000 : 5000);
        return () => clearTimeout(timeout);
      }, [status]);
      if (!status) return null;
      return h(
        'div',
        { className: `fa-status fa-status-${status.kind}`, role: status.kind === 'error' ? 'alert' : 'status' },
        h('span', { className: 'fa-status-text' }, status.text),
        h(
          'button',
          {
            type: 'button',
            className: 'fa-status-close',
            'aria-label': props.t('common.dismiss'),
            onClick: () => clearStatus(status.seq),
          },
          '×',
        ),
      );
    }

    function FaMetric(props) {
      return h(
        'div',
        { className: 'fa-metric' },
        h('div', { className: 'fa-metric-label' }, props.label),
        h('div', { className: 'fa-metric-value' }, props.value),
        props.sub ? h('div', { className: 'fa-metric-sub' }, props.sub) : null,
      );
    }

    // =========================================================================
    // 6A. 区块：导入（拖拽 / 粘贴 / 文件选择 / 工作区路径 / 图片与视频入口）
    // =========================================================================

    function ImportSection(props) {
      const t = props.t;
      const state = props.state;
      const imageInputRef = useRef(null);
      const videoInputRef = useRef(null);
      const [dragging, setDragging] = useState(false);

      const onFilePicked = (kind) => (event) => {
        const input = event && event.target;
        const file = input && input.files && input.files.length > 0 ? input.files[0] : null;
        try {
          if (input) input.value = '';
        } catch {
          /* 某些浏览器禁止清空，可忽略 */
        }
        if (!file) return;
        if (kind === 'video') importVideoFile(file);
        else importImageFile(file);
      };

      const onDrop = (event) => {
        event.preventDefault();
        setDragging(false);
        const list = event.dataTransfer && event.dataTransfer.files;
        if (!list || list.length === 0) return;
        const file = list[0];
        if (isVideoFile(file)) importVideoFile(file);
        else if (isImageFile(file)) importImageFile(file);
        else flash('warn', t('import.unsupported'));
      };

      const onPaste = (event) => {
        const clipboard = event.clipboardData;
        const items = clipboard && clipboard.items;
        if (!items) return;
        for (const item of Array.from(items)) {
          if (item && typeof item.type === 'string' && item.type.indexOf('image/') === 0) {
            const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
            if (file) {
              event.preventDefault();
              importImageFile(file);
              return;
            }
          }
        }
      };

      const image = state.image;
      const video = state.video;
      const summaryParts = [];
      if (image) summaryParts.push(t('import.summaryImage'));
      if (video) summaryParts.push(t('import.summaryVideo'));
      const summary = summaryParts.join(' · ');

      const renderImageCard = () => {
        if (!image) return h('div', { className: 'fa-hint' }, t('import.noImage'));
        return h(
          'div',
          { className: 'fa-media' },
          h(
            'div',
            { className: 'fa-row' },
            h('span', { className: 'fa-label' }, t('import.currentImage')),
            h('span', { className: 'fa-hint' }, image.name || baseName(image.path)),
            h(FaButton, { label: t('common.remove'), variant: 'ghost', small: true, onClick: removeImage }),
          ),
          image.url ? h('img', { className: 'fa-media-img', src: assetUrl(image.url), alt: image.name || t('import.currentImage') }) : null,
          h('div', { className: 'fa-hint fa-mono' }, image.path),
        );
      };

      const renderProbeGrid = (probe) => {
        if (!probe) return h('div', { className: 'fa-hint' }, t('video.noProbe'));
        return h(
          'div',
          { className: 'fa-metric-grid' },
          h(FaMetric, { label: t('video.resolution'), value: `${asNumberOrDash(probe.width)}×${asNumberOrDash(probe.height)}`, sub: asString(probe.aspectLabel) }),
          h(FaMetric, { label: t('video.duration'), value: asString(probe.durationLabel) || formatSeconds(probe.duration) }),
          h(FaMetric, { label: t('video.fps'), value: asNumberOrDash(probe.fps), sub: asString(probe.codec) }),
          h(FaMetric, { label: t('video.bitrate'), value: formatBitrate(probe.bitrate) || '—', sub: formatBytes(probe.sizeBytes) }),
          h(FaMetric, {
            label: t('video.audio'),
            value: probe.hasAudio ? asString(probe.audioCodec) || t('common.unknown') : t('video.audioNone'),
            sub: probe.hasAudio ? `${asNumberOrDash(probe.channels)}ch / ${asNumberOrDash(probe.sampleRate)}Hz` : '',
          }),
          h(FaMetric, { label: t('video.container'), value: asString(probe.container) || '—' }),
        );
      };

      const renderVideoCard = () => {
        if (!video) return null;
        const probe = video.probe;
        return h(
          'div',
          { className: 'fa-media' },
          h(
            'div',
            { className: 'fa-row' },
            h('span', { className: 'fa-label' }, t('import.currentVideo')),
            h('span', { className: 'fa-hint' }, video.name || baseName(video.path)),
            h(FaButton, { label: t('common.remove'), variant: 'ghost', small: true, onClick: removeVideo }),
          ),
          video.url ? h('video', { className: 'fa-video', src: assetUrl(video.url), controls: true, preload: 'metadata' }) : null,
          h('div', { className: 'fa-hint fa-mono' }, video.path),
          renderProbeGrid(probe),
          h(
            'div',
            { className: 'fa-row' },
            h(FaButton, {
              label: t('import.extractFrames'),
              busy: Boolean(state.busy.frames),
              disabled: !probe,
              onClick: extractFrames,
            }),
            h(FaButton, {
              label: t('import.contactSheet'),
              busy: Boolean(state.busy.sheet),
              disabled: !probe,
              onClick: makeContactSheet,
            }),
            h(FaButton, {
              label: t('video.reprobe'),
              variant: 'ghost',
              small: true,
              busy: Boolean(state.busy.probe),
              onClick: probeVideo,
            }),
          ),
          video.frames.length > 0
            ? h(
                'div',
                { className: 'fa-stack' },
                h('span', { className: 'fa-label' }, t('import.frames')),
                h(
                  'div',
                  { className: 'fa-thumb-grid' },
                  video.frames.map((frame) =>
                    h(
                      'div',
                      { className: 'fa-thumb', key: `${frame.index}-${frame.url}` },
                      h('img', {
                        className: 'fa-thumb-img',
                        src: assetUrl(frame.url),
                        alt: `${t('import.frames')} ${formatSeconds(frame.time)}`,
                      }),
                      h(
                        'div',
                        { className: 'fa-thumb-body' },
                        h('span', { className: 'fa-thumb-time' }, formatSeconds(frame.time)),
                        h(FaButton, {
                          label: t('import.useAsImage'),
                          variant: 'ghost',
                          small: true,
                          onClick: () => useFrameAsImage(frame),
                        }),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          video.contactSheet
            ? h(
                'div',
                { className: 'fa-media' },
                h('span', { className: 'fa-label' }, t('import.contactSheetTitle')),
                h('img', { className: 'fa-media-img', src: assetUrl(video.contactSheet.url), alt: t('import.contactSheetTitle') }),
                h(
                  'a',
                  { className: 'fa-link', href: assetUrl(video.contactSheet.url), target: '_blank', rel: 'noreferrer' },
                  t('common.open'),
                ),
              )
            : null,
        );
      };

      return h(
        FaSection,
        { t, title: t('import.title'), summary, defaultOpen: true },
        h(
          'div',
          {
            className: `fa-drop${dragging ? ' fa-drop-active' : ''}`,
            tabIndex: 0,
            role: 'button',
            'aria-label': t('import.dropAria'),
            onDragOver: (event) => {
              event.preventDefault();
              setDragging(true);
            },
            onDragLeave: () => setDragging(false),
            onDrop,
            onPaste,
          },
          h('div', { className: 'fa-drop-hint' }, t('import.dropHint')),
          h('div', { className: 'fa-hint' }, t('import.dropTypes')),
          h(
            'div',
            { className: 'fa-row' },
            h(FaButton, {
              label: t('import.chooseImage'),
              onClick: () => {
                if (imageInputRef.current) imageInputRef.current.click();
              },
              disabled: Boolean(state.busy.upload),
            }),
            h(FaButton, {
              label: t('import.chooseVideo'),
              onClick: () => {
                if (videoInputRef.current) videoInputRef.current.click();
              },
              disabled: Boolean(state.busy.upload),
            }),
          ),
          state.busy.upload
            ? h(
                'div',
                { className: 'fa-row' },
                h('span', { className: 'fa-spinner', 'aria-hidden': 'true' }),
                h('span', { className: 'fa-hint' }, t('import.busy')),
              )
            : null,
          h('input', {
            ref: imageInputRef,
            type: 'file',
            accept: 'image/*',
            className: 'fa-hidden-input',
            tabIndex: -1,
            onChange: onFilePicked('image'),
          }),
          h('input', {
            ref: videoInputRef,
            type: 'file',
            accept: 'video/*',
            className: 'fa-hidden-input',
            tabIndex: -1,
            onChange: onFilePicked('video'),
          }),
        ),
        h(
          'div',
          { className: 'fa-row' },
          h('input', {
            className: 'fa-input fa-grow',
            type: 'text',
            value: state.pathInput,
            placeholder: t('import.pathPlaceholder'),
            'aria-label': t('import.pathAria'),
            onChange: (event) => setPathInput(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') loadFromPathAuto();
            },
          }),
          h(FaButton, { label: t('import.loadImage'), disabled: Boolean(state.busy.load), onClick: () => loadFromPath('image') }),
          h(FaButton, { label: t('import.loadVideo'), disabled: Boolean(state.busy.load), onClick: () => loadFromPath('video') }),
        ),
        h('div', { className: 'fa-hint' }, t('import.sizeHint')),
        renderImageCard(),
        renderVideoCard(),
      );
    }

    // =========================================================================
    // 6B. 区块：客观测量（metrics + palette + 16 桶直方图）
    // =========================================================================

    function MeasureSection(props) {
      const t = props.t;
      const state = props.state;
      const image = state.image;
      const metrics = state.metrics;
      const palette = state.palette;
      const disabled = !image || image.path === '';
      const summary = metrics ? `${asNumberOrDash(metrics.width)}×${asNumberOrDash(metrics.height)} · ${asString(metrics.aspectLabel) || '—'}` : '';

      const renderHistogram = () => {
        if (!metrics || !Array.isArray(metrics.histogram) || metrics.histogram.length === 0) return null;
        let maxCount = 0;
        for (const bin of metrics.histogram) {
          const count = asFiniteNumber(bin && bin.count) || 0;
          if (count > maxCount) maxCount = count;
        }
        return h(
          'div',
          { className: 'fa-stack' },
          h('span', { className: 'fa-label' }, t('metrics.histogram')),
          h(
            'div',
            { className: 'fa-histogram', role: 'img', 'aria-label': t('metrics.histogramAria') },
            metrics.histogram.map((bin, index) => {
              const count = asFiniteNumber(bin && bin.count) || 0;
              const share = asFiniteNumber(bin && bin.share);
              const percent = maxCount > 0 ? Math.max(2, Math.round((count / maxCount) * 100)) : 2;
              const label = `${t('metrics.binRange', { from: index * 16, to: index * 16 + 15 })}：${count}${share !== null ? ` (${formatPercent(share, 1)})` : ''}`;
              return h(
                'div',
                { className: 'fa-hist-col', key: `bin-${index}`, title: label },
                h('div', { className: 'fa-hist-bar', style: { height: `${percent}%` }, 'aria-label': label }),
              );
            }),
          ),
          h('div', { className: 'fa-hist-axis' }, h('span', null, '0'), h('span', null, '255')),
        );
      };

      const renderPalette = () => {
        if (!palette || !Array.isArray(palette.colors) || palette.colors.length === 0) {
          return h('div', { className: 'fa-hint' }, t('metrics.paletteEmpty'));
        }
        return h(
          'div',
          { className: 'fa-palette' },
          palette.colors.map((color, index) =>
            h(
              'div',
              { className: 'fa-swatch', key: `${color.hex}-${index}`, title: `${color.hex} · ${formatPercent(color.share, 1)}` },
              h('div', { className: 'fa-swatch-color', style: { background: color.hex } }),
              h('div', { className: 'fa-swatch-meta' }, color.hex),
              h('div', { className: 'fa-swatch-meta' }, formatPercent(color.share, 1)),
            ),
          ),
        );
      };

      return h(
        FaSection,
        { t, title: t('metrics.title'), summary, defaultOpen: true },
        h(
          'div',
          { className: 'fa-row' },
          h(FaButton, {
            label: t('metrics.measure'),
            variant: 'primary',
            busy: Boolean(state.busy.metrics),
            disabled: disabled,
            onClick: measureAll,
          }),
          h(
            'label',
            { className: 'fa-row' },
            h('span', { className: 'fa-label' }, t('metrics.paletteK')),
            h(
              'select',
              {
                className: 'fa-select',
                style: { width: '72px' },
                value: String(state.paletteK),
                'aria-label': t('metrics.paletteK'),
                onChange: (event) => setPaletteK(event.target.value),
              },
              [4, 6, 8, 10, 12, 16].map((value) => h('option', { key: value, value: String(value) }, String(value))),
            ),
          ),
          h(FaButton, {
            label: t('metrics.paletteMeasure'),
            busy: Boolean(state.busy.palette),
            disabled: disabled,
            onClick: measurePaletteOnly,
          }),
          disabled ? h('span', { className: 'fa-hint' }, t('metrics.disabled')) : null,
        ),
        !image
          ? h(FaEmpty, { block: true, text: t('metrics.noImage') })
          : !metrics
            ? h(FaEmpty, { block: true, text: t('metrics.empty') })
            : h(
                'div',
                { className: 'fa-metric-grid' },
                h(FaMetric, {
                  label: t('metrics.width') + ' × ' + t('metrics.height'),
                  value: `${asNumberOrDash(metrics.width)}×${asNumberOrDash(metrics.height)}`,
                  sub: asString(metrics.aspectLabel),
                }),
                h(FaMetric, {
                  label: t('metrics.aspect'),
                  value: asString(metrics.aspectLabel) || '—',
                  sub: asNumberOrDash(metrics.aspectRatio),
                }),
                h(FaMetric, {
                  label: t('metrics.meanLuma'),
                  value: asNumberOrDash(metrics.meanLuma),
                  sub: asFiniteNumber(metrics.meanLumaPercent) !== null ? `${t('metrics.meanLumaPercent')} ${asNumberOrDash(metrics.meanLumaPercent)}%` : '',
                }),
                h(FaMetric, {
                  label: t('metrics.contrast'),
                  value: asNumberOrDash(metrics.rmsContrast),
                  sub: asString(metrics.contrastLevel),
                }),
                h(FaMetric, {
                  label: t('metrics.colorTemp'),
                  value: asNumberOrDash(metrics.colorTempRB),
                  sub: asString(metrics.colorTempLabel),
                }),
                h(FaMetric, {
                  label: t('metrics.saturation'),
                  value: asNumberOrDash(metrics.saturationMean),
                }),
                h(FaMetric, {
                  label: t('metrics.edge'),
                  value: asNumberOrDash(metrics.edgeDensity),
                  sub: asFiniteNumber(metrics.edgeRatio) !== null ? `${t('metrics.edgeRatio')} ${asNumberOrDash(metrics.edgeRatio)}%` : '',
                }),
                h(FaMetric, {
                  label: t('metrics.palette'),
                  value: palette && Array.isArray(palette.colors) ? String(palette.colors.length) : '—',
                  sub: palette && Array.isArray(palette.colors) ? palette.colors.slice(0, 3).map((item) => item.hex).join(' ') : '',
                }),
              ),
        renderHistogram(),
        h('div', { className: 'fa-stack' }, h('span', { className: 'fa-label' }, t('metrics.palette')), renderPalette()),
      );
    }

    // =========================================================================
    // 6C. 区块：八维分析表单（术语 / 依据 / 意图 / 页码引用 / 定义内联展开）
    // =========================================================================

    function AnalysisFormSection(props) {
      const t = props.t;
      const state = props.state;
      const knowledge = state.knowledge;
      const dimensions = dimensionsOf(state);
      const [openDefinitions, setOpenDefinitions] = useState({});
      const [resetArmed, setResetArmed] = useState(false);

      useEffect(() => {
        if (!resetArmed) return undefined;
        const timer = setTimeout(() => setResetArmed(false), 3000);
        return () => clearTimeout(timer);
      }, [resetArmed]);

      let filled = 0;
      for (const dimension of dimensions) {
        if (isEntryFilled(formEntryOf(state, dimension.key))) filled += 1;
      }
      const summary = filled > 0 ? t('form.progress', { done: filled, total: dimensions.length }) : '';

      const renderKnowledgeStatus = () => {
        if (knowledge.loading) {
          return h(
            'div',
            { className: 'fa-row' },
            h('span', { className: 'fa-spinner', 'aria-hidden': 'true' }),
            h('span', { className: 'fa-hint' }, t('form.knowledgeLoading')),
          );
        }
        if (knowledge.error) {
          return h(
            'div',
            { className: 'fa-status fa-status-warn' },
            h('span', { className: 'fa-status-text' }, `${t('form.knowledgeFailed')}：${knowledge.error}`),
            h(FaButton, { label: t('common.retry'), small: true, onClick: () => ensureKnowledge(true) }),
          );
        }
        return h('div', { className: 'fa-hint' }, t('form.knowledgeNote'));
      };

      const renderDefinition = (dimension, entry) => {
        const selected = selectedTermOf(dimension, entry);
        if (!selected || selected.definition === '') return null;
        const key = `${dimension.key}-${selected.term}`;
        const open = Boolean(openDefinitions[key]);
        return h(
          'div',
          { className: 'fa-stack' },
          h(
            'div',
            { className: 'fa-row' },
            h(FaButton, {
              label: open ? t('form.hideDefinition') : t('form.viewDefinition'),
              variant: 'ghost',
              small: true,
              pressed: open,
              onClick: () =>
                setOpenDefinitions((previous) => ({
                  ...previous,
                  [key]: !previous[key],
                })),
            }),
          ),
          open
            ? h(
                'div',
                { className: 'fa-def' },
                h('div', null, selected.definition),
                selected.cite ? h('div', { className: 'fa-def-cite' }, `${t('form.citeLabel')}：${selected.cite}`) : null,
                selected.exam ? h('div', { className: 'fa-def-cite' }, `${t('form.exam')}：${selected.exam}`) : null,
              )
            : null,
        );
      };

      return h(
        FaSection,
        { t, title: t('form.title'), summary, defaultOpen: true },
        renderKnowledgeStatus(),
        h(
          'div',
          { className: 'fa-row' },
          h(FaBadge, { text: summary || t('form.notStarted'), kind: filled === dimensions.length && filled > 0 ? 'ok' : undefined }),
          h(
            'button',
            {
              type: 'button',
              className: resetArmed ? 'fa-btn fa-btn-sm fa-btn-danger' : 'fa-btn fa-btn-sm fa-btn-ghost',
              onClick: () => {
                if (resetArmed) {
                  resetForm();
                  setResetArmed(false);
                } else {
                  setResetArmed(true);
                }
              },
            },
            resetArmed ? t('form.resetConfirm') : t('form.reset'),
          ),
        ),
        dimensions.map((dimension, index) => {
          const entry = formEntryOf(state, dimension.key);
          const entryFilled = isEntryFilled(entry);
          return h(
            'div',
            { className: 'fa-dim', key: dimension.key },
            h(
              'div',
              { className: 'fa-dim-head' },
              h('span', { className: 'fa-dim-index' }, `${index + 1}.`),
              h('span', { className: 'fa-dim-title' }, dimension.label),
              dimension.note ? h('span', { className: 'fa-dim-note' }, dimension.note) : null,
              h(FaBadge, { text: entryFilled ? t('form.filled') : t('form.emptyDim'), kind: entryFilled ? 'ok' : undefined }),
            ),
            h(
              'div',
              { className: 'fa-grid2' },
              h(
                FaField,
                { label: t('form.term') },
                h(
                  'select',
                  {
                    className: 'fa-select',
                    value: entry.term,
                    disabled: dimension.terms.length === 0,
                    'aria-label': `${dimension.label} · ${t('form.term')}`,
                    onChange: (event) => {
                      const value = event.target.value;
                      updateFormField(dimension.key, 'term', value);
                      let matched = null;
                      for (const term of dimension.terms) {
                        if (term.term === value) matched = term;
                      }
                      if (matched && matched.cite) updateFormField(dimension.key, 'cite', matched.cite);
                    },
                  },
                  h('option', { value: '' }, dimension.terms.length === 0 ? t('form.noTerms') : t('form.selectTerm')),
                  dimension.terms.map((term) => h('option', { key: term.term, value: term.term }, term.term)),
                ),
              ),
              h(
                FaField,
                { label: t('form.cite') },
                h('input', {
                  className: 'fa-input',
                  type: 'text',
                  value: entry.cite,
                  placeholder: t('form.citePlaceholder'),
                  'aria-label': `${dimension.label} · ${t('form.cite')}`,
                  onChange: (event) => updateFormField(dimension.key, 'cite', event.target.value),
                }),
              ),
            ),
            renderDefinition(dimension, entry),
            h(
              FaField,
              { label: t('form.basis') },
              h('textarea', {
                className: 'fa-textarea',
                rows: 2,
                value: entry.basis,
                placeholder: t('form.basisPlaceholder'),
                'aria-label': `${dimension.label} · ${t('form.basis')}`,
                onChange: (event) => updateFormField(dimension.key, 'basis', event.target.value),
              }),
            ),
            h(
              FaField,
              { label: t('form.intent') },
              h('textarea', {
                className: 'fa-textarea',
                rows: 2,
                value: entry.intent,
                placeholder: t('form.intentPlaceholder'),
                'aria-label': `${dimension.label} · ${t('form.intent')}`,
                onChange: (event) => updateFormField(dimension.key, 'intent', event.target.value),
              }),
            ),
          );
        }),
      );
    }

    // =========================================================================
    // 6D. 区块：标注画布
    // =========================================================================

    function AnnotationStage(props) {
      const t = props.t;
      const image = props.image;
      const annotation = props.annotation;
      const wrapRef = useRef(null);
      const canvasRef = useRef(null);
      const draftRef = useRef(null);
      const draggingRef = useRef(false);
      const [size, setSize] = useState({ width: 0, height: 0 });
      const [draft, setDraft] = useState(null);
      const [imageError, setImageError] = useState(false);

      const imageUrl = image ? asString(image.url) : '';

      useEffect(() => {
        setImageError(false);
        draftRef.current = null;
        setDraft(null);
      }, [imageUrl]);

      useEffect(() => {
        const element = wrapRef.current;
        if (!element || imageUrl === '') return undefined;
        const measure = () => {
          const rect = element.getBoundingClientRect();
          const width = Math.round(rect.width);
          const height = Math.round(rect.height);
          setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
        };
        measure();
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure);
          observer.observe(element);
        } else if (typeof window !== 'undefined') {
          window.addEventListener('resize', measure);
        }
        return () => {
          if (observer) observer.disconnect();
          else if (typeof window !== 'undefined') window.removeEventListener('resize', measure);
        };
      }, [imageUrl]);

      useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || size.width <= 0 || size.height <= 0) return undefined;
        const ratio =
          typeof window !== 'undefined' && asFiniteNumber(window.devicePixelRatio) !== null
            ? Math.min(2, Math.max(1, window.devicePixelRatio))
            : 1;
        canvas.width = Math.max(1, Math.round(size.width * ratio));
        canvas.height = Math.max(1, Math.round(size.height * ratio));
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        paintAnnotations(ctx, size.width, size.height, annotation, draft);
        return undefined;
      }, [size.width, size.height, annotation, draft]);

      const updateDraft = (value) => {
        const next = typeof value === 'function' ? value(draftRef.current) : value;
        draftRef.current = next;
        setDraft(next);
      };

      const pointFromEvent = (event) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
          x: clampRatio((event.clientX - rect.left) / rect.width),
          y: clampRatio((event.clientY - rect.top) / rect.height),
        };
      };

      const onPointerDown = (event) => {
        if (!imageUrl || imageError) return;
        const point = pointFromEvent(event);
        if (!point) return;
        if (annotation.tool === 'label') {
          const text = asString(annotation.labelText).trim() || t('annotate.defaultLabel');
          addAnnotationItem('label', { x: point.x, y: point.y, text });
          return;
        }
        event.preventDefault();
        try {
          if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        } catch {
          /* 指针捕获失败时仍可拖动，只是离开元素后可能收不到事件 */
        }
        draggingRef.current = true;
        updateDraft({ kind: annotation.tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      };

      const onPointerMove = (event) => {
        if (!draggingRef.current) return;
        const point = pointFromEvent(event);
        if (!point) return;
        updateDraft((previous) => (previous ? { ...previous, x2: point.x, y2: point.y } : previous));
      };

      const finishDraft = (event) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const current = draftRef.current;
        updateDraft(null);
        try {
          if (event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === 'function' && event.pointerId !== undefined) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } catch {
          /* 忽略释放失败 */
        }
        if (!current) return;
        if (current.kind === 'box') {
          const x = Math.min(current.x1, current.x2);
          const y = Math.min(current.y1, current.y2);
          const w = Math.abs(current.x2 - current.x1);
          const h = Math.abs(current.y2 - current.y1);
          if (w < 0.015 || h < 0.015) return;
          addAnnotationItem('box', { x, y, w, h });
          return;
        }
        const length = Math.sqrt((current.x2 - current.x1) ** 2 + (current.y2 - current.y1) ** 2);
        if (length < 0.015) return;
        addAnnotationItem(current.kind, { x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 });
      };

      const cancelDraft = () => {
        draggingRef.current = false;
        updateDraft(null);
      };

      if (!imageUrl || imageError) {
        return h(
          'div',
          { className: 'fa-stage-wrap', ref: wrapRef },
          h('div', { className: 'fa-stage-error' }, imageError ? t('errors.imageLoad') : t('annotate.loadingImage')),
        );
      }

      return h(
        'div',
        { className: 'fa-stage-wrap', ref: wrapRef },
        h('img', {
          className: 'fa-stage-img',
          src: assetUrl(imageUrl),
          alt: t('annotate.canvasAria'),
          draggable: false,
          onError: () => setImageError(true),
        }),
        h('canvas', {
          className: 'fa-stage-canvas',
          ref: canvasRef,
          role: 'img',
          'aria-label': t('annotate.canvasAria'),
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: finishDraft,
          onPointerCancel: cancelDraft,
        }),
      );
    }

    function AnnotateSection(props) {
      const t = props.t;
      const state = props.state;
      const image = state.image;
      const annotation = state.annotation;
      const count = annotationCount(annotation);
      const [clearArmed, setClearArmed] = useState(false);

      useEffect(() => {
        if (!clearArmed) return undefined;
        const timer = setTimeout(() => setClearArmed(false), 3000);
        return () => clearTimeout(timer);
      }, [clearArmed]);

      const summary = count > 0 ? `${count} ${t('annotate.items')}` : '';

      const renderAnnotationList = () => {
        if (count === 0) return h('div', { className: 'fa-hint' }, t('annotate.noItems'));
        const rows = [];
        for (const box of annotation.boxes) {
          rows.push({
            kind: 'box',
            id: box.id,
            text: `${t('annotate.box')} #${box.id} · ${Math.round(box.x * 100)}%, ${Math.round(box.y * 100)}% · ${Math.round(box.w * 100)}%×${Math.round(box.h * 100)}%`,
          });
        }
        for (const line of annotation.lines) {
          rows.push({ kind: 'line', id: line.id, text: `${t('annotate.line')} #${line.id}` });
        }
        for (const arrow of annotation.arrows) {
          rows.push({ kind: 'arrow', id: arrow.id, text: `${t('annotate.arrow')} #${arrow.id}` });
        }
        for (const label of annotation.labels) {
          rows.push({ kind: 'label', id: label.id, text: `${t('annotate.label')} #${label.id} · ${label.text}` });
        }
        return h(
          'div',
          { className: 'fa-ann-list' },
          rows.map((row) =>
            h(
              'div',
              { className: 'fa-ann-row', key: `${row.kind}-${row.id}` },
              h('span', { className: 'fa-ann-text' }, row.text),
              h(
                'button',
                {
                  type: 'button',
                  className: 'fa-btn fa-btn-sm fa-btn-ghost',
                  'aria-label': `${t('common.delete')} ${row.text}`,
                  onClick: () => deleteAnnotationItem(row.kind, row.id),
                },
                '×',
              ),
            ),
          ),
        );
      };

      return h(
        FaSection,
        { t, title: t('annotate.title'), summary, defaultOpen: true },
        !image
          ? h(FaEmpty, { block: true, text: t('annotate.disabled') })
          : h(
              'div',
              { className: 'fa-stack' },
              h(
                'div',
                { className: 'fa-row' },
                TOOL_OPTIONS.map((tool) =>
                  h(FaButton, {
                    key: tool,
                    label: t(`annotate.tool.${tool}`),
                    variant: 'ghost',
                    small: true,
                    pressed: annotation.tool === tool,
                    onClick: () => setAnnotationTool(tool),
                  }),
                ),
              ),
              h(
                'div',
                { className: 'fa-row' },
                h('span', { className: 'fa-label' }, t('annotate.grid')),
                h(
                  'select',
                  {
                    className: 'fa-select',
                    style: { width: '110px' },
                    value: annotation.grid,
                    'aria-label': t('annotate.grid'),
                    onChange: (event) => setAnnotationGrid(event.target.value),
                  },
                  GRID_OPTIONS.map((grid) => h('option', { key: grid, value: grid }, t(`annotate.grid.${grid}`))),
                ),
                h(FaButton, { label: t('annotate.undo'), variant: 'ghost', small: true, disabled: count === 0, onClick: undoAnnotation }),
                h(FaButton, {
                  label: clearArmed ? t('annotate.clearConfirm') : t('annotate.clear'),
                  variant: clearArmed ? 'danger' : 'ghost',
                  small: true,
                  disabled: count === 0,
                  onClick: () => {
                    if (clearArmed) {
                      clearAnnotations();
                      setClearArmed(false);
                    } else {
                      setClearArmed(true);
                    }
                  },
                }),
              ),
              annotation.tool === 'label'
                ? h('input', {
                    className: 'fa-input',
                    type: 'text',
                    value: annotation.labelText,
                    placeholder: t('annotate.labelPlaceholder'),
                    'aria-label': t('annotate.labelText'),
                    onChange: (event) => setAnnotationLabelText(event.target.value),
                  })
                : null,
              h('div', { className: 'fa-hint' }, t(`annotate.hint.${annotation.tool}`)),
              h(AnnotationStage, { t, image, annotation }),
              h(
                'div',
                { className: 'fa-row' },
                h(FaButton, { label: t('annotate.exportPng'), busy: Boolean(state.busy.png), onClick: exportAnnotationPng }),
                h(FaButton, {
                  label: t('annotate.hostOverlay'),
                  variant: 'primary',
                  busy: Boolean(state.busy.overlay),
                  onClick: generateHostOverlay,
                }),
                h('span', { className: 'fa-hint' }, t('annotate.hostHint')),
              ),
              annotation.hostUrl
                ? h(
                    'div',
                    { className: 'fa-media' },
                    h('span', { className: 'fa-label' }, t('annotate.hostResult')),
                    h('img', { className: 'fa-media-img', src: assetUrl(annotation.hostUrl), alt: t('annotate.hostResult') }),
                    annotation.hostPath ? h('div', { className: 'fa-hint fa-mono' }, annotation.hostPath) : null,
                    h('a', { className: 'fa-link', href: assetUrl(annotation.hostUrl), target: '_blank', rel: 'noreferrer' }, t('common.open')),
                  )
                : null,
              renderAnnotationList(),
            ),
      );
    }

    // =========================================================================
    // 6E. 区块：生成结构化提示词（复制 / 填入输入框 / 填入并发送）
    // =========================================================================

    function PromptSection(props) {
      const t = props.t;
      const state = props.state;
      const inputActions = props.inputActions;
      const containerRef = props.containerRef;
      const prompt = state.prompt;

      const handleFill = () => {
        if (asString(prompt).trim() === '') {
          flash('warn', t('status.needPrompt'));
          return;
        }
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          flash('warn', t('errors.noInputActions'));
          return;
        }
        inputActions.setDraft(prompt);
        flash('success', t('status.promptFilled'));
      };

      const handleFillAndSend = () => {
        if (asString(prompt).trim() === '') {
          flash('warn', t('status.needPrompt'));
          return;
        }
        if (!inputActions || typeof inputActions.setDraft !== 'function' || typeof inputActions.submit !== 'function') {
          flash('warn', t('errors.noInputActions'));
          return;
        }
        inputActions.setDraft(prompt);
        setTimeout(() => {
          try {
            inputActions.submit();
          } catch (error) {
            fail(error);
          }
        }, 120);
        flash('success', t('status.promptSent'));
      };

      const copyPrompt = () => copyWithFeedback(prompt, containerRef && containerRef.current);

      const summary = prompt ? t('prompt.ready') : '';

      return h(
        FaSection,
        { t, title: t('prompt.title'), summary, defaultOpen: true },
        h('div', { className: 'fa-hint' }, t('prompt.hint')),
        h(
          'div',
          { className: 'fa-row' },
          h(FaButton, {
            label: prompt ? t('prompt.regenerate') : t('prompt.generate'),
            variant: 'primary',
            onClick: () => generatePrompt(),
          }),
          h(FaButton, { label: t('prompt.copy'), variant: 'ghost', small: true, disabled: !prompt, onClick: copyPrompt }),
          h(FaButton, { label: t('prompt.fill'), disabled: !prompt, onClick: handleFill }),
          h(FaButton, { label: t('prompt.fillSend'), variant: 'primary', disabled: !prompt, onClick: handleFillAndSend }),
        ),
        prompt
          ? h(
              'div',
              { className: 'fa-stack' },
              h('span', { className: 'fa-hint' }, t('prompt.editHint')),
              h('textarea', {
                className: 'fa-textarea fa-prompt-preview',
                rows: 12,
                value: prompt,
                'aria-label': t('prompt.title'),
                onChange: (event) => setPromptText(event.target.value),
              }),
            )
          : h(FaEmpty, { block: true, text: t('prompt.empty') }),
      );
    }

    // =========================================================================
    // 6F. 区块：导出（Markdown 报告 + 分镜/镜头表 CSV）
    // =========================================================================

    function ExportSection(props) {
      const t = props.t;
      const state = props.state;
      const shots = state.shots;
      let hasShotContent = false;
      for (const shot of shots) {
        for (const field of CSV_FIELDS) {
          if (asString(shot[field]) !== '') {
            hasShotContent = true;
          }
        }
      }
      const summary = hasShotContent ? t('export.rowsSummary', { count: shots.length }) : '';
      return h(
        FaSection,
        { t, title: t('export.title'), summary, defaultOpen: true },
        h(
          'div',
          { className: 'fa-stack' },
          h('span', { className: 'fa-label' }, t('export.report')),
          h('div', { className: 'fa-hint' }, t('export.reportHint')),
          h(
            'div',
            { className: 'fa-row' },
            h(FaButton, { label: t('export.downloadReport'), variant: 'primary', onClick: exportReport }),
          ),
        ),
        h('div', { className: 'fa-divider' }),
        h(
          'div',
          { className: 'fa-stack' },
          h('span', { className: 'fa-label' }, t('export.shots')),
          h('div', { className: 'fa-hint' }, t('export.shotsHint')),
          h(
            'div',
            { className: 'fa-table-wrap' },
            h(
              'table',
              { className: 'fa-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  CSV_FIELDS.map((field) => h('th', { key: field }, t(`csv.${field}`))),
                  h('th', null, t('export.actions')),
                ),
              ),
              h(
                'tbody',
                null,
                shots.length === 0
                  ? h('tr', null, h('td', { colSpan: CSV_FIELDS.length + 1, className: 'fa-empty' }, t('export.emptyShots')))
                  : shots.map((shot, index) =>
                      h(
                        'tr',
                        { key: index },
                        CSV_FIELDS.map((field) =>
                          h(
                            'td',
                            { key: field },
                            h('input', {
                              className: 'fa-cell-input',
                              type: 'text',
                              value: asString(shot[field]),
                              'aria-label': `${t(`csv.${field}`)} · ${t('export.rowAria', { index: index + 1 })}`,
                              onChange: (event) => updateShot(index, field, event.target.value),
                            }),
                          ),
                        ),
                        h(
                          'td',
                          null,
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'fa-row-delete',
                              'aria-label': t('export.deleteRow'),
                              onClick: () => removeShotRow(index),
                            },
                            '×',
                          ),
                        ),
                      ),
                    ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'fa-row' },
            h(FaButton, { label: t('export.addRow'), disabled: shots.length >= MAX_SHOT_ROWS, onClick: addShotRow }),
            h(FaButton, { label: t('export.downloadCsv'), onClick: exportShotsCsv }),
          ),
        ),
      );
    }

    // =========================================================================
    // 6G. 区块：画面文字识别（OCR）
    // =========================================================================

    function OcrSection(props) {
      const t = props.t;
      const state = props.state;
      const containerRef = props.containerRef;
      const image = state.image;
      const ocr = state.ocr;
      const summary = ocr ? t('ocr.count', { count: ocr.lines.length }) : '';
      const confidenceText = (confidence) => {
        const value = asFiniteNumber(confidence);
        if (value === null) return '';
        const percent = value <= 1 ? value * 100 : value;
        return `${Math.round(percent)}%`;
      };
      const copyAll = () =>
        copyWithFeedback(ocr ? asString(ocr.text) || ocr.lines.map((line) => line.text).join('\n') : '', containerRef && containerRef.current);

      return h(
        FaSection,
        { t, title: t('ocr.title'), summary, defaultOpen: true },
        h('div', { className: 'fa-hint' }, t('ocr.hint')),
        h(
          'div',
          { className: 'fa-row' },
          h(FaButton, {
            label: t('ocr.run'),
            variant: 'primary',
            busy: Boolean(state.busy.ocr),
            disabled: !image || image.path === '',
            onClick: runOcr,
          }),
          h('span', { className: 'fa-hint' }, t('ocr.lang')),
          ocr ? h(FaBadge, { text: t('ocr.count', { count: ocr.lines.length }) }) : null,
          ocr && ocr.lines.length > 0
            ? h(FaButton, { label: t('ocr.copyAll'), variant: 'ghost', small: true, onClick: copyAll })
            : null,
        ),
        !image
          ? h(FaEmpty, { block: true, text: t('ocr.disabled') })
          : !ocr
            ? h('div', { className: 'fa-hint' }, t('ocr.empty'))
            : h(
                'div',
                { className: 'fa-stack' },
                ocr.lines.length === 0
                  ? h(FaEmpty, { text: t('ocr.noLines') })
                  : h(
                      'div',
                      { className: 'fa-ocr-list' },
                      ocr.lines.map((line, index) =>
                        h(
                          'button',
                          {
                            key: `${index}-${line.text}`,
                            type: 'button',
                            className: 'fa-ocr-line',
                            'aria-label': t('ocr.lineAria'),
                            title: t('ocr.lineAria'),
                            onClick: () => copyWithFeedback(line.text, containerRef && containerRef.current),
                          },
                          h('span', { className: 'fa-ocr-text' }, line.text),
                          line.confidence !== null && line.confidence !== undefined
                            ? h('span', { className: 'fa-ocr-conf' }, confidenceText(line.confidence))
                            : null,
                        ),
                      ),
                    ),
                ocr.text ? h('pre', { className: 'fa-ocr-full' }, ocr.text) : null,
              ),
      );
    }

    // =========================================================================
    // 7. 组合组件与两个入口
    // =========================================================================

    function AnalysisPanel(props) {
      const t = props.t;
      const state = useStoreValue();
      const panelRef = useRef(null);
      useEffect(() => {
        ensureKnowledge(false);
        return undefined;
      }, []);
      return h(
        'div',
        { className: 'fa-panel', ref: panelRef },
        h(FaStatusBanner, { t, status: state.status }),
        h(ImportSection, { t, state }),
        h(MeasureSection, { t, state }),
        h(AnalysisFormSection, { t, state }),
        h(AnnotateSection, { t, state }),
        h(PromptSection, { t, state, inputActions: props.inputActions, containerRef: panelRef }),
        h(ExportSection, { t, state }),
        h(OcrSection, { t, state, containerRef: panelRef }),
      );
    }

    function AnalysisView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const state = useStoreValue();
      const badges = [];
      if (state.image) badges.push(h(FaBadge, { key: 'image', text: t('view.badgeImage'), kind: 'ok' }));
      if (state.video) badges.push(h(FaBadge, { key: 'video', text: t('view.badgeVideo') }));
      return h(
        'div',
        { className: 'fa-root fa-view' },
        h(FaStyles),
        h(
          'div',
          { className: 'fa-view-scroll' },
          h(
            'header',
            { className: 'fa-view-head' },
            h('div', { className: 'fa-view-head-row' }, h('h1', { className: 'fa-view-title' }, t('view.title')), badges),
            h('div', { className: 'fa-view-sub' }, t('view.subtitle')),
          ),
          h(AnalysisPanel, { t, inputActions: props.inputActions }),
        ),
      );
    }

    function AnalysisDock(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const state = useStoreValue();
      const [open, setOpen] = useState(false);
      const image = state.image;
      const summaryParts = [];
      if (image) summaryParts.push(image.name || baseName(image.path));
      else if (state.video) summaryParts.push(state.video.name || baseName(state.video.path));
      else summaryParts.push(t('dock.noMaterial'));
      if (state.metrics) summaryParts.push(`${asNumberOrDash(state.metrics.width)}×${asNumberOrDash(state.metrics.height)}`);
      const summary = summaryParts.join(' · ');
      return h(
        'div',
        { className: 'fa-root fa-dock' },
        h(FaStyles),
        h(
          'div',
          { className: 'fa-dock-row' },
          image && image.url
            ? h('img', { className: 'fa-dock-thumb', src: assetUrl(image.url), alt: '' })
            : h('span', { className: 'fa-dock-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'fa-dock-label' }, t('dock.title')),
          h('span', { className: 'fa-dock-summary' }, summary),
          h(FaButton, {
            label: open ? t('dock.collapse') : t('dock.expand'),
            variant: 'ghost',
            small: true,
            onClick: () => setOpen((value) => !value),
          }),
        ),
        open
          ? h('div', { className: 'fa-dock-body' }, h(AnalysisPanel, { t, inputActions: props.inputActions }))
          : null,
      );
    }

    // =========================================================================
    // 8. locale 词典（zh / en 键集合完全一致，所有可见文案均经 t() 输出）
    // =========================================================================

    const DICT_ZH = {
      'annotate.arrow': '箭头',
      'annotate.box': '方框',
      'annotate.canvasAria': '画面标注画布',
      'annotate.clear': '清除全部',
      'annotate.clearConfirm': '再次点击确认清除',
      'annotate.defaultLabel': '标签',
      'annotate.disabled': '导入图片后可在画面上标注',
      'annotate.exportPng': '导出标注 PNG',
      'annotate.grid': '辅助线',
      'annotate.grid.golden': '黄金分割',
      'annotate.grid.none': '无',
      'annotate.grid.thirds': '三分法',
      'annotate.hint.arrow': '按住并拖动绘制箭头（视线 / 运动方向）',
      'annotate.hint.box': '按住并拖动绘制方框（景别框）',
      'annotate.hint.label': '点击画面放置文字标签',
      'annotate.hint.line': '按住并拖动绘制直线（轴线）',
      'annotate.hostHint': '由 Host 端工具链生成带标注的 PNG',
      'annotate.hostOverlay': '调用 Host 生成标注图',
      'annotate.hostResult': 'Host 标注图',
      'annotate.items': '个标注',
      'annotate.label': '文字',
      'annotate.labelPlaceholder': '输入要标注的文字（点击画面放置）',
      'annotate.labelText': '标签文字',
      'annotate.limit': '标注数量已达上限（80）',
      'annotate.line': '直线',
      'annotate.list': '标注列表',
      'annotate.loadingImage': '正在加载图片…',
      'annotate.noItems': '还没有标注',
      'annotate.title': '4 · 画面标注',
      'annotate.tool.arrow': '箭头',
      'annotate.tool.box': '方框',
      'annotate.tool.label': '文字',
      'annotate.tool.line': '直线',
      'annotate.undo': '撤销',
      'common.copyFailed': '复制失败，请手动选择文本',
      'common.delete': '删除',
      'common.dismiss': '关闭提示',
      'common.open': '打开',
      'common.remove': '移除',
      'common.retry': '重试',
      'common.unknown': '未知',
      'csv.angle': '角度和机位',
      'csv.content': '画面内容',
      'csv.duration': '时长',
      'csv.movement': '镜头运动',
      'csv.shot': '镜号',
      'csv.size': '景别',
      'csv.sound': '声音',
      'csv.time': '时间码',
      'dim.anglePosition': '角度和机位',
      'dim.anglePosition.note': '平视 / 仰拍 / 俯拍 / 机位高度与方向',
      'dim.colorPalette': '色彩色调',
      'dim.colorPalette.note': '色相、饱和度、冷暖与色彩结构',
      'dim.composition': '构图',
      'dim.composition.note': '主体位置、平衡、线条与空间分配',
      'dim.depthFocal': '景深与焦距',
      'dim.depthFocal.note': '景深、焦距、前后景关系与虚实',
      'dim.lightTone': '光线和影调',
      'dim.lightTone.note': '光比、方向、软硬与整体影调',
      'dim.cameraMovement': '镜头运动',
      'dim.cameraMovement.note': '推拉摇移跟升降与运动动机（视频或多帧）',
      'dim.shotSize': '景别',
      'dim.shotSize.note': '远景 / 全景 / 中景 / 近景 / 特写 / 大特写',
      'dim.sound': '声音线索',
      'dim.sound.note': '人声、环境声、音乐与静默的作用',
      'dock.collapse': '收起',
      'dock.expand': '展开',
      'dock.noMaterial': '尚未导入素材',
      'dock.title': '影视画面分析器',
      'errors.badResponse': 'Host 返回了无法解析的响应',
      'errors.canvasExport': '画布导出失败',
      'errors.hostError': 'Host 处理失败',
      'errors.imageLoad': '图片预览加载失败',
      'errors.network': '无法连接 Host 服务（网络错误）',
      'errors.noInputActions': '当前入口不支持写入输入框',
      'export.actions': '操作',
      'export.addRow': '添加镜头',
      'export.deleteRow': '删除本行',
      'export.downloadCsv': '下载镜头表 CSV',
      'export.downloadReport': '下载 Markdown 报告',
      'export.emptyShots': '镜头表为空，点击“添加镜头”开始',
      'export.report': 'Markdown 分析报告',
      'export.reportHint': '含素材信息、测量数据、八维分析、术语与页码引用、标注图与镜头表。',
      'export.rowAria': '第 {index} 行',
      'export.rowsSummary': '{count} 行镜头',
      'export.shots': '分镜 / 镜头表',
      'export.shotsHint': '可直接编辑；下载为 UTF-8 BOM 编码的 CSV（列：镜号、时间码、景别、角度和机位、镜头运动、画面内容、声音、时长）。',
      'export.title': '6 · 报告与镜头表',
      'form.basis': '画面依据',
      'form.basisPlaceholder': '画面中哪些证据支撑这个判断（构图、光影、色彩、人物位置…）',
      'form.cite': '页码引用',
      'form.citeLabel': '引用',
      'form.citePlaceholder': '例如 张1·印刷页 10–22',
      'form.emptyDim': '未填写',
      'form.exam': '考点',
      'form.filled': '已填写',
      'form.hideDefinition': '收起定义',
      'form.intent': '意图与效果',
      'form.intentPlaceholder': '导演 / 摄影想达到什么效果，观众感受如何',
      'form.knowledgeFailed': '教材知识库加载失败',
      'form.knowledgeLoading': '正在加载教材知识库…',
      'form.knowledgeNote': '术语、定义、页码均来自学习笔记整理的内置知识库（两本教材）。',
      'form.noTerms': '术语库未加载',
      'form.notStarted': '尚未填写',
      'form.progress': '已填写 {done} / {total}',
      'form.reset': '重置表单',
      'form.resetConfirm': '再次点击确认重置',
      'form.selectTerm': '选择术语…',
      'form.term': '术语',
      'form.title': '3 · 八维分析表单',
      'form.viewDefinition': '查看定义',
      'import.busy': '上传中…',
      'import.chooseImage': '选择图片',
      'import.chooseVideo': '选择视频',
      'import.contactSheet': '生成接触表',
      'import.contactSheetTitle': '接触表',
      'import.currentImage': '当前画面',
      'import.currentVideo': '当前视频',
      'import.dropAria': '素材拖放与粘贴区',
      'import.dropHint': '拖入图片或视频；点击此区域后可按 Ctrl+V 粘贴截图',
      'import.dropTypes': '支持 jpg / png / webp / gif / bmp；视频 mp4 / mov / mkv / webm；也可输入工作区绝对路径',
      'import.extractFrames': '抽取 6 帧',
      'import.frames': '抽帧缩略图',
      'import.loadImage': '按路径载入图片',
      'import.loadVideo': '按路径载入视频',
      'import.noImage': '尚未导入图片',
      'import.pathAria': '工作区素材绝对路径',
      'import.pathPlaceholder': '工作区绝对路径，例如 C:\\作品\\镜头01.jpg',
      'import.sizeHint': '图片 ≤ 30MB；视频 ≤ 8GB（更大的视频建议直接填绝对路径，免上传）；上传后保存在插件数据目录。',
      'import.summaryImage': '已导入图片',
      'import.summaryVideo': '已导入视频',
      'import.title': '1 · 导入素材',
      'import.tooLargeImage': '图片超过 30MB 限制',
      'import.tooLargeVideo': '视频超过 8GB 限制（更大的视频请直接用绝对路径导入，不上传）',
      'import.unsupported': '不支持的文件类型',
      'import.useAsImage': '作为当前画面',
      'metrics.aspect': '画幅比',
      'metrics.binRange': '{from}–{to}',
      'metrics.colorTemp': '色温倾向 R−B',
      'metrics.contrast': '对比度 RMS',
      'metrics.disabled': '导入图片后可测量',
      'metrics.edge': '边缘密度',
      'metrics.edgeRatio': '强边缘占比',
      'metrics.empty': '尚无测量数据，点击“重新测量”',
      'metrics.height': '高度',
      'metrics.histogram': '16 桶亮度直方图',
      'metrics.histogramAria': '亮度直方图',
      'metrics.meanLuma': '平均亮度',
      'metrics.meanLumaPercent': '亮度百分比',
      'metrics.measure': '重新测量',
      'metrics.noImage': '导入图片后可测量',
      'metrics.palette': '主色板',
      'metrics.paletteEmpty': '尚未提取色板',
      'metrics.paletteK': '色板颜色数',
      'metrics.paletteMeasure': '测量色板',
      'metrics.saturation': '饱和度均值',
      'metrics.share': '占比',
      'metrics.title': '2 · 客观测量',
      'metrics.width': '宽度',
      'ocr.copyAll': '复制全文',
      'ocr.count': '共 {count} 行',
      'ocr.disabled': '导入图片后可识别画面文字',
      'ocr.empty': '尚未识别',
      'ocr.hint': '识别画面中的字幕、招牌、片名等文字；点击识别结果可复制单行。',
      'ocr.lang': '语言：简体中文 + 英文',
      'ocr.lineAria': '复制此行文字',
      'ocr.noLines': '未识别到文字',
      'ocr.run': '识别文字',
      'ocr.title': '7 · 画面文字识别（OCR）',
      'prompt.copy': '复制',
      'prompt.editHint': '可在文本框内直接编辑，再填入输入框',
      'prompt.empty': '尚未生成提示词',
      'prompt.fill': '填入输入框',
      'prompt.fillSend': '填入并发送',
      'prompt.generate': '生成提示词',
      'prompt.hint': '把素材路径、测量数据、八维表单与两书框架拼成结构化提示词，交给会话 AI 完成最终分析。',
      'prompt.noFramework': '（知识库未加载，框架摘要为空）',
      'prompt.ready': '已生成',
      'prompt.regenerate': '重新生成',
      'prompt.title': '5 · 生成分析提示词',
      'render.basis': '画面依据',
      'render.cite': '页码引用',
      'render.intent': '意图与效果',
      'render.term': '术语',
      'report.contactSheet': '接触表',
      'report.dimension': '维度',
      'report.films': '片例',
      'report.footer': '本报告由“影视画面分析器”面板生成；页码引用以学习笔记与表单填写为准。',
      'report.frames': '已抽关键帧',
      'report.frameworkBook1': '影视视听语言',
      'report.frameworkBook2': '电影语言的语法',
      'report.generatedAt': '生成时间',
      'report.hostOverlay': 'Host 标注图',
      'report.imagePath': '图片路径',
      'report.items': '个',
      'report.metricName': '指标',
      'report.metricValue': '数值',
      'report.noMaterial': '（尚未导入素材）',
      'report.none': '未生成',
      'report.paletteColor': '颜色',
      'report.previewUrl': '预览地址',
      'report.sectionAnnotation': '画面标注',
      'report.sectionDimensions': '八维分析',
      'report.sectionFramework': '教材框架',
      'report.sectionMaterial': '素材',
      'report.sectionMetrics': '客观测量',
      'report.sectionOcr': '画面文字（OCR）',
      'report.sectionShots': '分镜 / 镜头表',
      'report.title': '影视画面分析报告',
      'report.videoAudio': '音频',
      'report.videoMeta': '视频元信息',
      'report.videoNoAudio': '无音频流',
      'report.videoPath': '视频路径',
      'status.cleared': '已清除',
      'status.copied': '已复制到剪贴板',
      'status.csvSaved': '镜头表已下载',
      'status.failed': '操作失败',
      'status.formReset': '表单已重置',
      'status.frameSelected': '已将抽帧设为当前画面',
      'status.framesDone': '抽帧完成',
      'status.importedImage': '已导入图片',
      'status.importedVideo': '已导入视频',
      'status.measured': '测量完成',
      'status.needImage': '请先导入图片',
      'status.needImagePath': '请先导入图片或使用工作区路径（Host 工具需要绝对路径）',
      'status.needPath': '请先输入工作区绝对路径',
      'status.needPrompt': '请先生成提示词',
      'status.needVideoPath': '请先导入视频或使用工作区路径',
      'status.ocrDone': 'OCR 完成',
      'status.overlayDone': '标注图已由 Host 生成',
      'status.paletteDone': '色板提取完成',
      'status.paletteFailed': '色板提取失败',
      'status.pathLoaded': '已从路径加载',
      'status.pngExported': '标注 PNG 已导出',
      'status.probed': '视频探测完成',
      'status.promptFilled': '已填入输入框',
      'status.promptReady': '提示词已生成',
      'status.promptSent': '已填入并发送',
      'status.removed': '已移除',
      'status.reportSaved': '报告已下载',
      'status.sheetDone': '接触表已生成',
      'video.audio': '音频',
      'video.audioNone': '无音频流',
      'video.bitrate': '码率',
      'video.container': '容器',
      'video.duration': '时长',
      'video.fps': '帧率',
      'video.noProbe': '尚未读取视频元信息',
      'video.reprobe': '重新探测',
      'video.resolution': '分辨率',
      'view.badgeImage': '已载入画面',
      'view.badgeVideo': '已载入视频',
      'view.subtitle': '导入画面或视频，测量光影色彩、按两本教材的八维框架拆解、在画面上标注，并把结构化提示词交给会话 AI 完成分析。',
      'view.title': '影视画面分析',
    };

    const DICT_EN = {
      'annotate.arrow': 'Arrow',
      'annotate.box': 'Frame box',
      'annotate.canvasAria': 'Frame annotation canvas',
      'annotate.clear': 'Clear all',
      'annotate.clearConfirm': 'Click again to confirm clearing',
      'annotate.defaultLabel': 'Label',
      'annotate.disabled': 'Import an image to annotate the frame',
      'annotate.exportPng': 'Export annotation PNG',
      'annotate.grid': 'Guides',
      'annotate.grid.golden': 'Golden ratio',
      'annotate.grid.none': 'None',
      'annotate.grid.thirds': 'Rule of thirds',
      'annotate.hint.arrow': 'Drag to draw an arrow (eye line / motion)',
      'annotate.hint.box': 'Drag to draw a frame box (shot size)',
      'annotate.hint.label': 'Click the frame to place a text label',
      'annotate.hint.line': 'Drag to draw a straight line (axis)',
      'annotate.hostHint': 'Rendered by the Host toolchain into a PNG',
      'annotate.hostOverlay': 'Render with Host',
      'annotate.hostResult': 'Host annotation',
      'annotate.items': 'annotations',
      'annotate.label': 'Label',
      'annotate.labelPlaceholder': 'Text to place (then click the frame)',
      'annotate.labelText': 'Label text',
      'annotate.limit': 'Annotation limit reached (80)',
      'annotate.line': 'Line',
      'annotate.list': 'Annotations',
      'annotate.loadingImage': 'Loading image…',
      'annotate.noItems': 'No annotations yet',
      'annotate.title': '4 · Frame annotation',
      'annotate.tool.arrow': 'Arrow',
      'annotate.tool.box': 'Box',
      'annotate.tool.label': 'Text',
      'annotate.tool.line': 'Line',
      'annotate.undo': 'Undo',
      'common.copyFailed': 'Copy failed — select the text manually',
      'common.delete': 'Delete',
      'common.dismiss': 'Dismiss message',
      'common.open': 'Open',
      'common.remove': 'Remove',
      'common.retry': 'Retry',
      'common.unknown': 'Unknown',
      'csv.angle': 'Angle & camera',
      'csv.content': 'Content',
      'csv.duration': 'Duration',
      'csv.movement': 'Camera movement',
      'csv.shot': 'Shot No.',
      'csv.size': 'Shot size',
      'csv.sound': 'Sound',
      'csv.time': 'Timecode',
      'dim.anglePosition': 'Angle & camera position',
      'dim.anglePosition.note': 'Eye level / low / high angle, height and direction',
      'dim.colorPalette': 'Color & palette',
      'dim.colorPalette.note': 'Hue, saturation, warm/cool and color structure',
      'dim.composition': 'Composition',
      'dim.composition.note': 'Subject placement, balance, lines and spatial division',
      'dim.depthFocal': 'Depth & focal length',
      'dim.depthFocal.note': 'Depth of field, focal length, foreground/background and focus',
      'dim.lightTone': 'Light & tonality',
      'dim.lightTone.note': 'Lighting ratio, direction, hardness and overall tonality',
      'dim.cameraMovement': 'Camera movement',
      'dim.cameraMovement.note': 'Push, pull, pan, tilt, track, crane (video / multi-frame)',
      'dim.shotSize': 'Shot size',
      'dim.shotSize.note': 'Wide / full / medium / close-up / extreme close-up',
      'dim.sound': 'Sound cues',
      'dim.sound.note': 'Dialogue, ambience, music and silence',
      'dock.collapse': 'Collapse',
      'dock.expand': 'Expand',
      'dock.noMaterial': 'No material yet',
      'dock.title': 'Film Frame Analyzer',
      'errors.badResponse': 'The Host returned an unreadable response',
      'errors.canvasExport': 'Canvas export failed',
      'errors.hostError': 'The Host failed to process the request',
      'errors.imageLoad': 'Failed to load the image preview',
      'errors.network': 'Cannot reach the Host service (network error)',
      'errors.noInputActions': 'This entry cannot write to the composer',
      'export.actions': 'Actions',
      'export.addRow': 'Add shot',
      'export.deleteRow': 'Delete row',
      'export.downloadCsv': 'Download shot list CSV',
      'export.downloadReport': 'Download Markdown report',
      'export.emptyShots': 'The shot list is empty — click Add shot.',
      'export.report': 'Markdown analysis report',
      'export.reportHint': 'Material info, measurements, eight-dimension analysis, terms with page citations, annotation image and shot list.',
      'export.rowAria': 'Row {index}',
      'export.rowsSummary': '{count} shots',
      'export.shots': 'Shot list',
      'export.shotsHint': 'Editable; downloads as UTF-8 BOM CSV (shot, timecode, shot size, angle & camera, movement, content, sound, duration).',
      'export.title': '6 · Reports & shot list',
      'form.basis': 'Visual evidence',
      'form.basisPlaceholder': 'Which visual evidence supports this judgment (composition, light, color, subject placement…)',
      'form.cite': 'Page citation',
      'form.citeLabel': 'Citation',
      'form.citePlaceholder': 'e.g. Zhang vol.1 · printed p.10–22',
      'form.emptyDim': 'Empty',
      'form.exam': 'Exam point',
      'form.filled': 'Filled',
      'form.hideDefinition': 'Hide definition',
      'form.intent': 'Intent & effect',
      'form.intentPlaceholder': 'What the director / cinematographer intended and how the audience feels',
      'form.knowledgeFailed': 'Failed to load the textbook knowledge base',
      'form.knowledgeLoading': 'Loading the textbook knowledge base…',
      'form.knowledgeNote': 'Terms, definitions and page citations come from the built-in knowledge base distilled from the study notes.',
      'form.noTerms': 'Terms not loaded',
      'form.notStarted': 'Not started',
      'form.progress': '{done} / {total} filled',
      'form.reset': 'Reset form',
      'form.resetConfirm': 'Click again to confirm reset',
      'form.selectTerm': 'Choose a term…',
      'form.term': 'Term',
      'form.title': '3 · Eight-dimension analysis',
      'form.viewDefinition': 'View definition',
      'import.busy': 'Uploading…',
      'import.chooseImage': 'Choose image',
      'import.chooseVideo': 'Choose video',
      'import.contactSheet': 'Build contact sheet',
      'import.contactSheetTitle': 'Contact sheet',
      'import.currentImage': 'Current frame',
      'import.currentVideo': 'Current video',
      'import.dropAria': 'Media drop and paste area',
      'import.dropHint': 'Drop an image or video here; click this area then press Ctrl+V to paste a screenshot',
      'import.dropTypes': 'jpg / png / webp / gif / bmp; video mp4 / mov / mkv / webm; a workspace absolute path also works',
      'import.extractFrames': 'Extract 6 frames',
      'import.frames': 'Extracted frames',
      'import.loadImage': 'Load image path',
      'import.loadVideo': 'Load video path',
      'import.noImage': 'No image imported',
      'import.pathAria': 'Workspace media absolute path',
      'import.pathPlaceholder': 'Workspace absolute path, e.g. C:\\work\\shot01.jpg',
      'import.sizeHint': 'Images ≤ 30MB; videos ≤ 8GB (for larger videos, enter an absolute path instead of uploading); uploads are stored in the plugin data directory.',
      'import.summaryImage': 'Image loaded',
      'import.summaryVideo': 'Video loaded',
      'import.title': '1 · Import material',
      'import.tooLargeImage': 'Image exceeds the 30MB limit',
      'import.tooLargeVideo': 'Video exceeds the 8GB limit (for larger videos, enter the absolute path instead of uploading)',
      'import.unsupported': 'Unsupported file type',
      'import.useAsImage': 'Use as current frame',
      'metrics.aspect': 'Aspect ratio',
      'metrics.binRange': '{from}–{to}',
      'metrics.colorTemp': 'Color temperature R−B',
      'metrics.contrast': 'Contrast RMS',
      'metrics.disabled': 'Import an image to measure',
      'metrics.edge': 'Edge density',
      'metrics.edgeRatio': 'Strong edge share',
      'metrics.empty': 'No measurements yet — click Measure',
      'metrics.height': 'Height',
      'metrics.histogram': '16-bin luma histogram',
      'metrics.histogramAria': 'Luma histogram',
      'metrics.meanLuma': 'Mean luma',
      'metrics.meanLumaPercent': 'Luma',
      'metrics.measure': 'Measure',
      'metrics.noImage': 'Import an image to measure',
      'metrics.palette': 'Palette',
      'metrics.paletteEmpty': 'No palette yet',
      'metrics.paletteK': 'Palette colors',
      'metrics.paletteMeasure': 'Measure palette',
      'metrics.saturation': 'Mean saturation',
      'metrics.share': 'Share',
      'metrics.title': '2 · Measurements',
      'metrics.width': 'Width',
      'ocr.copyAll': 'Copy all',
      'ocr.count': '{count} lines',
      'ocr.disabled': 'Import an image to read on-screen text',
      'ocr.empty': 'Not recognized yet',
      'ocr.hint': 'Recognize subtitles, signs and titles; click a line to copy it.',
      'ocr.lang': 'Language: Simplified Chinese + English',
      'ocr.lineAria': 'Copy this line',
      'ocr.noLines': 'No text recognized',
      'ocr.run': 'Recognize text',
      'ocr.title': '7 · On-screen text (OCR)',
      'prompt.copy': 'Copy',
      'prompt.editHint': 'Edit the text above before filling it into the composer',
      'prompt.empty': 'No prompt generated yet',
      'prompt.fill': 'Fill composer',
      'prompt.fillSend': 'Fill and send',
      'prompt.generate': 'Generate prompt',
      'prompt.hint': 'Combine material path, measurements, the eight-dimension form and both textbook frameworks into a structured prompt for the conversation AI.',
      'prompt.noFramework': '(knowledge base not loaded; framework summary is empty)',
      'prompt.ready': 'Ready',
      'prompt.regenerate': 'Regenerate',
      'prompt.title': '5 · Generate analysis prompt',
      'render.basis': 'Visual evidence',
      'render.cite': 'Page citation',
      'render.intent': 'Intent & effect',
      'render.term': 'Term',
      'report.contactSheet': 'Contact sheet',
      'report.dimension': 'Dimension',
      'report.films': 'Film examples',
      'report.footer': 'Generated by the Film Frame Analyzer panel; page citations follow the study notes and the form.',
      'report.frames': 'Extracted frames',
      'report.frameworkBook1': 'Film Visual & Audio Language',
      'report.frameworkBook2': 'The Grammar of Film Language',
      'report.generatedAt': 'Generated at',
      'report.hostOverlay': 'Host annotation',
      'report.imagePath': 'Image path',
      'report.items': 'items',
      'report.metricName': 'Metric',
      'report.metricValue': 'Value',
      'report.noMaterial': '(no material imported)',
      'report.none': 'Not generated',
      'report.paletteColor': 'Color',
      'report.previewUrl': 'Preview URL',
      'report.sectionAnnotation': 'Frame annotation',
      'report.sectionDimensions': 'Eight-dimension analysis',
      'report.sectionFramework': 'Textbook frameworks',
      'report.sectionMaterial': 'Material',
      'report.sectionMetrics': 'Measurements',
      'report.sectionOcr': 'On-screen text (OCR)',
      'report.sectionShots': 'Shot list',
      'report.title': 'Film Frame Analysis Report',
      'report.videoAudio': 'Audio',
      'report.videoMeta': 'Video metadata',
      'report.videoNoAudio': 'No audio stream',
      'report.videoPath': 'Video path',
      'status.cleared': 'Cleared',
      'status.copied': 'Copied to clipboard',
      'status.csvSaved': 'Shot list downloaded',
      'status.failed': 'Operation failed',
      'status.formReset': 'Form reset',
      'status.frameSelected': 'Frame set as current image',
      'status.framesDone': 'Frames extracted',
      'status.importedImage': 'Image imported',
      'status.importedVideo': 'Video imported',
      'status.measured': 'Measurement complete',
      'status.needImage': 'Import an image first',
      'status.needImagePath': 'Import an image or use a workspace path (Host tools require an absolute path)',
      'status.needPath': 'Enter a workspace absolute path first',
      'status.needPrompt': 'Generate the prompt first',
      'status.needVideoPath': 'Import a video or use a workspace path first',
      'status.ocrDone': 'OCR complete',
      'status.overlayDone': 'Host generated the annotation image',
      'status.paletteDone': 'Palette extracted',
      'status.paletteFailed': 'Palette extraction failed',
      'status.pathLoaded': 'Loaded from path',
      'status.pngExported': 'Annotation PNG exported',
      'status.probed': 'Video probed',
      'status.promptFilled': 'Filled into the composer',
      'status.promptReady': 'Prompt generated',
      'status.promptSent': 'Filled and sent',
      'status.removed': 'Removed',
      'status.reportSaved': 'Report downloaded',
      'status.sheetDone': 'Contact sheet generated',
      'video.audio': 'Audio',
      'video.audioNone': 'No audio stream',
      'video.bitrate': 'Bitrate',
      'video.container': 'Container',
      'video.duration': 'Duration',
      'video.fps': 'FPS',
      'video.noProbe': 'Video metadata not read yet',
      'video.reprobe': 'Re-probe',
      'video.resolution': 'Resolution',
      'view.badgeImage': 'Frame loaded',
      'view.badgeVideo': 'Video loaded',
      'view.subtitle': 'Import a frame or video, measure light and color, analyze it through the eight-dimension framework of both textbooks, annotate the frame, and hand a structured prompt to the conversation AI.',
      'view.title': 'Film Frame Analyzer',
    };

    // =========================================================================
    // 9. 插件注册：locale 词典 + 两个 slot 入口
    // =========================================================================

    function apply(ctx) {
      ctx.effect(() => {
        const disposeZh = ctx.locale.register(NS, 'zh', DICT_ZH);
        const disposeEn = ctx.locale.register(NS, 'en', DICT_EN);
        return () => {
          disposeEn();
          disposeZh();
        };
      }, 'film-analysis: dictionaries');

      translate = ctx.locale.bind(NS);

      ctx.effect(() => {
        const handleBeforeUnload = () => persistNow();
        try {
          window.addEventListener('beforeunload', handleBeforeUnload);
        } catch {
          /* 非浏览器环境忽略 */
        }
        return () => {
          try {
            window.removeEventListener('beforeunload', handleBeforeUnload);
          } catch {
            /* 忽略 */
          }
          if (persistTimer !== null) {
            clearTimeout(persistTimer);
            persistTimer = null;
          }
          persistNow();
        };
      }, 'film-analysis: persistence');

      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'film-analysis',
            order: 20,
            locale: NS,
            label: () => T('view.title'),
          },
          AnalysisView,
        ),
      );

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'film-analysis',
            order: 10,
            locale: NS,
            label: () => T('dock.title'),
          },
          AnalysisDock,
        ),
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
