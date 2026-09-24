// Builds the extension host bundle and copies the webview vendor files.
//   node esbuild.mjs               dev build
//   node esbuild.mjs --watch       rebuild on change
//   node esbuild.mjs --production  minified, no sourcemaps
//   node esbuild.mjs --tests       also build test/*.test.ts into out-test/
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');

function copyVendor() {
  const vendor = join(root, 'media', 'vendor');
  rmSync(vendor, { recursive: true, force: true });
  mkdirSync(vendor, { recursive: true });

  // Monaco AMD build. Its workers start from blob: URLs, which webviews allow.
  cpSync(join(root, 'node_modules/monaco-editor/min/vs'), join(vendor, 'monaco/vs'), {
    recursive: true,
    filter: (src) => !/nls\.messages\.[a-z-]+\.js$/.test(src),
  });

  // pdf.js UMD build for the preview pane.
  mkdirSync(join(vendor, 'pdfjs'), { recursive: true });
  for (const f of ['pdf.min.js', 'pdf.worker.min.js']) {
    cpSync(join(root, 'node_modules/pdfjs-dist/legacy/build', f), join(vendor, 'pdfjs', f));
  }

  // Fallback Processor.js for projects whose libs folder doesn't have one.
  const processor = join(root, '..', 'libs', 'Processor.js');
  if (!existsSync(processor)) throw new Error(`Missing ${processor}`);
  mkdirSync(join(root, 'dist'), { recursive: true });
  cpSync(processor, join(root, 'dist', 'Processor.js'));
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

copyVendor();
// A dev build's source map would otherwise linger in dist/ and ship in the .vsix.
if (production) rmSync(join(root, 'dist/extension.js.map'), { force: true });

const extension = await esbuild.context({
  ...common,
  entryPoints: [join(root, 'src/extension.ts')],
  outfile: join(root, 'dist/extension.js'),
  external: ['vscode'],
});

if (args.has('--tests')) {
  await esbuild.build({
    ...common,
    entryPoints: [join(root, 'test/*.test.ts')],
    outdir: join(root, 'out-test'),
    logLevel: 'warning',
  });
}

if (watch) {
  await extension.watch();
} else {
  await extension.rebuild();
  await extension.dispose();
}
