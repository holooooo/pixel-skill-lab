// 程序化像素贴图：怪物精灵、地砖、符文圆、光晕
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  return [c, g];
}
function tex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const px = (g, x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// 自动描边：透明像素若邻接实心像素则涂成描边色
function outline(c, g, color = [34, 20, 40]) {
  const d = g.getImageData(0, 0, c.width, c.height), w = c.width, h = c.height, src = new Uint8ClampedArray(d.data);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (src[i + 3]) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) { d.data[i] = color[0]; d.data[i + 1] = color[1]; d.data[i + 2] = color[2]; d.data[i + 3] = 255; }
  }
  g.putImageData(d, 0, 0);
}

export function girlTexture() {
  const [c, g] = canvas(20, 28);
  const hair = '#ff7eb6', hairL = '#ffc2dd', hairD = '#d9488f', skin = '#ffe3d1', eye = '#4a2f8f', dress = '#7cc4ff', dressD = '#3f78d6', white = '#ffffff', ribbon = '#ff3b6b';
  const o = 2;
  px(g, 1 + o, 5, hairD, 3, 11); px(g, 12 + o, 5, hairD, 3, 11);           // 双马尾
  px(g, 2 + o, 6, hair, 2, 9); px(g, 12 + o, 6, hair, 2, 9);
  px(g, 1 + o, 4, ribbon, 3, 2); px(g, 12 + o, 4, ribbon, 3, 2);
  px(g, 4 + o, 1, hair, 8, 10); px(g, 3 + o, 3, hair, 10, 7);              // 头发
  px(g, 5 + o, 1, hairL, 3, 1); px(g, 4 + o, 2, hairL, 2, 1);
  px(g, 5 + o, 4, skin, 6, 6);                                              // 脸
  px(g, 5 + o, 4, hair, 6, 1); px(g, 5 + o, 5, hair, 1, 1); px(g, 7 + o, 5, hair, 1, 1); px(g, 10 + o, 5, hair, 1, 1);
  px(g, 6 + o, 6, eye, 1, 2); px(g, 9 + o, 6, eye, 1, 2); px(g, 6 + o, 6, white); px(g, 9 + o, 6, white);
  px(g, 5 + o, 8, '#ff9aa8'); px(g, 10 + o, 8, '#ff9aa8'); px(g, 7 + o, 9, '#c2456b', 2, 1);
  px(g, 5 + o, 10, dress, 6, 5); px(g, 6 + o, 10, white, 4, 1); px(g, 7 + o, 11, ribbon, 2, 1);   // 上身
  px(g, 4 + o, 11, skin, 1, 4); px(g, 11 + o, 11, skin, 1, 4);
  px(g, 4 + o, 15, dressD, 8, 1); px(g, 3 + o, 16, dress, 10, 3); px(g, 3 + o, 18, white, 10, 1);   // 裙摆
  px(g, 6 + o, 19, skin, 1, 3); px(g, 9 + o, 19, skin, 1, 3);
  px(g, 5 + o, 22, '#5b2d4a', 2, 2); px(g, 9 + o, 22, '#5b2d4a', 2, 2);
  outline(c, g);
  return tex(c);
}

export function droneTexture(color = '#6fe3ff') {
  const [c, g] = canvas(12, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const d = Math.hypot(x - 5.5, y - 5.5);
    if (d < 4.6) px(g, x, y, d < 3 ? '#e8f4ff' : '#9fb4d8');
  }
  px(g, 4, 4, color, 4, 4); px(g, 5, 5, '#ffffff', 2, 2);
  px(g, 0, 5, '#9fb4d8', 2, 2); px(g, 10, 5, '#9fb4d8', 2, 2);
  outline(c, g);
  return tex(c);
}

export function slimeTexture(hue = '#5fd94a') {
  const [c, g] = canvas(20, 16);
  const col = new THREE.Color(hue);
  const dark = '#' + col.clone().multiplyScalar(0.35).getHexString();
  const mid = '#' + col.getHexString();
  const lite = '#' + col.clone().lerp(new THREE.Color('#ffffff'), 0.5).getHexString();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 20; x++) {
    const nx = (x - 9.5) / 9.5, ny = (y - 15) / 13;
    const d = nx * nx + ny * ny * (y < 15 ? 1 : 0);
    if (y > 15 || ny > 0.05) continue;
    if (d < 1) px(g, x, y, d > 0.78 ? dark : mid);
  }
  px(g, 5, 5, lite, 3, 2); px(g, 4, 7, lite, 1, 2);
  px(g, 7, 8, '#111', 2, 3); px(g, 12, 8, '#111', 2, 3);
  px(g, 7, 8, '#fff'); px(g, 12, 8, '#fff');
  px(g, 9, 12, dark, 3, 1);
  return tex(c);
}

export function dummyTexture() {
  const [c, g] = canvas(20, 26);
  const wood = '#8a5a2b', woodD = '#4d2f14', woodL = '#b77b3e', straw = '#e3c164', red = '#e23a3a';
  px(g, 8, 6, woodD, 4, 20); px(g, 9, 6, wood, 2, 20); px(g, 9, 6, woodL, 1, 20);
  px(g, 1, 9, woodD, 18, 4); px(g, 2, 10, wood, 16, 2);
  px(g, 5, 0, woodD, 10, 8); px(g, 6, 1, straw, 8, 6);
  px(g, 7, 2, '#222', 2, 2); px(g, 11, 2, '#222', 2, 2); px(g, 8, 5, '#a0522d', 4, 1);
  px(g, 5, 13, woodD, 10, 8); px(g, 6, 14, straw, 8, 6);
  px(g, 8, 15, red, 4, 4); px(g, 9, 16, '#fff', 2, 2); px(g, 9, 16, red, 1, 1);
  px(g, 6, 24, woodD, 8, 2);
  return tex(c);
}

export function totemTexture(color = '#7fb2ff') {
  const [c, g] = canvas(14, 24);
  px(g, 3, 4, '#2a2340', 8, 20); px(g, 4, 5, '#4b4370', 6, 18); px(g, 4, 5, '#6a5f9a', 1, 18);
  px(g, 1, 2, '#2a2340', 12, 4); px(g, 2, 3, '#6a5f9a', 10, 2);
  px(g, 6, 9, color, 2, 2); px(g, 5, 12, color, 4, 1); px(g, 6, 14, color, 2, 4); px(g, 5, 19, color, 4, 1);
  px(g, 2, 22, '#2a2340', 10, 2);
  return tex(c);
}

export function knightTexture() {
  const [c, g] = canvas(16, 20);
  px(g, 5, 1, '#20263a', 6, 7); px(g, 6, 2, '#b8c4e0', 4, 5); px(g, 6, 4, '#20263a', 4, 1); px(g, 7, 4, '#6fe3ff', 2, 1);
  px(g, 4, 8, '#20263a', 8, 7); px(g, 5, 9, '#5d6fa8', 6, 5); px(g, 7, 9, '#c86bff', 2, 5);
  px(g, 2, 9, '#20263a', 2, 5); px(g, 12, 9, '#20263a', 2, 5); px(g, 13, 3, '#e0e8ff', 1, 7);
  px(g, 5, 15, '#20263a', 2, 5); px(g, 9, 15, '#20263a', 2, 5);
  return tex(c);
}

export function floorTexture() {
  const S = 16, N = 8;
  const [c, g] = canvas(S * N, S * N);
  const r = rng(7);
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const v = 0.8 + r() * 0.35;
    const base = new THREE.Color(0x2a2340).multiplyScalar(v);
    px(g, tx * S, ty * S, '#' + base.getHexString(), S, S);
    px(g, tx * S, ty * S, '#15111f', S, 1); px(g, tx * S, ty * S, '#15111f', 1, S);
    px(g, tx * S + 1, ty * S + 1, '#' + base.clone().multiplyScalar(1.25).getHexString(), S - 2, 1);
    for (let k = 0; k < 6; k++) px(g, tx * S + 2 + Math.floor(r() * 12), ty * S + 2 + Math.floor(r() * 12), '#' + base.clone().multiplyScalar(0.75 + r() * 0.5).getHexString());
    if (r() < 0.22) { // 裂缝
      let x = tx * S + 3 + Math.floor(r() * 10), y = ty * S + 3;
      for (let k = 0; k < 8; k++) { px(g, x, y, '#120e1a'); x += Math.floor(r() * 3) - 1; y += 1; }
    }
    if (r() < 0.12) for (let k = 0; k < 8; k++) px(g, tx * S + Math.floor(r() * 16), ty * S + 12 + Math.floor(r() * 4), '#2f5a3a');
  }
  return tex(c, [7, 5]);
}

export function brickTexture() {
  const [c, g] = canvas(32, 32);
  px(g, 0, 0, '#1a1528', 32, 32);
  const r = rng(3);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
    const off = (y % 2) * 5;
    const col = new THREE.Color(0x3b3158).multiplyScalar(0.8 + r() * 0.4);
    px(g, x * 11 + off - 5, y * 8 + 1, '#' + col.getHexString(), 10, 6);
    px(g, x * 11 + off - 5, y * 8 + 1, '#' + col.clone().multiplyScalar(1.3).getHexString(), 10, 1);
  }
  return tex(c);
}

export function runeTexture(n = 12) {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2;
  const ring = (r) => { g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.stroke(); };
  ring(60); ring(52); ring(30);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const x = S / 2 + Math.cos(a) * 56, y = S / 2 + Math.sin(a) * 56;
    g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
  }
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = i / 6 * Math.PI * 2 * 2 - Math.PI / 2;
    const x = S / 2 + Math.cos(a) * 50, y = S / 2 + Math.sin(a) * 50;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  // 像素化：降采样
  const [c2, g2] = canvas(48, 48);
  g2.drawImage(c, 0, 0, 48, 48);
  const d = g2.getImageData(0, 0, 48, 48);
  for (let i = 0; i < d.data.length; i += 4) { const a = d.data[i + 3] > 70 ? 255 : 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a; }
  g2.putImageData(d, 0, 0);
  return tex(c2);
}

export function glowTexture() {
  const [c, g] = canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5) / 8;
    if (d > 1) continue;
    const a = Math.pow(1 - d, 1.6);
    const q = Math.round(a * 4) / 4;
    g.fillStyle = `rgba(255,255,255,${q})`; g.fillRect(x, y, 1, 1);
  }
  return tex(c);
}

export function noiseDiscTexture() {
  const S = 48;
  const [c, g] = canvas(S, S);
  const r = rng(11);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
    if (d > 1) continue;
    const n = r();
    const a = d > 0.9 ? 1 : (n > 0.72 ? 0.7 : n > 0.4 ? 0.28 : 0.12) * (0.4 + d * 0.6);
    g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, 1, 1);
  }
  return tex(c);
}
