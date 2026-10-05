import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CONFIG_FILE_NAME } from './config/parse';

const SKIP_DIRS = new Set(['node_modules', '.git', '.vscode', 'dist', 'out', 'target']);

/**
 * The reports a project config covers: every .zrpt in its folder and below, except in
 * subfolders that have their own report-designer.toml (the nearest config wins).
 */
export function findProjectReports(configFile: string): string[] {
  const reports: string[] = [];
  const walk = (dir: string, root: boolean) => {
    if (!root && existsSync(join(dir, CONFIG_FILE_NAME))) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name), false);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zrpt')) {
        reports.push(join(dir, entry.name));
      }
    }
  };
  walk(dirname(configFile), true);
  return reports.sort();
}

/**
 * The server stores templates by file name, so reports that share a name in different
 * folders would overwrite each other. Returns each clashing name with its files.
 */
export function nameClashes(reports: string[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const r of reports) {
    const name = basename(r).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  return new Map([...byName].filter(([, files]) => files.length > 1));
}
