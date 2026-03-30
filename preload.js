const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avis', {
  // Window controls
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),

  // Config store
  storeGet: (key, def) => ipcRenderer.invoke('store-get', key, def),
  storeSet: (key, val) => ipcRenderer.invoke('store-set', key, val),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // API keys
  getApiKey: (provider) => ipcRenderer.invoke('get-api-key', provider),
  setApiKey: (provider, key) => ipcRenderer.invoke('set-api-key', provider, key),
  getAllKeys: () => ipcRenderer.invoke('get-all-keys'),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),

  // History
  saveHistory: (date, data) => ipcRenderer.invoke('save-history', date, data),
  loadHistory: (date) => ipcRenderer.invoke('load-history', date),
  listHistory: () => ipcRenderer.invoke('list-history'),

  // Memory
  getMemories: () => ipcRenderer.invoke('get-memories'),
  saveMemories: (memories) => ipcRenderer.invoke('save-memories', memories),

  // Files
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // API calls
  apiCall: (params) => ipcRenderer.invoke('api-call', params),
  apiCallAgentic: (params) => ipcRenderer.invoke('api-call-agentic', params),
  testProvider: (provider, apiKey) => ipcRenderer.invoke('test-provider', provider, apiKey),

  // First run
  isFirstRun: () => ipcRenderer.invoke('is-first-run'),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),

  // Web fetch & search
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
  braveSearch: (query) => ipcRenderer.invoke('brave-search', query),
  ddgSearch: (query) => ipcRenderer.invoke('ddg-search', query),
  searxSearch: (query) => ipcRenderer.invoke('searx-search', query),
  browserNavigate: (url) => ipcRenderer.invoke('browser-navigate', url),
  browserGetContent: () => ipcRenderer.invoke('browser-get-content'),
  browserScreenshot: () => ipcRenderer.invoke('browser-screenshot'),

  // Code execution
  runCode: (params) => ipcRenderer.invoke('run-code', params),

  // Claude Code CLI integration
  runClaudeCode: (params) => ipcRenderer.invoke('run-claude-code', params),
  onClaudeCodeChunk: (callback) => ipcRenderer.on('claude-code-chunk', (_, chunk) => callback(chunk)),

  // UPGRADE 4: File system tools
  toolReadFile: (path) => ipcRenderer.invoke('tool-read-file', path),
  toolWriteFile: (path, content) => ipcRenderer.invoke('tool-write-file', path, content),

  // Steam game launcher
  launchSteamGame: (params) => ipcRenderer.invoke('launch-steam-game', params),

  // App launch & computer control
  openApp: (target) => ipcRenderer.invoke('open-app', target),
  computerAction: (params) => ipcRenderer.invoke('computer-action', params),

  // BUG FIX: Abort active request
  abortRequest: () => ipcRenderer.send('abort-request'),

  // Auto-updater
  installUpdate: () => ipcRenderer.send('install-update'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, data) => callback(data)),

  // BUG 3: Hot-reload (AVIS edits itself then reloads)
  hotReload: () => ipcRenderer.send('hot-reload'),

  // BUG 3: Get AVIS install path so Claude can find its own source files
  getAvisPath: () => ipcRenderer.invoke('get-avis-path')
});
