import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import puppeteer, { Browser } from 'puppeteer-core';
import type { ReportModel } from './model';

export interface RenderLog {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  /** 'page' for the template's own console output, 'stage' for pipeline progress. */
  source?: 'page' | 'stage';
}

export interface RenderOptions {
  chromePath: string;
  /** Folder of shared JS libs (from report-designer.toml). */
  libsPath?: string;
  /** Processor.js to use when libsPath doesn't provide one. */
  fallbackProcessorPath: string;
  /** JSON data to render with; defaults to the report's own sample data. */
  data?: string;
  /** Whole-render budget; on expiry the error names the stage that was running. */
  timeoutMs?: number;
  /** Receives every log line as it happens, so a hung render still shows progress. */
  onLog?: (log: RenderLog) => void;
  /** Reuse a running Chrome between renders. Without one, Chrome is launched and closed per render. */
  pool?: BrowserPool;
}

export class RenderError extends Error {
  constructor(
    message: string,
    readonly logs: RenderLog[],
  ) {
    super(message);
  }
}

const DEFAULT_STYLE = `
  body {
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;
  }
`;

const LAUNCH_ARGS = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'];

/**
 * Keeps one headless Chrome alive between previews; launching it is most of a small
 * report's render time. Closed after `idleMs` without use, or on dispose.
 */
export class BrowserPool {
  private browser?: Browser;
  private path?: string;
  private idle?: NodeJS.Timeout;

  constructor(private readonly idleMs = 5 * 60_000) {}

  async acquire(chromePath: string, timeoutMs: number): Promise<{ browser: Browser; reused: boolean }> {
    clearTimeout(this.idle);
    if (this.browser?.connected && this.path === chromePath) return { browser: this.browser, reused: true };
    await this.close();
    this.browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: LAUNCH_ARGS, timeout: timeoutMs });
    this.path = chromePath;
    this.browser.on('disconnected', () => (this.browser = undefined));
    return { browser: this.browser, reused: false };
  }

  release() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.idleMs);
  }

  async close() {
    clearTimeout(this.idle);
    const b = this.browser;
    this.browser = undefined;
    await b?.close().catch(() => undefined);
  }

  dispose() {
    void this.close();
  }
}

/**
 * Renders a report to PDF with the same page setup and script order as the Electron
 * designer and both servers, so a preview here matches what the server produces.
 */
export async function renderReport(model: ReportModel, opts: RenderOptions): Promise<{ pdf: Uint8Array; logs: RenderLog[] }> {
  const logs: RenderLog[] = [];
  const started = Date.now();
  const emit = (log: RenderLog) => {
    logs.push(log);
    opts.onLog?.(log);
  };
  let stage = 'starting';
  let stageStarted = started;
  const step = (name: string) => {
    const now = Date.now();
    stage = name;
    stageStarted = now;
    emit({ level: 'info', source: 'stage', message: `${name} (+${now - started} ms)` });
  };

  if (!model.code.trim()) throw new RenderError('The Template tab is empty. Add some Handlebars markup first.', logs);

  const libs = listLibs(opts.libsPath);
  const processorPath = libs.processor ?? opts.fallbackProcessorPath;
  const data = opts.data ?? model.data;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  let parsed: unknown;
  if (data.trim()) {
    // Parse here so malformed data fails with a clear message instead of a page script error.
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      throw new RenderError(`Data is not valid JSON: ${(err as Error).message}`, logs);
    }
  }

  step(opts.pool ? 'Starting Chrome' : `Launching Chrome: ${opts.chromePath}`);
  let browser: Browser;
  let reused = false;
  try {
    if (opts.pool) ({ browser, reused } = await opts.pool.acquire(opts.chromePath, timeoutMs));
    else browser = await puppeteer.launch({ executablePath: opts.chromePath, headless: true, args: LAUNCH_ARGS, timeout: timeoutMs });
  } catch (err) {
    throw new RenderError(`Could not start Chrome at ${opts.chromePath}: ${(err as Error).message}`, logs);
  }
  if (opts.pool) emit({ level: 'info', source: 'stage', message: reused ? 'Reusing running Chrome' : `Launched Chrome: ${opts.chromePath} (${Date.now() - stageStarted} ms)` });

  // A fresh incognito context per render keeps reports isolated while sharing the process.
  const context = await browser.createBrowserContext();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => undefined);
  }, timeoutMs);

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    page.on('console', async (msg) => {
      const parts = await Promise.all(
        msg.args().map(async (a) => {
          try {
            const v = await a.jsonValue();
            return typeof v === 'string' ? v : JSON.stringify(v);
          } catch {
            return a.toString();
          }
        }),
      );
      const type = msg.type();
      const level = type === 'error' ? 'error' : type === 'warn' ? 'warn' : type === 'info' ? 'info' : 'log';
      emit({ level, source: 'page', message: parts.length ? parts.join(' ') : msg.text() });
    });
    page.on('pageerror', (err) => emit({ level: 'error', source: 'page', message: String((err as Error).message ?? err) }));

    step('Loading template and styles');
    await page.setContent(`<style id='def-style'>${DEFAULT_STYLE}</style><body></body>`);
    await page.addScriptTag({ id: 'entry-template', type: 'text/x-handlebars-template', content: model.code });
    if (model.style.trim()) {
      await page.addScriptTag({ id: 'style-template', type: 'text/x-handlebars-template', content: model.style });
    }

    step(libs.scripts.length
      ? `Injecting ${libs.scripts.length} libraries from ${opts.libsPath}: ${libs.scripts.map((l) => basename(l)).join(', ')}`
      : `No libraries found in ${opts.libsPath ?? '(no libs path)'}`);
    for (const lib of libs.scripts) {
      await page.addScriptTag({ type: 'text/javascript', content: readFileSync(lib, 'utf8') });
    }

    step(`Injecting data${parsed === undefined ? ' (none)' : ''} and ${model.assets.length} assets`);
    if (parsed !== undefined) {
      await page.evaluate((ctx) => {
        (window as unknown as { processContext: unknown }).processContext = ctx;
      }, parsed);
    }
    if (model.assets.length) {
      const resources = Object.fromEntries(model.assets.map((a) => [a.id, a.data]));
      await page.evaluate((r) => {
        (window as unknown as { resourceContext: unknown }).resourceContext = r;
      }, resources);
    }

    step(`Running script and ${libs.processor ? 'Processor.js from libs' : 'bundled Processor.js'}`);
    // Processor.js calls appScript() unconditionally, so always define it.
    const script = model.script.trim() ? model.script : 'function appScript(){}';
    await page.addScriptTag({ type: 'text/javascript', content: script });
    await page.addScriptTag({ type: 'text/javascript', content: readFileSync(processorPath, 'utf8') });

    step('Waiting for fonts');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    step('Compiling Handlebars template');
    try {
      await page.evaluate(() => (window as unknown as { processHandlebar: () => unknown }).processHandlebar());
    } catch (err) {
      if (timedOut) throw err;
      throw new RenderError(`Template failed: ${(err as Error).message.split('\n')[0]}`, logs);
    }

    step(`Printing ${model.documentType} ${model.landscape ? 'landscape' : 'portrait'} PDF`);
    const pdf = await page.pdf({
      format: model.documentType,
      landscape: model.landscape,
      printBackground: true,
      margin: model.margin,
    });

    emit({ level: 'info', source: 'stage', message: `Rendered ${Math.round(pdf.byteLength / 1024)} KB PDF in ${Date.now() - started} ms` });
    return { pdf, logs };
  } catch (err) {
    if (timedOut) throw new RenderError(`Timed out after ${Math.round(timeoutMs / 1000)} s while: ${stage}`, logs);
    if (err instanceof RenderError) throw err;
    throw new RenderError(`Failed while ${stage.toLowerCase()}: ${(err as Error).message}`, logs);
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
    if (opts.pool) opts.pool.release();
    else await browser.close().catch(() => undefined);
  }
}

export function listLibs(libsPath?: string): { scripts: string[]; processor?: string } {
  if (!libsPath || !existsSync(libsPath)) return { scripts: [] };
  const files = readdirSync(libsPath)
    .filter((f) => extname(f).toLowerCase() === '.js')
    .sort();
  const processor = files.find((f) => f.toLowerCase() === 'processor.js');
  return {
    scripts: files.filter((f) => f !== processor).map((f) => join(libsPath, f)),
    processor: processor ? join(libsPath, processor) : undefined,
  };
}
