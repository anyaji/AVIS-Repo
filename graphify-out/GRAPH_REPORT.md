# Graph Report - .  (2026-07-01)

## Corpus Check
- 14 files · ~212,131 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 328 nodes · 365 edges · 40 communities (10 shown, 30 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.9)
- Token cost: 6,224 input · 3,719 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Main Process Core|Main Process Core]]
- [[_COMMUNITY_Renderer App (AVIS)|Renderer App (AVIS)]]
- [[_COMMUNITY_Macro Win32 Input|Macro Win32 Input]]
- [[_COMMUNITY_Build Configuration|Build Configuration]]
- [[_COMMUNITY_Macro Humanization|Macro Humanization]]
- [[_COMMUNITY_Macro Engine Controller|Macro Engine Controller]]
- [[_COMMUNITY_Runtime Dependencies|Runtime Dependencies]]
- [[_COMMUNITY_Macro Recorder|Macro Recorder]]
- [[_COMMUNITY_Package Metadata|Package Metadata]]
- [[_COMMUNITY_Chrome MCP Client|Chrome MCP Client]]
- [[_COMMUNITY_Macro Storage|Macro Storage]]
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
- [[_COMMUNITY_Calendar Indicator|Calendar Indicator]]
- [[_COMMUNITY_Connection Indicator|Connection Indicator]]
- [[_COMMUNITY_Dollar Indicator|Dollar Indicator]]
- [[_COMMUNITY_Internet Indicator|Internet Indicator]]
- [[_COMMUNITY_Settings Indicator|Settings Indicator]]

## God Nodes (most connected - your core abstractions)
1. `ChromeMCPClient` - 14 edges
2. `build` - 11 edges
3. `send()` - 9 edges
4. `scripts` - 8 edges
5. `nsis` - 8 edges
6. `_emit()` - 8 edges
7. `mouseBuf()` - 6 edges
8. `validateLicense()` - 5 edges
9. `hashKey()` - 4 edges
10. `publish` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (40 total, 30 thin omitted)

### Community 0 - "Main Process Core"
Cohesion: 0.04
Nodes (24): { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen }, APPDATA_DIR, { autoUpdater }, chromeMCP, CLIENTS_DIR, { exec, execSync, spawn }, fs, gotLock (+16 more)

### Community 1 - "Renderer App (AVIS)"
Cohesion: 0.06
Nodes (32): AVIS.applyPatch, AVIS.browseProjectFolder, AVIS.clearClaudeCodeOutput, AVIS.clearConsole, AVIS.clearTerminal, avis.close, AVIS.closeCockpitDetail, AVIS.copyClaudeCodeOutput (+24 more)

### Community 2 - "Macro Win32 Input"
Cohesion: 0.10
Nodes (34): BTNS, gdi32, _GetCursorPos, _GetDC, _GetForegroundWindow, getForegroundWindowTitle(), _GetMetric, _GetPixel (+26 more)

### Community 3 - "Build Configuration"
Cohesion: 0.07
Nodes (30): build, appId, copyright, directories, files, linux, mac, nsis (+22 more)

### Community 4 - "Macro Humanization"
Cohesion: 0.14
Nodes (13): bz(), clickHold(), gauss(), jitter(), mousePath(), cfg, eff(), humanize (+5 more)

### Community 5 - "Macro Engine Controller"
Cohesion: 0.15
Nodes (15): cfg, _emit(), _ensureHook(), load(), onStateChange(), path, play(), player (+7 more)

### Community 6 - "Runtime Dependencies"
Cohesion: 0.10
Nodes (20): dependencies, @anthropic-ai/sdk, axios, docx, electron-log, electron-store, electron-updater, @google/generative-ai (+12 more)

### Community 7 - "Macro Recorder"
Cohesion: 0.13
Nodes (7): events, heldSet, _insertSync(), keycode2scan(), keydown(), keyup(), mousedown()

### Community 8 - "Package Metadata"
Cohesion: 0.11
Nodes (18): author, description, devDependencies, electron, electron-builder, license, main, name (+10 more)

### Community 11 - "License System"
Cohesion: 0.60
Nodes (5): bindLicenseToDevice(), getDeviceId(), hashKey(), isMasterKey(), validateLicense()

## Knowledge Gaps
- **160 isolated node(s):** `BrowserAgent`, `ResponseCache`, `ClientManager`, `FileHandler`, `HotConfig` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build` connect `Build Configuration` to `Package Metadata`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Runtime Dependencies` to `Package Metadata`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `ChromeMCPClient` connect `Chrome MCP Client` to `Main Process Core`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **What connects `BrowserAgent`, `ResponseCache`, `ClientManager` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Main Process Core` be split into smaller, more focused modules?**
  _Cohesion score 0.0392156862745098 - nodes in this community are weakly interconnected._
- **Should `Renderer App (AVIS)` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `Macro Win32 Input` be split into smaller, more focused modules?**
  _Cohesion score 0.10252100840336134 - nodes in this community are weakly interconnected._