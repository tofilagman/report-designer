import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Common Chrome/Chromium/Edge install locations, most preferred first. */
function candidates(): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ];
    case 'win32': {
      const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(
        (r): r is string => !!r,
      );
      return roots.flatMap((r) => [
        join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]);
    }
    default:
      return [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ];
  }
}

/**
 * Picks the browser used for rendering, in precedence order:
 * report-designer.toml [render] chrome_path, the reportDesigner.chromePath setting,
 * the CHROME_PATH env var (what the Electron app used), then auto-detection.
 */
export function resolveChromePath(fromConfig?: string, fromSetting?: string): string | undefined {
  for (const explicit of [fromConfig, fromSetting, process.env.CHROME_PATH]) {
    if (explicit && explicit.trim()) return explicit.trim();
  }
  return candidates().find((c) => existsSync(c));
}
