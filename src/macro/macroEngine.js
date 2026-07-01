'use strict';
// AVIS Macro Engine — main-process controller.
// Records keyboard + mouse via uiohook-napi, replays via Win32 SendInput
// (hardware scan-code mode). Ported from VisionMacro and slimmed to drop the
// vision frameSync path — AVIS macros are pure input record/replay.

const path = require('path');
const recorder = require('./recorder');
const player = require('./player');
const storage = require('./storage');

let uIOhook = null;
let log = console;
let state = 'idle';            // 'idle' | 'recording' | 'playing'
let lastMacro = null;
let onStateChange = () => {};
let hookStarted = false;

let cfg = {
  speed: 1.0,
  repeatCount: 1,
  loopGap: 150,
  humanize: {},
};

function _emit() {
  try {
    onStateChange({
      state,
      eventCount: lastMacro ? lastMacro.length : 0,
      slots: storage.list(),
    });
  } catch (_) {}
}

function init({ logger, baseDir, config } = {}) {
  log = logger || console;
  if (config) cfg = { ...cfg, ...config };

  storage.init(cfg.macroDir || 'avis-macros', baseDir || process.cwd());
  player.init({ ...(cfg.humanize || {}), speed: cfg.speed });
  recorder.setSyncEnabled(false);   // no vision frameSync in AVIS

  try {
    uIOhook = require('uiohook-napi').uIOhook;
  } catch (e) {
    log.warn?.('Macro engine: uiohook-napi unavailable — record/replay disabled', e.message);
    uIOhook = null;
  }
}

function _ensureHook() {
  if (!uIOhook || hookStarted) return;
  uIOhook.on('keydown',   (e) => { if (state === 'recording') recorder.keydown(e); });
  uIOhook.on('keyup',     (e) => { if (state === 'recording') recorder.keyup(e); });
  uIOhook.on('mousedown', (e) => { if (state === 'recording') recorder.mousedown(e); });
  uIOhook.on('mouseup',   (e) => { if (state === 'recording') recorder.mouseup(e); });
  uIOhook.on('mousemove', (e) => { if (state === 'recording') recorder.mousemove(e); });
  uIOhook.on('wheel',     (e) => { if (state === 'recording') recorder.wheel(e); });
  uIOhook.start();
  hookStarted = true;
}

function getState() { return state; }

function startRecording() {
  if (!uIOhook) return { ok: false, error: 'Native input hook unavailable' };
  if (state !== 'idle') return { ok: false, error: `Busy (${state})` };
  _ensureHook();
  recorder.start();
  state = 'recording';
  _emit();
  return { ok: true };
}

function stopRecording() {
  if (state !== 'recording') return { ok: false, error: 'Not recording' };
  lastMacro = recorder.stop();
  state = 'idle';
  _emit();
  return { ok: true, eventCount: lastMacro.length };
}

function play(opts = {}) {
  if (!uIOhook) return { ok: false, error: 'Native input hook unavailable' };
  if (state !== 'idle') return { ok: false, error: `Busy (${state})` };
  if (!lastMacro || lastMacro.length === 0) return { ok: false, error: 'No macro recorded' };

  if (opts.speed) player.setSpeed(opts.speed);
  const repeat = Math.max(1, opts.repeatCount || cfg.repeatCount || 1);
  const gap = opts.loopGap ?? cfg.loopGap ?? 150;

  state = 'playing';
  _emit();

  let left = repeat;
  const runOnce = () => {
    player.play(lastMacro, () => {
      left -= 1;
      if (left > 0 && state === 'playing') {
        setTimeout(runOnce, gap + Math.floor(Math.random() * 200));
      } else {
        state = 'idle';
        _emit();
      }
    });
  };
  runOnce();
  return { ok: true };
}

function stop() {
  if (state === 'playing') { try { player.stop?.(); } catch (_) {} }
  state = 'idle';
  _emit();
  return { ok: true };
}

function save(name) {
  if (!lastMacro || !lastMacro.length) return { ok: false, error: 'Nothing to save' };
  const clean = (name || 'macro').replace(/[^a-z0-9_\-]/gi, '_');
  storage.save(clean, lastMacro);
  _emit();
  return { ok: true, name: clean };
}

function load(name) {
  const events = storage.load(name);
  if (!events) return { ok: false, error: 'Macro not found' };
  lastMacro = events;
  _emit();
  return { ok: true, eventCount: events.length };
}

function listMacros() { return storage.list(); }

function setOnStateChange(fn) { onStateChange = fn || (() => {}); }

function shutdown() {
  try { if (hookStarted && uIOhook) uIOhook.stop(); } catch (_) {}
  hookStarted = false;
}

module.exports = {
  init, getState, startRecording, stopRecording,
  play, stop, save, load, listMacros, setOnStateChange, shutdown,
};
