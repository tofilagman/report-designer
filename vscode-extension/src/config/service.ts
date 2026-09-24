import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_FILE_NAME, findConfigFile, parseConfig, ProjectConfig, ConfigIssue } from './parse';

export interface ResolvedConfig {
  /** Path of the nearest report-designer.toml, if any. */
  file?: string;
  /** Parsed config; undefined when there's no file or it has errors. */
  config?: ProjectConfig;
  issues: ConfigIssue[];
}

/**
 * Resolves the nearest report-designer.toml for a report, caches parsed results,
 * reports problems in the Problems panel, and fires onDidChange when any config
 * file is created, edited or deleted.
 */
export class ConfigService implements vscode.Disposable {
  private readonly cache = new Map<string, ResolvedConfig>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('report-designer');
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.diagnostics, this.changed];

  readonly onDidChange = this.changed.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE_NAME}`);
    const invalidate = () => {
      this.cache.clear();
      this.changed.fire();
    };
    watcher.onDidCreate(invalidate);
    watcher.onDidChange(invalidate);
    watcher.onDidDelete((uri) => {
      this.diagnostics.delete(uri);
      invalidate();
    });
    this.disposables.push(watcher);
  }

  /** Config that applies to the given .zrpt (or folder) URI. */
  resolve(target: vscode.Uri, isFolder = false): ResolvedConfig {
    const startDir = isFolder ? target.fsPath : dirname(target.fsPath);
    const stopDir = vscode.workspace.getWorkspaceFolder(target)?.uri.fsPath;
    const file = findConfigFile(startDir, stopDir);
    if (!file) return { issues: [] };

    const cached = this.cache.get(file);
    if (cached) return cached;

    let result: ResolvedConfig;
    try {
      result = { file, ...parseConfig(readFileSync(file, 'utf8'), file) };
    } catch (err) {
      result = { file, issues: [{ severity: 'error', message: `Could not read ${CONFIG_FILE_NAME}: ${String(err)}` }] };
    }
    this.cache.set(file, result);
    this.publishDiagnostics(file, result.issues);
    return result;
  }

  private publishDiagnostics(file: string, issues: ConfigIssue[]) {
    const diags = issues.map((i) => {
      const line = Math.max(0, (i.line ?? 1) - 1);
      const col = Math.max(0, (i.column ?? 1) - 1);
      const d = new vscode.Diagnostic(
        new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER),
        i.message,
        i.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );
      d.source = 'report-designer';
      return d;
    });
    this.diagnostics.set(vscode.Uri.file(file), diags);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
