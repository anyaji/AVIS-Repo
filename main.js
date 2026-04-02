const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const os = require('os');
const { exec, execSync, spawn } = require('child_process');
const WebSocket = require('ws');

// ====================================================================
// Real Desktop Path — OneDrive-aware
// ====================================================================
const REAL_DESKTOP = path.join(os.homedir(), 'Desktop');

function resolveDesktopInTask(task) {
  return task
    .replace(/my desktop/gi, `"${REAL_DESKTOP}"`)
    .replace(/the desktop/gi, `"${REAL_DESKTOP}"`)
    .replace(/C:\\Users\\anyaj\\Desktop/gi, REAL_DESKTOP)
    .replace(/C:\/Users\/anyaj\/Desktop/gi, REAL_DESKTOP.replace(/\\/g, '/'));
}
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
// Chrome MCP Client — connects to Claude in Chrome extension
// ====================================================================
class ChromeMCPClient {
  constructor() {
    this.connected = false;
    this.ws = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this._reconnectTimer = null;
  }

  async connect() {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket('ws://localhost:10235');

        this.ws.on('open', () => {
          this.connected = true;
          log.info('Chrome MCP connected');
          resolve(true);
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            if (msg.id && this.pendingRequests.has(msg.id)) {
              const { resolve, reject } = this.pendingRequests.get(msg.id);
              this.pendingRequests.delete(msg.id);
              if (msg.error) reject(new Error(msg.error.message));
              else resolve(msg.result);
            }
          } catch (err) {
            log.error('Chrome MCP message error:', err);
          }
        });

        this.ws.on('close', () => {
          this.connected = false;
          log.warn('Chrome MCP disconnected');
          if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
          this._reconnectTimer = setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', () => {
          this.connected = false;
          resolve(false);
        });
      } catch (err) {
        log.error('Chrome MCP connection failed:', err);
        resolve(false);
      }
    });
  }

  async call(method, params = {}) {
    if (!this.connected) throw new Error('Chrome extension not connected');
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Chrome MCP timeout'));
        }
      }, 60000);
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async navigate(url) { return this.call('browser/navigate', { url }); }
  async screenshot() { return this.call('browser/screenshot'); }
  async click(selector) { return this.call('browser/click', { selector }); }
  async type(selector, text) { return this.call('browser/type', { selector, text }); }
  async getPageContent() { return this.call('browser/getContent'); }
  async executeScript(script) { return this.call('browser/executeScript', { script }); }
  async waitForElement(selector, timeout = 10000) { return this.call('browser/waitForElement', { selector, timeout }); }
  async scroll(direction = 'down', amount = 300) { return this.call('browser/scroll', { direction, amount }); }
  isConnected() { return this.connected; }
}

const chromeMCP = new ChromeMCPClient();

// ====================================================================
// License System — master key always works, others validated via GitHub
// ====================================================================
const MASTER_KEY_HASH = '7a0aea83059eb157e2eba32700fdec68ab3d4bd279c32c8b81b8b5ef72fab796'; // SHA256 of master key
const LICENSE_URL = 'https://api.github.com/repos/anyaji/AVIS-Repo/contents/licenses.json';
// Obfuscated token — decoded at runtime
const _LT = [103,104,112,95,67,89,81,122,53,55,102,103,113,88,90,100,78,75,108,121,87,119,89,109,69,102,115,82,56,119,87,90,97,56,52,65,50,88,114,65];
const LICENSE_TOKEN = _LT.map(c => String.fromCharCode(c)).join('');
let licenseValid = false;
let licenseTier = 'standard';
let licenseOwner = '';

function hashKey(key) {
  return require('crypto').createHash('sha256').update(key.trim()).digest('hex');
}

function isMasterKey(key) {
  return hashKey(key) === MASTER_KEY_HASH;
}

// Generate a unique device fingerprint — stable across restarts, unique per machine
function getDeviceId() {
  const crypto = require('crypto');
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

  // Check remote license file (private repo — requires auth)
  try {
    const axios = require('axios');
    const response = await axios.get(LICENSE_URL, {
      timeout: 10000,
      headers: { 'Authorization': `token ${LICENSE_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' }
    });
    const data = response.data;
    // Keys are stored as SHA256 hashes — hash the user input to look up
    const keyHash = hashKey(key);
    const license = data.licenses?.[keyHash];

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

    // Get current file SHA (needed for GitHub API update)
    const fileInfo = await axios.get('https://api.github.com/repos/anyaji/AVIS-Repo/contents/licenses.json', {
      headers: { 'Authorization': `token ${LICENSE_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000
    });
    const sha = fileInfo.data.sha;

    // Update the license entry with device ID (keys stored as hashes)
    const keyHash = hashKey(key);
    currentData.licenses[keyHash].deviceId = deviceId;
    currentData.licenses[keyHash].activatedAt = new Date().toISOString();
    currentData.updated = new Date().toISOString().slice(0, 10);

    // Push update
    const content = Buffer.from(JSON.stringify(currentData, null, 2) + '\n').toString('base64');
    await axios.put('https://api.github.com/repos/anyaji/AVIS-Repo/contents/licenses.json', {
      message: `License activated on device ${deviceId}`,
      content,
      sha
    }, {
      headers: { 'Authorization': `token ${LICENSE_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
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

// License management — master key only
ipcMain.handle('license:list-all', async () => {
  if (licenseTier !== 'master') return { error: 'Unauthorized' };
  try {
    const axios = require('axios');
    const response = await axios.get(LICENSE_URL, {
      timeout: 10000,
      headers: { 'Authorization': `token ${LICENSE_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' }
    });
    return { success: true, data: response.data };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('license:update-status', async (_, { hash, status }) => {
  if (licenseTier !== 'master') return { error: 'Unauthorized' };
  try {
    const axios = require('axios');
    // Fetch current file with SHA
    const fileInfo = await axios.get(LICENSE_URL, {
      headers: { 'Authorization': `token ${LICENSE_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000
    });
    const sha = fileInfo.data.sha;
    const content = Buffer.from(fileInfo.data.content, 'base64').toString('utf-8');
    const data = JSON.parse(content);

    if (!data.licenses[hash]) return { error: 'License not found' };
    data.licenses[hash].status = status;
    data.updated = new Date().toISOString().slice(0, 10);

    const newContent = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');
    await axios.put('https://api.github.com/repos/anyaji/AVIS-Repo/contents/licenses.json', {
      message: `License ${data.licenses[hash].owner} ${status}`,
      content: newContent,
      sha
    }, {
      headers: { 'Authorization': `token ${LICENSE_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000
    });

    log.info(`License ${data.licenses[hash].owner} set to ${status}`);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

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
        autoUpdater.quitAndInstall(true, true);
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
  autoUpdater.quitAndInstall(true, true);
});

// Allow renderer to manually check for updates
ipcMain.on('check-for-updates', () => {
  if (!app.isPackaged) {
    sendUpdateStatus('current', `AVIS v${app.getVersion()} is up to date (dev mode)`);
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    sendUpdateStatus('error', `Update check failed: ${err.message || 'unknown error'}`);
  });
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

// Single instance lock — only one copy of AVIS at a time
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Single instance — second launch kills the first and takes over
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // We are the second instance — the first will receive 'second-instance' and quit
  // Wait briefly for the first to die, then relaunch ourselves
  const { spawn: spawnProc } = require('child_process');
  setTimeout(() => {
    spawnProc(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }, 1500);
} else {
  app.on('second-instance', () => {
    // First instance receives this — release lock and quit so the new one can take over
    app.releaseSingleInstanceLock();
    app.quit();
  });
}

app.whenReady().then(() => {
  ensureDirs();
  migrateKeys();

  // v3.1.0 migration — force users to re-enter API keys
  const lastMigration = store.get('migration.version', '0.0.0');
  if (lastMigration < '3.1.0') {
    log.info('v3.1.0 migration: clearing API keys and onboarding flag');
    store.delete('apiKeys');
    store.set('onboardingComplete', false);
    store.set('migration.version', '3.1.0');
    // Also clear the backup so migrateKeys() doesn't restore old keys
    const backupPath = path.join(app.getPath('appData'), 'AVIS', 'keys-backup.json');
    try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (e) {}
  }

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
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
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

  // GitHub token for releases is set via GH_TOKEN env var at build time
  // License token is embedded in LICENSE_TOKEN constant

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
  startSentinel();

  // Connect to Chrome MCP extension (non-blocking)
  chromeMCP.connect().then(ok => {
    log.info('Chrome MCP status:', ok ? 'connected' : 'unavailable');
  });

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

// Config management
ipcMain.handle('get-config', () => {
  const configPath = path.join(APPDATA_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
    return JSON.parse(raw);
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

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
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

// ====================================================================
// Image handling — save, wallpaper, clipboard
// ====================================================================
ipcMain.handle('save-image', async (_, { base64, savePath }) => {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(savePath, buffer);
    return { success: true, path: savePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-wallpaper', async (_, imagePath) => {
  const absPath = path.resolve(imagePath);
  const platform = process.platform;

  return new Promise((resolve) => {
    let cmd;
    if (platform === 'win32') {
      const winPath = absPath.replace(/\//g, '\\');
      const psFile = path.join(APPDATA_DIR, '_wp.ps1');
      fs.writeFileSync(psFile, `
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class WP {
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[WP]::SystemParametersInfo(20, 0, "${winPath}", 3)
`, 'utf-8');
      cmd = `powershell -ExecutionPolicy Bypass -File "${psFile}"`;
      exec(cmd, (err) => {
        try { fs.unlinkSync(psFile); } catch (e) {}
        resolve({ success: !err, error: err?.message });
      });
    } else if (platform === 'darwin') {
      cmd = `osascript -e 'tell application "Finder" to set desktop picture to POSIX file "${absPath}"'`;
      exec(cmd, (err) => resolve({ success: !err, error: err?.message }));
    } else {
      // Linux — try common desktop environments
      exec(`gsettings set org.gnome.desktop.background picture-uri "file://${absPath}" 2>/dev/null || feh --bg-fill "${absPath}" 2>/dev/null`, (err) => {
        resolve({ success: !err, error: err?.message });
      });
    }
  });
});

ipcMain.handle('copy-image-clipboard', async (_, base64) => {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const image = nativeImage.createFromBuffer(buffer);
    const { clipboard } = require('electron');
    clipboard.writeImage(image);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====================================================================
// Document Generation — PPTX, DOCX, XLSX
// ====================================================================
ipcMain.handle('generate-pptx', async (_, { slides, options }) => {
  try {
    const PptxGenJS = require('pptxgenjs');
    const pptx = new PptxGenJS();
    pptx.author = options?.author || 'AVIS';
    pptx.title = options?.title || 'Presentation';
    if (options?.layout) pptx.layout = options.layout;

    for (const slideData of slides) {
      const slide = pptx.addSlide();
      if (slideData.background) slide.background = slideData.background;

      for (const el of (slideData.elements || [])) {
        switch (el.type) {
          case 'title':
            slide.addText(el.text, {
              x: el.x || 0.5, y: el.y || 0.5, w: el.w || '90%',
              fontSize: el.fontSize || 28, bold: true, color: el.color || 'FFFFFF',
              fontFace: el.font || 'Arial', align: el.align || 'left'
            });
            break;
          case 'text':
            slide.addText(el.text, {
              x: el.x || 0.5, y: el.y || 1.5, w: el.w || '90%', h: el.h,
              fontSize: el.fontSize || 14, color: el.color || 'CCCCCC',
              fontFace: el.font || 'Arial', align: el.align || 'left',
              bullet: el.bullet || false, lineSpacing: el.lineSpacing || 22
            });
            break;
          case 'image':
            const imgOpts = { x: el.x || 0.5, y: el.y || 1.5, w: el.w || 4, h: el.h || 3 };
            if (el.data) imgOpts.data = el.data; // base64
            else if (el.path) imgOpts.path = el.path;
            slide.addImage(imgOpts);
            break;
          case 'table':
            slide.addTable(el.rows, {
              x: el.x || 0.5, y: el.y || 1.5, w: el.w || '90%',
              fontSize: el.fontSize || 11, color: el.color || 'CCCCCC',
              border: { pt: 0.5, color: '666666' },
              colW: el.colWidths, autoPage: true
            });
            break;
          case 'shape':
            slide.addShape(pptx.shapes[el.shape || 'RECTANGLE'], {
              x: el.x || 0, y: el.y || 0, w: el.w || 10, h: el.h || 0.05,
              fill: { color: el.fill || '00A8FF' }
            });
            break;
          case 'chart':
            slide.addChart(pptx.charts[el.chartType || 'BAR'], el.chartData, {
              x: el.x || 0.5, y: el.y || 1.5, w: el.w || 8, h: el.h || 4,
              showTitle: !!el.chartTitle, title: el.chartTitle || '',
              showValue: el.showValues !== false
            });
            break;
        }
      }
    }

    const savePath = path.join(app.getPath('desktop'), `${options?.filename || 'AVIS_Presentation'}.pptx`);
    await pptx.writeFile({ fileName: savePath });
    return { success: true, path: savePath, slides: slides.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('generate-docx', async (_, { content, options }) => {
  try {
    const docx = require('docx');
    const children = [];

    for (const block of content) {
      switch (block.type) {
        case 'heading':
          children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: block.text, bold: true, size: (block.level === 1 ? 32 : block.level === 2 ? 26 : 22) * 2, font: block.font || 'Arial' })],
            heading: block.level === 1 ? docx.HeadingLevel.HEADING_1 : block.level === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3,
            spacing: { after: 200 }
          }));
          break;
        case 'paragraph':
          children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: block.text, size: (block.fontSize || 12) * 2, font: block.font || 'Arial', bold: block.bold, italics: block.italic, color: block.color })],
            spacing: { after: 120 }, alignment: block.align === 'center' ? docx.AlignmentType.CENTER : block.align === 'right' ? docx.AlignmentType.RIGHT : docx.AlignmentType.LEFT,
            bullet: block.bullet ? { level: 0 } : undefined
          }));
          break;
        case 'image':
          if (block.data) {
            children.push(new docx.Paragraph({
              children: [new docx.ImageRun({ data: Buffer.from(block.data, 'base64'), transformation: { width: block.width || 400, height: block.height || 300 }, type: 'png' })],
              alignment: docx.AlignmentType.CENTER
            }));
          }
          break;
        case 'table':
          children.push(new docx.Table({
            rows: block.rows.map((row, ri) => new docx.TableRow({
              children: row.map(cell => new docx.TableCell({
                children: [new docx.Paragraph({ children: [new docx.TextRun({ text: String(cell), bold: ri === 0, size: 22, font: 'Arial' })] })],
                shading: ri === 0 ? { fill: '003366', color: 'FFFFFF' } : undefined,
                width: { size: 2000, type: docx.WidthType.DXA }
              }))
            })),
            width: { size: 100, type: docx.WidthType.PERCENTAGE }
          }));
          break;
        case 'pagebreak':
          children.push(new docx.Paragraph({ children: [], pageBreakBefore: true }));
          break;
      }
    }

    const doc = new docx.Document({
      creator: options?.author || 'AVIS',
      title: options?.title || 'Document',
      sections: [{ children }]
    });

    const buffer = await docx.Packer.toBuffer(doc);
    const savePath = path.join(app.getPath('desktop'), `${options?.filename || 'AVIS_Document'}.docx`);
    fs.writeFileSync(savePath, buffer);
    return { success: true, path: savePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('generate-xlsx', async (_, { sheets, options }) => {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();

    for (const sheet of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.data);
      if (sheet.colWidths) ws['!cols'] = sheet.colWidths.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, sheet.name || 'Sheet1');
    }

    const savePath = path.join(app.getPath('desktop'), `${options?.filename || 'AVIS_Spreadsheet'}.xlsx`);
    XLSX.writeFile(wb, savePath);
    return { success: true, path: savePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Dynamic paths — work for ANY user on ANY machine
ipcMain.handle('get-paths', () => ({
  home: app.getPath('home'),
  desktop: app.getPath('desktop'),
  documents: app.getPath('documents'),
  downloads: app.getPath('downloads'),
  appData: app.getPath('userData'),
  temp: app.getPath('temp'),
  avisSource: __dirname
}));

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
// Firecrawl API key verification — quick scrape of example.com
ipcMain.handle('firecrawl-verify', async () => {
  const apiKey = store.get('apiKeys.firecrawl', '');
  if (!apiKey) return { valid: false, error: 'No Firecrawl API key configured' };
  try {
    const FirecrawlApp = require('@mendable/firecrawl-js').default;
    const fcApp = new FirecrawlApp({ apiKey });
    const result = await fcApp.v1.scrapeUrl('https://example.com', { formats: ['markdown'] });
    return { valid: result.success === true, error: result.success ? null : 'Scrape test failed' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
});

ipcMain.handle('firecrawl-scrape', async (_, url) => {
  const apiKey = store.get('apiKeys.firecrawl', '');
  if (!apiKey) return { success: false, error: 'Firecrawl API key not configured', fallback: true };
  try {
    const FirecrawlApp = require('@mendable/firecrawl-js').default;
    const app = new FirecrawlApp({ apiKey });
    const result = await app.v1.scrapeUrl(url, { formats: ['markdown'] });
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
    const result = await app.v1.crawlUrl(url, { limit: limit || 10, scrapeOptions: { formats: ['markdown'] } });
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
    const result = await app.v1.search(query, { limit: limit || 5, scrapeOptions: { formats: ['markdown'] } });
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
// Claude Code permission enforcement — master key always has full access,
// standard users locked to safe mode unless explicitly unlocked
function isClaudeCodeUnlocked() {
  if (licenseTier === 'master') return true;
  return store.get('claudeCode.unlocked', false);
}

ipcMain.handle('get-real-desktop', () => REAL_DESKTOP);

ipcMain.handle('claude-code-check-unlock', () => ({
  unlocked: isClaudeCodeUnlocked(),
  tier: licenseTier,
  isMaster: licenseTier === 'master'
}));

// Master-only: unlock/lock Claude Code dangerous mode for this device
ipcMain.handle('claude-code-set-unlock', (_, unlocked) => {
  if (licenseTier !== 'master') return { error: 'Only master license can change this setting' };
  store.set('claudeCode.unlocked', !!unlocked);
  log.info(`Claude Code dangerous mode ${unlocked ? 'UNLOCKED' : 'LOCKED'} by master`);
  return { success: true, unlocked: !!unlocked };
});

ipcMain.handle('run-claude-code', async (_, { task, projectPath, flags }) => {
  return new Promise((resolve) => {
    // SECURITY: enforce safe mode for locked users — strip dangerous flags
    let cliFlags = flags || '--dangerously-skip-permissions';
    if (!isClaudeCodeUnlocked()) {
      // Strip dangerous flag — force safe/interactive mode
      cliFlags = cliFlags.replace(/--dangerously-skip-permissions/g, '').trim();
      log.info('Claude Code: dangerous mode LOCKED — running in safe mode');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude-code-chunk',
          '[AVIS] Claude Code running in SAFE MODE (permissions required).\n' +
          '[AVIS] Contact admin to unlock full autonomy.\n\n'
        );
      }
    }

    // Resolve "my desktop" / "the desktop" to real OneDrive-aware path
    const resolvedTask = resolveDesktopInTask(task);

    // Build full shell command — must quote the task to preserve multi-word strings
    const escapedTask = resolvedTask.replace(/"/g, '\\"');
    const cmd = cliFlags
      ? `claude ${cliFlags} -p "${escapedTask}"`
      : `claude -p "${escapedTask}"`;

    const proc = spawn(cmd, [], {
      cwd: projectPath || process.cwd(),
      timeout: 1800000, // 30 min for full builds
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
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
const API_TIMEOUT_MS = 90000; // 90s for regular API calls (council synthesis needs more time)
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
  // DALL-E uses the OpenAI key — detect by provider name OR model name OR isDalle flag
  const isDalle = provider === 'dalle' || model === 'dall-e-3' || options?.isDalle;
  const keyName = (isDalle || provider === 'dalle') ? 'openai' : provider;
  const apiKey = store.get(`apiKeys.${keyName}`, '');
  if (!apiKey) throw new Error(`No API key configured for ${keyName}`);

  try {
    let callFn;

    // Route DALL-E before the switch — catches all paths (provider='openai' with model='dall-e-3', provider='dalle', isDalle flag)
    if (isDalle) {
      callFn = callDalle(store.get('apiKeys.openai', ''), model, messages, options);
    } else switch (provider) {
      case 'claude': callFn = callClaude(apiKey, model, messages, systemPrompt, options); break;
      case 'deepseek': callFn = callDeepSeek(apiKey, model, messages, systemPrompt, options); break;
      case 'openai': callFn = callOpenAI(apiKey, model, messages, systemPrompt, options); break;
      case 'gemini': callFn = callGemini(apiKey, model, messages, systemPrompt, options); break;
      case 'mistral': callFn = callMistral(apiKey, model, messages, systemPrompt, options); break;
      case 'perplexity': callFn = callPerplexity(apiKey, model, messages, systemPrompt, options); break;
      case 'dalle': callFn = callDalle(store.get('apiKeys.openai', ''), model, messages, options); break;
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

    const apiPromise = client.messages.create(params).withResponse();
    const { data: response, response: rawResponse } = await withTimeout(apiPromise, 120000, 'Claude agentic call');

    if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };

    // Capture rate limit headers and send to renderer
    try {
      const headers = rawResponse?.headers;
      if (headers && mainWindow && !mainWindow.isDestroyed()) {
        const rateLimits = {
          requestLimit: parseInt(headers.get('x-ratelimit-limit-requests') || '0'),
          requestsRemaining: parseInt(headers.get('x-ratelimit-remaining-requests') || '0'),
          requestReset: headers.get('x-ratelimit-reset-requests') || '',
          tokenLimit: parseInt(headers.get('x-ratelimit-limit-tokens') || '0'),
          tokensRemaining: parseInt(headers.get('x-ratelimit-remaining-tokens') || '0'),
          tokenReset: headers.get('x-ratelimit-reset-tokens') || '',
          retryAfter: headers.get('retry-after') || null,
          timestamp: Date.now()
        };
        mainWindow.webContents.send('claude-rate-limits', rateLimits);
      }
    } catch (e) { /* rate limit parsing is non-critical */ }

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
        const m = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        await m.generateContent('Hi');
        return { success: true };
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
      case 'deepseek': {
        const axios = require('axios');
        await axios.post('https://api.deepseek.com/chat/completions', { model: 'deepseek-chat', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        return { success: true };
      }
      case 'firecrawl': {
        const FirecrawlApp = require('@mendable/firecrawl-js').default;
        const fcApp = new FirecrawlApp({ apiKey });
        await fcApp.v1.scrapeUrl('https://example.com', { formats: ['markdown'] });
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

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

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

    if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };

    const stream = client.messages.stream({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt || '',
      messages: claudeMessages
    });

    // Force-abort the stream when signal fires
    const onAbort = () => { try { stream.abort(); } catch (_) {} };
    signal.addEventListener('abort', onAbort, { once: true });

    let inputTokens = 0, outputTokens = 0;

    stream.on('text', (text) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-chunk', text);
      }
    });

    try {
      const finalMessage = await stream.finalMessage();
      inputTokens = finalMessage.usage?.input_tokens || 0;
      outputTokens = finalMessage.usage?.output_tokens || 0;
      const fullText = finalMessage.content.map(b => b.text || '').join('');
      return { error: false, text: fullText, inputTokens, outputTokens, model: finalMessage.model };
    } catch (streamErr) {
      if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };
      throw streamErr;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } catch (err) {
    if (signal.aborted) return { error: true, message: 'Request cancelled', code: 'ABORT' };
    return { error: true, message: err.message };
  } finally {
    activeAbortController = null;
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

  const { data: response, response: rawResponse } = await client.messages.create({
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt || '',
    messages: claudeMessages
  }).withResponse();

  // Capture rate limit headers
  try {
    const headers = rawResponse?.headers;
    if (headers && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-rate-limits', {
        requestLimit: parseInt(headers.get('x-ratelimit-limit-requests') || '0'),
        requestsRemaining: parseInt(headers.get('x-ratelimit-remaining-requests') || '0'),
        requestReset: headers.get('x-ratelimit-reset-requests') || '',
        tokenLimit: parseInt(headers.get('x-ratelimit-limit-tokens') || '0'),
        tokensRemaining: parseInt(headers.get('x-ratelimit-remaining-tokens') || '0'),
        tokenReset: headers.get('x-ratelimit-reset-tokens') || '',
        retryAfter: headers.get('retry-after') || null,
        timestamp: Date.now()
      });
    }
  } catch (e) {}

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
  const modelId = model || 'gemini-2.5-flash';

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

// DALL-E 3 via OpenAI — primary image generator
async function callDalle(apiKey, model, messages, options) {
  const axios = require('axios');
  const lastMsg = messages[messages.length - 1];
  const prompt = (typeof lastMsg.content === 'string') ? lastMsg.content : 'A beautiful image';

  // DALL-E 3 supports: 1024x1024, 1024x1792, 1792x1024
  const size = options?.size || (options?.wallpaper ? '1792x1024' : '1024x1024');

  const response = await axios.post('https://api.openai.com/v1/images/generations', {
    model: 'dall-e-3',
    prompt,
    n: 1,
    size,
    response_format: 'b64_json',
    quality: 'hd'
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });

  const imageData = response.data.data[0];
  return { text: '', image: { data: imageData.b64_json, mimeType: 'image/png' }, inputTokens: 0, outputTokens: 0, model: 'dall-e-3', revisedPrompt: imageData.revised_prompt };
}

// ====================================================================
// SESSION JOURNAL — Daily logs + pinned memories
// ====================================================================
const JOURNAL_DIR = path.join(app.getPath('documents'), 'AVIS', 'Journal');
try { fs.mkdirSync(JOURNAL_DIR, { recursive: true }); } catch (e) {}

function getJournalPath() {
  const today = new Date().toISOString().split('T')[0];
  return path.join(JOURNAL_DIR, `${today}.md`);
}

ipcMain.handle('journal-log', (_, data) => {
  try {
    const time = new Date().toLocaleTimeString();
    const entry = `\n### ${time} \u2014 ${(data.taskType || 'general').toUpperCase()}
**Agent:** ${data.agent || 'Claude'}
**User:** ${(data.userMessage || '').substring(0, 150)}
**Summary:** ${(data.summary || '').substring(0, 300)}
**Cost:** $${(data.cost || 0).toFixed(4)}
**Method:** ${data.method || 'direct'}
---\n`;
    fs.appendFileSync(getJournalPath(), entry, 'utf8');
    return { success: true };
  } catch (err) {
    log.warn('Journal log failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('journal-get-recent', (_, days) => {
  try {
    const entries = [];
    for (let i = 0; i < (days || 3); i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const p = path.join(JOURNAL_DIR, `${d.toISOString().split('T')[0]}.md`);
      if (fs.existsSync(p)) {
        entries.push(fs.readFileSync(p, 'utf8').substring(0, 1000));
      }
    }
    return entries.join('\n');
  } catch (err) {
    return '';
  }
});

ipcMain.handle('journal-save-memory', (_, fact) => {
  try {
    const p = path.join(JOURNAL_DIR, 'pinned-memories.md');
    fs.appendFileSync(p, `- [${new Date().toLocaleDateString()}] ${fact}\n`, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('journal-get-memories', () => {
  try {
    const p = path.join(JOURNAL_DIR, 'pinned-memories.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  } catch (err) {
    return '';
  }
});

// ====================================================================
// Chrome MCP IPC handlers — bridge renderer to Chrome extension
// ====================================================================
ipcMain.handle('chrome:navigate', (_, url) => chromeMCP.navigate(url));
ipcMain.handle('chrome:screenshot', () => chromeMCP.screenshot());
ipcMain.handle('chrome:click', (_, sel) => chromeMCP.click(sel));
ipcMain.handle('chrome:type', (_, sel, text) => chromeMCP.type(sel, text));
ipcMain.handle('chrome:getContent', () => chromeMCP.getPageContent());
ipcMain.handle('chrome:executeScript', (_, script) => chromeMCP.executeScript(script));
ipcMain.handle('chrome:waitFor', (_, sel, t) => chromeMCP.waitForElement(sel, t));
ipcMain.handle('chrome:scroll', (_, dir, amt) => chromeMCP.scroll(dir, amt));
ipcMain.handle('chrome:isConnected', () => chromeMCP.isConnected());

// ====================================================================
// Workflow Recorder IPC handlers — save/load browser workflows
// ====================================================================
const WORKFLOWS_DIR = path.join(os.homedir(), 'Documents', 'AVIS', 'Workflows');
try { fs.mkdirSync(WORKFLOWS_DIR, { recursive: true }); } catch (e) {}

ipcMain.handle('workflow:save', (_, name, taskDescription, steps) => {
  try {
    const workflow = {
      name,
      description: taskDescription,
      steps: steps.filter(s => s.success).map(s => s.step),
      savedAt: new Date().toISOString(),
      timesUsed: 0
    };
    const filename = name.toLowerCase().replace(/\s+/g, '-') + '.json';
    fs.writeFileSync(path.join(WORKFLOWS_DIR, filename), JSON.stringify(workflow, null, 2));
    return { success: true, filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('workflow:list', () => {
  try {
    return fs.readdirSync(WORKFLOWS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const w = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8'));
        return { filename: f, ...w };
      });
  } catch (e) { return []; }
});

ipcMain.handle('workflow:load', (_, filename) => {
  try {
    const p = path.join(WORKFLOWS_DIR, filename);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return null; }
});

ipcMain.handle('workflow:find', (_, message) => {
  try {
    const workflows = fs.readdirSync(WORKFLOWS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8')));
    const msg = message.toLowerCase();
    return workflows.find(w =>
      w.description.toLowerCase().split(' ')
        .filter(word => word.length > 4)
        .some(word => msg.includes(word))
    ) || null;
  } catch (e) { return null; }
});

// ====================================================================
// SENTINEL — Provider health monitor (runs every 2 hours)
// ====================================================================
async function pingProvider(providerName) {
  const apiKey = store.get(`apiKeys.${providerName}`, '');
  if (!apiKey) throw new Error('not configured');

  const axios = require('axios');
  const endpoints = {
    claude: { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              body: { model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] } },
    openai: { url: 'https://api.openai.com/v1/models', headers: { 'Authorization': `Bearer ${apiKey}` }, method: 'get' },
    deepseek: { url: 'https://api.deepseek.com/v1/models', headers: { 'Authorization': `Bearer ${apiKey}` }, method: 'get' },
    mistral: { url: 'https://api.mistral.ai/v1/models', headers: { 'Authorization': `Bearer ${apiKey}` }, method: 'get' },
    perplexity: { url: 'https://api.perplexity.ai/chat/completions', headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
                  body: { model: 'sonar', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] } },
    gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, method: 'get' }
  };

  const cfg = endpoints[providerName];
  if (!cfg) throw new Error('unknown provider');

  if (cfg.method === 'get') {
    await axios.get(cfg.url, { headers: cfg.headers || {}, timeout: 10000 });
  } else {
    await axios.post(cfg.url, cfg.body, { headers: cfg.headers, timeout: 10000 });
  }
}

function startSentinel() {
  const runCheck = async () => {
    log.info('=== SENTINEL HEALTH CHECK ===');
    const providers = ['claude', 'openai', 'deepseek', 'mistral', 'perplexity', 'gemini'];
    const results = {};

    for (const p of providers) {
      try {
        await pingProvider(p);
        results[p] = 'healthy';
      } catch (err) {
        results[p] = `degraded: ${err.message?.substring(0, 60) || 'unknown'}`;
        log.warn(`SENTINEL: ${p} degraded — ${err.message}`);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sentinel-report', {
        timestamp: new Date().toISOString(),
        results,
        summary: Object.entries(results).filter(([_, v]) => v !== 'healthy').map(([k, v]) => `${k}: ${v}`)
      });
    }
  };

  // First check 30s after launch, then every 2 hours
  setTimeout(runCheck, 30000);
  setInterval(runCheck, 2 * 60 * 60 * 1000);
}

