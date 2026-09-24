import { randomBytes, randomUUID } from 'node:crypto';
import { basename, dirname, extname } from 'node:path';
import * as vscode from 'vscode';
import { resolveChromePath } from './chrome';
import type { DeployTarget } from './config/parse';
import { ConfigService, ResolvedConfig } from './config/service';
import { publishTemplate, syncLibs, testConnection } from './deploy';
import { ReportDocument } from './document';
import type { Asset, EditableFields } from './model';
import { BrowserPool, RenderLog, renderReport } from './render';

export const VIEW_TYPE = 'reportDesigner.zrpt';

const EDITABLE: ReadonlySet<keyof EditableFields> = new Set([
  'name', 'landscape', 'documentType', 'margin', 'code', 'data', 'style', 'script',
]);

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

type FromWebview =
  | { type: 'ready' }
  | { type: 'edit'; field: keyof EditableFields; value: unknown }
  | { type: 'preview' }
  | { type: 'publish' | 'syncLibs' | 'testConnection'; target?: string }
  | { type: 'addAssets' }
  | { type: 'copyAsset' | 'deleteAsset'; id: string }
  | { type: 'createConfig' | 'openConfig' | 'showLog' }
  | { type: 'clientLog'; level: 'info' | 'warn' | 'error'; message: string };

interface Editor {
  document: ReportDocument;
  panel: vscode.WebviewPanel;
}

export class DesignerProvider implements vscode.CustomEditorProvider<ReportDocument> {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<ReportDocument>>();
  readonly onDidChangeCustomDocument = this.changed.event;

  private readonly editors = new Set<Editor>();
  private active?: Editor;
  private readonly rendering = new Set<ReportDocument>();
  /** Folders we've already offered to create a config for, this session. */
  private readonly migrationOffered = new Set<string>();
  /** Documents with an open "changed on disk" prompt, so repeated writes don't stack prompts. */
  private readonly conflictPrompts = new Set<ReportDocument>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configs: ConfigService,
    private readonly log: vscode.LogOutputChannel,
    private readonly browsers: BrowserPool,
  ) {
    context.subscriptions.push(configs.onDidChange(() => this.editors.forEach((e) => this.postConfig(e))));
  }

  get activeEditor(): Editor | undefined {
    return this.active;
  }

  // ---- CustomEditorProvider ----

  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<ReportDocument> {
    const document = await ReportDocument.open(uri, openContext.backupId);
    this.watchDisk(document);
    return document;
  }

  async resolveCustomEditor(document: ReportDocument, panel: vscode.WebviewPanel): Promise<void> {
    const editor: Editor = { document, panel };
    this.editors.add(editor);
    this.active = editor;

    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);

    panel.onDidChangeViewState(() => {
      if (panel.active) this.active = editor;
    });
    panel.onDidDispose(() => {
      this.editors.delete(editor);
      if (this.active === editor) this.active = undefined;
    });
    panel.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(editor, msg).catch((err) => this.fail(err)));

    this.offerConfigMigration(document);
  }

  async saveCustomDocument(document: ReportDocument): Promise<void> {
    await document.saveTo(document.uri);
  }

  async saveCustomDocumentAs(document: ReportDocument, destination: vscode.Uri): Promise<void> {
    await document.saveTo(destination);
  }

  async revertCustomDocument(document: ReportDocument): Promise<void> {
    await document.reload();
    for (const e of this.editorsFor(document)) e.panel.webview.postMessage({ type: 'model', model: document.model });
  }

  async backupCustomDocument(
    document: ReportDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    await document.saveTo(context.destination);
    return {
      id: context.destination.toString(),
      delete: () => vscode.workspace.fs.delete(context.destination).then(undefined, () => undefined),
    };
  }

  // ---- external changes ----

  private watchDisk(document: ReportDocument) {
    if (document.uri.scheme !== 'file') return;
    const folder = vscode.Uri.file(dirname(document.uri.fsPath));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, basename(document.uri.fsPath)));
    // Editors often write in several steps (truncate, write, rename), so settle before reading.
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.onDiskChange(document).catch((err) => this.fail(err)), 150);
    };
    watcher.onDidChange(changed);
    watcher.onDidCreate(changed);
    document.onDidDispose(() => {
      clearTimeout(timer);
      watcher.dispose();
    });
  }

  private async onDiskChange(document: ReportDocument) {
    const bytes = await document.readDiskIfChanged();
    if (!bytes) return;
    const name = basename(document.uri.fsPath);

    if (!this.isDirty(document)) {
      document.applyDisk(bytes);
      for (const e of this.editorsFor(document)) {
        e.panel.webview.postMessage({ type: 'model', model: document.model });
        this.postConfig(e);
      }
      this.log.info(`[${name}] Reloaded: file changed on disk`);
      return;
    }

    if (this.conflictPrompts.has(document)) return;
    this.conflictPrompts.add(document);
    this.log.warn(`[${name}] Changed on disk while it has unsaved changes`);
    try {
      const pick = await vscode.window.showWarningMessage(
        `${name} changed on disk. Reload it and discard your unsaved changes?`,
        'Reload',
        'Keep Mine',
      );
      if (pick !== 'Reload') return;
      // Revert through VS Code so the tab's unsaved marker clears; it calls revertCustomDocument.
      const editor = this.editorsFor(document)[0];
      editor?.panel.reveal(undefined, false);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      this.log.info(`[${name}] Reloaded from disk; unsaved changes discarded`);
    } finally {
      this.conflictPrompts.delete(document);
    }
  }

  /** Test hooks, exposed only when the extension runs under the test runner. */
  testHooks() {
    const find = (uri: vscode.Uri) => [...this.editors].find((e) => e.document.uri.toString() === uri.toString())?.document;
    return {
      model: (uri: vscode.Uri) => find(uri)?.model,
      edit: (uri: vscode.Uri, field: keyof EditableFields, value: unknown) => {
        const document = find(uri);
        if (!document) throw new Error(`${uri} is not open`);
        document.applyEdit(field, value as never);
        this.changed.fire({ document });
      },
    };
  }

  // ---- actions (also used by palette commands) ----

  async preview(editor: Editor): Promise<void> {
    const { document, panel } = editor;
    if (this.rendering.has(document)) return;

    const resolved = this.configs.resolve(document.uri);
    const chromePath = resolveChromePath(
      resolved.config?.render.chromePath,
      vscode.workspace.getConfiguration('reportDesigner').get<string>('chromePath'),
    );
    if (!chromePath) {
      this.previewFailed(panel, 'No Chrome or Chromium found. Set reportDesigner.chromePath.');
      const pick = await vscode.window.showErrorMessage('Report Designer needs Chrome or Chromium to render.', 'Open Settings');
      if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'reportDesigner.chromePath');
      return;
    }
    if (!resolved.config?.libsPath) {
      const why = resolved.file
        ? `${basename(resolved.file)} has no usable [libs] path.`
        : 'No report-designer.toml found for this report.';
      this.previewFailed(panel, `${why} Handlebars and other libraries are loaded from [libs] path.`);
      this.promptForConfig(document, resolved, why);
      return;
    }

    this.rendering.add(document);
    const name = basename(document.uri.fsPath);
    this.log.info(`[${name}] Preview requested`);
    panel.webview.postMessage({ type: 'rendering' });
    const onLog = (l: RenderLog) => {
      const line = `[${name}] ${l.source === 'page' ? 'page: ' : ''}${l.message}`;
      if (l.level === 'error') this.log.error(line);
      else if (l.level === 'warn') this.log.warn(line);
      else this.log.info(line);
      panel.webview.postMessage({ type: 'renderLog', log: l });
    };
    try {
      const { pdf } = await renderReport(document.model, {
        chromePath,
        libsPath: resolved.config.libsPath,
        fallbackProcessorPath: vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'Processor.js').fsPath,
        pool: this.browsers,
        onLog,
      });
      panel.webview.postMessage({ type: 'previewResult', pdf: Buffer.from(pdf).toString('base64') });
    } catch (err) {
      this.log.error(`[${name}] Render failed: ${(err as Error).message}`);
      this.previewFailed(panel, (err as Error).message);
    } finally {
      this.rendering.delete(document);
    }
  }

  async publish(editor: Editor, targetName?: string): Promise<void> {
    const { document } = editor;
    const target = await this.pickTarget(document, targetName);
    if (!target) return;
    if (!(await this.ensureSaved(document))) return;

    const template = basename(document.uri.fsPath, extname(document.uri.fsPath));
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Publishing ${template} to ${target.name}` },
      () => publishTemplate(target, document.uri.fsPath),
    );
    vscode.window.showInformationMessage(`Published ${template} to ${target.name}. Render with POST ${target.url}/render/pdf/${template}`);
  }

  async syncLibs(editor: Editor, targetName?: string): Promise<void> {
    const target = await this.pickTarget(editor.document, targetName);
    if (!target) return;
    const libsPath = this.configs.resolve(editor.document.uri).config?.libsPath;
    const names = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Syncing libraries to ${target.name}` },
      () => syncLibs(target, libsPath, vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'Processor.js').fsPath),
    );
    vscode.window.showInformationMessage(`Synced ${names.length} libraries to ${target.name}: ${names.join(', ')}`);
  }

  // ---- webview messages ----

  private async onMessage(editor: Editor, msg: FromWebview): Promise<void> {
    const { document, panel } = editor;
    switch (msg.type) {
      case 'ready':
        panel.webview.postMessage({ type: 'model', model: document.model });
        this.postConfig(editor);
        return;
      case 'edit':
        if (!EDITABLE.has(msg.field)) return;
        document.applyEdit(msg.field, msg.value as never);
        this.changed.fire({ document });
        return;
      case 'preview':
        return this.preview(editor);
      case 'publish':
        return this.publish(editor, msg.target);
      case 'syncLibs':
        return this.syncLibs(editor, msg.target);
      case 'testConnection': {
        const target = await this.pickTarget(document, msg.target);
        if (!target) return;
        await testConnection(target);
        vscode.window.showInformationMessage(`Connected to ${target.name} (${target.url})`);
        return;
      }
      case 'addAssets':
        return this.addAssets(document);
      case 'copyAsset':
        await vscode.env.clipboard.writeText(`{{resource '${msg.id}'}}`);
        vscode.window.setStatusBarMessage('Resource snippet copied to clipboard', 3000);
        return;
      case 'deleteAsset': {
        const ok = await vscode.window.showWarningMessage('Delete this resource?', { modal: true }, 'Delete');
        if (ok) this.setAssets(document, document.model.assets.filter((a) => a.id !== msg.id));
        return;
      }
      case 'createConfig':
        return vscode.commands.executeCommand('reportDesigner.createConfig', vscode.Uri.file(dirname(document.uri.fsPath)));
      case 'showLog':
        this.log.show(true);
        return;
      case 'clientLog': {
        const line = `[${basename(document.uri.fsPath)}] webview: ${msg.message}`;
        if (msg.level === 'error') this.log.error(line);
        else if (msg.level === 'warn') this.log.warn(line);
        else this.log.info(line);
        return;
      }
      case 'openConfig': {
        const file = this.configs.resolve(document.uri).file;
        if (file) await vscode.window.showTextDocument(vscode.Uri.file(file));
        return;
      }
    }
  }

  private async addAssets(document: ReportDocument) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      title: 'Add Image Resources',
      defaultUri: vscode.Uri.file(dirname(document.uri.fsPath)),
      filters: { Images: Object.keys(IMAGE_TYPES).map((e) => e.slice(1)) },
    });
    if (!picked?.length) return;
    const added: Asset[] = [];
    for (const uri of picked) {
      const mime = IMAGE_TYPES[extname(uri.fsPath).toLowerCase()];
      if (!mime) continue;
      const bytes = await vscode.workspace.fs.readFile(uri);
      added.push({ id: randomUUID(), data: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` });
    }
    this.setAssets(document, [...document.model.assets, ...added]);
  }

  private setAssets(document: ReportDocument, assets: Asset[]) {
    document.model = { ...document.model, assets };
    this.changed.fire({ document });
    for (const e of this.editorsFor(document)) e.panel.webview.postMessage({ type: 'assets', assets });
  }

  // ---- config helpers ----

  private postConfig(editor: Editor) {
    const r = this.configs.resolve(editor.document.uri);
    editor.panel.webview.postMessage({
      type: 'config',
      config: {
        file: r.file,
        libsPath: r.config?.libsPath,
        targets: r.config?.deploy.targets.map((t) => ({ name: t.name, url: t.url })) ?? [],
        defaultTarget: r.config?.deploy.defaultTarget,
        errors: r.issues.filter((i) => i.severity === 'error').map((i) => i.message),
        legacyUrl: editor.document.model.deploymentUrl ?? undefined,
      },
    });
  }

  private async pickTarget(document: ReportDocument, name?: string): Promise<DeployTarget | undefined> {
    const resolved = this.configs.resolve(document.uri);
    const targets = resolved.config?.deploy.targets ?? [];
    if (!targets.length) {
      this.promptForConfig(document, resolved, resolved.file
        ? `${basename(resolved.file)} has no [deploy.targets].`
        : 'No report-designer.toml found for this report.');
      return undefined;
    }
    const wanted = name ?? resolved.config?.deploy.defaultTarget;
    const found = targets.find((t) => t.name === wanted);
    if (found) return found;
    const pick = await vscode.window.showQuickPick(
      targets.map((t) => ({ label: t.name, description: t.url, target: t })),
      { title: 'Deploy target' },
    );
    return pick?.target;
  }

  async chooseTarget(document: ReportDocument): Promise<string | undefined> {
    const targets = this.configs.resolve(document.uri).config?.deploy.targets ?? [];
    if (!targets.length) return undefined;
    const pick = await vscode.window.showQuickPick(
      targets.map((t) => ({ label: t.name, description: t.url })),
      { title: 'Publish to' },
    );
    return pick?.label;
  }

  private async promptForConfig(document: ReportDocument, resolved: ResolvedConfig, why: string) {
    const action = resolved.file ? 'Open Config' : 'Create Config';
    const pick = await vscode.window.showWarningMessage(why, action);
    if (pick === 'Open Config' && resolved.file) {
      await vscode.window.showTextDocument(vscode.Uri.file(resolved.file));
    } else if (pick === 'Create Config') {
      await vscode.commands.executeCommand('reportDesigner.createConfig', vscode.Uri.file(dirname(document.uri.fsPath)));
    }
  }

  /** Reports saved by the Electron app carry their own server URL; offer to move it into a shared config. */
  private async offerConfigMigration(document: ReportDocument) {
    const url = document.model.deploymentUrl;
    const folder = dirname(document.uri.fsPath);
    if (!url || this.migrationOffered.has(folder) || this.configs.resolve(document.uri).file) return;
    this.migrationOffered.add(folder);
    const pick = await vscode.window.showInformationMessage(
      `This report stores its server URL (${url}). Create a report-designer.toml in this folder so every report here shares it?`,
      'Create Config',
      'Not Now',
    );
    if (pick === 'Create Config') {
      await vscode.commands.executeCommand('reportDesigner.createConfig', vscode.Uri.file(folder), url);
    }
  }

  private isDirty(document: ReportDocument): boolean {
    return vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((t) => t.isDirty && t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === document.uri.toString());
  }

  private async ensureSaved(document: ReportDocument): Promise<boolean> {
    if (!this.isDirty(document)) return true;
    return (await vscode.workspace.save(document.uri)) !== undefined;
  }

  // ---- misc ----

  private editorsFor(document: ReportDocument) {
    return [...this.editors].filter((e) => e.document === document);
  }

  private previewFailed(panel: vscode.WebviewPanel, message: string) {
    panel.webview.postMessage({ type: 'previewError', message });
  }

  private fail(err: unknown) {
    this.log.error((err as Error).message ?? String(err));
    vscode.window.showErrorMessage(`Report Designer: ${(err as Error).message ?? String(err)}`);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(media, ...p)).toString();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `worker-src blob:`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${uri('designer.css')}">
  <title>Report Designer</title>
</head>
<body>
  <header class="toolbar">
    <span class="title" id="title"></span>
    <span class="spacer"></span>
    <select id="target" title="Deploy target"></select>
    <button id="btn-test" class="secondary" title="Test connection to the selected target">Test</button>
    <button id="btn-sync" class="secondary" title="Upload the project's libs folder to the selected target">Sync Libs</button>
    <button id="btn-publish" class="secondary" title="Save and upload this report to the selected target">Publish</button>
    <button id="btn-preview" title="Render a PDF preview">Preview</button>
  </header>

  <main class="split" id="split">
    <section class="pane" id="left">
      <nav class="tabs" data-group="left">
        <button data-tab="code" class="active">Template</button>
        <button data-tab="data">Data</button>
        <button data-tab="style">Style</button>
        <button data-tab="script">Script</button>
        <button data-tab="assets">Assets</button>
        <button data-tab="settings">Settings</button>
      </nav>
      <div class="panels">
        <div class="panel active" data-panel="code"><div class="editor" id="ed-code"></div></div>
        <div class="panel" data-panel="data"><div class="editor" id="ed-data"></div></div>
        <div class="panel" data-panel="style"><div class="editor" id="ed-style"></div></div>
        <div class="panel" data-panel="script"><div class="editor" id="ed-script"></div></div>
        <div class="panel scroll" data-panel="assets">
          <div class="row"><button id="btn-add-asset">Add Images</button>
            <span class="hint">Insert with <code>{{resource 'id'}}</code>. Use the copy button to get the snippet.</span></div>
          <div class="assets" id="assets"></div>
        </div>
        <div class="panel scroll" data-panel="settings">
          <form class="settings" id="settings" autocomplete="off">
            <h3>Report</h3>
            <label>Name <input id="f-name" type="text" placeholder="eg: Awesome PDF Template"></label>
            <label>Orientation
              <select id="f-orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
            </label>
            <label>Document type <select id="f-doctype"></select></label>
            <fieldset>
              <legend>Margin (px, or with a unit like 1cm)</legend>
              <label>Top <input id="f-mtop" type="text"></label>
              <label>Right <input id="f-mright" type="text"></label>
              <label>Bottom <input id="f-mbottom" type="text"></label>
              <label>Left <input id="f-mleft" type="text"></label>
            </fieldset>
            <h3>Project</h3>
            <div id="project"></div>
          </form>
        </div>
      </div>
    </section>

    <div class="gutter" id="gutter" title="Drag to resize"></div>

    <section class="pane" id="right">
      <nav class="tabs" data-group="right">
        <button data-tab="preview" class="active">Preview</button>
        <button data-tab="logs">Logs <span class="badge" id="log-count" hidden></span></button>
      </nav>
      <div class="panels">
        <div class="panel active scroll" data-panel="preview">
          <div class="status" id="preview-status">Press Preview to render the report.</div>
          <div class="pages" id="pages"></div>
        </div>
        <div class="panel scroll" data-panel="logs">
          <div class="row"><button id="btn-show-log" class="secondary">Open Output Channel</button>
            <span class="hint">Pipeline stages and the template's console output, newest last.</span></div>
          <div id="logs" class="logs"></div>
        </div>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    window.RD_VENDOR = ${JSON.stringify({ monaco: uri('vendor', 'monaco', 'vs'), pdfjs: uri('vendor', 'pdfjs') })};
  </script>
  <!-- pdf.js must load before Monaco's AMD loader, or its UMD wrapper registers as an AMD module instead of window.pdfjsLib -->
  <script nonce="${nonce}" src="${uri('vendor', 'pdfjs', 'pdf.min.js')}"></script>
  <script nonce="${nonce}" src="${uri('vendor', 'monaco', 'vs', 'loader.js')}"></script>
  <script nonce="${nonce}" src="${uri('designer.js')}"></script>
</body>
</html>`;
  }
}
