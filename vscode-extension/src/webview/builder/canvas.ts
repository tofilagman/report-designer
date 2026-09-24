// Live HTML canvas. Renders the report the same way the PDF pipeline does (default style,
// libs, data, assets, script, Processor.js) inside a sandboxed iframe, sized to the page.
// The iframe has no same-origin access, so template scripts can't reach the VS Code API.

export interface CanvasLib {
  name: string;
  content: string;
}

export interface CanvasInput {
  code: string;
  style: string;
  script: string;
  data: string;
  assets: { id: string; data: string }[];
  documentType: string;
  landscape: boolean;
  margin: { top: string; right: string; bottom: string; left: string };
  libs: CanvasLib[];
  processor: string;
}

export interface Canvas {
  render(input: CanvasInput): void;
  select(id: string | undefined): void;
}

/** Page sizes in CSS px (96 dpi), portrait. */
const PAGE_PX: Record<string, [number, number]> = {
  A0: [3179, 4494], A1: [2245, 3179], A2: [1587, 2245], A3: [1123, 1587], A4: [794, 1123], A5: [559, 794], A6: [397, 559],
  Letter: [816, 1056], Legal: [816, 1344], Tabloid: [1056, 1632], Ledger: [1632, 1056],
};

const UNIT_PX: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

/** Same rules puppeteer uses for margin strings: a unit suffix, or px when there's none. */
export function toPx(value: string): number {
  const m = /^\s*(-?[\d.]+)\s*(px|in|cm|mm)?\s*$/i.exec(value ?? '');
  if (!m) return 0;
  return parseFloat(m[1]) * UNIT_PX[(m[2] ?? 'px').toLowerCase()];
}

const DEFAULT_STYLE = `
  body {
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;
  }
`;

const CANVAS_STYLE = `
  html { background: #fff; }
  [data-rb] { cursor: pointer; }
  [data-rb]:hover { outline: 1px dashed #4a90e2; outline-offset: 2px; }
  [data-rb].rb-selected { outline: 2px solid #1a73e8 !important; outline-offset: 2px; }
`;

// Runs inside the iframe before Processor.js. Its listeners survive Processor's script cleanup.
const BOOT = `
(function () {
  var send = function (m) { m.rb = true; parent.postMessage(m, '*'); };
  window.addEventListener('error', function (e) { send({ kind: 'error', message: e.message }); });
  var origLog = console.log, origWarn = console.warn, origError = console.error;
  console.log = function () { send({ kind: 'log', level: 'log', message: [].map.call(arguments, fmt).join(' ') }); origLog.apply(console, arguments); };
  console.warn = function () { send({ kind: 'log', level: 'warn', message: [].map.call(arguments, fmt).join(' ') }); origWarn.apply(console, arguments); };
  console.error = function () { send({ kind: 'log', level: 'error', message: [].map.call(arguments, fmt).join(' ') }); origError.apply(console, arguments); };
  function fmt(a) { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-rb]');
    if (el) { e.preventDefault(); send({ kind: 'select', id: el.getAttribute('data-rb') }); }
  }, true);
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.kind !== 'select') return;
    document.querySelectorAll('.rb-selected').forEach(function (n) { n.classList.remove('rb-selected'); });
    if (m.id) {
      var el = document.querySelector('[data-rb="' + String(m.id).replace(/"/g, '') + '"]');
      if (el) { el.classList.add('rb-selected'); if (m.scroll) el.scrollIntoView({ block: 'nearest' }); }
    }
  });
  var report = function () { send({ kind: 'size', height: document.documentElement.scrollHeight }); };
  window.__rbDone = function (ms) {
    report();
    send({ kind: 'rendered', ms: ms });
    new ResizeObserver(report).observe(document.body);
    document.querySelectorAll('img').forEach(function (img) { img.addEventListener('load', report); });
  };
})();
`;

/** Script content can't contain a closing script tag. */
const scriptSafe = (s: string) => s.replace(/<\/script/gi, '<\\/script');

export function createCanvas(
  host: HTMLElement,
  nonce: string,
  handlers: {
    onSelect(id: string): void;
    onLog(level: 'log' | 'info' | 'warn' | 'error', message: string): void;
    onRendered(ms: number): void;
  },
): Canvas {
  host.classList.add('rb-canvas');
  const scroller = document.createElement('div');
  scroller.className = 'rb-canvas-scroll';
  const sheet = document.createElement('div');
  sheet.className = 'rb-sheet';
  const guides = document.createElement('div');
  guides.className = 'rb-guides';
  const status = document.createElement('div');
  status.className = 'rb-canvas-status';
  let frame = newFrame();
  sheet.append(frame, guides);
  scroller.append(sheet);
  host.append(status, scroller);

  /** The next render loads here, hidden, and replaces `frame` once it reports in, so edits don't flash blank. */
  let pending: HTMLIFrameElement | undefined;
  let selected: string | undefined;
  let page = { width: 794, height: 1123, top: 0, bottom: 0 };
  let contentHeight = 0;
  let pendingHeight = 0;
  let frameErrors = 0;
  let started = 0;

  function newFrame() {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.className = 'rb-frame';
    f.title = 'Live report canvas';
    return f;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.rb !== true) return;
    if (pending && e.source === pending.contentWindow) {
      if (m.kind === 'size') pendingHeight = m.height;
      if (m.kind !== 'rendered' && m.kind !== 'error') return;
      // The new render is ready (or failed): swap it in.
      frame.remove();
      frame = pending;
      pending = undefined;
      frame.classList.remove('rb-pending');
      frameErrors = 0;
      contentHeight = pendingHeight;
      layout();
    } else if (e.source !== frame.contentWindow) {
      return;
    }
    switch (m.kind) {
      case 'select':
        handlers.onSelect(m.id);
        break;
      case 'size':
        contentHeight = m.height;
        layout();
        break;
      case 'rendered':
        // Keep an error from this render on screen; the page may still have partly rendered.
        if (!frameErrors) {
          status.textContent = '';
          status.hidden = true;
        }
        handlers.onRendered(Math.round(performance.now() - started));
        post({ kind: 'select', id: selected });
        break;
      case 'error':
        frameErrors++;
        showError(m.message);
        handlers.onLog('error', `Live canvas: ${m.message}`);
        break;
      case 'log':
        handlers.onLog(m.level, m.message);
        break;
    }
  });

  new ResizeObserver(() => layout()).observe(scroller);

  function post(msg: unknown) {
    frame.contentWindow?.postMessage(msg, '*');
  }

  function showError(message: string) {
    status.textContent = message;
    status.hidden = false;
  }

  /** Scales the sheet to the pane width and draws a dashed line at each page break. */
  function layout() {
    const avail = scroller.clientWidth - 32;
    const scale = Math.min(1, Math.max(0.2, avail / page.width));
    const height = Math.max(page.height, contentHeight);
    for (const f of [frame, pending]) {
      if (!f) continue;
      f.style.width = `${page.width}px`;
      f.style.height = `${f === pending ? Math.max(page.height, pendingHeight) : height}px`;
    }
    sheet.style.width = `${page.width}px`;
    sheet.style.height = `${height}px`;
    sheet.style.transform = `scale(${scale})`;
    sheet.style.marginBottom = `${-(1 - scale) * height}px`;
    sheet.style.marginRight = `${-(1 - scale) * page.width}px`;

    const perPage = page.height - page.top - page.bottom;
    const lines: string[] = [];
    if (perPage > 50) {
      for (let y = page.top + perPage, n = 1; y < height - page.bottom; y += perPage, n++) {
        lines.push(`<div class="rb-break" style="top:${y}px"><span>Page ${n + 1}</span></div>`);
      }
    }
    guides.innerHTML = lines.join('');
  }

  return {
    render(input) {
      started = performance.now();
      const [w, h] = PAGE_PX[input.documentType] ?? PAGE_PX.A4;
      const [width, height] = input.landscape ? [h, w] : [w, h];
      const m = { top: toPx(input.margin.top), right: toPx(input.margin.right), bottom: toPx(input.margin.bottom), left: toPx(input.margin.left) };
      page = { width, height, top: m.top, bottom: m.bottom };

      let data = 'undefined';
      if (input.data.trim()) {
        try {
          data = JSON.stringify(JSON.parse(input.data)).replace(/</g, '\\u003c');
        } catch (err) {
          showError(`Data is not valid JSON: ${(err as Error).message}`);
          return;
        }
      }
      const resources = JSON.stringify(Object.fromEntries(input.assets.map((a) => [a.id, a.data]))).replace(/</g, '\\u003c');
      const s = (content: string) => `<script nonce="${nonce}">${scriptSafe(content)}</script>`;

      const doc = [
        '<!DOCTYPE html><html><head><meta charset="utf-8">',
        `<style id="def-style">${DEFAULT_STYLE}</style>`,
        `<style>${CANVAS_STYLE}</style>`,
        '</head>',
        `<body style="margin:0;padding:${m.top}px ${m.right}px ${m.bottom}px ${m.left}px;box-sizing:border-box;width:${width}px">`,
        `<script type="text/x-handlebars-template" id="entry-template">${scriptSafe(input.code)}</script>`,
        input.style.trim() ? `<script type="text/x-handlebars-template" id="style-template">${scriptSafe(input.style)}</script>` : '',
        s(BOOT),
        ...input.libs.map((l) => s(l.content)),
        s(`window.processContext = ${data}; window.resourceContext = ${resources};`),
        s(input.script.trim() ? input.script : 'function appScript(){}'),
        s(input.processor),
        s(`(function(){ var t = performance.now(); try { window.processHandlebar(); } catch (e) { parent.postMessage({ rb: true, kind: 'error', message: e.message }, '*'); } window.__rbDone(performance.now() - t); })();`),
        '</body></html>',
      ].join('\n');

      // A fresh frame per render: reusing one would keep globals and helpers from the last run.
      pending?.remove();
      pending = newFrame();
      pending.classList.add('rb-pending');
      pendingHeight = 0;
      pending.srcdoc = doc;
      sheet.insertBefore(pending, guides);
      layout();
    },
    select(id) {
      selected = id;
      post({ kind: 'select', id, scroll: true });
    },
  };
}
