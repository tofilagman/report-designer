import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { decodeReport, EditableFields, encodeReport, ReportModel } from './model';

const hash = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

/** One open .zrpt file. The extension host holds the model; webviews send edits to it. */
export class ReportDocument implements vscode.CustomDocument {
  private readonly disposed = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposed.event;

  private constructor(
    readonly uri: vscode.Uri,
    public model: ReportModel,
    /** Hash of the file as last loaded or saved, so our own writes aren't mistaken for outside changes. */
    private diskHash: string | undefined,
  ) {}

  static async open(uri: vscode.Uri, backupId?: string): Promise<ReportDocument> {
    const disk = await readIfExists(uri);
    const bytes = backupId ? await vscode.workspace.fs.readFile(vscode.Uri.parse(backupId)) : disk ?? new Uint8Array();
    return new ReportDocument(uri, decodeReport(bytes), disk && hash(disk));
  }

  applyEdit<K extends keyof EditableFields>(field: K, value: EditableFields[K]) {
    this.model = { ...this.model, [field]: value };
  }

  async saveTo(target: vscode.Uri) {
    const bytes = encodeReport(this.model);
    await vscode.workspace.fs.writeFile(target, bytes);
    if (target.toString() === this.uri.toString()) this.diskHash = hash(bytes);
  }

  async reload() {
    const bytes = await vscode.workspace.fs.readFile(this.uri);
    this.applyDisk(bytes);
  }

  /** The file's current bytes if they differ from what this document last loaded or saved. */
  async readDiskIfChanged(): Promise<Uint8Array | undefined> {
    const bytes = await readIfExists(this.uri);
    if (!bytes || hash(bytes) === this.diskHash) return undefined;
    return bytes;
  }

  applyDisk(bytes: Uint8Array) {
    this.model = decodeReport(bytes);
    this.diskHash = hash(bytes);
  }

  dispose() {
    this.disposed.fire();
    this.disposed.dispose();
  }
}

async function readIfExists(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return undefined;
    throw err;
  }
}
