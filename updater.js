#!/usr/bin/env node
// AVIS Standalone Updater — runs independently of the main app
// If AVIS is broken/crashed, this can still download and install the latest version

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const REPO = 'anyaji/AVIS-Repo';
const RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
// OneDrive-aware desktop detection
const oneDriveDesktop = path.join(os.homedir(), 'OneDrive', 'Desktop');
const DESKTOP = fs.existsSync(oneDriveDesktop) ? oneDriveDesktop : path.join(os.homedir(), 'Desktop');

console.log('');
console.log('  ================================');
console.log('  AVIS Updater');
console.log('  Avel Intelligence Services');
console.log('  ================================');
console.log('');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'AVIS-Updater', 'Accept': 'application/vnd.github.v3+json' } };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const options = { headers: { 'User-Agent': 'AVIS-Updater' } };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0) {
          const pct = Math.round(downloaded / total * 100);
          process.stdout.write(`\r  Downloading: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
        }
      });
      res.on('end', () => { file.end(); console.log('\n  Download complete.'); resolve(dest); });
    }).on('error', (err) => { file.close(); reject(err); });
  });
}

async function main() {
  try {
    console.log('  Checking for latest version...');
    const res = await fetch(RELEASE_URL);
    if (res.status !== 200) { console.log('  Error: Could not reach GitHub. Status:', res.status); process.exit(1); }

    const release = JSON.parse(res.data);
    const version = release.tag_name || release.name;
    console.log(`  Latest version: ${version}`);

    const asset = release.assets.find(a => a.name.endsWith('.exe') && !a.name.includes('blockmap'));
    if (!asset) { console.log('  Error: No installer found in release.'); process.exit(1); }

    console.log(`  Installer: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)}MB)`);

    const dest = path.join(DESKTOP, 'AVIS-Setup.exe');
    console.log(`  Saving to: ${dest}`);
    console.log('');

    await download(asset.browser_download_url, dest);

    console.log('');
    console.log('  Installing...');

    // Kill any running AVIS first
    try { exec('taskkill /F /IM "AVIS - Avel Intelligence Services.exe"', { timeout: 5000 }); } catch (e) {}
    await new Promise(r => setTimeout(r, 2000));

    // Run the installer silently
    exec(`"${dest}" /S`, (err) => {
      if (err) {
        console.log('  Silent install failed — opening installer for manual install.');
        exec(`start "" "${dest}"`);
      } else {
        console.log('  Installed successfully!');
      }
      console.log('');
      console.log('  Done. AVIS will launch automatically.');
      console.log('');
      setTimeout(() => process.exit(0), 3000);
    });

  } catch (err) {
    console.log('  Error:', err.message);
    console.log('');
    console.log('  Manual download: https://github.com/anyaji/AVIS-Repo/releases/latest');
    process.exit(1);
  }
}

main();
