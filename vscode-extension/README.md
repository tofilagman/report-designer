# Report Designer for VS Code

Design Handlebars PDF report templates (`.zrpt`) inside VS Code. Opening a `.zrpt` file opens the designer automatically.

- **Template / Data / Style / Script** tabs, each a Monaco editor
- **Assets**: embed images and reference them with `{{resource 'id'}}`
- **Preview** renders through headless Chrome using the same pipeline as the report servers, and shows page `console` output in **Logs**
- **Publish** and **Sync Libs** upload to a report server (`report-server/` in this repo)
- Save, undo inside the editors, dirty state, revert and hot exit work like any VS Code editor

`.zrpt` files are the format both report servers read, and files saved by the earlier Electron designer open unchanged.

## Visual builder (prototype)

The **Design** tab builds a report from blocks instead of hand-written Handlebars: Text (with `{{field}}` tokens), Field, Table, Image, Divider and Spacer. Field and list pickers come from the sample JSON in the Data tab, and **Start from sample data** creates a first layout with a field per value and a table per list.

- The **Live** tab renders the page instantly with your sample data, libraries and scripts, at the real page size with page-break guides. Click a block on it to select it. **PDF** is still the exact Chrome render.
- The layout is saved as a `layout` field in the `.zrpt` and the Template tab shows the generated code, read-only. The servers ignore `layout` and render `code` as before.
- **Undo/Redo**: builder changes go on VS Code's undo stack, so ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y, the Edit menu and the toolbar buttons all work, and undoing back to the last save clears the unsaved marker. Typing in one field merges into one step (until a 1.5 s pause); adding, moving or deleting a block, starting a layout and detaching are one step each. Inside the Data, Style and Script editors ⌘Z undoes that editor's text, as before.
- **Detach to code** switches the report to hand editing and keeps the layout in the file (`detachedLayout`). **Re-attach visual layout** in the Design tab brings it back; if the template was edited by hand in between, the Design tab says so and the edited version is kept under **Restore previous template**. Hand-written templates that never had a layout can't be turned into blocks. Starting a layout on an existing report keeps the old template, and **Restore previous template** brings it back.
- The Live canvas needs `'unsafe-eval'` in the webview's CSP for `Handlebars.compile`. Template scripts run in a sandboxed iframe without same-origin access, so they can't reach the VS Code API.

`sample-project/invoice-visual.zrpt` is the sample invoice built with the builder.

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

# One table per server, each with its own URL and key.
[deploy.targets.dev]
url = "http://localhost:8088"
key = "<dev server's REPORT_SERVER_KEY>"   # optional; see "Server API keys"

[deploy.targets.staging]
url = "https://reports-staging.example.com"
key = "<staging key>"

[deploy.targets.prod]
url = "https://reports.example.com"
# no key here: stored in the keychain with "Set Server API Key", or read from an env var:
# token_env = "REPORT_SERVER_PROD_TOKEN"

# [render]
# chrome_path = "/usr/bin/google-chrome-stable"
```

### Deploying a whole project

Open `report-designer.toml` and use the links above it: **Deploy N reports + libraries to dev** at the top for the default target, or **Deploy N reports to …** above each `[deploy.targets.…]` table. The same action is the upload button in the editor title bar, **Deploy Project** on the config file or a folder in the Explorer, **Deploy whole project…** in a report's Settings tab, and **Report Designer: Deploy Project** in the Command Palette.

It syncs the `[libs]` folder first, then publishes every `.zrpt` in the config's folder and below, skipping subfolders that have their own `report-designer.toml`. Before uploading anything it checks that no two reports share a file name (the server stores templates by name, so they'd overwrite each other) and offers to save reports with unsaved changes. A wrong key or an unreachable server stops the run; a single report failing doesn't, and the summary links to the log. Progress shows in a notification and can be cancelled.

### Server API keys

A server with `REPORT_SERVER_KEY` set needs that key on every request. Each target gets its key from the first of:

1. **`key = "…"` in the target's table.** Convenient for dev servers and keys you're happy to keep with the project. Anyone who can read the file can use the key, so keep production keys out of files you commit, or don't commit the config.
2. **The OS keychain**, via **Report Designer: Set Server API Key** (or **Set key** next to the target in the Settings tab). Stored per server URL in VS Code's SecretStorage, never written to a file.
3. **`token_env`**: the name of an environment variable holding the key, for CI and scripts.

Keys are sent as `Authorization: Bearer <key>` on publish, library sync, Deploy Project and **Test**. A `key` in the file must meet the server's rule (32+ characters, no spaces); a bad one shows in the Problems panel on its line. The links above each target show where its key comes from, and a `401` offers to set the key, or to open the config when the key came from it. **Clear Server API Key** removes a keychain key.

Problems in the file show in the Problems panel. Unknown keys are warnings, so newer config files still load.

Run **Report Designer: Create Project Config** (also in the Explorer folder context menu) to write a starter file. Opening a report saved by the old Electron designer, which kept its server URL in each file (`deploymentUrl`), offers to create one from that URL.

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
| Report Designer: Deploy Project | Sync libraries, then publish every report the config covers |
| Report Designer: Set Server API Key... | Store the server's `REPORT_SERVER_KEY` for a target in the OS keychain |
| Report Designer: Clear Server API Key... | Remove a stored key |

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
| `src/builder/` | Visual builder block model, schema inference and Handlebars generator (pure, unit-tested) |
| `src/webview/builder/` | Builder UI (Preact) and live canvas, bundled to `media/builder.js` |

The webview never touches the file system or network. File access, rendering and uploads all happen in the extension host.
