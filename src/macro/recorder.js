'use strict';
// Captures keyboard + mouse events into a timestamped event list.
// Each event stores its absolute timestamp (_ts) during recording.
// Delays are computed from those timestamps only at stop(), so leading
// silence and inter-event gaps are always captured exactly.
//
// VisionMacro addition: inserts frameSync events at significant action
// boundaries so the player can gate on live screen match.
//
// Bug fix #1: minimum gap threshold between frameSync events (SYNC_GAP_MS).
// Without this, fast macros (rapid clicks) insert a sync before every single
// action, causing frame comparisons to stall the entire sequence.

const MOUSE_PX_THRESHOLD = 6;
const MOUSE_MS_THRESHOLD = 16;
const SYNC_GAP_MS        = 500; // minimum ms between auto frameSync checkpoints

let events        = [];
let startTs       = 0;
let lastMx        = -999;
let lastMy        = -999;
let lastMt        = 0;
let lastSyncTs    = 0;   // wall-clock time of last frameSync insertion
let heldSet       = new Set();
let _screenRecord = null;
let syncEnabled   = true;

function setScreenRecord(sr) { _screenRecord = sr; }
function setSyncEnabled(v)   { syncEnabled = v; }

// Insert a frameSync checkpoint ONLY when enough time has passed since the
// last one. This prevents rapid-fire actions from getting a sync on every step.
function _insertSync() {
  if (!syncEnabled || !_screenRecord) return;
  const now = Date.now();
  if (now - lastSyncTs < SYNC_GAP_MS) return;   // Bug #1 fix — gap threshold
  const frameIdx = _screenRecord.getFrameCount() - 1;
  if (frameIdx < 0) return;
  events.push({ type: 'frameSync', frameIdx, tolerance: 0.05, timeout: 15000, _ts: now });
  lastSyncTs = now;
}

function start() {
  events     = [];
  heldSet    = new Set();
  startTs    = Date.now();
  lastSyncTs = 0;
  lastMx     = -999; lastMy = -999; lastMt = 0;
}

function stop() {
  let prev = startTs;
  for (const e of events) {
    e.delay = e._ts - prev;
    prev    = e._ts;
    delete e._ts;
  }
  const trailing = Date.now() - prev;
  if (trailing > 50) events.push({ type: 'wait', delay: trailing });
  return [...events];
}

function injectKeydowns(keys) {
  for (const k of keys) {
    if (heldSet.has(k.scan)) continue;
    heldSet.add(k.scan);
    events.push({ type: 'keydown', scan: k.scan, ext: k.ext, _ts: startTs });
  }
}

function keycode2scan(kc) {
  return kc > 0xFF
    ? { scan: kc & 0xFF, ext: true  }
    : { scan: kc,        ext: false };
}

function keydown(e) {
  _insertSync();
  const { scan, ext } = keycode2scan(e.keycode);
  events.push({ type: 'keydown', scan, ext, _ts: Date.now() });
}

function keyup(e) {
  const { scan, ext } = keycode2scan(e.keycode);
  events.push({ type: 'keyup', scan, ext, _ts: Date.now() });
}

function mousemove(e) {
  const now = Date.now();
  const dx  = Math.abs(e.x - lastMx);
  const dy  = Math.abs(e.y - lastMy);
  if (dx < MOUSE_PX_THRESHOLD && dy < MOUSE_PX_THRESHOLD && now - lastMt < MOUSE_MS_THRESHOLD) return;
  lastMx = e.x; lastMy = e.y; lastMt = now;
  events.push({ type: 'mousemove', x: e.x, y: e.y, _ts: now });
}

function mousedown(e) {
  _insertSync();
  const btn = { 1: 'left', 2: 'right', 3: 'middle' }[e.button];
  if (btn) {
    events.push({ type: 'mousedown', btn, x: e.x, y: e.y, _ts: Date.now() });
  } else if (e.button === 4 || e.button === 5) {
    events.push({ type: 'xdown', xbtn: e.button - 3, x: e.x, y: e.y, _ts: Date.now() });
  }
}

function mouseup(e) {
  const btn = { 1: 'left', 2: 'right', 3: 'middle' }[e.button];
  if (btn) {
    events.push({ type: 'mouseup', btn, _ts: Date.now() });
  } else if (e.button === 4 || e.button === 5) {
    events.push({ type: 'xup', xbtn: e.button - 3, _ts: Date.now() });
  }
}

function wheel(e) {
  const delta = -(e.rotation || -1) * 120;
  if (e.direction === 4) {
    events.push({ type: 'hscroll', delta, _ts: Date.now() });
  } else {
    events.push({ type: 'scroll', delta, _ts: Date.now() });
  }
}

function markWaitForPixel(x, y, color) {
  events.push({ type: 'waitForPixel', x, y, r: color.r, g: color.g, b: color.b, tolerance: 15, timeout: 30000, _ts: Date.now() });
}

// Manual checkpoint — bypasses SYNC_GAP_MS so the user can force a sync at any moment.
function insertSyncForced() {
  if (!_screenRecord) return false;
  const frameIdx = _screenRecord.getFrameCount() - 1;
  if (frameIdx < 0) return false;
  const now = Date.now();
  events.push({ type: 'frameSync', frameIdx, tolerance: 0.05, timeout: 15000, manual: true, _ts: now });
  lastSyncTs = now;
  return true;
}

function count() { return events.length; }

module.exports = {
  start, stop, count, injectKeydowns, markWaitForPixel, insertSyncForced,
  keydown, keyup, mousemove, mousedown, mouseup, wheel,
  setScreenRecord, setSyncEnabled,
};
