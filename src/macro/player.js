'use strict';

// Bug fixes applied:
//  #2 — frameMatcher lazy-required inside frameSync case only. Worker no
//        longer crashes at startup if pixelmatch isn't installed yet.
//  #4 — frameSync replaces the normal pre-event sleep with a race:
//        the recorded delay is the MINIMUM wait; if the screen already
//        matches after the delay, proceed immediately. If the game is still
//        loading past the delay, keep waiting (up to timeout). Eliminates
//        the old double-wait (delay + polling stacked on top of each other).
//  #5 — diffBuf pre-allocated once per frameSync event, reused every poll.
//        Was allocating 900KB per 80ms cycle.
//  #6 — ref frame converted BGRA→RGBA once per frameSync event (refRgba).
//        Was re-converting every poll cycle.

const input    = require('./input');
const humanize = require('./humanize');

let cfg             = {};
let stopFlag        = false;
let busy            = false;
let _screenRecord   = null;
let _onPerfectFail  = null;   // set by engine.js; called when perfect mode times out

function setScreenRecord(sr)    { _screenRecord  = sr; }
function setOnPerfectFail(cb)   { _onPerfectFail = cb; }

function init(humanizeCfg = {}) {
  cfg = {
    timingJitter:    0.08,
    mouseSteps:      22,
    mouseJitter:     2,
    clickHoldMin:    35,
    clickHoldMax:    85,
    speed:           1.0,
    perfectPlayback: false,
    ...humanizeCfg,
  };
}

function setSpeed(x) { cfg.speed = Math.max(0.25, x); }

const eff   = (ms) => ms / (cfg.speed || 1);
const sleep = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms)));

async function run(events, onDone) {
  busy     = true;
  stopFlag = false;

  let cx = 0, cy = 0;

  for (const evt of events) {
    if (stopFlag) break;

    // frameSync manages its own timing (race between delay and screen match).
    // All other event types use the normal pre-event sleep.
    if (evt.type !== 'frameSync') {
      let sleepMs = evt.delay > 0 ? humanize.jitter(eff(evt.delay), cfg.timingJitter) : 0;
      // Wire clickHold: if min/max are set, mouseup hold is at least clickHoldMin.
      // With min=0 and max=0 (accuracy mode) this branch never fires.
      if (evt.type === 'mouseup' && cfg.clickHoldMin > 0 && cfg.clickHoldMax > 0) {
        sleepMs = Math.max(sleepMs, humanize.clickHold(cfg.clickHoldMin, cfg.clickHoldMax));
      }
      if (sleepMs > 0) await sleep(sleepMs);
    }
    if (stopFlag) break;

    switch (evt.type) {

      case 'keydown':
        input.pressKey(evt.scan, evt.ext);
        break;

      case 'keyup':
        input.releaseKey(evt.scan, evt.ext);
        break;

      case 'mousemove': {
        const dist = Math.hypot(evt.x - cx, evt.y - cy);
        // mouseSteps=1 means accuracy mode — skip bezier, jump directly to target.
        if (dist >= 4 && cfg.mouseSteps > 1) {
          const steps = Math.min(cfg.mouseSteps, Math.max(2, Math.round(dist / 12)));
          const mpath = humanize.mousePath(cx, cy, evt.x, evt.y, steps, cfg.mouseJitter);
          for (const pt of mpath) {
            if (stopFlag) break;
            input.moveMouse(pt.x, pt.y);
          }
        }
        input.moveMouse(evt.x, evt.y);
        cx = evt.x; cy = evt.y;
        break;
      }

      case 'mousedown': {
        if (evt.x !== undefined && cfg.mouseSteps > 1) {
          const dist = Math.hypot(evt.x - cx, evt.y - cy);
          if (dist > 4) {
            const steps = Math.min(8, Math.max(2, Math.round(dist / 20)));
            const mpath = humanize.mousePath(cx, cy, evt.x, evt.y, steps, cfg.mouseJitter);
            for (const pt of mpath) {
              if (stopFlag) break;
              input.moveMouse(pt.x, pt.y);
            }
            cx = evt.x; cy = evt.y;
          }
        } else if (evt.x !== undefined) {
          input.moveMouse(evt.x, evt.y);
          cx = evt.x; cy = evt.y;
        }
        input.mouseDown(evt.btn);
        break;
      }

      case 'mouseup':
        input.mouseUp(evt.btn);
        break;

      case 'scroll':
        input.scroll(evt.delta);
        break;

      case 'hscroll':
        input.hscroll(evt.delta);
        break;

      case 'wait':
        break;

      case 'waitForPixel': {
        const { x, y, r, g, b, tolerance = 15, timeout = 30000 } = evt;
        const deadline = Date.now() + timeout;
        while (!stopFlag && Date.now() < deadline) {
          const px = input.getPixelColor(x, y);
          if (Math.abs(px.r - r) <= tolerance &&
              Math.abs(px.g - g) <= tolerance &&
              Math.abs(px.b - b) <= tolerance) break;
          await sleep(100);
        }
        break;
      }

      case 'frameSync': {
        // Bug #2: lazy require — only loaded if a frameSync event is actually encountered.
        let frameMatcher;
        try { frameMatcher = require('./frameMatcher'); } catch { break; }

        if (!_screenRecord) {
          if (evt.delay > 0) await sleep(humanize.jitter(eff(evt.delay), cfg.timingJitter));
          break;
        }

        const perfect   = !!cfg.perfectPlayback;
        const tolerance = perfect ? 0.03 : (evt.tolerance ?? 0.05);
        // Perfect mode: wait up to 5 minutes and never fire on a mismatch.
        // Normal mode: 15s timeout, then proceed regardless.
        const timeout   = perfect ? 300000 : (evt.timeout ?? 15000);
        const { frameIdx } = evt;
        const ref = _screenRecord.loadFrame(frameIdx);
        if (!ref) {
          if (evt.delay > 0) await sleep(humanize.jitter(eff(evt.delay), cfg.timingJitter));
          break;
        }

        // Bug #6: convert ref frame BGRA→RGBA once for the entire polling loop.
        const refRgba = frameMatcher.bgraToRgba(ref.buf);

        // Bug #5: allocate diff buffer once; reuse on every poll.
        const diffBuf = new Uint8Array(ref.width * ref.height * 4);

        // Bug #4: race between the recorded delay and the screen match.
        const minDelay = humanize.jitter(eff(evt.delay || 0), cfg.timingJitter);
        const delayEnd = Date.now() + minDelay;
        const deadline = Date.now() + Math.max(minDelay, timeout);
        let matched    = false;

        while (!stopFlag && Date.now() < deadline) {
          const now  = Date.now();
          const live = input.captureScreen();

          if (live && live.width === ref.width && live.height === ref.height) {
            const { match } = frameMatcher.comparePrepped(
              refRgba, live.buf, ref.width, ref.height, tolerance, diffBuf
            );
            if (match && now >= delayEnd) { matched = true; break; }
            if (match) { await sleep(delayEnd - Date.now()); matched = true; break; }
          }

          const remaining = delayEnd - Date.now();
          await sleep(remaining > 0 ? Math.min(80, remaining) : 80);
        }

        // Perfect mode: if we timed out without a match, abort and notify engine.
        if (perfect && !matched && !stopFlag) {
          stopFlag = true;
          if (_onPerfectFail) _onPerfectFail(frameIdx);
        }
        break;
      }

      case 'xdown': {
        if (evt.x !== undefined) {
          const dist = Math.hypot(evt.x - cx, evt.y - cy);
          if (dist > 4) {
            const steps = Math.min(8, Math.max(3, Math.round(dist / 20)));
            const mpath = humanize.mousePath(cx, cy, evt.x, evt.y, steps, cfg.mouseJitter);
            for (const pt of mpath) { if (stopFlag) break; input.moveMouse(pt.x, pt.y); }
            cx = evt.x; cy = evt.y;
          }
        }
        input.mouseXDown(evt.xbtn);
        break;
      }

      case 'xup':
        input.mouseXUp(evt.xbtn);
        break;
    }
  }

  busy = false;
  onDone();
}

function play(events, onDone) {
  if (busy) { stop(); setTimeout(() => play(events, onDone), 50); return; }
  run(events, onDone).catch(() => { busy = false; onDone(); });
}

function stop()      { stopFlag = true; }
function isPlaying() { return busy; }

module.exports = { init, setSpeed, play, stop, isPlaying, setScreenRecord, setOnPerfectFail };
