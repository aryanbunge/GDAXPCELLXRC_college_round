// Gold poster interactions. Everything follows the mouse, or your head cursor when hand control is running.
//  - #head: a 3D point-cloud head (like the face-mesh points the tracker reads) that turns toward the pointer, with a face box and live yaw/pitch.
//  - #ink : violet liquid ink that trails the pointer; it blends with 'difference' so text under it changes colour.
//  - a ring that trails the mouse, and buttons that lean toward the pointer.
(() => {
  const ink = document.getElementById('ink'), ink2 = document.getElementById('ink2'), hc = document.getElementById('head');
  const still = true; // static build: no animation
  let W = innerWidth, H = innerHeight;
  const p = { x: W * 0.62, y: H * 0.4 }, s = { ...p }, t = { ...p };
  const ig = ink && ink.getContext('2d'), ig2 = ink2 && ink2.getContext('2d'), hg = hc && hc.getContext('2d');
  let inkFill = '#f0be08';
  const STOPS = [[0, '#f7cc0a'], [0.39, '#efbc08'], [0.65, '#cf9d05'], [0.85, '#b08104'], [1, '#9d7004']];
  const sizeInk = () => { W = innerWidth; H = innerHeight; for (const [c, g] of [[ink, ig], [ink2, ig2]]) if (c) { c.width = W / 2; c.height = H / 2; g.setTransform(0.5, 0, 0, 0.5, 0, 0); } if (ig) { inkFill = ig.createLinearGradient(0, 0, 0, H); for (const [o, c] of STOPS) inkFill.addColorStop(o, c); } };
  addEventListener('resize', sizeInk); sizeInk();
  const ring = document.createElement('div'); ring.id = 'fxcur'; document.body.appendChild(ring);
  let glitch = 0;
  addEventListener('pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; ring.style.opacity = 1; ring.classList.toggle('on', !!(e.target.closest && e.target.closest('button,a,input,[data-jump]'))); }, { passive: true });
  addEventListener('pointerdown', () => { glitch = 14; });
  document.addEventListener('pointerleave', () => (ring.style.opacity = 0));
  const head = document.getElementById('cursor'); let headOn = false;
  const readHead = () => { headOn = !!head && head.style.display !== 'none'; if (!headOn) return; const r = head.getBoundingClientRect(); if (!r.width || (!r.left && !r.top)) { headOn = false; return; } p.x = r.left + r.width / 2; p.y = r.top + r.height / 2; };

  // ---- head model: ellipsoid with brow, eye sockets, nose and mouth, built once ----
  const LAT = 26, LON = 40, G = [];
  for (let i = 0; i <= LAT; i++) { const la = (i / LAT - 0.5) * Math.PI, row = [];
    for (let j = 0; j < LON; j++) { const lo = (j / LON) * Math.PI * 2;
      let x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
      if (y < 0) { x *= 1 - 0.26 * Math.pow(-y, 1.2); z *= 1 - 0.14 * -y; }
      if (z > 0) {
        z += 0.3 * Math.exp(-(x * x / 0.012 + (y + 0.1) ** 2 / 0.05));
        z -= 0.11 * (Math.exp(-((x - 0.3) ** 2 / 0.02 + (y - 0.22) ** 2 / 0.012)) + Math.exp(-((x + 0.3) ** 2 / 0.02 + (y - 0.22) ** 2 / 0.012)));
        z -= 0.07 * Math.exp(-(x * x / 0.06 + (y + 0.55) ** 2 / 0.004)); z += 0.06 * Math.exp(-((y - 0.34) ** 2 / 0.004));
      }
      row.push([x * 0.84, y, z * 0.86]);
    } G.push(row); }
  let tip = G[0][0]; for (const r of G) for (const q of r) if (q[2] > tip[2]) tip = q;
  const yawEl = document.getElementById('rYaw'), pitEl = document.getElementById('rPitch');
  let frameN = 0;
  function drawHead() {
    const w = hc.clientWidth, h = hc.clientHeight; if (!w) return;
    const d = Math.min(devicePixelRatio || 1, 2); if (hc.width !== Math.round(w * d)) { hc.width = Math.round(w * d); hc.height = Math.round(h * d); }
    const r = hc.getBoundingClientRect(), cx = r.left + w / 2, cy = r.top + h / 2;
    const yaw = Math.max(-1, Math.min(1, (s.x - cx) / (W * 0.45))) * 0.8, pit = Math.max(-1, Math.min(1, (s.y - cy) / (H * 0.45))) * 0.45;
    hg.setTransform(d, 0, 0, d, 0, 0); hg.clearRect(0, 0, w, h);
    const S = Math.min(w, h) * 0.4, ox = w / 2, oy = h / 2, cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
    const proj = (q) => { const x1 = q[0] * cyw + q[2] * syw, z1 = -q[0] * syw + q[2] * cyw, y1 = q[1] * cp - z1 * sp, z2 = q[1] * sp + z1 * cp, f = 1.9 / (1.9 - z2 * 0.55);
      return [ox + x1 * S * f, oy - y1 * S * f, z2]; };
    const P = G.map((row) => row.map(proj)), near = new Path2D(), far = new Path2D(), dots = [];
    for (let i = 0; i <= LAT; i++) for (let j = 0; j < LON; j++) {
      const a = P[i][j], b = P[i][(j + 1) % LON], c = i < LAT ? P[i + 1][j] : null;
      for (const q of [b, c]) { if (!q) continue; const zz = Math.min(a[2], q[2]); if (zz < -0.12) continue; const path = zz > 0.25 ? near : far; path.moveTo(a[0], a[1]); path.lineTo(q[0], q[1]); }
      if (a[2] > 0) dots.push(a);
    }
    hg.lineWidth = 1; hg.strokeStyle = 'rgba(10,10,10,.22)'; hg.stroke(far); hg.strokeStyle = 'rgba(10,10,10,.9)'; hg.stroke(near);
    hg.fillStyle = '#0a0a0a'; for (const a of dots) { const k = 0.9 + a[2] * 1.5; hg.fillRect(a[0] - k / 2, a[1] - k / 2, k, k); }
    const n = proj(tip); hg.strokeStyle = '#0a0a0a'; hg.lineWidth = 1.5; hg.beginPath(); hg.arc(n[0], n[1], 11, 0, 7); hg.moveTo(n[0] - 20, n[1]); hg.lineTo(n[0] - 6, n[1]); hg.moveTo(n[0] + 6, n[1]); hg.lineTo(n[0] + 20, n[1]); hg.moveTo(n[0], n[1] - 20); hg.lineTo(n[0], n[1] - 6); hg.moveTo(n[0], n[1] + 6); hg.lineTo(n[0], n[1] + 20); hg.stroke();
    // face box (corner brackets) the way a detector draws it
    const bx = w * 0.14, by = h * 0.04, bw = w * 0.72, bh = h * 0.92, L = 22; hg.lineWidth = 2;
    hg.beginPath(); for (const [x, y, sx, sy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) { hg.moveTo(x + sx * L, y); hg.lineTo(x, y); hg.lineTo(x, y + sy * L); } hg.stroke();
    hg.strokeStyle = '#0a0a0a'; hg.fillStyle = '#0a0a0a'; hg.font = '600 10px ui-monospace,Menlo,Consolas,monospace'; hg.fillText('FACE 0.98', bx + 4, by - 6);
    if (glitch > 0) { for (let k = 0; k < 6; k++) { const y = Math.random() * h * d, hh = (6 + Math.random() * 30) * d, dx = (Math.random() - 0.5) * 40 * d; hg.setTransform(1, 0, 0, 1, 0, 0); hg.drawImage(hc, 0, y, hc.width, hh, dx, y, hc.width, hh); } glitch--; }
    if (!(frameN % 4) && yawEl) { yawEl.textContent = ((yaw * 180) / Math.PI).toFixed(0) + '°'; pitEl.textContent = ((pit * 180) / Math.PI).toFixed(0) + '°'; }
  }

  // ---- ink trail ----
  const blobs = [], LIFE = 950;
  function drawInk(now) {
    const last = blobs[blobs.length - 1], sp = last ? Math.hypot(t.x - last.x, t.y - last.y) : 0;
    if (!last || sp > 2) blobs.push({ x: t.x, y: t.y, t: now, r: Math.min(24, 9 + sp * 0.4), k: 0 });
    while (blobs.length && now - blobs[0].t > LIFE) blobs.shift();
    for (const b of blobs) b.k = b.r * (1 - (now - b.t) / LIFE);
    // Trail is painted in the page's own yellow and blended with 'difference': black on the background,
    // and black text / the wireframe face flip to yellow where the trail crosses them.
    for (const [g, col] of [[ig, inkFill]]) {
      if (!g) continue;
      g.clearRect(0, 0, W, H); g.fillStyle = col;
      for (const b of blobs) { g.beginPath(); g.arc(b.x, b.y, b.k, 0, 7); g.fill(); }
      g.beginPath(); g.arc(t.x, t.y, 17, 0, 7); g.fill();
    }
  }

  const magnets = [...document.querySelectorAll('.actions button')];
  function frame(now) {
    frameN++; readHead(); s.x += (p.x - s.x) * 0.1; s.y += (p.y - s.y) * 0.1; t.x += (p.x - t.x) * 0.22; t.y += (p.y - t.y) * 0.22;
    ring.style.transform = `translate(${t.x}px,${t.y}px)`; if (headOn) ring.style.opacity = 0;
    if (!still && !(frameN % 420)) glitch = 10;
    if (ig) drawInk(now); if (hg) drawHead();
    for (const el of magnets) { const r = el.getBoundingClientRect(); if (!r.width) continue; const dx = s.x - (r.left + r.width / 2), dy = s.y - (r.top + r.height / 2); el.style.transform = Math.hypot(dx, dy) < 120 ? `translate(${(dx * 0.1).toFixed(1)}px,${(dy * 0.1).toFixed(1)}px)` : ''; }
    if (!still) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
