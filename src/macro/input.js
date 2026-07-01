'use strict';
// Win32 SendInput wrapper — hardware scan-code mode (KEYEVENTF_SCANCODE)
// Same flag used by physical macro devices; inputs appear as real hardware events.

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const gdi32  = koffi.load('gdi32.dll');
const winmm  = koffi.load('winmm.dll');

const _SendInput       = user32.func('uint32 SendInput(uint32 nInputs, uint8_t* pInputs, int32 cbSize)');
const _GetMetric       = user32.func('int32 GetSystemMetrics(int32 nIndex)');
const _GetCursorPos    = user32.func('bool GetCursorPos(uint8_t* lpPoint)');
const _WindowFromPoint = user32.func('void* WindowFromPoint(int32 x, int32 y)');
const _PostMessage     = user32.func('bool PostMessageW(void* hWnd, uint32 Msg, uint32 wParam, int32 lParam)');
const _GetDC           = user32.func('void* GetDC(void* hWnd)');
const _ReleaseDC       = user32.func('int ReleaseDC(void* hWnd, void* hDC)');
const _GetPixel        = gdi32.func('uint32 GetPixel(void* hdc, int32 x, int32 y)');
const _TimerRes        = winmm.func('uint32 timeBeginPeriod(uint32 uPeriod)');

const WM_MOUSEWHEEL  = 0x020A;
const WM_MOUSEHWHEEL = 0x020E;
const ptBuf = Buffer.alloc(8);

_TimerRes(1); // 1 ms timer precision — critical for tight key timing

// sizeof(INPUT) = 40 on 64-bit Windows
// Layout: [0-3] type  [4-7] pad  [8..39] union (KEYBDINPUT or MOUSEINPUT)
const SZ = 40;

// INPUT.type values
const T_MOUSE = 0;
const T_KEY   = 1;

// KEYBDINPUT flags
const KF_SCAN = 0x0008; // use wScan (hardware scan code)
const KF_UP   = 0x0002; // key release
const KF_EXT  = 0x0001; // extended key (arrows, ins, del, etc.)

// MOUSEINPUT flags
const MF_MOVE   = 0x0001;
const MF_LD     = 0x0002; MF_LD;
const MF_LU     = 0x0004;
const MF_RD     = 0x0008;
const MF_RU     = 0x0010;
const MF_MD     = 0x0020;
const MF_MU     = 0x0040;
const MF_XD     = 0x0080;
const MF_XU     = 0x0100;
const MF_WHEEL  = 0x0800;
const MF_ABS    = 0x8000; // coordinates are absolute (0-65535)

// Screen dims for normalising absolute mouse coords
const SW = _GetMetric(0); // SM_CXSCREEN
const SH = _GetMetric(1); // SM_CYSCREEN

function send(buf) { return _SendInput(1, buf, SZ); }

function keyBuf(scan, up, ext) {
  const b = Buffer.alloc(SZ, 0);
  b.writeUInt32LE(T_KEY, 0);
  // [4-7] pad stays 0
  b.writeUInt16LE(0,    8);   // wVk = 0 when using scan
  b.writeUInt16LE(scan & 0xFF, 10); // wScan
  let f = KF_SCAN;
  if (up)  f |= KF_UP;
  if (ext) f |= KF_EXT;
  b.writeUInt32LE(f, 12);     // dwFlags
  b.writeUInt32LE(0, 16);     // time  (0 = let driver stamp)
  // [20-31] pad + dwExtraInfo stay 0
  return b;
}

function mouseBuf(flags, dx, dy, data) {
  const b = Buffer.alloc(SZ, 0);
  b.writeUInt32LE(T_MOUSE, 0);
  b.writeInt32LE(dx   ?? 0,   8);
  b.writeInt32LE(dy   ?? 0,  12);
  b.writeUInt32LE(data ?? 0, 16);
  b.writeUInt32LE(flags,     20);
  return b;
}

function norm(x, y) {
  return [
    Math.round((x * 65535) / SW),
    Math.round((y * 65535) / SH),
  ];
}

const BTNS = {
  left:   { down: 0x0002, up: 0x0004 },
  right:  { down: 0x0008, up: 0x0010 },
  middle: { down: 0x0020, up: 0x0040 },
};

// ── Foreground window title (for window targeting feature) ────
const _GetForegroundWindow = user32.func('void * GetForegroundWindow()');
const _GetWindowTextW      = user32.func('int GetWindowTextW(void * hWnd, uint8_t * lpString, int nMaxCount)');

function getForegroundWindowTitle() {
  try {
    const hwnd = _GetForegroundWindow();
    const buf  = Buffer.alloc(512, 0);
    const len  = _GetWindowTextW(hwnd, buf, 256);
    if (len <= 0) return '';
    return buf.slice(0, len * 2).toString('utf16le');
  } catch { return ''; }
}

module.exports = {
  pressKey(scan, ext = false)  { send(keyBuf(scan, false, ext)); },
  releaseKey(scan, ext = false){ send(keyBuf(scan, true,  ext)); },

  moveMouse(x, y) {
    const [nx, ny] = norm(x, y);
    send(mouseBuf(MF_MOVE | MF_ABS, nx, ny));
  },

  mouseDown(btn = 'left') {
    send(mouseBuf((BTNS[btn] ?? BTNS.left).down, 0, 0));
  },

  mouseUp(btn = 'left') {
    send(mouseBuf((BTNS[btn] ?? BTNS.left).up, 0, 0));
  },

  scroll(delta) {
    _GetCursorPos(ptBuf);
    const cx = ptBuf.readInt32LE(0);
    const cy = ptBuf.readInt32LE(4);
    const hwnd = _WindowFromPoint(cx, cy);
    const wParam = ((delta & 0xFFFF) << 16) >>> 0;
    const lParam = (((cy & 0xFFFF) << 16) | (cx & 0xFFFF)) >>> 0;
    if (hwnd) _PostMessage(hwnd, WM_MOUSEWHEEL, wParam, lParam);
  },

  hscroll(delta) {
    _GetCursorPos(ptBuf);
    const cx = ptBuf.readInt32LE(0);
    const cy = ptBuf.readInt32LE(4);
    const hwnd = _WindowFromPoint(cx, cy);
    const wParam = ((delta & 0xFFFF) << 16) >>> 0;
    const lParam = (((cy & 0xFFFF) << 16) | (cx & 0xFFFF)) >>> 0;
    if (hwnd) _PostMessage(hwnd, WM_MOUSEHWHEEL, wParam, lParam);
  },

  mouseXDown(xbtn) { send(mouseBuf(MF_XD, 0, 0, xbtn)); },
  mouseXUp(xbtn)   { send(mouseBuf(MF_XU, 0, 0, xbtn)); },

  // Returns current cursor position as {x, y}
  getCursorPos() {
    _GetCursorPos(ptBuf);
    return { x: ptBuf.readInt32LE(0), y: ptBuf.readInt32LE(4) };
  },

  // Samples the screen pixel at (x, y) and returns {r, g, b}.
  // COLORREF from GetPixel is 0x00BBGGRR.
  getPixelColor(x, y) {
    const hdc   = _GetDC(null);
    const color = _GetPixel(hdc, x, y);
    _ReleaseDC(null, hdc);
    return {
      r: (color)       & 0xFF,
      g: (color >> 8)  & 0xFF,
      b: (color >> 16) & 0xFF,
    };
  },

  screenSize: () => ({ w: SW, h: SH }),
  getForegroundWindowTitle,

  // Raw BGRA capture for frame matching — delegates to screenshot.captureRaw()
  // so the same GDI pipeline is used everywhere.
  captureScreen: () => require('../screenshot').captureRaw(),
};
