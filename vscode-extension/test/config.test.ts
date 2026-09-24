import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configTemplate, findConfigFile, parseConfig } from '../src/config/parse';

const FILE = '/proj/reports/report-designer.toml';

test('starter template parses cleanly', () => {
  const { config, issues } = parseConfig(configTemplate({ deployUrl: 'http://srv:8088/' }), FILE);
  assert.deepEqual(issues, []);
  assert.ok(config);
  assert.equal(config.libsPath, '/proj/reports/libs');
  assert.equal(config.defaults.documentType, 'A4');
  assert.equal(config.defaults.orientation, 'portrait');
  assert.deepEqual(config.defaults.margin, { top: '20', right: '20', bottom: '20', left: '20' });
  assert.equal(config.deploy.defaultTarget, 'dev');
  assert.deepEqual(config.deploy.targets, [{ name: 'dev', url: 'http://srv:8088', tokenEnv: undefined }]);
});

test('paths resolve relative to the config file', () => {
  const { config } = parseConfig('version = 1\n[libs]\npath = "../shared/libs"\n[render]\nchrome_path = "/opt/chrome"', FILE);
  assert.equal(config?.libsPath, '/proj/shared/libs');
  assert.equal(config?.render.chromePath, '/opt/chrome');
});

test('multiple targets with token_env', () => {
  const { config, issues } = parseConfig(
    `version = 1
[deploy]
default = "prod"
[deploy.targets.dev]
url = "http://localhost:8088"
[deploy.targets.prod]
url = "https://reports.example.com"
token_env = "RD_TOKEN"`,
    FILE,
  );
  assert.deepEqual(issues, []);
  assert.equal(config?.deploy.defaultTarget, 'prod');
  assert.equal(config?.deploy.targets.find((t) => t.name === 'prod')?.tokenEnv, 'RD_TOKEN');
});

test('syntax errors report a line', () => {
  const { config, issues } = parseConfig('version = 1\n[libs\npath = "x"', FILE);
  assert.equal(config, undefined);
  assert.equal(issues[0].severity, 'error');
  assert.equal(issues[0].line, 2);
});

test('semantic errors are located and block the config', () => {
  const text = `version = 1
[defaults]
document_type = "B5"
[deploy]
default = "nope"
[deploy.targets.dev]
url = "localhost:8088"
token = "secret"`;
  const { config, issues } = parseConfig(text, FILE);
  assert.equal(config, undefined);
  const byMsg = (s: string) => issues.find((i) => i.message.includes(s));
  assert.equal(byMsg('document_type')?.line, 3);
  assert.equal(byMsg('http(s) URL')?.line, 6);
  assert.ok(byMsg('deploy.default'));
});

test('unknown keys and missing version are warnings only', () => {
  const { config, issues } = parseConfig('[libs]\npath = "./libs"\n[future]\nx = 1', FILE);
  assert.ok(config);
  assert.deepEqual(issues.map((i) => i.severity), ['warning', 'warning']);
});

test('unsupported version is rejected', () => {
  const { config, issues } = parseConfig('version = 2', FILE);
  assert.equal(config, undefined);
  assert.match(issues[0].message, /Unsupported version 2/);
});

test('nearest config wins and lookup stops at the workspace root', () => {
  const root = mkdtempSync(join(tmpdir(), 'rd-config-'));
  const nested = join(root, 'a', 'b');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, 'report-designer.toml'), 'version = 1');
  writeFileSync(join(root, 'a', 'report-designer.toml'), 'version = 1');

  assert.equal(findConfigFile(nested, root), join(root, 'a', 'report-designer.toml'));
  assert.equal(findConfigFile(root, root), join(root, 'report-designer.toml'));
  assert.equal(findConfigFile(nested, nested), undefined);
});
