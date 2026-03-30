const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { exec, spawn } = require('child_process');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Key store — NO encryption (encryption causes key loss across rebuilds)
// Keys are stored in %APPDATA%/AVIS/avis-keys.json (survives reinstalls)
const store = new Store({ name: 'avis-keys', cwd: path.join(app.getPath('appData'), 'AVIS') });

// Migrate: if old encrypted store exists, try to read keys from plain backup
function migrateKeys() {
  const backupPath = path.join(app.getPath('appData'), 'AVIS', 'keys-backup.json');
  // If store has no keys, try to restore from backup
  const currentKeys = store.get('apiKeys', {});
  const hasAnyKey = Object.values(currentKeys).some(k => k && k.length > 0);
  if (!hasAnyKey && fs.existsSync(backupPath)) {
    try {
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
      if (backup.apiKeys) {
        store.set('apiKeys', backup.apiKeys);
        log.info('Restored API keys from backup');
      }
    } catch (e) { log.warn('Could not restore keys from backup:', e.message); }
  }
}

// Save a plain JSON backup every time keys change
function backupKeys() {
  const backupPath = path.join(app.getPath('appData'), 'AVIS', 'keys-backup.json');
  const keys = store.get('apiKeys', {});
  try {
    fs.writeFileSync(backupPath, JSON.stringify({ apiKeys: keys, timestamp: new Date().toISOString() }), 'utf-8');
  } catch (e) { log.warn('Could not backup keys:', e.message); }
}

let mainWindow;
let browserViewWindow = null;

// ====================================================================
// License System — master key always works, others validated via GitHub
// ====================================================================
const MASTER_KEY_HASH = '7cff1ad44b9eec3b8917276d874c7776'; // MD5 of master key
const LICENSE_URL = 'https://raw.githubusercontent.com/anyaji/AVIS-Repo/main/licenses.json';
let licenseValid = false;
let licenseTier = 'standard';
let licenseOwner = '';

function hashKey(key) {
  return require('crypto').createHash('md5').update(key.trim()).digest('hex');
}

function isMasterKey(key) {
  return hashKey(key) === MASTER_KEY_HASH;
}

// Generate a unique device fingerprint — stable across restarts, unique per machine
function getDeviceId() {
  const crypto = require('crypto');
  const os = require('os');
  const raw = `${os.hostname()}-${os.userInfo().username}-${os.cpus()[0]?.model || ''}-${os.totalmem()}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

async function validateLicense(key) {
  if (!key || !key.trim()) return { valid: false, reason: 'No license key entered' };

  // Master key always works — no network needed, no device lock
  if (isMasterKey(key)) {
    return { valid: true, tier: 'master', owner: 'Avel (Master)', message: '' };
  }

  const deviceId = getDeviceId();

  // Check remote license file
  try {
    const axios = require('axios');
    const response = await axios.get(LICENSE_URL, { timeout: 10000 });
    const data = response.data;
    const license = data.licenses?.[key.trim()];

    if (!license) return { valid: false, reason: 'License key not found' };
    if (license.status === 'revoked') return { valid: false, reason: data.message || 'License has been revoked' };
    if (license.status !== 'active') return { valid: false, reason: `License status: ${license.status}` };

    // Device binding check
    if (license.deviceId && license.deviceId !== deviceId) {
      return { valid: false, reason: 'This key is already activated on another device' };
    }

    // First activation — bind key to this device via GitHub API
    if (!license.deviceId) {
      await bindLicenseToDevice(key.trim(), deviceId, data);
    }

    return { valid: true, tier: license.tier || 'standard', owner: license.owner || 'User', message: data.message || '' };
  } catch (err) {
    // Network error — allow 24h grace period if previously validated
    const lastValidation = store.get('license.lastValidated', 0);
    const hoursSince = (Date.now() - lastValidation) / (1000 * 60 * 60);
    if (hoursSince < 24 && store.get('license.wasValid', false)) {
      return { valid: true, tier: store.get('license.tier', 'standard'), owner: store.get('license.owner', 'User'), message: 'Offline mode (24h grace)' };
    }
    return { valid: false, reason: 'Could not verify license (no internet). Try again later.' };
  }
}

// Bind a license key to this device by updating licenses.json on GitHub
async function bindLicenseToDevice(key, deviceId, currentData) {
  try {
    const axios = require('axios');
    const GH_TOKEN = store.get('github.token', '');

    // Get current file SHA (needed for GitHub API update)
    const fileInfo = await axios.get('https://api.github.com/repos/anyaji/AVIS-Repo/contents/licenses.json', {
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000
    });
    const sha = fileInfo.data.sha;

    // Update the license entry with device ID
    currentData.licenses[key].deviceId = deviceId;
    currentData.licenses[key].activatedAt = new Date().toISOString();
    currentData.updated = new Date().toISOString().slice(0, 10);

    // Push update
    const content = Buffer.from(JSON.stringify(currentData, null, 2) + '\n').toString('base64');
    await axios.put('https://api.github.com/repos/anyaji/AVIS-Repo/contents/licenses.json', {
      message: `License ${key} activated on device ${deviceId}`,
      content,
      sha
    }, {
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000
    });

    log.info(`License ${key} bound to device ${deviceId}`);
  } catch (err) {
    log.warn('Could not bind license to device:', err.message);
    // Don't block activation if binding fails — it'll try again next check
  }
}

// Periodic license check — every 5 minutes
function startLicenseChecks() {
  setInterval(async () => {
    const key = store.get('license.key', '');
    if (!key) return;
    if (isMasterKey(key)) return; // master never needs rechecking

    const result = await validateLicense(key);
    if (!result.valid) {
      licenseValid = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('license-revoked', { reason: result.reason });
      }
      log.warn('License revoked:', result.reason);
    }
  }, 5 * 60 * 1000);
}

// IPC handlers
ipcMain.handle('license:validate', async (_, key) => {
  const result = await validateLicense(key);
  if (result.valid) {
    licenseValid = true;
    licenseTier = result.tier;
    licenseOwner = result.owner;
    store.set('license.key', key.trim());
    store.set('license.tier', result.tier);
    store.set('license.owner', result.owner);
    store.set('license.wasValid', true);
    store.set('license.lastValidated', Date.now());
    log.info(`License activated: ${result.owner} (${result.tier})`);
  }
  return result;
});

ipcMain.handle('license:check', () => {
  return {
    valid: licenseValid,
    key: store.get('license.key', ''),
    tier: licenseTier,
    owner: licenseOwner
  };
});

ipcMain.handle('license:device-id', () => getDeviceId());
ipcMain.handle('license:set-gh-token', (_, token) => { store.set('github.token', token); return true; });

ipcMain.handle('license:clear', () => {
  store.delete('license.key');
  store.delete('license.tier');
  store.delete('license.owner');
  store.set('license.wasValid', false);
  licenseValid = false;
  return true;
});

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
// Auto-Updater — checks GitHub Releases, auto-installs while open
// ====================================================================
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// FIX 3: Explicitly set feed URL — don't rely on package.json alone
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'anyaji',
  repo: 'AVIS-Repo'
});

let updateCountdown = null;

function initAutoUpdater() {
  cleanOldBuilds();

  // FIX 1: Debug logging
  log.info('=== AVIS Auto-Updater Init ===');
  log.info('Current version:', app.getVersion());
  log.info('Feed URL:', JSON.stringify(autoUpdater.getFeedURL()));

  // Check 5s after launch
  setTimeout(() => {
    log.info('Running startup update check...');
    autoUpdater.checkForUpdates().catch(e => log.warn('Update check failed:', e.message));
  }, 5000);

  // Re-check every 1 minute
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 1000); // check every 1 minute

  autoUpdater.on('checking-for-update', () => {
    log.info('=== UPDATE CHECK STARTED ===');
    log.info('Current version:', app.getVersion());
    sendUpdateStatus('checking', 'Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('UPDATE AVAILABLE:', info.version);
    sendUpdateStatus('available', `Update v${info.version} available — downloading...`, info.version);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('No update available. Latest:', info?.version || 'unknown');
    sendUpdateStatus('current', `AVIS v${app.getVersion()} is up to date`);
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', `Downloading update: ${Math.round(progress.percent)}%`, null, progress.percent);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
    sendUpdateStatus('ready', `v${info.version} ready — restarting in 10s...`, info.version);
    let countdown = 10;
    updateCountdown = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(updateCountdown);
        updateCountdown = null;
        log.info('Auto-installing update...');
        autoUpdater.quitAndInstall(false, true);
      } else {
        sendUpdateStatus('ready', `v${info.version} ready — restarting in ${countdown}s...`, info.version);
      }
    }, 1000);
  });

  autoUpdater.on('error', (err) => {
    log.error('Update error:', err.message);
    if (err.message && (err.message.includes('404') || err.message.includes('net::') || err.message.includes('ENOTFOUND'))) {
      log.info('Update check skipped (no release or network issue)');
      return;
    }
    sendUpdateStatus('error', 'Update check failed — will retry later');
  });
}

// FIX 4: Expose version to renderer
ipcMain.handle('get-app-version', () => app.getVersion());

function sendUpdateStatus(status, message, version, percent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, message, version, percent });
  }
}

// Cancel the auto-restart countdown
ipcMain.on('cancel-update', () => {
  if (updateCountdown) {
    clearInterval(updateCountdown);
    updateCountdown = null;
    sendUpdateStatus('ready', 'Update ready — click Restart when ready', null);
    log.info('Auto-restart cancelled by user');
  }
});

// Allow renderer to trigger install + restart immediately
ipcMain.on('install-update', () => {
  if (updateCountdown) { clearInterval(updateCountdown); updateCountdown = null; }
  autoUpdater.quitAndInstall(false, true);
});

// Allow renderer to manually check for updates
ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(() => {});
});

// ====================================================================
// Clean old build artifacts on startup
// ====================================================================
function cleanOldBuilds() {
  const desktopPath = path.join(app.getPath('home'), 'Desktop');
  try {
    const entries = fs.readdirSync(desktopPath);
    for (const entry of entries) {
      // Clean old AVIS installer dirs (AVIS-Installer, AVIS-Installer-v2, AVIS-Installer-v3, etc.)
      if (/^AVIS-Installer/i.test(entry)) {
        const full = path.join(desktopPath, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
          log.info('Cleaned old build dir:', full);
        }
      }
      // Clean old setup exes (but not the current one being run)
      if (/^AVIS.*Setup.*\.exe$/i.test(entry) && !entry.includes(app.getVersion())) {
        const full = path.join(desktopPath, entry);
        try {
          fs.unlinkSync(full);
          log.info('Cleaned old installer:', full);
        } catch (e) {
          // File might be in use, skip
        }
      }
    }
  } catch (e) {
    log.warn('Could not clean old builds:', e.message);
  }

  // Also clean electron-updater temp/pending dirs
  const updaterCache = path.join(app.getPath('userData'), 'pending');
  try {
    if (fs.existsSync(updaterCache)) {
      fs.rmSync(updaterCache, { recursive: true, force: true });
      log.info('Cleaned updater cache');
    }
  } catch (e) {}
}

app.whenReady().then(() => {
  ensureDirs();
  migrateKeys();

  // Log which keys are loaded on startup
  const keys = store.get('apiKeys', {});
  Object.entries(keys).forEach(([provider, key]) => {
    if (key && key.length > 0) log.info(`Key loaded: ${provider} = ${key.substring(0, 8)}...`);
  });

  // Check if startup splash is enabled
  const configPath = path.join(APPDATA_DIR, 'config.json');
  let showSplash = true;
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.showStartupSplash === false) showSplash = false;
    }
  } catch (e) {}

  if (showSplash) {
    const splash = new BrowserWindow({
      width: 1200, height: 700, frame: false, transparent: false,
      backgroundColor: '#000000', resizable: false, center: true,
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    const startupPath = path.join(__dirname, 'src', 'startup.html');
    let startupHtml = fs.readFileSync(startupPath, 'utf-8');
    const version = require('./package.json').version;
    startupHtml = startupHtml.replace('id="version-tag"></div>', `id="version-tag">v${version}</div>`);
    const tmpStartup = path.join(APPDATA_DIR, '_startup.html');
    fs.writeFileSync(tmpStartup, startupHtml, 'utf-8');
    splash.loadFile(tmpStartup);

    createWindow();
    mainWindow.hide();

    ipcMain.once('startup-complete', () => {
      splash.destroy();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.executeJavaScript(`
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.4s ease';
        setTimeout(() => document.body.style.opacity = '1', 50);
      `).catch(() => {});
      try { fs.unlinkSync(tmpStartup); } catch (e) {}
    });

    setTimeout(() => {
      if (splash && !splash.isDestroyed()) {
        splash.destroy();
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
      }
    }, 6000);
  } else {
    createWindow();
  }

  // Set GitHub token for license binding (master only, stored locally)
  if (!store.get('github.token', '')) {
    store.set('github.token', process.env.GH_TOKEN || '');
  }

  // Validate stored license on startup
  const storedKey = store.get('license.key', '');
  if (storedKey) {
    validateLicense(storedKey).then(result => {
      licenseValid = result.valid;
      licenseTier = result.tier || 'standard';
      licenseOwner = result.owner || '';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('license-status', result);
      }
    });
  }

  startLicenseChecks();

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
ipcMain.handle('set-api-key', (_, provider, key) => {
  store.set(`apiKeys.${provider}`, key);
  backupKeys(); // always backup after key change
  return true;
});
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
// ====================================================================
// Firecrawl integration — clean markdown scraping
// ====================================================================
ipcMain.handle('firecrawl-scrape', async (_, url) => {
  const apiKey = store.get('apiKeys.firecrawl', '');
  if (!apiKey) return { success: false, error: 'Firecrawl API key not configured', fallback: true };
  try {
    const FirecrawlApp = require('@mendable/firecrawl-js').default;
    const app = new FirecrawlApp({ apiKey });
    const result = await app.scrapeUrl(url, { formats: ['markdown'] });
    if (result.success) {
      return { success: true, content: result.markdown || result.content || '', metadata: result.metadata || {} };
    }
    return { success: false, error: result.error || 'Scrape failed', fallback: true };
  } catch (err) {
    return { success: false, error: err.message, fallback: true };
  }
});

ipcMain.handle('firecrawl-crawl', async (_, url, limit) => {
  const apiKey = store.get('apiKeys.firecrawl', '');
  if (!apiKey) return { success: false, error: 'Firecrawl API key not configured' };
  try {
    const FirecrawlApp = require('@mendable/firecrawl-js').default;
    const app = new FirecrawlApp({ apiKey });
    const result = await app.crawlUrl(url, { limit: limit || 10, scrapeOptions: { formats: ['markdown'] } });
    if (result.success) {
      return { success: true, pages: (result.data || []).map(p => ({ url: p.metadata?.sourceURL || '', content: p.markdown || '' })) };
    }
    return { success: false, error: result.error || 'Crawl failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('firecrawl-search', async (_, query, limit) => {
  const apiKey = store.get('apiKeys.firecrawl', '');
  if (!apiKey) return { success: false, error: 'Firecrawl API key not configured' };
  try {
    const FirecrawlApp = require('@mendable/firecrawl-js').default;
    const app = new FirecrawlApp({ apiKey });
    const result = await app.search(query, { limit: limit || 5, scrapeOptions: { formats: ['markdown'] } });
    return { success: true, results: result.data || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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
// Computer Control — DPI-aware screenshot, click, type, scroll
// ====================================================================

// Get DPI scale factor for coordinate correction
function getScaleFactor() {
  return screen.getPrimaryDisplay().scaleFactor || 1;
}

// Display info for renderer
ipcMain.handle('get-display-info', () => {
  const d = screen.getPrimaryDisplay();
  return { scaleFactor: d.scaleFactor, bounds: d.bounds, workArea: d.workArea, size: d.size };
});

// Write a PowerShell script to temp file and execute (avoids inline escaping issues)
function runPowerShell(script) {
  return new Promise((resolve) => {
    const psFile = path.join(APPDATA_DIR, '_avis_ps.ps1');
    fs.writeFileSync(psFile, script, 'utf-8');
    exec(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 10000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(psFile); } catch (e) {}
      resolve({ success: !err, output: (stdout || '').trim(), error: err ? (stderr || err.message) : null });
    });
  });
}

ipcMain.handle('computer-action', async (_, { action, x, y, text: inputText, button, direction, amount, window_name }) => {
  const scale = getScaleFactor();
  try {
    switch (action) {
      case 'screenshot': {
        const { desktopCapturer } = require('electron');
        const thumbSize = { width: Math.round(screen.getPrimaryDisplay().size.width * scale), height: Math.round(screen.getPrimaryDisplay().size.height * scale) };

        // If window_name specified, try to capture that specific window
        if (window_name) {
          const windowSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: thumbSize });
          const target = windowSources.find(s => s.name.toLowerCase().includes(window_name.toLowerCase()));
          if (target) {
            const img = target.thumbnail;
            return { success: true, action: 'screenshot', image: img.toDataURL(), width: img.getSize().width, height: img.getSize().height, scaleFactor: scale, windowName: target.name, mode: 'window' };
          }
          // Window not found — list available windows so Claude can retry
          const available = windowSources.map(s => s.name).slice(0, 15);
          return { success: false, action: 'screenshot', error: `Window "${window_name}" not found. Available: ${available.join(', ')}`, availableWindows: available };
        }

        // No window_name — capture full desktop
        const screenSources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumbSize });
        if (screenSources.length > 0) {
          const img = screenSources[0].thumbnail;
          return { success: true, action: 'screenshot', image: img.toDataURL(), width: img.getSize().width, height: img.getSize().height, scaleFactor: scale, mode: 'desktop' };
        }
        // Fallback
        const fallback = await mainWindow.webContents.capturePage();
        return { success: true, action: 'screenshot', image: fallback.toDataURL(), scaleFactor: scale, mode: 'fallback' };
      }

      case 'list_windows': {
        const { desktopCapturer } = require('electron');
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
        return { success: true, action: 'list_windows', windows: sources.map(s => s.name).filter(n => n.length > 0) };
      }

      case 'click': {
        // Apply DPI scaling to coordinates
        const cx = Math.round((x || 0) * scale);
        const cy = Math.round((y || 0) * scale);
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -Name U -Namespace W
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
Start-Sleep -Milliseconds 50
[W.U]::mouse_event(0x02, 0, 0, 0, 0)
[W.U]::mouse_event(0x04, 0, 0, 0, 0)
`;
        const result = await runPowerShell(ps);
        return { success: result.success, action: 'click', x: cx, y: cy, originalX: x, originalY: y, scaleFactor: scale, error: result.error };
      }

      case 'double_click': {
        const cx = Math.round((x || 0) * scale);
        const cy = Math.round((y || 0) * scale);
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -Name U -Namespace W
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
Start-Sleep -Milliseconds 50
[W.U]::mouse_event(0x02, 0, 0, 0, 0)
[W.U]::mouse_event(0x04, 0, 0, 0, 0)
Start-Sleep -Milliseconds 80
[W.U]::mouse_event(0x02, 0, 0, 0, 0)
[W.U]::mouse_event(0x04, 0, 0, 0, 0)
`;
        const result = await runPowerShell(ps);
        return { success: result.success, action: 'double_click', x: cx, y: cy, error: result.error };
      }

      case 'right_click': {
        const cx = Math.round((x || 0) * scale);
        const cy = Math.round((y || 0) * scale);
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -Name U -Namespace W
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
Start-Sleep -Milliseconds 50
[W.U]::mouse_event(0x08, 0, 0, 0, 0)
[W.U]::mouse_event(0x10, 0, 0, 0, 0)
`;
        const result = await runPowerShell(ps);
        return { success: result.success, action: 'right_click', x: cx, y: cy, error: result.error };
      }

      case 'type': {
        // Write text to a temp file and use PowerShell clip + paste for reliability
        if (!inputText) return { success: false, action: 'type', error: 'No text provided' };
        const textFile = path.join(APPDATA_DIR, '_avis_type.txt');
        fs.writeFileSync(textFile, inputText, 'utf-8');
        const ps = `
$text = [System.IO.File]::ReadAllText("${textFile.replace(/\\/g, '\\\\')}")
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($text.Replace('+','{+}').Replace('^','{^}').Replace('%','{%}').Replace('~','{~}').Replace('(','{(}').Replace(')','{)}').Replace('{','{{}').Replace('}','{}}'))
`;
        const result = await runPowerShell(ps);
        try { fs.unlinkSync(textFile); } catch (e) {}
        return { success: result.success, action: 'type', error: result.error };
      }

      case 'key': {
        // Send special key combos: {ENTER}, {TAB}, ^c (Ctrl+C), etc.
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${(inputText || '').replace(/"/g, '`"')}")
`;
        const result = await runPowerShell(ps);
        return { success: result.success, action: 'key', key: inputText, error: result.error };
      }

      case 'scroll': {
        const scrollAmount = amount || 3;
        const scrollDir = direction === 'up' ? 120 * scrollAmount : -120 * scrollAmount;
        const ps = `
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -Name U -Namespace W
[W.U]::mouse_event(0x0800, 0, 0, ${scrollDir}, 0)
`;
        const result = await runPowerShell(ps);
        return { success: result.success, action: 'scroll', direction, error: result.error };
      }

      case 'move': {
        const cx = Math.round((x || 0) * scale);
        const cy = Math.round((y || 0) * scale);
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})
`;
        const result = await runPowerShell(ps);
        return { success: result.success, action: 'move', x: cx, y: cy, error: result.error };
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
        const m = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        await m.generateContent('Hi');
        return { success: true };
      }
      case 'grok': {
        const axios = require('axios');
        const grokModels = ['grok-2-latest', 'grok-beta'];
        for (const gm of grokModels) {
          try {
            await axios.post('https://api.x.ai/v1/chat/completions', {
              model: gm, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5
            }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 });
            return { success: true };
          } catch (e) {
            if (e.response?.status === 401) return { success: false, error: 'Invalid API key' };
            if (e.response?.status === 400 || e.response?.status === 404) continue;
            continue;
          }
        }
        return { success: false, error: 'No Grok model responded. Check your xAI API plan.' };
      }
      case 'mistral': {
        const axios = require('axios');
        await axios.post('https://api.mistral.ai/v1/chat/completions', { model: 'mistral-small-latest', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        return { success: true };
      }
      case 'perplexity': {
        const axios = require('axios');
        await axios.post('https://api.perplexity.ai/chat/completions', { model: 'sonar', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
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
      case 'firecrawl': {
        const FirecrawlApp = require('@mendable/firecrawl-js').default;
        const fcApp = new FirecrawlApp({ apiKey });
        await fcApp.scrapeUrl('https://example.com', { formats: ['markdown'] });
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

// ====================================================================
// Streaming Claude call — sends chunks to renderer in real time
// ====================================================================
ipcMain.handle('api-call-stream-start', async (_, { model, messages, systemPrompt }) => {
  const apiKey = store.get('apiKeys.claude', '');
  if (!apiKey) return { error: true, message: 'No Claude API key' };

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const claudeMessages = sanitizeClaudeMessages(messages.map(m => {
      if (Array.isArray(m.content)) return { role: m.role, content: m.content };
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.images ? [
          ...m.images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })),
          { type: 'text', text: (m.content && m.content.trim()) ? m.content : 'Please analyze this image.' }
        ] : m.content
      };
    }));

    if (claudeMessages.length === 0) return { error: true, message: 'Empty message' };

    const stream = client.messages.stream({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt || '',
      messages: claudeMessages
    });

    let inputTokens = 0, outputTokens = 0;

    stream.on('text', (text) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-chunk', text);
      }
    });

    const finalMessage = await stream.finalMessage();
    inputTokens = finalMessage.usage?.input_tokens || 0;
    outputTokens = finalMessage.usage?.output_tokens || 0;
    const fullText = finalMessage.content.map(b => b.text || '').join('');

    return { error: false, text: fullText, inputTokens, outputTokens, model: finalMessage.model };
  } catch (err) {
    return { error: true, message: err.message };
  }
});

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
  const modelId = model || 'gemini-1.5-flash';

  // Use generateContent for simple single-turn, startChat for multi-turn
  const genModel = genAI.getGenerativeModel({ model: modelId });

  // Extract the last user message
  const last = messages[messages.length - 1];
  const prompt = (typeof last.content === 'string') ? last.content : (last.content || 'Hello');

  // Build parts
  const parts = [];
  if (systemPrompt) parts.push({ text: `System: ${systemPrompt}\n\n` });
  if (last.images) {
    for (const img of last.images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: prompt });

  // If multi-turn (>1 message), use chat
  if (messages.length > 1) {
    const history = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i];
      const text = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content);
      if (text && text.trim()) {
        history.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
      }
    }
    // Gemini requires history to start with user and alternate
    const cleanHistory = [];
    let lastRole = null;
    for (const h of history) {
      if (h.role !== lastRole) { cleanHistory.push(h); lastRole = h.role; }
    }
    if (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') cleanHistory.shift();

    try {
      const chat = genModel.startChat({ history: cleanHistory });
      const result = await chat.sendMessage(parts);
      const usage = result.response.usageMetadata || {};
      return { text: result.response.text(), inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, model: modelId };
    } catch (chatErr) {
      // Fall through to simple generateContent
    }
  }

  // Simple single-turn
  const result = await genModel.generateContent(parts);
  const usage = result.response.usageMetadata || {};
  return { text: result.response.text(), inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, model: modelId };
}

async function callGrok(apiKey, model, messages, systemPrompt) {
  const axios = require('axios');
  const oaiMessages = [];
  // Grok supports system role
  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
    oaiMessages.push({ role: 'system', content: systemPrompt.substring(0, 2000) });
  }
  for (const m of messages) {
    // Extract plain text — Grok only accepts string content
    let content = '';
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      // Extract text from multimodal content blocks
      content = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    if (!content || !content.trim()) continue;
    // Normalize role to user/assistant/system only
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    oaiMessages.push({ role, content: content.trim() });
  }

  if (oaiMessages.length === 0 || !oaiMessages.some(m => m.role === 'user')) {
    oaiMessages.push({ role: 'user', content: 'Hello' });
  }

  const models = [model || 'grok-2-latest', 'grok-beta'];
  let lastErr = null;
  for (const grokModel of models) {
    try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: grokModel, messages: oaiMessages, max_tokens: 4096
      }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });

      const d = response.data;
      return { text: d.choices[0].message.content, inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0, model: d.model || grokModel };
    } catch (err) {
      lastErr = err;
      if (err.response?.status === 401) throw new Error('Invalid Grok API key');
      if (err.response?.status === 400 || err.response?.status === 404) continue;
      throw err;
    }
  }
  throw lastErr || new Error('All Grok models failed');
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
    model: model || 'sonar-pro', messages: oaiMessages, max_tokens: 4096
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
