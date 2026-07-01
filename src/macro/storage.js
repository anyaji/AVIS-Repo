'use strict';

const fs   = require('fs');
const path = require('path');

let dir;

function init(macroDir, baseDir) {
  // baseDir is the exe's directory (writable). Falls back to source root for dev.
  const base = baseDir || path.resolve(__dirname, '..');
  dir = path.resolve(base, macroDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function save(name, events) {
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(events, null, 2));
  return file;
}

function load(name) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function list() {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .map(f => path.basename(f, '.json'));
}

// Save metadata (screen recording info, etc.) alongside the macro.
function saveMeta(name, meta) {
  const file = path.join(dir, `${name}.meta.json`);
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
}

function loadMeta(name) {
  const file = path.join(dir, `${name}.meta.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

module.exports = { init, save, load, list, saveMeta, loadMeta };
