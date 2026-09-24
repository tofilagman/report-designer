import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_FILE_NAME, configTemplate } from './config/parse';
import { ConfigService } from './config/service';
import { DesignerProvider, VIEW_TYPE } from './designerProvider';
import { encodeReport, newReport } from './model';
import { BrowserPool } from './render';

export function activate(context: vscode.ExtensionContext) {
  const configs = new ConfigService();
  const log = vscode.window.createOutputChannel('Report Designer', { log: true });
  const browsers = new BrowserPool();
  const provider = new DesignerProvider(context, configs, log, browsers);

  context.subscriptions.push(
    configs,
    log,
    browsers,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      // Monaco and the rendered preview are expensive to rebuild, so keep them alive in background tabs.
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),

    vscode.commands.registerCommand('reportDesigner.newReport', (folder?: vscode.Uri) => newReportCommand(configs, folder)),
    vscode.commands.registerCommand('reportDesigner.createConfig', (folder?: vscode.Uri, deployUrl?: string) =>
      createConfigCommand(folder, deployUrl),
    ),
    vscode.commands.registerCommand('reportDesigner.preview', () => withActive(provider, (e) => provider.preview(e))),
    vscode.commands.registerCommand('reportDesigner.publish', () => withActive(provider, (e) => provider.publish(e))),
    vscode.commands.registerCommand('reportDesigner.publishTo', () =>
      withActive(provider, async (e) => {
        const target = await provider.chooseTarget(e.document);
        if (target) await provider.publish(e, target);
      }),
    ),
    vscode.commands.registerCommand('reportDesigner.syncLibs', () => withActive(provider, (e) => provider.syncLibs(e))),
  );

  // Surface problems in every project config up front, not only once a report is opened.
  vscode.workspace.findFiles(`**/${CONFIG_FILE_NAME}`, '**/node_modules/**').then((files) => {
    for (const f of files) configs.resolve(vscode.Uri.file(dirname(f.fsPath)), true);
  });

  return context.extensionMode === vscode.ExtensionMode.Test ? { test: provider.testHooks() } : undefined;
}

export function deactivate() {}

async function withActive(
  provider: DesignerProvider,
  fn: (editor: NonNullable<DesignerProvider['activeEditor']>) => Promise<void>,
) {
  const editor = provider.activeEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a .zrpt report first.');
    return;
  }
  try {
    await fn(editor);
  } catch (err) {
    vscode.window.showErrorMessage(`Report Designer: ${(err as Error).message}`);
  }
}

/** Folder for a new file: the explorer selection, else the active file's folder, else the first workspace folder. */
function targetFolder(folder?: vscode.Uri): vscode.Uri | undefined {
  if (folder) return folder;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const active = tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText ? tab.uri : undefined;
  if (active?.scheme === 'file') return vscode.Uri.file(dirname(active.fsPath));
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function newReportCommand(configs: ConfigService, folderArg?: vscode.Uri) {
  let folder = targetFolder(folderArg);
  if (!folder) {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: 'Folder for the new report' });
    folder = picked?.[0];
    if (!folder) return;
  }

  const name = await vscode.window.showInputBox({
    title: 'New Report',
    prompt: `Report name (saved in ${vscode.workspace.asRelativePath(folder)})`,
    placeHolder: 'invoice',
    validateInput: (v) => {
      if (!v.trim()) return 'Enter a name';
      if (/[\\/:*?"<>|]/.test(v)) return 'Name cannot contain \\ / : * ? " < > |';
      if (existsSync(join(folder!.fsPath, `${fileStem(v)}.zrpt`))) return 'A report with this name already exists';
      return undefined;
    },
  });
  if (!name) return;

  const uri = vscode.Uri.joinPath(folder, `${fileStem(name)}.zrpt`);
  const config = configs.resolve(folder, true).config;
  await vscode.workspace.fs.writeFile(uri, encodeReport(newReport(name.trim(), config)));
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
}

function fileStem(name: string) {
  return name.trim().replace(/\.zrpt$/i, '').replace(/\s+/g, '-');
}

async function createConfigCommand(folderArg?: vscode.Uri, deployUrl?: string) {
  let folder = folderArg ?? targetFolder();
  if (!folderArg) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      defaultUri: folder,
      openLabel: 'Create Config Here',
      title: 'Project folder for report-designer.toml',
    });
    folder = picked?.[0];
  }
  if (!folder) return;

  const uri = vscode.Uri.joinPath(folder, CONFIG_FILE_NAME);
  if (!existsSync(uri.fsPath)) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(configTemplate({ deployUrl }), 'utf8'));
  }
  await vscode.window.showTextDocument(uri);
}
