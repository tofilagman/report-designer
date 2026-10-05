import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DeployTarget } from './config/parse';

export class DeployError extends Error {
  constructor(
    message: string,
    /** HTTP status when the server answered; 401 means a missing or wrong API key. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A target plus the API key to send, resolved by the caller (VS Code SecretStorage). */
export type DeployTargetWithKey = DeployTarget & { key?: string };

/** The stored key wins; otherwise the target's token_env variable, for CI and scripted use. */
function headers(target: DeployTargetWithKey): Record<string, string> {
  if (target.key) return { Authorization: `Bearer ${target.key}` };
  if (!target.tokenEnv) return {};
  const token = process.env[target.tokenEnv];
  if (!token) throw new DeployError(`Environment variable ${target.tokenEnv} (token_env for "${target.name}") is not set`);
  return { Authorization: `Bearer ${token}` };
}

async function send(target: DeployTargetWithKey, path: string, init: RequestInit): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${target.url}${path}`, {
      ...init,
      headers: { ...headers(target), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof DeployError) throw err;
    const c = (err as { cause?: { code?: string; message?: string } }).cause;
    const cause = c?.code ?? c?.message;
    throw new DeployError(`Could not reach ${target.name} (${target.url})${cause ? `: ${cause}` : ''}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 500);
    if (res.status === 401) {
      const sent = !!headers(target).Authorization;
      throw new DeployError(
        sent
          ? `${target.name} rejected the API key (${body || 'Invalid API key'}). Check the key set for ${target.url}.`
          : `${target.name} requires an API key. Set the key for ${target.url}.`,
        401,
      );
    }
    throw new DeployError(`${target.name} responded ${res.status}${body ? `: ${body}` : ''}`, res.status);
  }
}

/** Uploads a saved .zrpt to POST /template/publish. The server stores it under its file name. */
export async function publishTemplate(target: DeployTargetWithKey, zrptPath: string): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(zrptPath)]), basename(zrptPath));
  await send(target, '/template/publish', { method: 'POST', body: form });
}

/** Uploads every .js in the libs folder to POST /lib/sync, plus the fallback Processor.js if the folder has none. */
export async function syncLibs(target: DeployTargetWithKey, libsPath: string | undefined, fallbackProcessor: string): Promise<string[]> {
  const files = libsPath && existsSync(libsPath)
    ? readdirSync(libsPath).filter((f) => extname(f).toLowerCase() === '.js').map((f) => join(libsPath, f))
    : [];
  if (!files.some((f) => basename(f).toLowerCase() === 'processor.js')) files.push(fallbackProcessor);

  const form = new FormData();
  for (const f of files) form.append('files', new Blob([readFileSync(f)]), basename(f));
  await send(target, '/lib/sync', { method: 'POST', body: form });
  return files.map((f) => basename(f));
}

/** GET /template returns 200 on the Kotlin server; with a key configured it also checks the key. */
export async function testConnection(target: DeployTargetWithKey): Promise<void> {
  await send(target, '/template', { method: 'GET' });
}
