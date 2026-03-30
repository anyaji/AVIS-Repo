const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { exec, spawn } = require('child_process');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const store = new Store({ name: 'avis-config', encryptionKey: 'avis-avel-productions-2026' });

let mainWindow;
let browserViewWindow = null; // Hidden browser for fetch_url

const APPDATA_DIR = path.join(app.getPath('appData'), 'AVIS');
const HISTORY_DIR = path.join(APPDATA_DIR, 'history');
const MEMORY_FILE = path.join(APPDATA_DIR, 'memories.json');

function ensureDirs() {
  for (const dir of [APPDATA_DIR, HISTORY_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, '[]', 'utf-8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    backgroundColor: '#080c10',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ====================================================================
// Auto-Updater — checks GitHub Releases for new versions
// ====================================================================
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function initAutoUpdater() {
  // Check 3s after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => log.warn('Update check failed:', e.message));
  }, 3000);

  // Re-check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 1000); // check every 1 minute

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking', 'Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', `Update v${info.version} available — downloading...`, info.version);
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('current', 'AVIS is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', `Downloading: ${Math.round(progress.percent)}%`, null, progress.percent);
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('ready', `v${info.version} ready — restart to install`, info.version);
  });

  autoUpdater.on('error', (err) => {
    // Suppress 404 (no release published yet) and network errors silently
    if (err.message && (err.message.includes('404') || err.message.includes('net::') || err.message.includes('ENOTFOUND'))) {
      log.info('Update check skipped:', err.message);
      return; // silent — don't show to user
    }
    sendUpdateStatus('error', 'Update check failed — will retry later');
  });
}

function sendUpdateStatus(status, message, version, percent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, message, version, percent });
  }
}

// Allow renderer to trigger install + restart
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Allow renderer to manually check for updates
ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(() => {});
});

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  initAutoUpdater();
});

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// Window controls
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win-close', () => mainWindow?.close());

// Config store
ipcMain.handle('store-get', (_, key, def) => store.get(key, def));
ipcMain.handle('store-set', (_, key, val) => { store.set(key, val); return true; });
ipcMain.handle('store-delete', (_, key) => { store.delete(key); return true; });

// API key management
ipcMain.handle('get-api-key', (_, provider) => store.get(`apiKeys.${provider}`, ''));
ipcMain.handle('set-api-key', (_, provider, key) => { store.set(`apiKeys.${provider}`, key); return true; });
ipcMain.handle('get-all-keys', () => store.get('apiKeys', {}));

// Config management
ipcMain.handle('get-config', () => {
  const configPath = path.join(APPDATA_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return null;
});

ipcMain.handle('save-config', (_, config) => {
  const configPath = path.join(APPDATA_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return true;
});

// History management
ipcMain.handle('save-history', (_, date, data) => {
  const filePath = path.join(HISTORY_DIR, `${date}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('load-history', (_, date) => {
  const filePath = path.join(HISTORY_DIR, `${date}.json`);
  if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return null;
});

ipcMain.handle('list-history', () => {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse();
});

// Memory management
ipcMain.handle('get-memories', () => {
  if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  return [];
});

ipcMain.handle('save-memories', (_, memories) => {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf-8');
  return true;
});

// File handling
ipcMain.handle('read-file', async (_, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB > 20) throw new Error('File exceeds 20MB limit');

  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
    const buffer = fs.readFileSync(filePath);
    return { type: 'image', data: buffer.toString('base64'), mimeType: `image/${ext.slice(1)}`, name: path.basename(filePath), sizeMB };
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const pdf = await pdfParse(buffer);
    return { type: 'text', data: pdf.text, name: path.basename(filePath), sizeMB };
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return { type: 'text', data: result.value, name: path.basename(filePath), sizeMB };
  }

  if (['.xlsx', '.xls'].includes(ext)) {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    let text = '';
    workbook.SheetNames.forEach(name => {
      text += `--- Sheet: ${name} ---\n`;
      text += XLSX.utils.sheet_to_csv(workbook.Sheets[name]) + '\n\n';
    });
    return { type: 'text', data: text, name: path.basename(filePath), sizeMB };
  }

  return { type: 'text', data: fs.readFileSync(filePath, 'utf-8'), name: path.basename(filePath), sizeMB };
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Supported', extensions: ['pdf', 'docx', 'txt', 'csv', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'md', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Export config
ipcMain.handle('export-config', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'avis-config.avis',
    filters: [{ name: 'AVIS Config', extensions: ['avis'] }]
  });
  if (result.canceled) return false;
  const configPath = path.join(APPDATA_DIR, 'config.json');
  const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '{}';
  fs.writeFileSync(result.filePath, config, 'utf-8');
  return true;
});

ipcMain.handle('import-config', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'AVIS Config', extensions: ['avis'] }]
  });
  if (result.canceled) return null;
  const data = fs.readFileSync(result.filePaths[0], 'utf-8');
  const config = JSON.parse(data);
  const configPath = path.join(APPDATA_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
});

// Check first run
// First run check — also considers if any API keys already exist in store
ipcMain.handle('is-first-run', () => {
  if (store.get('onboardingComplete', false)) return false;
  // If any keys exist, user already set up — skip onboarding
  const keys = store.get('apiKeys', {});
  if (Object.values(keys).some(k => k && k.length > 0)) {
    store.set('onboardingComplete', true);
    return false;
  }
  return true;
});
ipcMain.handle('complete-onboarding', () => { store.set('onboardingComplete', true); return true; });

// BUG 3: Hot-reload — reload renderer when AVIS edits its own source files
ipcMain.on('hot-reload', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
});

// Expose AVIS install path so Claude knows where its own source files are
ipcMain.handle('get-avis-path', () => __dirname);

// Developer panel — list source files + read/write for built-in editor
ipcMain.handle('dev-list-files', () => {
  const files = [];
  const walk = (dir, prefix) => {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'assets') continue;
        const full = path.join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const stat = fs.statSync(full);
        if (stat.isFile() && /\.(js|html|css|json)$/.test(entry)) {
          files.push(rel);
        } else if (stat.isDirectory()) {
          walk(full, rel);
        }
      }
    } catch (e) {}
  };
  walk(__dirname, '');
  return files.sort();
});

ipcMain.handle('dev-read-file', (_, relPath) => {
  const full = path.join(__dirname, relPath);
  if (!fs.existsSync(full)) return { error: 'File not found' };
  return { content: fs.readFileSync(full, 'utf-8'), path: relPath };
});

ipcMain.handle('dev-write-file', (_, relPath, content) => {
  const full = path.join(__dirname, relPath);
  fs.writeFileSync(full, content, 'utf-8');
  return { success: true, path: relPath };
});

// ====================================================================
// UPGRADE 1: Web Fetch — headless BrowserWindow to load & extract pages
// ====================================================================
ipcMain.handle('fetch-url', async (_, url) => {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const timeout = setTimeout(() => {
      win.destroy();
      reject(new Error('Page load timed out after 30s'));
    }, 30000);

    win.webContents.on('did-finish-load', async () => {
      try {
        const text = await win.webContents.executeJavaScript(`
          (function() {
            // Remove script/style/nav elements
            const remove = document.querySelectorAll('script, style, noscript, nav, footer, iframe, svg');
            remove.forEach(el => el.remove());
            // Get text content
            const body = document.body;
            return body ? body.innerText.substring(0, 50000) : '';
          })()
        `);
        const title = await win.webContents.executeJavaScript('document.title');
        const finalUrl = win.webContents.getURL();
        clearTimeout(timeout);
        win.destroy();
        resolve({ title, url: finalUrl, text: text.trim() });
      } catch (err) {
        clearTimeout(timeout);
        win.destroy();
        reject(err);
      }
    });

    win.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
      clearTimeout(timeout);
      win.destroy();
      reject(new Error(`Failed to load ${url}: ${errorDescription}`));
    });

    win.loadURL(url.startsWith('http') ? url : `https://${url}`);
  });
});

// Navigate a visible browser panel (for the Browser tab)
ipcMain.handle('browser-navigate', async (_, url) => {
  if (browserViewWindow) {
    browserViewWindow.destroy();
    browserViewWindow = null;
  }

  browserViewWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve({ title: 'Timeout', url });
    }, 30000);

    browserViewWindow.webContents.on('did-finish-load', async () => {
      clearTimeout(timeout);
      const title = await browserViewWindow.webContents.executeJavaScript('document.title');
      resolve({ title, url: browserViewWindow.webContents.getURL() });
    });

    browserViewWindow.loadURL(url.startsWith('http') ? url : `https://${url}`);
  });
});

ipcMain.handle('browser-get-content', async () => {
  if (!browserViewWindow) return { text: '', title: '' };
  try {
    const text = await browserViewWindow.webContents.executeJavaScript(`
      (function() {
        const remove = document.querySelectorAll('script, style, noscript, nav, footer, iframe, svg');
        remove.forEach(el => el.remove());
        return document.body ? document.body.innerText.substring(0, 50000) : '';
      })()
    `);
    const title = await browserViewWindow.webContents.executeJavaScript('document.title');
    return { text, title };
  } catch (e) {
    return { text: '', title: '' };
  }
});

ipcMain.handle('browser-screenshot', async () => {
  if (!browserViewWindow) return null;
  try {
    const image = await browserViewWindow.webContents.capturePage();
    return image.toDataURL();
  } catch (e) {
    return null;
  }
});

// ====================================================================
// UPGRADE 1: Brave Search fallback
// ====================================================================
ipcMain.handle('brave-search', async (_, query) => {
  const axios = require('axios');
  const apiKey = store.get('apiKeys.brave', '');
  if (!apiKey) throw new Error('Brave Search API key not configured');

  const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    params: { q: query, count: 5 },
    headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey }
  });

  const results = (response.data.web?.results || []).map(r => ({
    title: r.title,
    snippet: r.description,
    url: r.url
  }));
  return results;
});

// ====================================================================
// FIX 1: DuckDuckGo instant answer (no API key, always works)
// ====================================================================
ipcMain.handle('ddg-search', async (_, query) => {
  const axios = require('axios');
  const response = await axios.get('https://api.duckduckgo.com/', {
    params: { q: query, format: 'json', no_redirect: 1, no_html: 1 },
    timeout: 10000
  });
  const d = response.data;
  const results = [];
  // Abstract/answer
  if (d.Abstract) {
    results.push({ title: d.Heading || query, snippet: d.Abstract, url: d.AbstractURL || '' });
  }
  if (d.Answer) {
    results.push({ title: 'Answer', snippet: d.Answer, url: '' });
  }
  // Related topics
  if (d.RelatedTopics) {
    for (const topic of d.RelatedTopics.slice(0, 8)) {
      if (topic.Text && topic.FirstURL) {
        results.push({ title: topic.Text.substring(0, 80), snippet: topic.Text, url: topic.FirstURL });
      }
      // Sub-topics
      if (topic.Topics) {
        for (const sub of topic.Topics.slice(0, 3)) {
          if (sub.Text && sub.FirstURL) {
            results.push({ title: sub.Text.substring(0, 80), snippet: sub.Text, url: sub.FirstURL });
          }
        }
      }
    }
  }
  // Results section
  if (d.Results) {
    for (const r of d.Results.slice(0, 5)) {
      if (r.Text && r.FirstURL) {
        results.push({ title: r.Text.substring(0, 80), snippet: r.Text, url: r.FirstURL });
      }
    }
  }
  return results;
});

// ====================================================================
// FIX 1: SearXNG public instance (no API key, always works)
// ====================================================================
ipcMain.handle('searx-search', async (_, query) => {
  const axios = require('axios');
  // Try multiple public instances in case one is down
  const instances = ['https://searx.be', 'https://search.sapti.me', 'https://searx.tiekoetter.com'];
  for (const base of instances) {
    try {
      const response = await axios.get(`${base}/search`, {
        params: { q: query, format: 'json', categories: 'general', language: 'en' },
        timeout: 8000,
        headers: { 'Accept': 'application/json' }
      });
      const data = response.data;
      if (data.results && data.results.length > 0) {
        return data.results.slice(0, 8).map(r => ({
          title: r.title || '',
          snippet: r.content || '',
          url: r.url || ''
        }));
      }
    } catch (e) { continue; }
  }
  throw new Error('All SearXNG instances failed');
});

// ====================================================================
// UPGRADE 3: Code Execution — JS via vm sandbox, Python via spawn
// ====================================================================
// ====================================================================
// FIX 2: Claude Code integration — launch claude CLI as subprocess
// ====================================================================
ipcMain.handle('run-claude-code', async (_, { task, projectPath, flags }) => {
  return new Promise((resolve) => {
    const cliFlags = flags || '--dangerously-skip-permissions';
    const escapedTask = task.replace(/"/g, '\\"');
    const command = `claude ${cliFlags} -p "${escapedTask}"`;

    const proc = spawn('claude', [cliFlags, '-p', task], {
      cwd: projectPath || process.cwd(),
      timeout: 1800000, // 30 min for full builds
      shell: true,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Stream chunks to renderer for live display
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude-code-chunk', data.toString());
      }
    });

    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        output: stdout.trim(),
        error: stderr.trim(),
        exitCode
      });
    });

    proc.on('error', (err) => {
      if (err.message.includes('ENOENT')) {
        resolve({ success: false, output: '', error: 'Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code', exitCode: -1 });
      } else {
        resolve({ success: false, output: '', error: err.message, exitCode: -1 });
      }
    });
  });
});

// ====================================================================
// BUG 3: Weather API — free, no key via wttr.in
// ====================================================================
ipcMain.handle('get-weather', async (_, location) => {
  const axios = require('axios');
  try {
    const loc = encodeURIComponent(location || 'auto');
    const response = await axios.get(`https://wttr.in/${loc}?format=j1`, { timeout: 8000, headers: { 'Accept': 'application/json' } });
    const d = response.data;
    const current = d.current_condition?.[0] || {};
    const area = d.nearest_area?.[0] || {};
    return {
      success: true,
      location: `${area.areaName?.[0]?.value || location}, ${area.region?.[0]?.value || ''}, ${area.country?.[0]?.value || ''}`.replace(/, ,/g, ','),
      temp_f: current.temp_F,
      temp_c: current.temp_C,
      condition: current.weatherDesc?.[0]?.value || '',
      humidity: current.humidity,
      wind_mph: current.windspeedMiles,
      feels_like_f: current.FeelsLikeF,
      forecast: (d.weather || []).slice(0, 3).map(day => ({
        date: day.date,
        max_f: day.maxtempF,
        min_f: day.mintempF,
        condition: day.hourly?.[4]?.weatherDesc?.[0]?.value || ''
      }))
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====================================================================
// BUG 3: Smart Steam game launcher
// ====================================================================
ipcMain.handle('launch-steam-game', async (_, { gameName, appId }) => {
  // Method 1: If appId provided, use steam:// protocol directly
  if (appId) {
    exec(`start steam://run/${appId}`, { shell: true });
    return { success: true, method: 'steam_url', appId, message: `Launching via steam://run/${appId}` };
  }

  // Method 2: Search Steam library folders for the game
  const steamPaths = [
    'C:/Program Files (x86)/Steam/steamapps/common',
    'C:/Program Files/Steam/steamapps/common',
    'D:/Steam/steamapps/common',
    'D:/SteamLibrary/steamapps/common',
    'E:/SteamLibrary/steamapps/common'
  ];

  for (const steamPath of steamPaths) {
    try {
      const entries = fs.readdirSync(steamPath);
      const match = entries.find(g => g.toLowerCase().includes(gameName.toLowerCase()));
      if (match) {
        const gamePath = path.join(steamPath, match);
        // Find .exe files
        const findExes = (dir, depth = 0) => {
          if (depth > 2) return [];
          const results = [];
          try {
            for (const f of fs.readdirSync(dir)) {
              const full = path.join(dir, f);
              const stat = fs.statSync(full);
              if (stat.isFile() && f.endsWith('.exe') && !f.includes('unins') && !f.includes('crash') && !f.includes('redis')) {
                results.push(full);
              } else if (stat.isDirectory() && depth < 2) {
                results.push(...findExes(full, depth + 1));
              }
            }
          } catch (e) {}
          return results;
        };
        const exes = findExes(gamePath);
        if (exes.length > 0) {
          // Prefer exe matching game name
          const bestExe = exes.find(e => path.basename(e).toLowerCase().includes(gameName.toLowerCase().split(' ')[0])) || exes[0];
          exec(`start "" "${bestExe}"`, { shell: true });
          return { success: true, method: 'direct_exe', path: bestExe, message: `Launching ${path.basename(bestExe)}` };
        }
      }
    } catch (e) { continue; }
  }

  // Method 3: Try steam:// with game name as-is (Steam handles fuzzy matching sometimes)
  const sanitized = gameName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  exec(`start steam://store/0`, { shell: true }); // Opens Steam
  return { success: false, method: 'fallback', message: `Could not find "${gameName}" in Steam libraries. Opened Steam — try searching there.` };
});

ipcMain.handle('run-code', async (_, { language, code }) => {
  if (language === 'javascript') {
    return runJavaScript(code);
  } else if (language === 'python') {
    return runPython(code);
  }
  throw new Error(`Unsupported language: ${language}`);
});

function runJavaScript(code) {
  return new Promise((resolve) => {
    const logs = [];
    const sandbox = {
      console: {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
        error: (...args) => logs.push('[ERROR] ' + args.map(a => String(a)).join(' ')),
        warn: (...args) => logs.push('[WARN] ' + args.map(a => String(a)).join(' ')),
        info: (...args) => logs.push(args.map(a => String(a)).join(' '))
      },
      setTimeout: () => {},
      setInterval: () => {},
      require: () => { throw new Error('require is not available in sandbox'); },
      process: { env: {} },
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite
    };

    try {
      const context = vm.createContext(sandbox, { timeout: 10000 });
      const result = vm.runInContext(code, context, { timeout: 10000 });
      const output = logs.join('\n');
      const resultStr = result !== undefined ? String(result) : '';
      resolve({
        success: true,
        output: output + (output && resultStr ? '\n' : '') + resultStr,
        logs
      });
    } catch (err) {
      resolve({
        success: false,
        output: logs.join('\n') + '\n' + err.message,
        error: err.message
      });
    }
  });
}

// BUG 2: Find working Python command on startup, cache it
let cachedPythonCmd = null;

function findPythonCmd() {
  return new Promise((resolve) => {
    if (cachedPythonCmd) { resolve(cachedPythonCmd); return; }
    // Check stored preference first
    const stored = store.get('pythonCmd', null);
    if (stored) {
      exec(`${stored} --version`, { timeout: 5000 }, (err) => {
        if (!err) { cachedPythonCmd = stored; resolve(stored); return; }
        // Stored one is stale, try all
        tryPythonCmds(resolve);
      });
    } else {
      tryPythonCmds(resolve);
    }
  });
}

function tryPythonCmds(resolve) {
  const cmds = ['python', 'python3', 'py'];
  let i = 0;
  function tryNext() {
    if (i >= cmds.length) { resolve(null); return; }
    const cmd = cmds[i++];
    exec(`${cmd} --version`, { timeout: 5000 }, (err) => {
      if (!err) { cachedPythonCmd = cmd; store.set('pythonCmd', cmd); resolve(cmd); }
      else tryNext();
    });
  }
  tryNext();
}

function runPython(code) {
  return new Promise(async (resolve) => {
    const pythonCmd = await findPythonCmd();
    if (!pythonCmd) {
      resolve({ success: false, output: 'Python not found. Install Python and ensure it is in your PATH.', error: 'Python not found' });
      return;
    }

    const tempFile = path.join(APPDATA_DIR, '_avis_temp.py');
    fs.writeFileSync(tempFile, code, 'utf-8');

    const proc = spawn(pythonCmd, [tempFile], {
      timeout: 60000,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (exitCode) => {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      if (exitCode === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({ success: false, output: stdout + '\n' + stderr, error: stderr.trim() });
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      resolve({ success: false, output: err.message, error: err.message });
    });
  });
}

// ====================================================================
// UPGRADE 4: File System Access — read/write any file
// ====================================================================
ipcMain.handle('tool-read-file', async (_, filePath) => {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return { success: false, error: `File not found: ${absPath}` };
    const stats = fs.statSync(absPath);
    if (stats.size > 20 * 1024 * 1024) return { success: false, error: 'File exceeds 20MB limit' };
    const ext = path.extname(absPath).toLowerCase();

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(absPath);
      const pdf = await pdfParse(buffer);
      return { success: true, content: pdf.text, path: absPath, size: stats.size };
    }

    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: absPath });
      return { success: true, content: result.value, path: absPath, size: stats.size };
    }

    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
      const buffer = fs.readFileSync(absPath);
      return { success: true, content: `[Binary image file: ${path.basename(absPath)}, ${stats.size} bytes]`, path: absPath, size: stats.size, isImage: true, base64: buffer.toString('base64'), mimeType: `image/${ext.slice(1)}` };
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    return { success: true, content, path: absPath, size: stats.size };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('tool-write-file', async (_, filePath, content) => {
  try {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    return { success: true, path: absPath, size: Buffer.byteLength(content, 'utf-8') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====================================================================
// UPGRADE 5: Open App / Launch Application
// ====================================================================
ipcMain.handle('open-app', async (_, target) => {
  return new Promise((resolve) => {
    // Use shell.openPath for files/folders, exec for app names
    if (fs.existsSync(target)) {
      shell.openPath(path.resolve(target)).then(err => {
        resolve({ success: !err, error: err || undefined, target });
      });
    } else {
      // Try as a command
      exec(`start "" "${target}"`, { shell: true }, (err) => {
        if (err) {
          // Try direct execution
          exec(target, { shell: true, timeout: 5000 }, (err2) => {
            resolve({ success: !err2, error: err2?.message, target });
          });
        } else {
          resolve({ success: true, target });
        }
      });
    }
  });
});

// ====================================================================
// UPGRADE 5: Computer Control — Screenshot, click, type
// ====================================================================
ipcMain.handle('computer-action', async (_, { action, x, y, text: inputText, button, direction, amount }) => {
  try {
    switch (action) {
      case 'screenshot': {
        const displays = screen.getAllDisplays();
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;

        // Create an offscreen window and capture the screen
        const captureWin = new BrowserWindow({ width, height, show: false, frame: false, transparent: true });
        // Use desktopCapturer approach via the main window
        const sources = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const { desktopCapturer } = require('electron');
            // This won't work in renderer with contextIsolation, use nativeImage instead
            return 'use-native';
          })().catch(() => 'error')
        `).catch(() => 'error');

        // Fallback: capture the main window
        const image = await mainWindow.webContents.capturePage();
        captureWin.destroy();
        return { success: true, action: 'screenshot', image: image.toDataURL() };
      }

      case 'click': {
        // Use PowerShell to simulate click
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x || 0}, ${y || 0})
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class MouseOps {
            [DllImport("user32.dll")]
            public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
          }
"@
          [MouseOps]::mouse_event(0x02, 0, 0, 0, 0)
          [MouseOps]::mouse_event(0x04, 0, 0, 0, 0)
        `;
        return new Promise((resolve) => {
          exec(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, (err) => {
            resolve({ success: !err, action: 'click', x, y, error: err?.message });
          });
        });
      }

      case 'type': {
        // Use PowerShell SendKeys
        const escapedText = (inputText || '').replace(/[+^%~(){}[\]]/g, '{$&}');
        return new Promise((resolve) => {
          exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText.replace(/'/g, "''")}')"`, (err) => {
            resolve({ success: !err, action: 'type', error: err?.message });
          });
        });
      }

      case 'scroll': {
        const scrollAmount = amount || 3;
        const scrollDir = direction === 'up' ? 120 * scrollAmount : -120 * scrollAmount;
        return new Promise((resolve) => {
          exec(`powershell -Command "Add-Type @\\"
using System;
using System.Runtime.InteropServices;
public class MouseScroll {
  [DllImport(\\"user32.dll\\")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
\\"@; [MouseScroll]::mouse_event(0x0800, 0, 0, ${scrollDir}, 0)"`, (err) => {
            resolve({ success: !err, action: 'scroll', direction, error: err?.message });
          });
        });
      }

      case 'move': {
        return new Promise((resolve) => {
          exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x || 0}, ${y || 0})"`, (err) => {
            resolve({ success: !err, action: 'move', x, y, error: err?.message });
          });
        });
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====================================================================
// BUG 1 & 4: Timeout + abort infrastructure for all API calls
// ====================================================================
const API_TIMEOUT_MS = 60000; // 60s for regular API calls
let activeAbortController = null;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label || 'Request'} timed out after ${ms / 1000}s`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Renderer can ask to abort the active request
ipcMain.on('abort-request', () => {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
});

// ====================================================================
// Provider API calls — now with 30s timeout on every call
// ====================================================================
ipcMain.handle('api-call', async (_, { provider, model, messages, systemPrompt, options }) => {
  const apiKey = store.get(`apiKeys.${provider}`, '');
  if (!apiKey) throw new Error(`No API key configured for ${provider}`);

  try {
    let callFn;
    switch (provider) {
      case 'claude': callFn = callClaude(apiKey, model, messages, systemPrompt, options); break;
      case 'deepseek': callFn = callDeepSeek(apiKey, model, messages, systemPrompt, options); break;
      case 'openai': callFn = callOpenAI(apiKey, model, messages, systemPrompt, options); break;
      case 'gemini': callFn = callGemini(apiKey, model, messages, systemPrompt, options); break;
      case 'grok': callFn = callGrok(apiKey, model, messages, systemPrompt, options); break;
      case 'mistral': callFn = callMistral(apiKey, model, messages, systemPrompt, options); break;
      case 'perplexity': callFn = callPerplexity(apiKey, model, messages, systemPrompt, options); break;
      case 'stability': callFn = callStability(apiKey, model, messages, options); break;
      default: throw new Error(`Unknown provider: ${provider}`);
    }
    return await withTimeout(callFn, API_TIMEOUT_MS, `${provider} API call`);
  } catch (err) {
    return { error: true, message: err.message, code: err.status || err.code || 'TIMEOUT' };
  }
});

// Claude agentic call — returns full content blocks including tool_use, with 30s timeout per call
ipcMain.handle('api-call-agentic', async (_, { model, messages, systemPrompt, tools }) => {
  const apiKey = store.get('apiKeys.claude', '');
  if (!apiKey) throw new Error('No API key configured for Claude');

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const rawMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.images ? [
          ...m.images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })),
          { type: 'text', text: (m.content && m.content.trim()) ? m.content : 'Please analyze this image.' }
        ] : m.content
      };
    });

    // BUG 1: Sanitize all messages to prevent empty-content 400 errors
    const claudeMessages = sanitizeClaudeMessages(rawMessages);
    if (claudeMessages.length === 0) {
      return { error: true, message: 'No valid message content to send.', code: 'EMPTY_CONTENT' };
    }

    const params = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt || '',
      messages: claudeMessages
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    const apiPromise = client.messages.create(params);
    const response = await withTimeout(apiPromise, 120000, 'Claude agentic call'); // 2 min per agentic iteration

    if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };

    return {
      content: response.content,
      stop_reason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model
    };
  } catch (err) {
    if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };
    return { error: true, message: err.message, code: err.status || err.code || 'TIMEOUT' };
  } finally {
    activeAbortController = null;
  }
});

// Test provider connection
ipcMain.handle('test-provider', async (_, provider, apiKey) => {
  try {
    switch (provider) {
      case 'claude': {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });
        await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] });
        return { success: true };
      }
      case 'openai': {
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey });
        await client.chat.completions.create({ model: 'gpt-3.5-turbo', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] });
        return { success: true };
      }
      case 'gemini': {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const m = genAI.getGenerativeModel({ model: 'gemini-pro' });
        await m.generateContent('Hi');
        return { success: true };
      }
      case 'grok': {
        const axios = require('axios');
        await axios.post('https://api.x.ai/v1/chat/completions', { model: 'grok-2', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        return { success: true };
      }
      case 'mistral': {
        const axios = require('axios');
        await axios.post('https://api.mistral.ai/v1/chat/completions', { model: 'mistral-small-latest', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        return { success: true };
      }
      case 'perplexity': {
        const axios = require('axios');
        await axios.post('https://api.perplexity.ai/chat/completions', { model: 'llama-3.1-sonar-small-128k-online', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        return { success: true };
      }
      case 'stability': {
        const axios = require('axios');
        await axios.get('https://api.stability.ai/v1/user/account', { headers: { 'Authorization': `Bearer ${apiKey}` } });
        return { success: true };
      }
      case 'deepseek': {
        const axios = require('axios');
        await axios.post('https://api.deepseek.com/chat/completions', { model: 'deepseek-chat', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        return { success: true };
      }
      case 'brave': {
        const axios = require('axios');
        await axios.get('https://api.search.brave.com/res/v1/web/search', { params: { q: 'test', count: 1 }, headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey } });
        return { success: true };
      }
      default: return { success: false, error: 'Unknown provider' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====================================================================
// BUG 1+2: Message sanitization — prevents 400 empty-content errors
// ====================================================================
function sanitizeClaudeMessages(messages) {
  return messages.map(m => {
    // If content is an array (multimodal), filter out empty text blocks and ensure at least one valid block
    if (Array.isArray(m.content)) {
      const filtered = m.content.filter(block => {
        if (block.type === 'text') return block.text && block.text.trim().length > 0;
        if (block.type === 'image') return block.source && block.source.data;
        if (block.type === 'tool_use') return true;
        if (block.type === 'tool_result') return true;
        return true;
      });
      // If only images remain (no text), add a default text block
      const hasText = filtered.some(b => b.type === 'text');
      const hasImage = filtered.some(b => b.type === 'image');
      if (!hasText && hasImage) {
        filtered.unshift({ type: 'text', text: 'Please analyze this image.' });
      }
      // If nothing remains, add a placeholder
      if (filtered.length === 0) {
        return { ...m, content: [{ type: 'text', text: '.' }] };
      }
      return { ...m, content: filtered };
    }
    // If content is a string, ensure non-empty
    if (typeof m.content === 'string') {
      if (!m.content || m.content.trim().length === 0) {
        return { ...m, content: '.' };
      }
    }
    return m;
  }).filter(m => {
    // Remove messages with null/undefined content
    if (m.content === null || m.content === undefined) return false;
    if (typeof m.content === 'string' && m.content.trim().length === 0) return false;
    if (Array.isArray(m.content) && m.content.length === 0) return false;
    return true;
  });
}

// Provider implementation functions
async function callClaude(apiKey, model, messages, systemPrompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const claudeMessages = sanitizeClaudeMessages(messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.images ? [
      ...m.images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })),
      { type: 'text', text: (m.content && m.content.trim()) ? m.content : 'Please analyze this image.' }
    ] : m.content
  })));

  if (claudeMessages.length === 0) {
    return { error: true, message: 'No valid message content to send.', code: 'EMPTY_CONTENT' };
  }

  const response = await client.messages.create({
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt || '',
    messages: claudeMessages
  });

  const text = response.content.map(b => b.text || '').join('');
  return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model };
}

async function callOpenAI(apiKey, model, messages, systemPrompt) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });

  const oaiMessages = [];
  if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (m.images && m.images.length > 0) {
      oaiMessages.push({
        role: m.role, content: [
          ...m.images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })),
          { type: 'text', text: m.content }
        ]
      });
    } else {
      oaiMessages.push({ role: m.role, content: m.content });
    }
  }

  const response = await client.chat.completions.create({ model: model || 'gpt-4o', messages: oaiMessages, max_tokens: 4096 });
  return { text: response.choices[0].message.content, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, model: response.model };
}

async function callGemini(apiKey, model, messages, systemPrompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model: model || 'gemini-pro', systemInstruction: systemPrompt || undefined });

  const history = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    history.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }

  const chat = genModel.startChat({ history });
  const last = messages[messages.length - 1];
  const parts = [];
  if (last.images) {
    for (const img of last.images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: last.content });

  const result = await chat.sendMessage(parts);
  const response = result.response;
  const usage = response.usageMetadata || {};
  return { text: response.text(), inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, model: model || 'gemini-pro' };
}

async function callGrok(apiKey, model, messages, systemPrompt) {
  const axios = require('axios');
  const oaiMessages = [];
  if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) oaiMessages.push({ role: m.role, content: m.content });

  const response = await axios.post('https://api.x.ai/v1/chat/completions', {
    model: model || 'grok-2', messages: oaiMessages, max_tokens: 4096
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

  const d = response.data;
  return { text: d.choices[0].message.content, inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0, model: d.model || model };
}

async function callMistral(apiKey, model, messages, systemPrompt) {
  const axios = require('axios');
  const oaiMessages = [];
  if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) oaiMessages.push({ role: m.role, content: m.content });

  const response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
    model: model || 'mistral-large-latest', messages: oaiMessages, max_tokens: 4096
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

  const d = response.data;
  return { text: d.choices[0].message.content, inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0, model: d.model || model };
}

async function callPerplexity(apiKey, model, messages, systemPrompt) {
  const axios = require('axios');
  const oaiMessages = [];
  if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) oaiMessages.push({ role: m.role, content: m.content });

  const response = await axios.post('https://api.perplexity.ai/chat/completions', {
    model: model || 'llama-3.1-sonar-large-128k-online', messages: oaiMessages, max_tokens: 4096
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

  const d = response.data;
  return { text: d.choices[0].message.content, inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0, model: d.model || model, citations: d.citations || [] };
}

async function callDeepSeek(apiKey, model, messages, systemPrompt) {
  const axios = require('axios');
  const oaiMessages = [];
  if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) oaiMessages.push({ role: m.role, content: m.content });

  const response = await axios.post('https://api.deepseek.com/chat/completions', {
    model: model || 'deepseek-chat', messages: oaiMessages, max_tokens: 4096
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

  const d = response.data;
  return { text: d.choices[0].message.content, inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0, model: d.model || model };
}

async function callStability(apiKey, model, messages) {
  const axios = require('axios');
  const lastMsg = messages[messages.length - 1];
  const prompt = lastMsg.content;

  const response = await axios.post('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
    text_prompts: [{ text: prompt, weight: 1 }],
    cfg_scale: 7, height: 1024, width: 1024, steps: 30, samples: 1
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } });

  const image = response.data.artifacts[0];
  return { text: '', image: { data: image.base64, mimeType: 'image/png' }, inputTokens: 0, outputTokens: 0, model: 'stable-diffusion-xl' };
}
