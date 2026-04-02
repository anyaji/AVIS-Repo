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
  apiCallStream: (params) => ipcRenderer.invoke('api-call-stream-start', params),
  onStreamChunk: (callback) => ipcRenderer.on('stream-chunk', (_, chunk) => callback(chunk)),
  offStreamChunk: () => ipcRenderer.removeAllListeners('stream-chunk'),
  testProvider: (provider, apiKey) => ipcRenderer.invoke('test-provider', provider, apiKey),

  // License
  validateLicense: (key) => ipcRenderer.invoke('license:validate', key),
  checkLicense: () => ipcRenderer.invoke('license:check'),
  clearLicense: () => ipcRenderer.invoke('license:clear'),
  getDeviceId: () => ipcRenderer.invoke('license:device-id'),
  onLicenseRevoked: (cb) => ipcRenderer.on('license-revoked', (_, data) => cb(data)),
  onLicenseStatus: (cb) => ipcRenderer.on('license-status', (_, data) => cb(data)),
  listAllLicenses: () => ipcRenderer.invoke('license:list-all'),
  updateLicenseStatus: (hash, status) => ipcRenderer.invoke('license:update-status', { hash, status }),

  // First run
  isFirstRun: () => ipcRenderer.invoke('is-first-run'),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),

  // Firecrawl
  firecrawlScrape: (url) => ipcRenderer.invoke('firecrawl-scrape', url),
  firecrawlCrawl: (url, limit) => ipcRenderer.invoke('firecrawl-crawl', url, limit),
  firecrawlSearch: (query, limit) => ipcRenderer.invoke('firecrawl-search', query, limit),
  firecrawlVerify: () => ipcRenderer.invoke('firecrawl-verify'),

  // Web fetch & search
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
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

  // Document generation
  generatePptx: (params) => ipcRenderer.invoke('generate-pptx', params),
  generateDocx: (params) => ipcRenderer.invoke('generate-docx', params),
  generateXlsx: (params) => ipcRenderer.invoke('generate-xlsx', params),

  // Image handling
  saveImage: (params) => ipcRenderer.invoke('save-image', params),
  setWallpaper: (path) => ipcRenderer.invoke('set-wallpaper', path),
  copyImageClipboard: (base64) => ipcRenderer.invoke('copy-image-clipboard', base64),

  // Steam game launcher
  launchSteamGame: (params) => ipcRenderer.invoke('launch-steam-game', params),

  // App launch & computer control
  openApp: (target) => ipcRenderer.invoke('open-app', target),
  computerAction: (params) => ipcRenderer.invoke('computer-action', params),
  getDisplayInfo: () => ipcRenderer.invoke('get-display-info'),

  // BUG FIX: Abort active request
  abortRequest: () => ipcRenderer.send('abort-request'),

  // Auto-updater
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  installUpdate: () => ipcRenderer.send('install-update'),
  cancelUpdate: () => ipcRenderer.send('cancel-update'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_, data) => callback(data)),

  // Developer panel
  devListFiles: () => ipcRenderer.invoke('dev-list-files'),
  devReadFile: (relPath) => ipcRenderer.invoke('dev-read-file', relPath),
  devWriteFile: (relPath, content) => ipcRenderer.invoke('dev-write-file', relPath, content),

  // Dynamic paths
  getPaths: () => ipcRenderer.invoke('get-paths'),

  // Hot-reload (AVIS edits itself then reloads)
  hotReload: () => ipcRenderer.send('hot-reload'),

  // Session Journal
  journalLog: (data) => ipcRenderer.invoke('journal-log', data),
  journalGetRecent: (days) => ipcRenderer.invoke('journal-get-recent', days),
  journalSaveMemory: (fact) => ipcRenderer.invoke('journal-save-memory', fact),
  journalGetMemories: () => ipcRenderer.invoke('journal-get-memories'),

  // Sentinel health reports
  onSentinelReport: (cb) => ipcRenderer.on('sentinel-report', (_, data) => cb(data)),

  // Claude rate limit monitoring
  onClaudeRateLimits: (cb) => ipcRenderer.on('claude-rate-limits', (_, data) => cb(data)),

  // Claude Code permission control
  claudeCodeCheckUnlock: () => ipcRenderer.invoke('claude-code-check-unlock'),
  claudeCodeSetUnlock: (unlocked) => ipcRenderer.invoke('claude-code-set-unlock', unlocked),

  // BUG 3: Get AVIS install path so Claude can find its own source files
  getAvisPath: () => ipcRenderer.invoke('get-avis-path')
});
