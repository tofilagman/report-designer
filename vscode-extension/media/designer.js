// Webview side of the Report Designer. Runs sandboxed: all file, render and network
// work happens in the extension host, reached through postMessage.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const vendor = window.RD_VENDOR;
  const DOCUMENT_TYPES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'Ledger'];
  const EDITORS = [
    { field: 'code', el: 'ed-code', language: 'handlebars' },
    { field: 'data', el: 'ed-data', language: 'json' },
    { field: 'style', el: 'ed-style', language: 'css' },
    { field: 'script', el: 'ed-script', language: 'javascript' },
  ];

  const $ = (id) => document.getElementById(id);
  const state = Object.assign({ split: 0.55, left: 'code', right: 'preview' }, vscode.getState() || {});
  const saveState = () => vscode.setState(state);

  let model = null;
  let config = null;
  let editors = {};
  /** True while applying a model from the host, so programmatic changes aren't echoed back as edits. */
  let applying = false;
  let lastPdf = null;
  let renderStarted = 0;
  let renderMs = 0;
  /** Log display timing once per render, not on every resize redraw. */
  let reportDisplay = false;

  const post = (msg) => vscode.postMessage(msg);
  /** Mirrors webview-side progress and failures into the extension's Output channel. */
  const clientLog = (level, message) => post({ type: 'clientLog', level, message });
  window.addEventListener('error', (e) => clientLog('error', `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => clientLog('error', `Unhandled: ${e.reason && e.reason.message || e.reason}`));
  const edit = (field, value) => {
    if (applying || !model) return;
    model[field] = value;
    post({ type: 'edit', field, value });
    if (field === 'name') $('title').textContent = value;
  };

  // ---------- tabs & split ----------

  function showTab(group, tab) {
    const nav = document.querySelector(`.tabs[data-group="${group}"]`);
    const panels = nav.nextElementSibling;
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    panels.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
    state[group] = tab;
    saveState();
    const ed = editors[tab];
    if (ed) requestAnimationFrame(() => ed.layout());
  }

  document.querySelectorAll('.tabs').forEach((nav) => {
    nav.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-tab]');
      if (btn) showTab(nav.dataset.group, btn.dataset.tab);
    });
  });

  function applySplit() {
    $('split').style.gridTemplateColumns = `${state.split * 100}% 6px 1fr`;
  }

  $('gutter').addEventListener('pointerdown', (ev) => {
    const split = $('split');
    const rect = split.getBoundingClientRect();
    $('gutter').setPointerCapture(ev.pointerId);
    split.classList.add('dragging');
    const move = (e) => {
      state.split = Math.min(0.85, Math.max(0.15, (e.clientX - rect.left) / rect.width));
      applySplit();
    };
    const up = () => {
      split.classList.remove('dragging');
      $('gutter').removeEventListener('pointermove', move);
      $('gutter').removeEventListener('pointerup', up);
      saveState();
      if (lastPdf) renderPdf(lastPdf);
    };
    $('gutter').addEventListener('pointermove', move);
    $('gutter').addEventListener('pointerup', up);
  });

  // ---------- toolbar ----------

  const selectedTarget = () => $('target').value || undefined;
  $('btn-preview').addEventListener('click', () => post({ type: 'preview' }));
  $('btn-publish').addEventListener('click', () => post({ type: 'publish', target: selectedTarget() }));
  $('btn-sync').addEventListener('click', () => post({ type: 'syncLibs', target: selectedTarget() }));
  $('btn-test').addEventListener('click', () => post({ type: 'testConnection', target: selectedTarget() }));
  $('btn-add-asset').addEventListener('click', () => post({ type: 'addAssets' }));
  $('btn-show-log').addEventListener('click', () => post({ type: 'showLog' }));

  // ---------- settings form ----------

  DOCUMENT_TYPES.forEach((d) => $('f-doctype').append(new Option(d, d)));

  $('f-name').addEventListener('input', (e) => edit('name', e.target.value));
  $('f-orientation').addEventListener('change', (e) => edit('landscape', e.target.value === 'landscape'));
  $('f-doctype').addEventListener('change', (e) => edit('documentType', e.target.value));
  for (const side of ['top', 'right', 'bottom', 'left']) {
    $(`f-m${side}`).addEventListener('input', () => {
      if (!model) return;
      edit('margin', { ...model.margin, [side]: $(`f-m${side}`).value.trim() || '0' });
    });
  }
  $('settings').addEventListener('submit', (e) => e.preventDefault());

  function applyModel(next) {
    model = next;
    applying = true;
    try {
      $('title').textContent = model.name;
      $('f-name').value = model.name;
      $('f-orientation').value = model.landscape ? 'landscape' : 'portrait';
      $('f-doctype').value = model.documentType;
      for (const side of ['top', 'right', 'bottom', 'left']) $(`f-m${side}`).value = model.margin[side];
      for (const { field } of EDITORS) {
        const ed = editors[field];
        if (ed && ed.getValue() !== model[field]) ed.setValue(model[field]);
      }
      renderAssets(model.assets);
    } finally {
      applying = false;
    }
  }

  // ---------- project config ----------

  function applyConfig(next) {
    config = next;
    const select = $('target');
    const previous = select.value;
    select.replaceChildren(...config.targets.map((t) => new Option(`${t.name} · ${t.url}`, t.name)));
    const keep = config.targets.some((t) => t.name === previous) ? previous : config.defaultTarget;
    if (keep) select.value = keep;
    const noTargets = config.targets.length === 0;
    select.hidden = noTargets;
    for (const id of ['btn-test', 'btn-sync', 'btn-publish']) $(id).disabled = noTargets;

    const box = $('project');
    box.replaceChildren();
    if (!config.file) {
      box.append(
        para('No report-designer.toml applies to this report. It sets the shared libraries folder and deploy targets for every report in its folder.'),
      );
      if (config.legacyUrl) box.append(para(`This file still carries a server URL from the desktop app: ${config.legacyUrl}`));
      box.append(button('Create report-designer.toml', () => post({ type: 'createConfig' })));
      return;
    }
    box.append(definition('Config', config.file));
    box.append(definition('Libraries', config.libsPath || '(not set)'));
    box.append(
      definition('Targets', config.targets.length
        ? config.targets.map((t) => `${t.name}${t.name === config.defaultTarget ? ' (default)' : ''}: ${t.url}`).join('\n')
        : '(none)'),
    );
    if (config.errors.length) {
      const ul = document.createElement('ul');
      ul.className = 'errors';
      config.errors.forEach((e) => ul.append(Object.assign(document.createElement('li'), { textContent: e })));
      box.append(ul);
    }
    box.append(button('Open report-designer.toml', () => post({ type: 'openConfig' })));
  }

  function para(text) {
    return Object.assign(document.createElement('p'), { textContent: text });
  }
  function button(text, onClick) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, className: 'secondary' });
    b.addEventListener('click', onClick);
    return b;
  }
  function definition(term, value) {
    const div = document.createElement('div');
    div.className = 'def';
    div.append(Object.assign(document.createElement('span'), { textContent: term }));
    div.append(Object.assign(document.createElement('code'), { textContent: value }));
    return div;
  }

  // ---------- assets ----------

  function renderAssets(assets) {
    const box = $('assets');
    box.replaceChildren();
    if (!assets.length) {
      box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'No images yet.' }));
      return;
    }
    for (const a of assets) {
      const card = document.createElement('figure');
      card.className = 'asset';
      const img = Object.assign(document.createElement('img'), { src: a.data, alt: '' });
      const caption = document.createElement('figcaption');
      caption.append(Object.assign(document.createElement('code'), { textContent: a.id.slice(0, 8), title: a.id }));
      const copy = button('Copy', () => post({ type: 'copyAsset', id: a.id }));
      copy.title = `Copy {{resource '${a.id}'}}`;
      const del = button('Delete', () => post({ type: 'deleteAsset', id: a.id }));
      caption.append(copy, del);
      card.append(img, caption);
      box.append(card);
    }
  }

  // ---------- preview & logs ----------

  function setStatus(text, kind) {
    const el = $('preview-status');
    el.textContent = text;
    el.className = `status ${kind || ''}`;
    el.hidden = !text;
  }

  let logCount = 0;
  let pageLogCount = 0;
  let logErrors = false;
  function clearLogs() {
    $('logs').replaceChildren();
    logCount = 0;
    pageLogCount = 0;
    logErrors = false;
    updateBadge();
  }
  function addLog(l) {
    const cls = `log ${l.level}${l.source === 'stage' ? ' stage' : ''}`;
    $('logs').append(Object.assign(document.createElement('pre'), { className: cls, textContent: l.message }));
    logCount++;
    if (l.source === 'page') pageLogCount++;
    if (l.level === 'error') logErrors = true;
    updateBadge();
  }
  /** Called once a render finishes, so an empty template log reads as a fact rather than a missing feature. */
  function noteNoPageOutput() {
    if (pageLogCount > 0) return;
    $('logs').append(Object.assign(document.createElement('pre'), {
      className: 'log note',
      textContent: 'The template wrote no console output. console.log() in the Script tab or in a helper appears here.',
    }));
  }
  function updateBadge() {
    const badge = $('log-count');
    badge.textContent = String(logCount);
    badge.hidden = logCount === 0;
    badge.classList.toggle('error', logErrors);
    badge.title = logErrors ? 'Render reported errors' : `${pageLogCount} from the template, ${logCount - pageLogCount} pipeline stages`;
  }

  const pdfjs = window.pdfjsLib;
  /**
   * Dedicated workers aren't served by the webview's resource loader, so importScripts()
   * of a webview URL from inside a worker can fail or stall. Fetch the script in the page
   * instead and start the worker from its text. If that fails, pdf.js runs on the main thread.
   */
  const pdfWorkerReady = (async () => {
    if (!pdfjs) return 'unavailable';
    const workerUrl = new URL(`${vendor.pdfjs}/pdf.worker.min.js`, document.baseURI).href;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    try {
      const res = await fetch(workerUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = new Blob([await res.text()], { type: 'text/javascript' });
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(blob));
      return 'worker';
    } catch (err) {
      clientLog('warn', `pdf.js worker unavailable (${err.message}); rendering pages on the main thread`);
      return 'main thread';
    }
  })();

  let renderToken = 0;
  async function renderPdf(bytes) {
    const token = ++renderToken;
    const pages = $('pages');
    if (!pdfjs) {
      setStatus('pdf.js failed to load; cannot show the preview.', 'error');
      return;
    }
    const started = performance.now();
    const mode = await pdfWorkerReady;
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
    const doc = await Promise.race([
      task.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`pdf.js did not open the document within 20 s (${mode})`)), 20_000)),
    ]).catch((err) => {
      task.destroy();
      throw err;
    });
    if (token !== renderToken) return doc.destroy();
    const width = pages.clientWidth - 24;
    const ratio = window.devicePixelRatio || 1;
    const canvases = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (token !== renderToken) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / ratio}px`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      canvases.push(canvas);
    }
    if (token !== renderToken) return;
    pages.replaceChildren(...canvases);
    const ms = Math.round(performance.now() - started);
    setStatus(`${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · rendered in ${renderMs} ms, displayed in ${ms} ms (pdf.js ${mode})`, 'ok');
    if (reportDisplay) {
      reportDisplay = false;
      clientLog('info', `Displayed ${doc.numPages} page(s) in ${ms} ms using pdf.js on the ${mode}`);
    }
    doc.destroy();
  }

  // Redraw only when the width changes; adding pages changes the height, which would loop.
  let resizeTimer;
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === lastWidth) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => lastPdf && renderPdf(lastPdf), 200);
  }).observe($('pages'));

  // ---------- host messages ----------

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'model':
        applyModel(msg.model);
        break;
      case 'config':
        applyConfig(msg.config);
        break;
      case 'assets':
        model.assets = msg.assets;
        renderAssets(msg.assets);
        break;
      case 'rendering':
        $('btn-preview').disabled = true;
        renderStarted = performance.now();
        clearLogs();
        setStatus('Rendering: starting…', 'busy');
        showTab('right', 'preview');
        break;
      case 'renderLog':
        addLog(msg.log);
        if (msg.log.source === 'stage') setStatus(`Rendering: ${msg.log.message}`, 'busy');
        break;
      case 'previewResult': {
        $('btn-preview').disabled = false;
        renderMs = Math.round(performance.now() - renderStarted);
        noteNoPageOutput();
        const bin = atob(msg.pdf);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        lastPdf = bytes;
        reportDisplay = true;
        setStatus(`Displaying ${Math.round(bytes.length / 1024)} KB PDF…`, 'busy');
        renderPdf(bytes).catch((err) => {
          setStatus(`Could not display PDF: ${err.message}`, 'error');
          addLog({ level: 'error', source: 'stage', message: `Display failed: ${err.message}` });
          clientLog('error', `Display failed: ${err.message}`);
        });
        break;
      }
      case 'previewError':
        $('btn-preview').disabled = false;
        addLog({ level: 'error', source: 'stage', message: msg.message });
        noteNoPageOutput();
        setStatus(msg.message, 'error');
        showTab('right', 'preview');
        break;
    }
  });

  // ---------- Monaco ----------

  function monacoTheme() {
    const c = document.body.classList;
    if (c.contains('vscode-high-contrast-light')) return 'hc-light';
    if (c.contains('vscode-high-contrast')) return 'hc-black';
    return c.contains('vscode-light') ? 'vs' : 'vs-dark';
  }

  applySplit();
  showTab('left', state.left);
  showTab('right', state.right);

  require.config({ paths: { vs: vendor.monaco } });
  require(['vs/editor/editor.main'], (loaded) => {
    const monaco = loaded && loaded.editor ? loaded : window.monaco;
    const css = getComputedStyle(document.body);
    const fontFamily = css.getPropertyValue('--vscode-editor-font-family').trim() || undefined;
    const fontSize = parseInt(css.getPropertyValue('--vscode-editor-font-size'), 10) || undefined;

    for (const { field, el, language } of EDITORS) {
      const ed = monaco.editor.create($(el), {
        language,
        theme: monacoTheme(),
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily,
        fontSize,
        tabSize: 2,
        scrollBeyondLastLine: false,
      });
      ed.onDidChangeModelContent(() => edit(field, ed.getValue()));
      editors[field] = ed;
    }

    new MutationObserver(() => monaco.editor.setTheme(monacoTheme())).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    post({ type: 'ready' });
  });
})();
