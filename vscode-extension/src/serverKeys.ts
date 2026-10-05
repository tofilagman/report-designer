import * as vscode from 'vscode';

export { MIN_KEY_LENGTH, validateKey } from './keyRules';

/**
 * API keys for deploy targets, kept in VS Code's SecretStorage (the OS keychain), keyed by
 * server URL so every project pointing at the same server shares one key. Keys never go
 * into report-designer.toml, which is meant to be committed.
 */
export class ServerKeys {
  readonly onDidChange: vscode.Event<void>;

  constructor(private readonly secrets: vscode.SecretStorage) {
    const emitter = new vscode.EventEmitter<void>();
    secrets.onDidChange((e) => {
      if (e.key.startsWith('serverKey:')) emitter.fire();
    });
    this.onDidChange = emitter.event;
  }

  private id(url: string) {
    return `serverKey:${url.replace(/\/+$/, '').toLowerCase()}`;
  }

  get(url: string): Thenable<string | undefined> {
    return this.secrets.get(this.id(url));
  }

  async has(url: string): Promise<boolean> {
    return !!(await this.get(url));
  }

  set(url: string, key: string): Thenable<void> {
    return this.secrets.store(this.id(url), key.trim());
  }

  delete(url: string): Thenable<void> {
    return this.secrets.delete(this.id(url));
  }
}
