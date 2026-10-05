import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_FILE_NAME, configTemplate, DeployTarget } from './config/parse';
import { ConfigService } from './config/service';
import { DesignerProvider, VIEW_TYPE } from './designerProvider';
import { encodeReport, newReport } from './model';
import { BrowserPool } from './render';
import { ServerKeys, validateKey } from './serverKeys';

export function activate(context: vscode.ExtensionContext) {
  const configs = new ConfigService();
  const log = vscode.window.createOutputChannel('Report Designer', { log: true });
  const browsers = new BrowserPool();
  const keys = new ServerKeys(context.secrets);
  const provider = new DesignerProvider(context, configs, log, browsers, keys);

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
    vscode.commands.registerCommand('reportDesigner.setServerKey', (target?: DeployTarget) => setServerKeyCommand(provider, configs, keys, target)),
    vscode.commands.registerCommand('reportDesigner.clearServerKey', (target?: DeployTarget) => clearServerKeyCommand(provider, configs, keys, target)),
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

/** Deploy targets to choose from: the active report's config, else every config in the workspace. */
async function knownTargets(provider: DesignerProvider, configs: ConfigService): Promise<DeployTarget[]> {
  const active = provider.activeEditor;
  let targets = active ? provider.targetsFor(active.document) : [];
  if (!targets.length) {
    const files = await vscode.workspace.findFiles(`**/${CONFIG_FILE_NAME}`, '**/node_modules/**');
    targets = files.flatMap((f) => configs.resolve(vscode.Uri.file(dirname(f.fsPath)), true).config?.deploy.targets ?? []);
  }
  // One entry per server: keys are stored per URL.
  return [...new Map(targets.map((t) => [t.url.toLowerCase(), t])).values()];
}

async function pickKeyTarget(
  provider: DesignerProvider,
  configs: ConfigService,
  keys: ServerKeys,
  title: string,
): Promise<DeployTarget | undefined> {
  const targets = await knownTargets(provider, configs);
  if (!targets.length) {
    vscode.window.showWarningMessage('No deploy targets found. Add [deploy.targets] to a report-designer.toml first.');
    return undefined;
  }
  const items = await Promise.all(
    targets.map(async (t) => ({
      label: t.name,
      description: t.url,
      detail: (await keys.has(t.url)) ? '$(key) Key stored' : t.tokenEnv ? `Uses $${t.tokenEnv}` : 'No key',
      target: t,
    })),
  );
  return (await vscode.window.showQuickPick(items, { title }))?.target;
}

async function setServerKeyCommand(provider: DesignerProvider, configs: ConfigService, keys: ServerKeys, target?: DeployTarget) {
  target ??= await pickKeyTarget(provider, configs, keys, 'Set API key for which server?');
  if (!target) return;
  const key = await vscode.window.showInputBox({
    title: `API key for ${target.name}`,
    prompt: `The REPORT_SERVER_KEY configured on ${target.url}. Stored in your OS keychain, never in report-designer.toml.`,
    placeHolder: 'e.g. the output of: openssl rand -hex 32',
    password: true,
    ignoreFocusOut: true,
    validateInput: validateKey,
  });
  if (key === undefined) return;
  await keys.set(target.url, key);
  vscode.window.showInformationMessage(`API key saved for ${target.name} (${target.url}). Use Test in the designer toolbar to check it.`);
}

async function clearServerKeyCommand(provider: DesignerProvider, configs: ConfigService, keys: ServerKeys, target?: DeployTarget) {
  target ??= await pickKeyTarget(provider, configs, keys, 'Remove the stored API key for which server?');
  if (!target) return;
  await keys.delete(target.url);
  vscode.window.showInformationMessage(`Removed the stored API key for ${target.name} (${target.url}).`);
}
