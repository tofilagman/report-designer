# Report Designer for VS Code

Design Handlebars PDF report templates (`.zrpt`) inside VS Code. Opening a `.zrpt` file opens the designer automatically.

- **Template / Data / Style / Script** tabs, each a Monaco editor
- **Assets**: embed images and reference them with `{{resource 'id'}}`
- **Preview** renders through headless Chrome using the same pipeline as the report servers, and shows page `console` output in **Logs**
- **Publish** and **Sync Libs** upload to a report server (`report-server/` in this repo)
- Save, undo inside the editors, dirty state, revert and hot exit work like any VS Code editor

`.zrpt` files are unchanged from the Electron designer, so both tools and both servers read the same files.

## Project config: `report-designer.toml`

Reports in a folder share one config. The designer walks up from the report's folder to the workspace root, and the **nearest** `report-designer.toml` wins; configs are never merged. Relative paths resolve against the TOML file's folder.

```toml
version = 1

[libs]
path = "./libs"            # JS libs injected into every render; Processor.js expected here

[defaults]                 # used by "New Report" in this folder
document_type = "A4"       # A0–A6, Letter, Legal, Tabloid, Ledger
orientation = "portrait"   # or "landscape"
margin = { top = "20", right = "20", bottom = "20", left = "20" }

[deploy]
default = "dev"

[deploy.targets.dev]
url = "http://localhost:8088"

[deploy.targets.prod]
url = "https://reports.example.com"
token_env = "REPORT_SERVER_PROD_TOKEN"   # sent as a Bearer token; the token itself never goes in this file

# [render]
# chrome_path = "/usr/bin/google-chrome-stable"
```

Problems in the file show in the Problems panel. Unknown keys are warnings, so newer config files still load.

Run **Report Designer: Create Project Config** (also in the Explorer folder context menu) to write a starter file. Opening a report saved by the Electron app that still carries its own `deploymentUrl` offers to create one from that URL.

### Precedence

1. The `.zrpt` itself: page size, margins, template, data, script, assets
2. `report-designer.toml`: libraries, deploy targets, new-report defaults
3. VS Code settings: `reportDesigner.chromePath` (per machine)
4. Built-in defaults

### Chrome

Rendering needs Chrome, Chromium, Edge or Brave. The browser is found in this order: `[render] chrome_path`, the `reportDesigner.chromePath` setting, the `CHROME_PATH` environment variable, then the usual install locations for your OS.

## Commands

| Command | |
|---|---|
| Report Designer: New Report | Create a `.zrpt` in the selected folder using the folder's `[defaults]` |
| Report Designer: Create Project Config | Write a starter `report-designer.toml` |
| Report Designer: Preview Report | Same as the Preview button |
| Report Designer: Publish Report | Save, then upload to the default target (or the one picked in the toolbar) |
| Report Designer: Publish Report to Target... | Pick a target, then publish |
| Report Designer: Sync Libraries to Server | Upload the `[libs]` folder's `.js` files |

After publishing `invoice.zrpt`, the server renders it at `POST <url>/render/pdf/invoice` (PDF) or `POST <url>/render/text/invoice` (base64 data URI) with the JSON data as the body.

## Development

```bash
npm install
npm run build        # bundle to dist/ and copy Monaco + pdf.js into media/vendor/
npm test             # unit tests; render tests use a local Chrome and ../libs
npm run package      # build a .vsix
```

Press **F5** in VS Code with this folder open to launch an Extension Development Host on `sample-project/`.

### Layout

| Path | |
|---|---|
| `src/extension.ts` | Activation and commands |
| `src/designerProvider.ts` | Custom editor: document lifecycle, webview HTML and messages |
| `src/config/parse.ts` | TOML lookup, parsing and validation (no `vscode` import, unit-tested) |
| `src/config/service.ts` | Caching, file watching, Problems panel |
| `src/render.ts` | Puppeteer render pipeline (matches the Kotlin and .NET servers) |
| `src/deploy.ts` | Publish, sync libs, test connection |
| `src/model.ts` | `.zrpt` BSON encoding |
| `media/designer.js` | Webview UI; sandboxed and talks to the host through `postMessage` |

The webview never touches the file system or network. File access, rendering and uploads all happen in the extension host.
