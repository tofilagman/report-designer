import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse, TomlError } from 'smol-toml';

export const CONFIG_FILE_NAME = 'report-designer.toml';
export const CONFIG_VERSION = 1;

export const DOCUMENT_TYPES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'Ledger'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type Orientation = 'portrait' | 'landscape';

export interface Margin {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface DeployTarget {
  name: string;
  url: string;
  /** Name of the environment variable holding a bearer token. The token itself never lives in the file. */
  tokenEnv?: string;
}

export interface ProjectConfig {
  version: number;
  /** Absolute path of the report-designer.toml file. */
  file: string;
  /** Folder containing the config; relative paths resolve against it. */
  dir: string;
  libsPath?: string;
  defaults: {
    documentType?: DocumentType;
    orientation?: Orientation;
    margin?: Partial<Margin>;
  };
  deploy: {
    defaultTarget?: string;
    targets: DeployTarget[];
  };
  render: {
    chromePath?: string;
  };
}

export interface ConfigIssue {
  severity: 'error' | 'warning';
  message: string;
  /** 1-based line, when it can be located. */
  line?: number;
  column?: number;
}

export interface ParseResult {
  config?: ProjectConfig;
  issues: ConfigIssue[];
}

const KNOWN_SECTIONS = new Set(['version', 'libs', 'defaults', 'deploy', 'render']);
const MARGIN_KEYS = ['top', 'right', 'bottom', 'left'] as const;

/**
 * Walks up from `startDir` looking for report-designer.toml. Stops after checking
 * `stopDir` (usually the workspace folder); with no stopDir it stops at the filesystem root.
 * The nearest file wins and configs are never merged.
 */
export function findConfigFile(startDir: string, stopDir?: string): string | undefined {
  let dir = resolve(startDir);
  const stop = stopDir ? resolve(stopDir) : undefined;
  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    if (dir === stop) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function parseConfig(text: string, file: string): ParseResult {
  const issues: ConfigIssue[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = parse(text) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof TomlError) {
      return { issues: [{ severity: 'error', message: err.message.split('\n')[0], line: err.line, column: err.column }] };
    }
    throw err;
  }

  const at = (key: string) => locate(text, key);
  const error = (message: string, key: string) => issues.push({ severity: 'error', message, ...at(key) });
  const warn = (message: string, key: string) => issues.push({ severity: 'warning', message, ...at(key) });

  const dir = dirname(file);
  const config: ProjectConfig = {
    version: CONFIG_VERSION,
    file,
    dir,
    defaults: {},
    deploy: { targets: [] },
    render: {},
  };

  if (raw.version === undefined) {
    warn(`Missing "version"; assuming version = ${CONFIG_VERSION}`, 'version');
  } else if (raw.version !== CONFIG_VERSION) {
    error(`Unsupported version ${String(raw.version)}; this extension understands version = ${CONFIG_VERSION}`, 'version');
    return { issues };
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_SECTIONS.has(key)) warn(`Unknown key "${key}" is ignored`, key);
  }

  const libs = table(raw.libs, 'libs', error);
  if (libs) {
    if (typeof libs.path === 'string' && libs.path.trim()) config.libsPath = resolvePath(dir, libs.path);
    else if (libs.path !== undefined) error('"libs.path" must be a non-empty string', 'path');
  }

  const defaults = table(raw.defaults, 'defaults', error);
  if (defaults) {
    if (defaults.document_type !== undefined) {
      const match = DOCUMENT_TYPES.find((d) => d.toLowerCase() === String(defaults.document_type).toLowerCase());
      if (match) config.defaults.documentType = match;
      else error(`"document_type" must be one of ${DOCUMENT_TYPES.join(', ')}`, 'document_type');
    }
    if (defaults.orientation !== undefined) {
      if (defaults.orientation === 'portrait' || defaults.orientation === 'landscape') {
        config.defaults.orientation = defaults.orientation;
      } else {
        error('"orientation" must be "portrait" or "landscape"', 'orientation');
      }
    }
    const margin = table(defaults.margin, 'margin', error);
    if (margin) {
      config.defaults.margin = {};
      for (const k of MARGIN_KEYS) {
        const v = margin[k];
        if (v === undefined) continue;
        if (typeof v === 'string' || typeof v === 'number') config.defaults.margin[k] = String(v);
        else error(`"margin.${k}" must be a string like "20" or "1cm"`, 'margin');
      }
    }
  }

  const deploy = table(raw.deploy, 'deploy', error);
  if (deploy) {
    const targets = table(deploy.targets, 'targets', error) ?? {};
    for (const [name, value] of Object.entries(targets)) {
      const t = table(value, `deploy.targets.${name}`, error);
      if (!t) continue;
      if (typeof t.url !== 'string' || !/^https?:\/\//.test(t.url)) {
        error(`deploy.targets.${name}.url must be an http(s) URL`, `deploy.targets.${name}`);
        continue;
      }
      if (t.token_env !== undefined && typeof t.token_env !== 'string') {
        error(`deploy.targets.${name}.token_env must be the name of an environment variable`, 'token_env');
      }
      if (t.token !== undefined) {
        error(`deploy.targets.${name}: don't store tokens in this file; use token_env instead`, 'token');
      }
      config.deploy.targets.push({
        name,
        url: t.url.replace(/\/+$/, ''),
        tokenEnv: typeof t.token_env === 'string' ? t.token_env : undefined,
      });
    }
    if (deploy.default !== undefined) {
      if (typeof deploy.default === 'string' && config.deploy.targets.some((t) => t.name === deploy.default)) {
        config.deploy.defaultTarget = deploy.default;
      } else {
        error(`"deploy.default" must name one of the targets under [deploy.targets]`, 'default');
      }
    }
    if (!config.deploy.defaultTarget && config.deploy.targets.length === 1) {
      config.deploy.defaultTarget = config.deploy.targets[0].name;
    }
  }

  const render = table(raw.render, 'render', error);
  if (render && render.chrome_path !== undefined) {
    if (typeof render.chrome_path === 'string' && render.chrome_path.trim()) {
      config.render.chromePath = resolvePath(dir, render.chrome_path);
    } else {
      error('"render.chrome_path" must be a non-empty string', 'chrome_path');
    }
  }

  return { config: issues.some((i) => i.severity === 'error') ? undefined : config, issues };
}

/** Starter config written by "Create Project Config". */
export function configTemplate(opts: { deployUrl?: string; libsPath?: string } = {}): string {
  return `# Report Designer project config. Applies to every .zrpt in this folder and below;
# the nearest report-designer.toml wins. Relative paths resolve against this file.
version = ${CONFIG_VERSION}

[libs]
# Shared JS libraries injected into every render. Processor.js is expected here;
# a bundled copy is used if it's missing.
path = "${opts.libsPath ?? './libs'}"

[defaults]
# Applied when creating a new report in this folder.
document_type = "A4"
orientation = "portrait"
margin = { top = "20", right = "20", bottom = "20", left = "20" }

[deploy]
default = "dev"

[deploy.targets.dev]
url = "${opts.deployUrl ?? 'http://localhost:8088'}"

# [deploy.targets.prod]
# url = "https://reports.example.com"
# token_env = "REPORT_SERVER_PROD_TOKEN"   # name of an env var, never the token itself

# [render]
# chrome_path = "/usr/bin/google-chrome-stable"   # overrides the reportDesigner.chromePath setting
`;
}

function table(
  value: unknown,
  key: string,
  error: (message: string, key: string) => void,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
    return value as Record<string, unknown>;
  }
  error(`"${key}" must be a table`, key);
  return undefined;
}

function resolvePath(base: string, p: string): string {
  const expanded = p.startsWith('~/') ? join(process.env.HOME ?? process.env.USERPROFILE ?? '', p.slice(2)) : p;
  return isAbsolute(expanded) ? expanded : resolve(base, expanded);
}

/**
 * Best-effort position for a semantic error: the first line that declares `key`,
 * either as a `[table.header]` or as `key =`. smol-toml doesn't report value positions.
 */
function locate(text: string, key: string): { line?: number; column?: number } {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [new RegExp(`^\\s*\\[\\s*${escaped}\\s*\\]`), new RegExp(`^\\s*${escaped.split('\\.').pop()}\\s*=`)];
  const lines = text.split(/\r?\n/);
  for (const re of patterns) {
    const idx = lines.findIndex((l) => re.test(l));
    if (idx >= 0) return { line: idx + 1, column: lines[idx].search(/\S/) + 1 };
  }
  return {};
}
