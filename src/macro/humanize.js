'use strict';
// Makes replayed input look human — Gaussian timing jitter + Bezier mouse paths

// Box-Muller: returns Gaussian-distributed random number
function gauss(mean, std) {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Add human-like jitter to a delay (ms). factor = fraction of stddev.
function jitter(ms, factor = 0.08) {
  return Math.max(0, Math.round(gauss(ms, ms * factor)));
}

// Cubic Bezier point
function bz(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

// Generate a natural mouse path from (x1,y1) → (x2,y2).
// Uses a curved Bezier with slight random perpendicular offset so paths
// aren't perfectly straight (humans never move in straight lines).
function mousePath(x1, y1, x2, y2, steps = 22, jitterPx = 2) {
  const dx   = x2 - x1;
  const dy   = y2 - y1;
  const dist = Math.sqrt(dx*dx + dy*dy) || 1;

  // Perpendicular unit vector
  const px = -dy / dist;
  const py =  dx / dist;

  // Random curve offset — larger for longer distances
  const curve = dist * (0.04 + Math.random() * 0.10) * (Math.random() < 0.5 ? 1 : -1);

  const c1x = x1 + dx * 0.30 + curve * px;
  const c1y = y1 + dy * 0.30 + curve * py;
  const c2x = x1 + dx * 0.70 + curve * px * 0.6;
  const c2y = y1 + dy * 0.70 + curve * py * 0.6;

  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ease-in/out: remap t with smoothstep so the cursor accelerates then decelerates
    const s = t * t * (3 - 2 * t);
    path.push({
      x: Math.round(bz(s, x1, c1x, c2x, x2) + (Math.random() - 0.5) * jitterPx),
      y: Math.round(bz(s, y1, c1y, c2y, y2) + (Math.random() - 0.5) * jitterPx),
    });
  }
  return path;
}

// Random click-hold duration (how long mouse button stays depressed)
function clickHold(min = 35, max = 85) {
  return Math.round(gauss((min + max) / 2, (max - min) / 6));
}

module.exports = { jitter, mousePath, clickHold };
