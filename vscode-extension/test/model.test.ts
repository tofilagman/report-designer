import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BSON } from 'bson';
import { parseConfig } from '../src/config/parse';
import { decodeReport, encodeReport, newReport } from '../src/model';

// Exactly what the Electron designer's save() writes (margins come from text inputs).
const electronFile = {
  name: 'Invoice',
  landscape: false,
  documentType: 'A4',
  margin: { left: '20', right: '20', top: '10', bottom: 20 },
  deploymentUrl: 'http://localhost:8088',
  code: '<h1>{{title}}</h1>',
  data: '{"title":"Hi"}',
  style: 'h1 { color: red; }',
  script: 'function appScript(){}',
  assets: [{ data: 'data:image/png;base64,AAAA', id: 'a1' }],
};

test('reads files written by the Electron app', () => {
  const m = decodeReport(BSON.serialize(electronFile));
  assert.equal(m.name, 'Invoice');
  assert.equal(m.documentType, 'A4');
  assert.deepEqual(m.margin, { top: '10', right: '20', bottom: '20', left: '20' });
  assert.equal(m.deploymentUrl, 'http://localhost:8088');
  assert.deepEqual(m.assets, [{ id: 'a1', data: 'data:image/png;base64,AAAA' }]);
});

test('round-trips without losing unknown fields', () => {
  const m = decodeReport(BSON.serialize({ ...electronFile, futureField: { keep: true } }));
  const back = BSON.deserialize(encodeReport(m));
  assert.deepEqual(back.futureField, { keep: true });
  assert.equal(back.code, electronFile.code);
  assert.equal(back.deploymentUrl, electronFile.deploymentUrl);
  // Fields the Kotlin TemplateModel requires are all present.
  for (const k of ['name', 'landscape', 'documentType', 'code', 'script', 'margin', 'assets']) assert.ok(k in back, k);
});

test('empty file opens as a new report', () => {
  const m = decodeReport(new Uint8Array());
  assert.equal(m.documentType, 'A4');
  assert.equal(m.code, '');
});

test('new reports take [defaults] from the config', () => {
  const { config } = parseConfig(
    'version = 1\n[defaults]\ndocument_type = "letter"\norientation = "landscape"\nmargin = { top = "1cm" }',
    '/p/report-designer.toml',
  );
  const m = newReport('Statement', config);
  assert.equal(m.documentType, 'Letter');
  assert.equal(m.landscape, true);
  assert.deepEqual(m.margin, { top: '1cm', right: '20', bottom: '20', left: '20' });
});
