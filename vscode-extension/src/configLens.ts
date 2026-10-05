import { basename, dirname } from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_FILE_NAME } from './config/parse';
import type { ConfigService } from './config/service';
import { findProjectReports } from './projectDeploy';
import type { ServerKeys } from './serverKeys';

/**
 * Deploy actions on report-designer.toml: one at the top for the default target, and
 * "Deploy" plus "Set API key" above each [deploy.targets.<name>] table.
 */
export class ConfigLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(
    private readonly configs: ConfigService,
    private readonly keys: ServerKeys,
  ) {
    configs.onDidChange(() => this.changed.fire());
    keys.onDidChange(() => this.changed.fire());
    // Reports added or removed change the counts shown in the lenses.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.zrpt', false, true, false);
    watcher.onDidCreate(() => this.changed.fire());
    watcher.onDidDelete(() => this.changed.fire());
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (basename(doc.uri.fsPath) !== CONFIG_FILE_NAME) return [];
    const { config } = this.configs.resolve(vscode.Uri.file(dirname(doc.uri.fsPath)), true);
    if (!config || config.file !== doc.uri.fsPath || !config.deploy.targets.length) return [];

    const count = findProjectReports(doc.uri.fsPath).length;
    const reports = `${count} report${count === 1 ? '' : 's'}`;
    const top = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [
      new vscode.CodeLens(top, {
        title: config.deploy.defaultTarget
          ? `$(cloud-upload) Deploy ${reports} + libraries to ${config.deploy.defaultTarget}`
          : `$(cloud-upload) Deploy ${reports} + libraries…`,
        tooltip: 'Sync the [libs] folder, then publish every report this config covers',
        command: 'reportDesigner.deployProject',
        arguments: [doc.uri, config.deploy.defaultTarget],
      }),
    ];

    const lines = doc.getText().split(/\r?\n/);
    for (const target of config.deploy.targets) {
      const header = new RegExp(`^\\s*\\[\\s*deploy\\.targets\\.${target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`);
      const line = lines.findIndex((l) => header.test(l));
      if (line < 0) continue;
      const range = new vscode.Range(line, 0, line, 0);
      const hasKey = !target.key && (await this.keys.has(target.url));
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(cloud-upload) Deploy ${reports} to ${target.name}`,
          tooltip: `Sync libraries and publish every report to ${target.url}`,
          command: 'reportDesigner.deployProject',
          arguments: [doc.uri, target.name],
        }),
        target.key
          ? new vscode.CodeLens(range, { title: '$(key) Key in this file', tooltip: 'Sent as the API key for this target', command: '' })
          : new vscode.CodeLens(range, {
              title: hasKey ? '$(key) API key stored' : target.tokenEnv ? `$(key) Key from $${target.tokenEnv}` : '$(key) Set API key',
              tooltip: hasKey
                ? 'Change or check the key stored in your OS keychain'
                : `Store the server's REPORT_SERVER_KEY for ${target.url} in your OS keychain, or add key = "…" to this table`,
              command: 'reportDesigner.setServerKey',
              arguments: [target],
            }),
      );
    }
    return lenses;
  }
}
