# Graph Report - .  (2026-07-01)

## Corpus Check
- 32 files · ~207,588 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 193 nodes · 185 edges · 34 communities (8 shown, 26 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.9)
- Token cost: 15,289 input · 1,226 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Main Process Core|Main Process Core]]
- [[_COMMUNITY_Build Configuration|Build Configuration]]
- [[_COMMUNITY_Runtime Dependencies|Runtime Dependencies]]
- [[_COMMUNITY_Chrome MCP Client|Chrome MCP Client]]
- [[_COMMUNITY_Package Metadata|Package Metadata]]
- [[_COMMUNITY_UI Shell & Assets|UI Shell & Assets]]
- [[_COMMUNITY_NSIS Installer Config|NSIS Installer Config]]
- [[_COMMUNITY_NPM Scripts|NPM Scripts]]
- [[_COMMUNITY_License System|License System]]
- [[_COMMUNITY_Renderer App Core|Renderer App Core]]
- [[_COMMUNITY_Browser Agent|Browser Agent]]
- [[_COMMUNITY_Response Cache|Response Cache]]
- [[_COMMUNITY_Client Manager|Client Manager]]
- [[_COMMUNITY_Delegation Protocol|Delegation Protocol]]
- [[_COMMUNITY_File Handler|File Handler]]
- [[_COMMUNITY_Hot Config|Hot Config]]
- [[_COMMUNITY_Memory Manager|Memory Manager]]
- [[_COMMUNITY_Mission Control|Mission Control]]
- [[_COMMUNITY_Orchestrator|Orchestrator]]
- [[_COMMUNITY_Step-Down Manager|Step-Down Manager]]
- [[_COMMUNITY_Theme Manager|Theme Manager]]
- [[_COMMUNITY_Usage Meter|Usage Meter]]
- [[_COMMUNITY_Workflow Recorder|Workflow Recorder]]
- [[_COMMUNITY_Claude Call Path|Claude Call Path]]
- [[_COMMUNITY_Auto-Updater|Auto-Updater]]
- [[_COMMUNITY_Preload Bridge|Preload Bridge]]
- [[_COMMUNITY_Claude Provider|Claude Provider]]
- [[_COMMUNITY_DeepSeek Provider|DeepSeek Provider]]
- [[_COMMUNITY_Gemini Provider|Gemini Provider]]
- [[_COMMUNITY_Mistral Provider|Mistral Provider]]
- [[_COMMUNITY_OpenAI Provider|OpenAI Provider]]
- [[_COMMUNITY_Perplexity Provider|Perplexity Provider]]
- [[_COMMUNITY_Dollar Indicator|Dollar Indicator]]
- [[_COMMUNITY_Settings Indicator|Settings Indicator]]

## God Nodes (most connected - your core abstractions)
1. `ChromeMCPClient` - 14 edges
2. `build` - 11 edges
3. `scripts` - 8 edges
4. `nsis` - 8 edges
5. `AVIS Main Interface` - 7 edges
6. `validateLicense()` - 5 edges
7. `hashKey()` - 4 edges
8. `publish` - 4 edges
9. `mac` - 4 edges
10. `linux` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Calendar Animation` --references--> `AVIS Main Interface`  [EXTRACTED]
  assets/animations/calendar.gif → src/index.html
- `Connection Animation` --references--> `AVIS Main Interface`  [EXTRACTED]
  assets/animations/connection.gif → src/index.html
- `AVIS Main Interface` --references--> `Internet/Search Animation`  [EXTRACTED]
  src/index.html → assets/animations/internet.gif
- `AVIS Main Interface` --references--> `AVIS Stylesheet`  [EXTRACTED]
  src/index.html → styles/avis.css
- `AVIS Main Interface` --references--> `Client Mode Stylesheet`  [EXTRACTED]
  src/index.html → styles/client-mode.css

## Import Cycles
- None detected.

## Communities (34 total, 26 thin omitted)

### Community 0 - "Main Process Core"
Cohesion: 0.04
Nodes (23): { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen }, APPDATA_DIR, { autoUpdater }, chromeMCP, CLIENTS_DIR, { exec, execSync, spawn }, fs, gotLock (+15 more)

### Community 1 - "Build Configuration"
Cohesion: 0.09
Nodes (22): build, appId, copyright, directories, files, linux, mac, productName (+14 more)

### Community 2 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, @anthropic-ai/sdk, axios, docx, electron-log, electron-store, electron-updater, @google/generative-ai (+10 more)

### Community 4 - "Package Metadata"
Cohesion: 0.18
Nodes (10): author, description, devDependencies, electron, electron-builder, license, main, name (+2 more)

### Community 5 - "UI Shell & Assets"
Cohesion: 0.22
Nodes (9): AVIS Stylesheet, AVIS Global Object, Calendar Animation, Client Mode Stylesheet, Connection Animation, Electron IPC Renderer, AVIS Main Interface, Internet/Search Animation (+1 more)

### Community 6 - "NSIS Installer Config"
Cohesion: 0.25
Nodes (8): nsis, allowToChangeInstallationDirectory, createDesktopShortcut, installerIcon, oneClick, perMachine, shortcutName, uninstallerIcon

### Community 7 - "NPM Scripts"
Cohesion: 0.25
Nodes (8): scripts, build, build:all, build:linux, build:mac, pack, release, start

### Community 8 - "License System"
Cohesion: 0.60
Nodes (5): bindLicenseToDevice(), getDeviceId(), hashKey(), isMasterKey(), validateLicense()

## Knowledge Gaps
- **108 isolated node(s):** `{ app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen }`, `path`, `fs`, `vm`, `os` (+103 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build` connect `Build Configuration` to `Package Metadata`, `NSIS Installer Config`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Runtime Dependencies` to `Package Metadata`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `ChromeMCPClient` connect `Chrome MCP Client` to `Main Process Core`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `{ app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen }`, `path`, `fs` to the rest of the system?**
  _108 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Main Process Core` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Build Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Runtime Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._