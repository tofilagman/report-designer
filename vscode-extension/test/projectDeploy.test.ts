import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { findProjectReports, nameClashes } from '../src/projectDeploy';

function project(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'rd-project-'));
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '');
  }
  return root;
}

test('finds reports in the config folder and below, skipping nested projects and tooling folders', () => {
  const root = project([
    'report-designer.toml',
    'invoice.zrpt',
    'sales/summary.ZRPT',
    'sales/notes.txt',
    'other/report-designer.toml',
    'other/belongs-to-other.zrpt',
    'node_modules/pkg/x.zrpt',
    '.history/old.zrpt',
  ]);
  const found = findProjectReports(join(root, 'report-designer.toml')).map((f) => relative(root, f));
  assert.deepEqual(found, ['invoice.zrpt', 'sales/summary.ZRPT']);
});

test('a nested project only sees its own reports', () => {
  const root = project(['report-designer.toml', 'a.zrpt', 'other/report-designer.toml', 'other/b.zrpt']);
  const found = findProjectReports(join(root, 'other', 'report-designer.toml')).map((f) => relative(root, f));
  assert.deepEqual(found, ['other/b.zrpt']);
});

test('reports with the same file name in different folders clash', () => {
  const clashes = nameClashes(['/p/invoice.zrpt', '/p/a/Invoice.zrpt', '/p/b/receipt.zrpt']);
  assert.deepEqual([...clashes.keys()], ['invoice.zrpt']);
  assert.equal(clashes.get('invoice.zrpt')!.length, 2);
});
