import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DeployTarget } from './config/parse';

export class DeployError extends Error {}

function headers(target: DeployTarget): Record<string, string> {
  if (!target.tokenEnv) return {};
  const token = process.env[target.tokenEnv];
  if (!token) throw new DeployError(`Environment variable ${target.tokenEnv} (token_env for "${target.name}") is not set`);
  return { Authorization: `Bearer ${token}` };
}

async function send(target: DeployTarget, path: string, init: RequestInit): Promise<void> {
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
    throw new DeployError(`${target.name} responded ${res.status}${body ? `: ${body}` : ''}`);
  }
}

/** Uploads a saved .zrpt to POST /template/publish. The server stores it under its file name. */
export async function publishTemplate(target: DeployTarget, zrptPath: string): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(zrptPath)]), basename(zrptPath));
  await send(target, '/template/publish', { method: 'POST', body: form });
}

/** Uploads every .js in the libs folder to POST /lib/sync, plus the fallback Processor.js if the folder has none. */
export async function syncLibs(target: DeployTarget, libsPath: string | undefined, fallbackProcessor: string): Promise<string[]> {
  const files = libsPath && existsSync(libsPath)
    ? readdirSync(libsPath).filter((f) => extname(f).toLowerCase() === '.js').map((f) => join(libsPath, f))
    : [];
  if (!files.some((f) => basename(f).toLowerCase() === 'processor.js')) files.push(fallbackProcessor);

  const form = new FormData();
  for (const f of files) form.append('files', new Blob([readFileSync(f)]), basename(f));
  await send(target, '/lib/sync', { method: 'POST', body: form });
  return files.map((f) => basename(f));
}

/** GET /template returns 200 on the Kotlin server; used as a connectivity check. */
export async function testConnection(target: DeployTarget): Promise<void> {
  await send(target, '/template', { method: 'GET' });
}
