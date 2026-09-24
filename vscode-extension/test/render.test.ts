import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { resolveChromePath } from '../src/chrome';
import { newReport } from '../src/model';
import { BrowserPool, RenderError, renderReport } from '../src/render';

// Uses the repo's shared libs folder and a locally installed Chrome; skipped when Chrome isn't found.
const repoLibs = resolve(__dirname, '../../libs');
const chromePath = resolveChromePath();
const opts = {
  chromePath: chromePath ?? '',
  libsPath: repoLibs,
  fallbackProcessorPath: join(repoLibs, 'Processor.js'),
};

test('renders a template with data, style, script and a resource', { skip: !chromePath && 'Chrome not found' }, async () => {
  const model = {
    ...newReport('Test'),
    code: '<h1>{{title}}</h1><p id="d">{{currentDate}}</p><img src="{{resource \'logo\'}}">',
    data: '{"title":"Hello"}',
    style: 'h1 { color: {{color}}; }',
    assets: [{ id: 'logo', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==' }],
    script: `Handlebars.registerHelper('currentDate', () => 'today');
function appScript(){ console.log('appScript ran', { n: 1 }); }`,
  };
  const { pdf, logs } = await renderReport(model, opts);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
  assert.ok(pdf.byteLength > 1000);
  assert.ok(logs.some((l) => l.message.includes('appScript ran') && l.message.includes('{"n":1}')), JSON.stringify(logs));
});

test('an empty script still renders (appScript is always defined)', { skip: !chromePath && 'Chrome not found' }, async () => {
  const { pdf } = await renderReport({ ...newReport('T'), code: '<p>x</p>', script: '' }, opts);
  assert.ok(pdf.byteLength > 0);
});

test('invalid JSON data fails with a clear message', { skip: !chromePath && 'Chrome not found' }, async () => {
  await assert.rejects(renderReport({ ...newReport('T'), code: '<p/>', data: '{bad' }, opts), (err: RenderError) => {
    assert.match(err.message, /Data is not valid JSON/);
    return true;
  });
});

test('template errors surface with page logs', { skip: !chromePath && 'Chrome not found' }, async () => {
  const noLibs = mkdtempSync(join(tmpdir(), 'rd-nolibs-'));
  await assert.rejects(
    renderReport({ ...newReport('T'), code: '<p/>' }, { ...opts, libsPath: noLibs }),
    (err: RenderError) => {
      assert.ok(err instanceof RenderError);
      assert.match(err.message + JSON.stringify(err.logs), /Handlebars is not defined/);
      return true;
    },
  );
});

test('empty template is rejected before launching Chrome', async () => {
  await assert.rejects(renderReport(newReport('T'), { ...opts, chromePath: '/nonexistent' }), /Template tab is empty/);
});

test('pooled renders reuse Chrome and report every stage', { skip: !chromePath && 'Chrome not found' }, async () => {
  const pool = new BrowserPool();
  try {
    const model = { ...newReport('T'), code: '<p>{{x}}</p>', data: '{"x":1}' };
    const live: string[] = [];
    const t0 = Date.now();
    await renderReport(model, { ...opts, pool, onLog: (l) => live.push(l.message) });
    const cold = Date.now() - t0;
    const t1 = Date.now();
    const { logs } = await renderReport(model, { ...opts, pool });
    const warm = Date.now() - t1;
    for (const s of ['Starting Chrome', 'Loading template', 'Injecting', 'Compiling Handlebars', 'Printing A4', 'Rendered']) {
      assert.ok(live.some((m) => m.startsWith(s)), `missing stage ${s}: ${live.join(' | ')}`);
    }
    assert.ok(logs.some((l) => l.message === 'Reusing running Chrome'));
    assert.ok(warm < cold, `warm ${warm} ms should beat cold ${cold} ms`);
    console.log(`cold ${cold} ms, warm ${warm} ms`);
  } finally {
    await pool.close();
  }
});

test('a hung template times out and names the stage', { skip: !chromePath && 'Chrome not found' }, async () => {
  const model = { ...newReport('T'), code: '<p/>', script: 'function appScript(){ while(true){} }' };
  await assert.rejects(renderReport(model, { ...opts, timeoutMs: 3000 }), /Timed out after 3 s while: Compiling Handlebars template/);
});
