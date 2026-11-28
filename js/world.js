// 3D-Welt mit Three.js: Gelände in Kacheln, Straße, Vegetation, Häuser, Himmel, Fahrer-Avatar
import * as THREE from 'three';
import { rng, hash2, fbm, clamp, lerp, smooth } from './util.js';
import * as FX from './worldfx.js';
import { buildThemeExtras, updateThemeExtras, ringPlanetTex } from './worldthemes.js';

const CHUNK = 256;
const QUALITY = {
  high: { pr: 1.75, shadow: 2048, radius: 4, res: 40, trees: 1, aa: true },
  medium: { pr: 1.25, shadow: 1024, radius: 3, res: 32, trees: .75, aa: true },
  low: { pr: 1, shadow: 0, radius: 2, res: 24, trees: .45, aa: false },
};
export function autoQuality() {
  const mobile = navigator.userAgentData?.mobile || /Android|Mobi|iPad|Tablet/i.test(navigator.userAgent);
  return mobile ? 'medium' : 'high';
}
const col = s => new THREE.Color(s);

/* ---------- Texturen aus Canvas ---------- */
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8; return t;
}
function roadTexture() {
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = '#4b5056'; x.fillRect(0, 0, w, h);
    const r = rng(42);
    for (let i = 0; i < 9000; i++) { const v = 60 + r() * 50 | 0; x.fillStyle = `rgba(${v},${v},${v + 4},${.25 + r() * .35})`; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    // Fahrspuren etwas dunkler
    for (const u of [.25, .75]) { const g = x.createLinearGradient(w * (u - .12), 0, w * (u + .12), 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(20,22,26,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(w * (u - .12), 0, w * .24, h); }
    x.fillStyle = '#eceff1'; x.fillRect(w * .03, 0, w * .022, h); x.fillRect(w * .948, 0, w * .022, h);
    x.fillRect(w * .493, 0, w * .016, h * .375);
  });
}
// Wege abseits der Straße: Schotter, Feldweg, Waldpfad, Mondstaub (ohne Markierungen)
function pathTexture(kind) {
  const C = { gravel: ['#a69a86', [150, 140, 122], [95, 88, 78]], dirt: ['#8a6a4a', [120, 92, 64], [70, 52, 36]], trail: ['#5e4630', [88, 66, 44], [40, 30, 20]], moon: ['#8f9195', [170, 172, 176], [90, 92, 96]], cosmic: ['#1a1030', [120, 90, 255], [255, 80, 220]], sand: ['#c9b48a', [215, 200, 160], [160, 140, 105]], candy: ['#ff9ccf', [255, 255, 255], [255, 210, 80]], rainbow: ['#ffffff', [255, 255, 255], [240, 240, 255]] }[kind] || ['#4b5056', [80, 80, 84], [40, 40, 44]];
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = C[0]; x.fillRect(0, 0, w, h); const r = rng(7);
    for (let i = 0; i < 7000; i++) { const c = r() < .5 ? C[1] : C[2], s = kind === 'gravel' ? 1 + r() * 4 : 1 + r() * 2.5; x.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${.3 + r() * .5})`; x.beginPath(); x.arc(r() * w, r() * h, s / 2, 0, 7); x.fill(); }
    if (kind === 'dirt' || kind === 'gravel') for (const u of [.3, .7]) { const g = x.createLinearGradient(w * (u - .1), 0, w * (u + .1), 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(30,20,10,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(w * (u - .1), 0, w * .2, h); }
    if (kind === 'trail') { x.strokeStyle = 'rgba(70,45,25,.8)'; x.lineWidth = 6; for (let i = 0; i < 9; i++) { const y = r() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * .3, y + 20 * (r() - .5), w * .7, y + 30 * (r() - .5), w, y + 15 * (r() - .5)); x.stroke(); } }
    // Regenbogen: farbige Längsstreifen über die ganze Breite
    if (kind === 'rainbow') { const cs = ['#ff4d4d', '#ff9f43', '#ffd93d', '#6bd66b', '#4dabff', '#7a6cff', '#c77dff']; cs.forEach((c, i) => { x.globalAlpha = .9; x.fillStyle = c; x.fillRect(i * w / cs.length, 0, w / cs.length + 1, h); }); x.globalAlpha = 1; }
    if (kind === 'moon') { for (let i = 0; i < 40; i++) { const cx = r() * w, cy = r() * h, rr = 4 + r() * 14; x.strokeStyle = 'rgba(60,62,66,.5)'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.stroke(); } }
  });
}
function grassTexture() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 6000; i++) { const v = 100 + r() * 70 | 0; x.fillStyle = `rgba(${v},${v},${v},.5)`; x.fillRect(r() * w, r() * h, 1, 2 + r() * 3); }
  });
}
function labelTex(text, opt = {}) {
  const w = opt.w || 256, h = opt.h || 128;
  return canvasTex(w, h, (x) => {
    x.fillStyle = opt.bg || '#ffffff'; x.fillRect(0, 0, w, h);
    if (opt.border) { x.strokeStyle = opt.border; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10); }
    if (opt.checker) for (let i = 0; i < w / 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 16, j * 16 + (j ? h - 32 : 0), 16, 16); }
    x.fillStyle = opt.fg || '#111'; x.font = `700 ${opt.size || 64}px Barlow, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2);
  }, false);
}
// Pfeil nach unten mit Leuchtrand (echte Mitspieler)
let _arrowTex = null, _glowTex = null;
function remoteArrowTex() {
  return _arrowTex ||= canvasTex(128, 160, x => {
    x.clearRect(0, 0, 128, 160);
    const path = () => { x.beginPath(); x.moveTo(40, 12); x.lineTo(88, 12); x.lineTo(88, 70); x.lineTo(116, 70); x.lineTo(64, 146); x.lineTo(12, 70); x.lineTo(40, 70); x.closePath(); };
    x.shadowColor = '#2fe6ff'; x.shadowBlur = 22; x.fillStyle = '#2fe6ff'; path(); x.fill(); x.fill();
    x.shadowBlur = 0; x.lineWidth = 6; x.strokeStyle = '#ffffff'; x.lineJoin = 'round'; path(); x.stroke();
  }, false);
}
function glowTex() {
  return _glowTex ||= canvasTex(128, 128, x => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }, false);
}
// Fassade mit Fenstern; wird mit der Hausfarbe multipliziert
function windowTex() {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const px = 12 + i * 40, py = 10 + j * 40;
      x.fillStyle = '#56636f'; x.fillRect(px, py, 24, 26);
      x.fillStyle = '#e9e3d9'; x.fillRect(px + 11, py, 2, 26); x.fillRect(px, py + 12, 24, 2);
    }
    x.fillStyle = '#d6cfc2'; x.fillRect(0, h - 6, w, 6);
  }, false);
}
function cloudTex() {
  return canvasTex(256, 128, (x, w, h) => {
    const r = rng(3);
    for (let i = 0; i < 22; i++) { const cx = 40 + r() * 176, cy = 50 + r() * 40, rad = 18 + r() * 34; const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
  }, false);
}

/* ---------- Geometrie-Helfer ---------- */
function colored(geo, c) { const n = geo.attributes.position.count, a = new Float32Array(n * 3); const cc = col(c); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; }
function merge(geos) {
  // einfache Zusammenführung (Position, Normale, Farbe), nicht indiziert
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), colr = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); colr.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  return m;
}
// light: helle Krone und Stamm, damit Fantasiewelten sie beliebig einfärben können (Lollibäume, Korallen)
function coniferGeo(light, whiteTrunk) {
  const parts = [colored(new THREE.CylinderGeometry(.18, .26, 2.4, 6).translate(0, 1.2, 0), whiteTrunk ? '#f4f4f4' : '#5b4030')];
  [[3.6, 2.4, 1.6], [2.9, 2.6, 3.4], [2.1, 2.6, 5.1], [1.3, 2.2, 6.6]].forEach(([r, h, y], i) => parts.push(colored(new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2 - .6, 0), light ? (i % 2 ? '#e8e8e8' : '#d6d6d6') : i % 2 ? '#2f6a3a' : '#2a6034')));
  return merge(parts);
}
function leafyGeo(light, whiteTrunk) {
  const crown = new THREE.IcosahedronGeometry(2.6, 1);
  const p = crown.attributes.position; const r = rng(11);
  for (let i = 0; i < p.count; i++) { const k = .85 + r() * .3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * .9, p.getZ(i) * k); }
  crown.computeVertexNormals();
  return merge([colored(new THREE.CylinderGeometry(.22, .32, 3.4, 6).translate(0, 1.7, 0), whiteTrunk ? '#ffffff' : '#5d4433'), colored(crown.translate(0, 5, 0), light ? '#eeeeee' : '#4f8f3a'), colored(new THREE.IcosahedronGeometry(1.6, 0).translate(1.2, 4.2, .6), light ? '#dddddd' : '#5c9c42')]);
}
function rockGeo() {
  const g = new THREE.DodecahedronGeometry(1, 0); const p = g.attributes.position; const r = rng(5);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.8 + r() * .5), p.getY(i) * (.5 + r() * .3), p.getZ(i) * (.8 + r() * .5));
  g.computeVertexNormals(); return colored(g, '#8b8d8f');
}
function palmGeo() {
  // leicht gebogener Stamm aus Segmenten, Wedel als flache Kegel
  const parts = []; let x = 0, y = 0;
  for (let i = 0; i < 6; i++) { const seg = new THREE.CylinderGeometry(.2 - i * .015, .24 - i * .015, 1.5, 6); seg.translate(x, y + .75, 0); parts.push(colored(seg, i % 2 ? '#8a6a4a' : '#7b5d40')); x += .12 + i * .04; y += 1.45; }
  for (let k = 0; k < 7; k++) { const f = new THREE.ConeGeometry(.55, 4.2, 4); f.scale(1, 1, .18); f.rotateZ(Math.PI / 2 + .45); f.translate(1.9, 0, 0); f.rotateY(k / 7 * Math.PI * 2); f.translate(x, y + .1, 0); parts.push(colored(f, k % 2 ? '#3f8f3a' : '#4fa043')); }
  parts.push(colored(new THREE.IcosahedronGeometry(.4, 0).translate(x, y - .2, 0), '#6b4a2a'));
  return merge(parts);
}
function cactusGeo() {
  const g = '#4d8a4a';
  return merge([colored(new THREE.CylinderGeometry(.32, .36, 4.2, 8).translate(0, 2.1, 0), g), colored(new THREE.SphereGeometry(.32, 8, 6).translate(0, 4.2, 0), g),
    colored(new THREE.CylinderGeometry(.2, .2, 1, 8).rotateZ(Math.PI / 2).translate(.6, 1.9, 0), g), colored(new THREE.CylinderGeometry(.2, .2, 1.4, 8).translate(1.05, 2.6, 0), g), colored(new THREE.SphereGeometry(.2, 8, 6).translate(1.05, 3.3, 0), g),
    colored(new THREE.CylinderGeometry(.18, .18, .8, 8).rotateZ(Math.PI / 2).translate(-.5, 2.5, 0), g), colored(new THREE.CylinderGeometry(.18, .18, 1, 8).translate(-.85, 3, 0), g), colored(new THREE.SphereGeometry(.18, 8, 6).translate(-.85, 3.5, 0), g)]);
}
function tuftGeo() { return merge([colored(new THREE.ConeGeometry(.35, .9, 4).translate(0, .45, 0), '#5f9a46'), colored(new THREE.ConeGeometry(.25, .7, 4).translate(.3, .35, .2), '#6aa34c')]); }

/* ---------- Avatar ---------- */
export const AV_DEFAULT = { pattern: 'plain', jersey2: '#ffffff', shorts: '#1b1e22', socks: '#f4f4f4', shoes: '#1b1e22', hair: '#3a2a1e', lens: '#20262c', helmetStyle: 'road', glasses: 'none', beard: false, ponytail: false, bottle: true, bottleColor: '#3fa7f5', extra: 'none', bike: 'road', head: 'human' };
// Trikotmuster als Textur (u läuft um den Körper, v von unten nach oben)
export function jerseyTex(pattern, c1, c2) {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = c1; x.fillRect(0, 0, w, h); x.fillStyle = c2;
    if (pattern === 'band') x.fillRect(0, h * .42, w, h * .16);
    else if (pattern === 'stripes') for (let i = 0; i < 8; i++) x.fillRect(i * w / 8, 0, w / 16, h);
    else if (pattern === 'hoops') for (let i = 0; i < 6; i++) x.fillRect(0, i * h / 6, w, h / 12);
    else if (pattern === 'dots') for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) { x.beginPath(); x.arc((i + .5 + (j % 2) * .5) * w / 9, (j + .5) * h / 9, w / 40, 0, 7); x.fill(); }
    else if (pattern === 'split') x.fillRect(0, 0, w / 2, h);
    else if (pattern === 'chevron') { x.lineWidth = h / 10; x.strokeStyle = c2; x.beginPath(); x.moveTo(0, h * .3); x.lineTo(w / 4, h * .55); x.lineTo(w / 2, h * .3); x.lineTo(w * .75, h * .55); x.lineTo(w, h * .3); x.stroke(); }
  }, false);
}
export class Rider {
  constructor(c) {
    const A = this.av = { ...AV_DEFAULT, ...(c.av || {}) };
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ';
    const M = (color, rough) => new THREE.MeshStandardMaterial({ color, roughness: rough ?? .6, metalness: 0 });
    this.mat = { jersey: M(c.jersey, .7), bike: M(c.bikeColor, .35), skin: M(c.skin, .8), helmet: M(c.helmet, .3), dark: M('#1b1e22', .8), tire: M('#151618', .9), rim: M('#c8ccd0', .3), sock: M(A.socks, .8),
      shorts: M(A.shorts, .75), shoes: M(A.shoes, .5), hair: M(A.hair, .9), lens: new THREE.MeshStandardMaterial({ color: A.lens, roughness: .1, metalness: .6 }), gold: new THREE.MeshStandardMaterial({ color: '#e8c04a', roughness: .25, metalness: .8 }) };
    if (A.pattern && A.pattern !== 'plain') { this.mat.jersey.map = jerseyTex(A.pattern, c.jersey, A.jersey2); this.mat.jersey.color.set('#ffffff'); }
    const g = this.g = new THREE.Group(); this.root.add(g);
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.P = { R: V(0, .34, .5), F: V(0, .34, -.53), BB: V(0, .29, .04), S: V(0, .8, .2), H: V(0, .86, -.36), HB: V(0, .7, -.4) };
    const tube = (a, b, r, mat) => { const m = add(new THREE.CylinderGeometry(r, r, 1, 8), mat); this.limb(m, a, b); return m; };
    const P = this.P;
    tube(P.R, P.BB, .016, this.mat.bike); tube(P.R, P.S, .014, this.mat.bike); tube(P.BB, P.S, .022, this.mat.bike);
    tube(P.S, P.H, .02, this.mat.bike); tube(P.BB, P.HB, .026, this.mat.bike); tube(P.HB, P.F, .016, this.mat.bike); tube(P.HB, P.H, .024, this.mat.bike);
    // Radtyp: Lenker und Griffposition (Hände), Reifen, Zubehör
    const T = A.bike || 'road';
    this.hand = T === 'mtb' ? { x: .32, y: .92, z: -.44 } : T === 'city' || T === 'cargo' ? { x: .27, y: 1.0, z: -.36 } : T === 'tt' ? { x: .07, y: .86, z: -.62 } : { x: .2, y: .9, z: -.46 };
    const Hd = this.hand;
    if (T === 'mtb') { tube(P.H, V(0, .92, -.44), .018, this.mat.dark); const bar = add(new THREE.CylinderGeometry(.014, .014, .68, 8), this.mat.dark); bar.rotation.z = Math.PI / 2; bar.position.set(0, .92, -.44); tube(P.HB, P.F, .03, this.mat.rim); }
    else if (T === 'city' || T === 'cargo') { tube(P.H, V(0, 1.0, -.38), .016, this.mat.dark); for (const s of [-1, 1]) tube(V(0, 1.0, -.38), V(s * .27, 1.0, -.33), .013, this.mat.dark); }
    else if (T === 'tt') { tube(P.H, V(0, .86, -.46), .016, this.mat.dark); const bar = add(new THREE.CylinderGeometry(.013, .013, .4, 8), this.mat.dark); bar.rotation.z = Math.PI / 2; bar.position.set(0, .86, -.47); for (const s of [-1, 1]) tube(V(s * .07, .87, -.42), V(s * .07, .87, -.66), .011, this.mat.dark); }
    else { tube(P.H, V(0, .9, -.46), .016, this.mat.dark); const bar = add(new THREE.CylinderGeometry(.013, .013, .42, 8), this.mat.dark); bar.rotation.z = Math.PI / 2; bar.position.set(0, .9, -.47); for (const s of [-1, 1]) tube(V(s * .2, .9, -.47), V(s * .2, .8, -.42), .012, this.mat.dark); }
    tube(P.S, V(0, .88, .23), .013, this.mat.rim);
    const saddle = add(new THREE.BoxGeometry(.13, .04, .27), this.mat.dark); saddle.position.set(0, .89, .23);
    const tw = { road: .022, tt: .022, gravel: .032, city: .03, cargo: .03, mtb: .046 }[T] || .022, wheelAt = T === 'cargo' ? [P.R, P.F, V(0, .22, -1.25)] : [P.R, P.F];
    this.wheels = wheelAt.map((p, wi) => {
      const w = new THREE.Group(); w.position.copy(p); g.add(w); const sc = wi === 2 ? .62 : 1; w.scale.setScalar(sc);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(.335, tw, 8, 32), this.mat.tire); tire.rotation.y = Math.PI / 2; tire.castShadow = true; w.add(tire);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.305, .012, 6, 32), this.mat.rim); rim.rotation.y = Math.PI / 2; w.add(rim);
      if (T === 'tt') { const disc = new THREE.Mesh(new THREE.CylinderGeometry(.305, .305, .02, 32), this.mat.bike); disc.rotation.z = Math.PI / 2; w.add(disc); }
      else for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(.004, .6, .012), this.mat.rim); sp.rotation.x = k * Math.PI / 4; w.add(sp); }
      if (T === 'mtb') for (let k = 0; k < 24; k++) { const kn = new THREE.Mesh(new THREE.BoxGeometry(.11, .02, .03), this.mat.tire); const a = k / 24 * Math.PI * 2; kn.position.set(0, Math.cos(a) * .375, Math.sin(a) * .375); kn.rotation.x = a; w.add(kn); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .1, 10), this.mat.rim); hub.rotation.z = Math.PI / 2; w.add(hub);
      return w;
    });
    // Stadtrad: Schutzbleche und Korb; Lastenrad: Kiste vorne mit Mitfahrer (Hund)
    if (T === 'city' || T === 'cargo') for (const p of [P.R, P.F]) { const m = add(new THREE.TorusGeometry(.37, .012, 4, 24, Math.PI * .9), this.mat.bike); m.rotation.y = Math.PI / 2; m.rotation.x = p === P.R ? -Math.PI * .95 : -Math.PI * .1; m.position.copy(p); }
    if (T === 'city') { const b = add(new THREE.BoxGeometry(.3, .18, .26), new THREE.MeshStandardMaterial({ color: '#a8763e', roughness: .9, wireframe: true })); b.position.set(0, .82, -.68); }
    if (T === 'cargo') {
      tube(P.HB, V(0, .3, -1.25), .022, this.mat.bike);
      const box = add(new THREE.BoxGeometry(.5, .32, .6), new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: .9 })); box.position.set(0, .55, -.95);
      const dog = new THREE.Group(); dog.position.set(0, .78, -.98); g.add(dog);
      const fur = new THREE.MeshStandardMaterial({ color: '#c8a070', roughness: .9 }), dark = this.mat.dark;
      const dh = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 10), fur); dog.add(dh);
      const sn = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 8), fur); sn.position.set(0, -.02, -.1); dog.add(sn);
      const no = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), dark); no.position.set(0, 0, -.16); dog.add(no);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#7a5030', roughness: .9 })); e.scale.set(.5, 1.3, .8); e.position.set(s * .1, .04, .02); e.rotation.z = s * .5; dog.add(e); const ey = new THREE.Mesh(new THREE.SphereGeometry(.016, 6, 5), dark); ey.position.set(s * .045, .03, -.09); dog.add(ey); }
      this.dog = dog;
    }
    const ring = add(new THREE.CylinderGeometry(.1, .1, .01, 20), this.mat.rim); ring.rotation.z = Math.PI / 2; ring.position.copy(P.BB).add(V(.05, 0, 0));
    this.crank = [add(new THREE.BoxGeometry(.015, .17, .025), this.mat.rim), add(new THREE.BoxGeometry(.015, .17, .025), this.mat.rim)];
    // Fahrer
    this.hip = V(0, .96, .2); this.sh = T === 'city' || T === 'cargo' ? V(0, 1.44, 0) : T === 'tt' ? V(0, 1.27, -.3) : V(0, 1.36, -.2);
    this.torso = add(new THREE.CapsuleGeometry(.15, .32, 4, 10), this.mat.jersey); this.torso.scale.set(1.15, 1, .85);
    this.head = add(new THREE.SphereGeometry(.1, 14, 12), this.mat.skin);
    this.helmet = add(new THREE.SphereGeometry(.13, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), this.mat.helmet); this.helmet.scale.set(.95, .85, 1.25);
    this.arms = [-1, 1].map(s => ({ s, up: add(new THREE.CylinderGeometry(.045, .04, 1, 8), this.mat.jersey), lo: add(new THREE.CylinderGeometry(.038, .033, 1, 8), this.mat.skin), elb: add(new THREE.SphereGeometry(.042, 8, 6), this.mat.skin) }));
    this.legs = [-1, 1].map(s => ({ s, th: add(new THREE.CylinderGeometry(.075, .055, 1, 10), this.mat.shorts), sh: add(new THREE.CylinderGeometry(.052, .04, 1, 10), this.mat.skin), knee: add(new THREE.SphereGeometry(.058, 10, 8), this.mat.skin), sock: add(new THREE.CylinderGeometry(.042, .042, .12, 8), this.mat.sock), shoe: add(new THREE.BoxGeometry(.08, .07, .25), this.mat.shoes) }));
    this.buildAcc(add, V);
    this.wheelA = 0; this.update(0, 0, 0, 0);
  }
  // Zubehör: Helmform, Brille, Bart, Zopf, Trinkflasche und freischaltbare Extras. Alles hängt an einer Kopfgruppe.
  buildAcc(add, V) {
    const A = this.av, hg = this.headG = new THREE.Group(); this.g.add(hg);
    const put = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; hg.add(m); return m; };
    // Tierkopf statt Menschenkopf: Fell färbt auch Arme und Beine
    const AN = { fox: ['#e0702a', '#ffffff'], panda: ['#f4f4f2', '#1b1b1d'], bear: ['#7a5030', '#c9a27a'], cat: ['#9aa0a6', '#f1e7dc'], penguin: ['#1d2126', '#f4f4f2'], frog: ['#4fae4a', '#d9f0a8'] }[A.head];
    if (AN) {
      const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .85 }), fur = M(AN[0]), fur2 = M(AN[1]), dk = this.mat.dark;
      this.head.visible = false; this.mat.skin.color.set(AN[0]);
      const h = put(new THREE.SphereGeometry(.11, 16, 12), fur, 0, 0, 0);
      const eyes = (y, z, r = .018) => { for (const s of [-1, 1]) put(new THREE.SphereGeometry(r, 8, 6), dk, s * .042, y, z); };
      if (A.head === 'fox') { const sn = put(new THREE.ConeGeometry(.055, .14, 10), fur2, 0, -.03, -.13); sn.rotation.x = -Math.PI / 2; put(new THREE.SphereGeometry(.016, 6, 5), dk, 0, -.03, -.2); for (const s of [-1, 1]) { const e = put(new THREE.ConeGeometry(.04, .09, 4), fur, s * .065, .1, 0); e.rotation.z = -s * .25; } eyes(.02, -.095); }
      if (A.head === 'cat') { put(new THREE.SphereGeometry(.05, 10, 8), fur2, 0, -.035, -.08).scale.set(1.2, .8, .8); put(new THREE.SphereGeometry(.012, 6, 5), M('#e88a9a'), 0, -.02, -.12); for (const s of [-1, 1]) { const e = put(new THREE.ConeGeometry(.035, .07, 4), fur, s * .06, .1, -.01); e.rotation.z = -s * .2; } eyes(.02, -.095); }
      if (A.head === 'panda') { for (const s of [-1, 1]) { put(new THREE.SphereGeometry(.035, 10, 8), fur2, s * .075, .085, .01); put(new THREE.SphereGeometry(.028, 10, 8), fur2, s * .042, .02, -.09).scale.set(1, 1.3, .6); } put(new THREE.SphereGeometry(.018, 8, 6), fur2, 0, -.03, -.105); }
      if (A.head === 'bear') { for (const s of [-1, 1]) put(new THREE.SphereGeometry(.035, 10, 8), fur, s * .075, .085, .01); put(new THREE.SphereGeometry(.05, 10, 8), fur2, 0, -.035, -.085).scale.set(1, .8, .9); put(new THREE.SphereGeometry(.018, 8, 6), dk, 0, -.02, -.13); eyes(.025, -.095, .015); }
      if (A.head === 'penguin') { put(new THREE.SphereGeometry(.085, 14, 10), fur2, 0, -.01, -.04).scale.set(1, 1.05, .7); const b = put(new THREE.ConeGeometry(.03, .08, 8), M('#f5a623'), 0, -.03, -.14); b.rotation.x = -Math.PI / 2; eyes(.025, -.1, .014); }
      if (A.head === 'frog') { h.scale.set(1.25, .8, 1.05); for (const s of [-1, 1]) { put(new THREE.SphereGeometry(.04, 10, 8), fur, s * .06, .07, -.04); put(new THREE.SphereGeometry(.02, 8, 6), dk, s * .06, .085, -.075); } put(new THREE.TorusGeometry(.05, .006, 4, 12, Math.PI), M('#2d6a2a'), 0, -.03, -.1).rotation.z = Math.PI; }
    }
    // Helm: Straße (Standard), Aero (lang gezogen mit Spitze), Kappe (Schirmmütze statt Helm)
    if (A.helmetStyle === 'aero') { this.helmet.scale.set(.95, .82, 1.55); put(new THREE.ConeGeometry(.07, .22, 10).rotateX(Math.PI / 2), this.mat.helmet, 0, .02, .22); }
    if (A.helmetStyle === 'cap') {
      this.helmet.visible = false;
      put(new THREE.SphereGeometry(.108, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), this.mat.helmet, 0, .02, 0);
      put(new THREE.CylinderGeometry(.09, .09, .012, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, .9), this.mat.helmet, 0, .03, -.09);
    }
    if (A.glasses === 'sport') { put(new THREE.BoxGeometry(.2, .045, .03), this.mat.lens, 0, -.005, -.098).rotation.x = .1; put(new THREE.BoxGeometry(.012, .012, .12), this.mat.dark, .1, 0, -.04); put(new THREE.BoxGeometry(.012, .012, .12), this.mat.dark, -.1, 0, -.04); }
    if (A.glasses === 'round') for (const s of [-1, 1]) { const r = put(new THREE.TorusGeometry(.028, .006, 6, 16), this.mat.dark, s * .04, -.005, -.098); put(new THREE.CircleGeometry(.026, 16), this.mat.lens, s * .04, -.005, -.1).rotation.y = Math.PI; r.rotation.y = 0; }
    if (A.beard) put(new THREE.SphereGeometry(.075, 12, 8, 0, Math.PI * 2, Math.PI / 2.4, Math.PI / 2).scale(1, .9, .9), this.mat.hair, 0, -.035, -.035);
    if (A.ponytail) { const t = put(new THREE.CylinderGeometry(.025, .012, .2, 8), this.mat.hair, 0, -.05, .14); t.rotation.x = -.9; }
    if (A.extra === 'horn') { const h = put(new THREE.ConeGeometry(.03, .2, 12), this.mat.gold, 0, .19, -.08); h.rotation.x = -.5; }
    if (A.extra === 'crown') { const cr = put(new THREE.CylinderGeometry(.08, .07, .06, 8, 1, true), this.mat.gold, 0, .15, 0); cr.material.side = THREE.DoubleSide; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; put(new THREE.ConeGeometry(.014, .04, 6), this.mat.gold, Math.cos(a) * .078, .2, Math.sin(a) * .078); } }
    if (A.extra === 'antlers') for (const s of [-1, 1]) { const a = put(new THREE.CylinderGeometry(.008, .012, .16, 6), this.mat.hair, s * .07, .17, 0); a.rotation.z = -s * .5; const b = put(new THREE.CylinderGeometry(.006, .009, .08, 6), this.mat.hair, s * .1, .22, -.03); b.rotation.x = .6; }
    if (A.bottle) { const P = this.P, b = add(new THREE.CylinderGeometry(.035, .035, 1, 10), new THREE.MeshStandardMaterial({ color: A.bottleColor || '#3fa7f5', roughness: .4 })); this.limb(b, P.BB.clone().lerp(P.HB, .3), P.BB.clone().lerp(P.HB, .62)); b.position.y += .05; }
  }
  setColors(c) { if (this.mat.jersey.map) { this.mat.jersey.map = jerseyTex(this.av.pattern, c.jersey, this.av.jersey2); this.mat.jersey.needsUpdate = true; } else this.mat.jersey.color.set(c.jersey); this.mat.bike.color.set(c.bikeColor); this.mat.helmet.color.set(c.helmet); this.mat.skin.color.set(c.skin); }
  limb(m, a, b) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    m.position.copy(a).addScaledVector(d, .5); m.scale.set(1, L, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }
  update(crank, v, dt, gradePct) {
    if (this.dog) this.dog.rotation.y = Math.sin(crank * .45) * .35;
    const P = this.P, V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.wheelA -= v / .34 * dt; for (const w of this.wheels) w.rotation.x = this.wheelA;
    const bob = Math.sin(crank * 2) * .008 * Math.min(1, v / 3);
    const lean = clamp(gradePct / 100, -.1, .15);
    const hip = this.hip.clone().add(V(0, bob, 0)), sh = this.sh.clone().add(V(0, bob * .6 - lean * .3, lean * .6));
    // Oberkörper
    const mid = hip.clone().lerp(sh, .5); this.torso.position.copy(mid);
    this.torso.quaternion.setFromUnitVectors(V(0, 1, 0), sh.clone().sub(hip).normalize());
    const headP = sh.clone().add(V(0, .15, -.1)); this.head.position.copy(headP); this.helmet.position.copy(headP).add(V(0, .03, .01)); this.helmet.rotation.x = -.35; if (this.headG) { this.headG.position.copy(this.head.position); this.headG.rotation.x = -.25; }
    for (const a of this.arms) {
      const Hd = this.hand || { x: .2, y: .9, z: -.46 }, s0 = sh.clone().add(V(a.s * .17, .02, .02)), hand = V(a.s * Hd.x, Hd.y, Hd.z), el = s0.clone().lerp(hand, .5).add(V(a.s * .03, .06, .05));
      this.limb(a.up, s0, el); this.limb(a.lo, el, hand); a.elb.position.copy(el);
    }
    const r = .17, L1 = .45, L2 = .46;
    for (const l of this.legs) {
      const ang = crank + (l.s > 0 ? Math.PI : 0);
      const ped = P.BB.clone().add(V(l.s * .09, -Math.cos(ang) * r, Math.sin(ang) * r));
      const arm = this.crank[l.s > 0 ? 1 : 0]; this.limb(arm, P.BB.clone().add(V(l.s * .07, 0, 0)), ped.clone().add(V(-l.s * .02, 0, 0)));
      const foot = ped.clone().add(V(0, .055, 0)), h = hip.clone().add(V(l.s * .1, -.02, 0));
      const dv = foot.clone().sub(h); let D = Math.min(dv.length(), L1 + L2 - .005);
      const dir = dv.normalize(), a1 = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      let perp = V(0, -dir.z, dir.y); if (perp.z > 0) perp.negate();
      const knee = h.clone().addScaledVector(dir, Math.cos(a1) * L1).addScaledVector(perp, Math.sin(a1) * L1);
      this.limb(l.th, h, knee); l.knee.position.copy(knee);
      const ankle = h.clone().addScaledVector(dir, D);
      this.limb(l.sh, knee, ankle);
      l.sock.position.copy(ankle).lerp(knee, .12); l.sock.quaternion.copy(l.sh.quaternion);
      l.shoe.position.copy(ankle).add(V(0, -.02, -.05)); l.shoe.rotation.x = -.15 - Math.sin(ang) * .2;
    }
  }
}

/* ---------- Welt ---------- */
export class World {
  constructor(canvas, route, profile, opt = {}) {
    this.route = route; this.profile = profile; this.latK = Math.min(1, (route.roadW || 3.3) / 3.3);
    this.qKey = (profile.quality === 'auto' || !QUALITY[profile.quality]) ? autoQuality() : profile.quality;
    const Q = this.Q = QUALITY[this.qKey];
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    if (Q.shadow) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; }
    const th = route.theme;
    this.scene = new THREE.Scene();
    const sky0 = col(th.sky[0]), sky1 = col(th.sky[1]);
    this.scene.background = sky1.clone();
    const viewR = (Q.radius + .5) * CHUNK;
    this.scene.fog = new THREE.Fog(sky1.clone(), viewR * .35, viewR * .98);
    this.camera = new THREE.PerspectiveCamera(62, 1, .1, 9000);
    // Himmelskuppel
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: sky0 }, hor: { value: sky1 }, sun: { value: new THREE.Vector3(.45, .55, -.7).normalize() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 sun; varying vec3 vP; void main(){ float h = clamp(vP.y,0.0,1.0); vec3 c = mix(hor, top, pow(h,0.55)); float s = max(dot(vP, sun),0.0); c += vec3(1.0,0.92,0.75)*(pow(s,600.0)*2.5 + pow(s,12.0)*0.18); if(vP.y<0.0) c = hor; gl_FragColor = vec4(c,1.0); }',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), skyMat); this.sky.renderOrder = -10; this.scene.add(this.sky);
    this.skyMat = skyMat;
    // Licht
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.15); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sunDir = new THREE.Vector3(.45, .55, -.7).normalize();
    if (Q.shadow) { sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow); const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400; sun.shadow.bias = -.0004; sun.shadow.normalBias = .04; }
    this.scene.add(sun); this.scene.add(sun.target);
    // Materialien
    this.grassTex = grassTexture(); this.grassTex.colorSpace = THREE.NoColorSpace;
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.grassTex });
    this.vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // Lebendige Welt (abschaltbar, auf "Niedrig" aus): Wolkenschatten im Gelände, Wind in Bäumen und Gras
    this.living = profile.living !== false && this.qKey !== 'low';
    if (this.living) { FX.cloudShadows(this.terrainMat); this.vegMat = new THREE.MeshLambertMaterial({ vertexColors: true }); FX.windSway(this.vegMat); }
    this.chunks = new Map(); this.queue = [];
    this.buildRoad(); this.buildInstances(); this.buildFar(); this.buildClouds(); this.buildProps(); this.buildTunnels();
    if (this.living) { this.flare = FX.makeFlare(this.scene); this.parts = FX.makeParticles(this.scene, FX.particleKind(route.theme), this.qKey === 'high' ? 320 : 180); this.specs = FX.makeSpectators(this, route, this.vcMat); }
    if (route.realTerrain) { this.buildDemFar(); this.scene.fog.far = 7000; this.scene.fog.near = viewR * .6; }
    if (route.osm) this.buildOsm();
    this.npcs = [];
    if (route.water != null) {
      const wm = new THREE.MeshPhongMaterial({ color: 0x1f5f8f, specular: 0x5f8fb8, shininess: 60, transparent: true, opacity: .94 });
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), wm); this.water.rotation.x = -Math.PI / 2; this.water.position.y = route.water; this.water.receiveShadow = true; this.scene.add(this.water);
    }
    this.rider = new Rider(profile); this.scene.add(this.rider.root);
    // Fahrradlicht für die Nacht
    this.lamp = new THREE.SpotLight(0xfff2d0, 0, 60, .5, .6, 1.2); this.lamp.position.set(0, 1.1, -.6); this.lamp.target.position.set(0, 0, -14);
    this.rider.root.add(this.lamp, this.lamp.target);
    this.expoBase = 1.05; this.baseTheme = { sky: th.sky.map(col) };
    this.buildStars(); this.buildRain();
    this.pacer = null;
    this.view = 0; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.camInit = false;
    this.lastInst = 0; this.instDirty = true;
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /* Straße als Band entlang der Strecke */
  buildRoad() {
    const R = this.route, N = R.N, W = R.roadW || 3.3, SH = W < 3 ? .6 : 1.7, offroad = (R.surface || 'asphalt') !== 'asphalt';
    const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2);
    const sp = new Float32Array((N + 1) * 4 * 3), sc = new Float32Array((N + 1) * 4 * 3);
    const gravel = col('#8a8275'), grass = col(R.theme.grass[0]);
    for (let i = 0; i <= N; i++) {
      const h = R.head[i], rx = Math.cos(h), rz = Math.sin(h), x = R.x[i], z = R.z[i], y = R.e[i] + .1;
      pos.set([x - rx * W, y, z - rz * W, x + rx * W, y, z + rz * W], i * 6);
      uv.set([0, i * R.step / 8, 1, i * R.step / 8], i * 4);
      sp.set([x - rx * (W + SH), y - .32, z - rz * (W + SH), x - rx * W, y - .02, z - rz * W, x + rx * W, y - .02, z + rz * W, x + rx * (W + SH), y - .32, z + rz * (W + SH)], i * 12);
      for (let k = 0; k < 4; k++) { const c = (k === 0 || k === 3 || offroad) ? grass : gravel; sc.set([c.r, c.g, c.b], i * 12 + k * 3); }
    }
    const idx = [], sidx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c);
      const s = i * 4, t = s + 4; sidx.push(s, s + 1, t, s + 1, t + 1, t, s + 2, s + 3, t + 2, s + 3, t + 3, t + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tex = offroad ? pathTexture(R.surface) : roadTexture();
    const road = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ map: tex, specular: 0x0b0b0b, shininess: 20, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    road.receiveShadow = true; this.scene.add(road);
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(sp, 3)); g2.setAttribute('color', new THREE.BufferAttribute(sc, 3)); g2.setIndex(sidx); g2.computeVertexNormals();
    const sh = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); sh.receiveShadow = true; this.scene.add(sh);
    // Steigungsband am Straßenrand: Farbe zeigt die Steigung (blau bergab, grün flach, gelb, orange, rot steil)
    const gb = new Float32Array((N + 1) * 4 * 3), gcol = new Float32Array((N + 1) * 4 * 3), gidx = [];
    const gc = g => col(g > 8 ? '#ef4458' : g > 5 ? '#ff8a3d' : g > 2.5 ? '#f5c542' : g > -1.5 ? '#4fd18b' : '#3fa7f5');
    for (let i = 0; i <= N; i++) {
      const h = R.head[i], rx = Math.cos(h), rz = Math.sin(h), x = R.x[i], z = R.z[i], y = R.e[i] + .11, c = gc(R.grade[i]);
      const BW = offroad ? .18 : .5; gb.set([x - rx * (W + BW), y - .08, z - rz * (W + BW), x - rx * (W + .02), y, z - rz * (W + .02), x + rx * (W + .02), y, z + rz * (W + .02), x + rx * (W + BW), y - .08, z + rz * (W + BW)], i * 12);
      for (let k = 0; k < 4; k++) gcol.set([c.r, c.g, c.b], i * 12 + k * 3);
    }
    for (let i = 0; i < N; i++) { const s = i * 4, t = s + 4; gidx.push(s, s + 1, t, s + 1, t + 1, t, s + 2, s + 3, t + 2, s + 3, t + 3, t + 2); }
    const g3 = new THREE.BufferGeometry(); g3.setAttribute('position', new THREE.BufferAttribute(gb, 3)); g3.setAttribute('color', new THREE.BufferAttribute(gcol, 3)); g3.setIndex(gidx);
    const band = new THREE.Mesh(g3, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    this.scene.add(band);
    this.roadMeshes = [road, sh, band];
  }

  /* Tunnel: Gewölbe entlang der Straße, Portale, Lampen */
  buildTunnels() {
    const R = this.route; if (!R.tunnels.length) return;
    const SEG = 12, HW = 5.6, HH = 6.4;
    const mat = new THREE.MeshLambertMaterial({ color: 0x77736c, side: THREE.DoubleSide });
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffe3a0 });
    const portalM = new THREE.MeshLambertMaterial({ color: 0x9a948a });
    for (const t of R.tunnels) {
      const a = t.from - 32, b = t.to + 32, n = Math.max(2, Math.round((b - a) / 4));
      const pos = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const d = a + (b - a) * i / n, h = R.headAt(d), rx = Math.cos(h), rz = Math.sin(h), x = R.xAt(d), z = R.zAt(d), y = R.eleAt(d);
        for (let k = 0; k <= SEG; k++) { const ang = Math.PI * k / SEG, lx = -Math.cos(ang) * HW, ly = Math.sin(ang) * HH - .3; pos.push(x + rx * lx, y + ly, z + rz * lx); }
        if (i < n) for (let k = 0; k < SEG; k++) { const p = i * (SEG + 1) + k, q = p + SEG + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const tube = new THREE.Mesh(g, mat); tube.castShadow = true; tube.receiveShadow = true; this.scene.add(tube);
      // Lampen an der Decke
      const cnt = Math.floor((b - a) / 18), lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(.5, .12, 1.6), lampM, cnt), m = new THREE.Matrix4();
      for (let k = 0; k < cnt; k++) { const d = a + 9 + k * 18, h = R.headAt(d); m.makeRotationY(-h); m.setPosition(R.xAt(d), R.eleAt(d) + HH - .45, R.zAt(d)); lamps.setMatrixAt(k, m); }
      this.scene.add(lamps);
      // Portale
      for (const [d, dir] of [[a, 1], [b, -1]]) {
        const grp = new THREE.Group(), h = R.headAt(d); grp.position.set(R.xAt(d), R.eleAt(d), R.zAt(d)); grp.rotation.y = -h;
        for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(3, 9, 1.4), portalM); p.position.set(s * (HW + 1.4), 4.2, 0); p.castShadow = true; grp.add(p); }
        const top = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 5.8, 2.6, 1.4), portalM); top.position.y = HH + 1; top.castShadow = true; grp.add(top);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, .9), new THREE.MeshBasicMaterial({ map: labelTex('TUNNEL ' +Math.round(t.to - t.from) + ' m', { w: 512, h: 90, size: 52, bg: '#f2f2f2', fg: '#1b1e22' }) }));
        sign.position.set(0, HH + 1, dir * .72); if (dir < 0) sign.rotation.y = Math.PI; grp.add(sign);
        this.scene.add(grp);
      }
    }
  }

  /* Leitpfosten, Kilometersteine, Start/Ziel, Anstiegsbanner */
  buildProps() {
    const R = this.route, at = (d, off, y = 0) => { const x = R.xAt(d), z = R.zAt(d), h = R.headAt(d); return new THREE.Vector3(x + Math.cos(h) * off, R.eleAt(d) + y, z + Math.sin(h) * off); };
    // Leitpfosten
    const n = (R.surface || 'asphalt') === 'asphalt' ? Math.floor(R.total / 50) * 2 : 0;
    const post = new THREE.InstancedMesh(merge([colored(new THREE.BoxGeometry(.12, 1, .12).translate(0, .5, 0), '#f2f2f2'), colored(new THREE.BoxGeometry(.125, .2, .125).translate(0, .82, 0), '#222')]), this.vcMat, n);
    const m = new THREE.Matrix4(); let k = 0;
    for (let d = 25; d < R.total && k < n; d += 50) for (const s of [-1, 1]) { const p = at(d, s * 5.4, -.1); m.makeRotationY(-R.headAt(d)); m.setPosition(p); post.setMatrixAt(k++, m); }
    post.count = k; post.castShadow = true; this.scene.add(post);
    // Kilometersteine
    for (let km = 1; km * 1000 < R.total; km++) {
      const d = km * 1000, p = at(d, 5.6), grp = new THREE.Group(); grp.position.copy(p); grp.rotation.y = -R.headAt(d) + Math.PI / 2;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(.25, 1.1, .55), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 })); stone.position.y = .45; stone.castShadow = true; grp.add(stone);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(.5, .32), new THREE.MeshBasicMaterial({ map: labelTex(String(km), { w: 128, h: 80, size: 56, bg: '#ffd23f' }) })); plate.position.set(-.13, .7, 0); plate.rotation.y = -Math.PI / 2; grp.add(plate);
      this.scene.add(grp);
    }
    // Torbögen
    const arch = (d, text, opt) => {
      const g = new THREE.Group(), h = R.headAt(d), p = at(d, 0); g.position.copy(p); g.rotation.y = -h;
      const pm = new THREE.MeshLambertMaterial({ color: opt.pole || 0x2b2f35 });
      for (const s of [-1, 1]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(.45, 6, .45), pm); pole.position.set(s * 5, 3, 0); pole.castShadow = true; g.add(pole); }
      const ban = new THREE.Mesh(new THREE.BoxGeometry(10.5, 1.5, .3), [pm, pm, pm, pm, new THREE.MeshBasicMaterial({ map: labelTex(text, { w: 512, h: 80, size: 50, ...opt }) }), new THREE.MeshBasicMaterial({ map: labelTex(text, { w: 512, h: 80, size: 50, ...opt }) })]);
      ban.position.y = 5.6; ban.castShadow = true; g.add(ban); this.scene.add(g);
    };
    arch(8, R.loop ? 'START · ZIEL' : 'START', { bg: '#ffffff', fg: '#111', checker: true });
    if (!R.loop) arch(R.total - 6, 'ZIEL', { bg: '#ffffff', fg: '#111', checker: true });
    for (const c of R.climbs) { arch(c.from, c.name.toUpperCase(), { bg: '#c8102e', fg: '#fff' }); arch(c.to, 'GIPFEL ' + c.name.toUpperCase(), { bg: '#ffffff', fg: '#c8102e', border: '#c8102e' }); }
    for (const s of R.sprints) { arch(s.from, s.name.toUpperCase(), { bg: '#2f9e57', fg: '#fff' }); arch(s.to, 'SPRINT ENDE', { bg: '#ffffff', fg: '#2f9e57', border: '#2f9e57' }); }
    // Steigungsschilder an Anstiegen: alle 500 m mit Steigung des nächsten Abschnitts
    const signMat = new THREE.MeshLambertMaterial({ color: 0x9aa1a8 });
    for (const c of R.climbs) for (let d = c.from + 20; d < c.to - 150; d += 500) {
      const end = Math.min(c.to, d + 500), g = (R.eleAt(end) - R.eleAt(d)) / (end - d) * 100, left = (c.to - d) / 1000;
      const grp = new THREE.Group(), p = at(d, -5.8); grp.position.copy(p); grp.rotation.y = -R.headAt(d);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.2, 6), signMat); post.position.y = 1.1; grp.add(post);
      const bg = g > 8 ? '#ef4458' : g > 5 ? '#ff8a3d' : '#f5c542';
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .9), new THREE.MeshBasicMaterial({ map: labelTex(`▲ ${g.toFixed(0)} %`, { w: 256, h: 176, size: 70, bg, fg: '#111', border: '#111' }) }));
      pl.position.set(0, 2.4, .04); grp.add(pl);
      const pl2 = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .4), new THREE.MeshBasicMaterial({ map: labelTex(`noch ${left.toFixed(1).replace('.', ',')} km`, { w: 256, h: 80, size: 40, bg: '#fff', fg: '#111' }) }));
      pl2.position.set(0, 1.75, .04); grp.add(pl2);
      this.scene.add(grp);
    }
    // Ortschaften: Ortstafeln, Laternen, Kirchturm
    const lampPole = new THREE.MeshLambertMaterial({ color: 0x3a3f45 }), lampHead = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
    for (const t of R.towns) {
      for (const [d, txt, back] of [[t.from - 15, t.name, false], [t.to + 15, t.name, true]]) {
        const grp = new THREE.Group(), p = at(d, 5.9); grp.position.copy(p); grp.rotation.y = -R.headAt(d);
        for (const s of [-.55, .55]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 2, 6), signMat); post.position.set(s, 1, 0); grp.add(post); }
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .8), new THREE.MeshBasicMaterial({ map: labelTex(txt, { w: 320, h: 160, size: txt.length > 10 ? 40 : 54, bg: '#ffd23f', fg: '#111', border: '#111' }) }));
        pl.position.set(0, 1.9, .03); grp.add(pl);
        if (back) { const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .08), new THREE.MeshBasicMaterial({ color: 0xc8102e })); bar.position.set(0, 1.9, .04); bar.rotation.z = -.42; grp.add(bar); }
        this.scene.add(grp);
      }
      const n = Math.floor((t.to - t.from) / 40), poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.07, .09, 5, 6).translate(0, 2.5, 0), lampPole, n), heads = new THREE.InstancedMesh(new THREE.BoxGeometry(.9, .14, .3), lampHead, n), m = new THREE.Matrix4();
      for (let k = 0; k < n; k++) { const d = t.from + 20 + k * 40, s = k % 2 ? 1 : -1, p = at(d, s * 5.2, -.1); m.makeRotationY(-R.headAt(d)); m.setPosition(p); poles.setMatrixAt(k, m); m.setPosition(at(d, s * 4.7, 4.95)); heads.setMatrixAt(k, m); }
      poles.castShadow = true; this.scene.add(poles, heads);
      // Kirchturm in der Ortsmitte
      const dm = (t.from + t.to) / 2, side = R.tunnelAt(dm) ? 0 : 1, cp = at(dm, side * 26, -.5);
      cp.y = R.heightAt(cp.x, cp.z) - .5;
      const tower = new THREE.Group(); tower.position.copy(cp); tower.rotation.y = -R.headAt(dm);
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 20, 4.5), new THREE.MeshLambertMaterial({ color: 0xf1ebdf })); body.position.y = 10; body.castShadow = true; tower.add(body);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(3.4, 9, 4), new THREE.MeshLambertMaterial({ color: 0x4f6a5a })); spire.position.y = 24.5; spire.rotation.y = Math.PI / 4; spire.castShadow = true; tower.add(spire);
      const clock = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff })); clock.position.set(0, 16, 2.26); tower.add(clock);
      const nave = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 16), new THREE.MeshLambertMaterial({ color: 0xece4d6 })); nave.position.set(0, 4, -10); nave.castShadow = true; tower.add(nave);
      const roofM = new THREE.MeshLambertMaterial({ color: 0x8b3a2b });
      for (const s of [-1, 1]) { const rf = new THREE.Mesh(new THREE.BoxGeometry(5.6, .3, 16.6), roofM); rf.position.set(s * 2.3, 9.6, -10); rf.rotation.z = -s * .62; rf.castShadow = true; tower.add(rf); }
      this.scene.add(tower);
    }
    // Küste: Leuchtturm und Segelboote auf dem Meer
    if (R.theme.coast && R.water != null) {
      const dl = R.total * .55, h = R.headAt(dl), side = R.theme.coast;
      const lx = R.xAt(dl) - Math.cos(h) * side * 34, lz = R.zAt(dl) - Math.sin(h) * side * 34;
      const lh = new THREE.Group(); lh.position.set(lx, Math.max(R.heightAt(lx, lz), R.water + .5), lz);
      for (let k = 0; k < 5; k++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.1 - k * .18, 2.3 - k * .18, 4, 16), new THREE.MeshLambertMaterial({ color: k % 2 ? 0xc8102e : 0xffffff })); seg.position.y = 2 + k * 4; seg.castShadow = true; lh.add(seg); }
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 12), new THREE.MeshBasicMaterial({ color: 0xfff5b0 })); lamp.position.y = 21; lh.add(lamp);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2, 12), new THREE.MeshLambertMaterial({ color: 0x2b2f35 })); cap.position.y = 23; lh.add(cap);
      this.scene.add(lh);
      const r = rng(77); this.boats = [];
      const hullM = new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }), sailM = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      for (let k = 0; k < 14; k++) {
        const d = r() * R.total, hh = R.headAt(d), off = (120 + r() * 700) * side;
        const bx = R.xAt(d) - Math.cos(hh) * off, bz = R.zAt(d) - Math.sin(hh) * off;
        if (R.heightAt(bx, bz) > R.water - 1) continue;
        const b = new THREE.Group(); b.position.set(bx, R.water, bz); b.rotation.y = r() * 6.28;
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, .9, 7).translate(0, .2, 0), hullM); b.add(hull);
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, .7, -2.5, 0, 9, -.3, 0, .7, 2.4], 3)); sg.computeVertexNormals();
        b.add(new THREE.Mesh(sg, k % 3 ? sailM : new THREE.MeshLambertMaterial({ color: 0xff6a3d, side: THREE.DoubleSide })));
        b.userData = { ph: r() * 6 }; this.scene.add(b); this.boats.push(b);
      }
    }
    // Gebetsfahnen quer über die Straße (Himalaya)
    if (R.theme.flags) {
      const per = 12, lines = Math.floor(R.total / 450), im = new THREE.InstancedMesh(new THREE.PlaneGeometry(.42, .55).translate(0, -.28, 0), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), lines * per);
      const cols = ['#2f6fd6', '#f4f4f4', '#d8322f', '#2e9b4e', '#f2c230'].map(col), m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0); let k = 0;
      const poleM = new THREE.MeshLambertMaterial({ color: 0x6b5030 });
      for (let li = 0; li < lines; li++) {
        const d = 200 + li * 450; if (d > R.total - 100 || R.tunnelAt(d, 30)) continue;
        const a0 = at(d, -6.5), a1 = at(d, 6.5);
        for (const pp of [a0, a1]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, 6.5, 6).translate(0, 3.25, 0), poleM); pole.position.copy(pp); this.scene.add(pole); }
        q4.setFromAxisAngle(up, -R.headAt(d) + Math.PI / 2);
        for (let i = 0; i < per; i++) {
          const f = (i + .5) / per, pnt = a0.clone().lerp(a1, f); pnt.y += 6.3 - Math.sin(f * Math.PI) * 1.2;
          m4.compose(pnt, q4, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(k, m4); im.setColorAt(k, cols[i % 5]); k++;
        }
      }
      im.count = k; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.scene.add(im);
    }
    // Wahrzeichen in der Ferne: steiler Felsdom im Meer (Tropen) oder Tafelberge (Wüste)
    if (R.theme.landmark && !['volcano', 'fuji'].includes(R.theme.landmark)) {
      const r = rng(31), isDome = R.theme.landmark === 'dome';
      const mat = new THREE.MeshLambertMaterial({ color: isDome ? 0x7d8a7a : 0xb5653c, flatShading: true });
      for (let i = 0; i < (isDome ? 2 : 6); i++) {
        const d = R.total * (isDome ? .35 + i * .35 : .1 + i * .15), h = R.headAt(d), side = isDome ? (R.theme.coast || -1) : (i % 2 ? 1 : -1), off = isDome ? 260 + i * 160 : 380 + r() * 500;
        const x = R.xAt(d) - Math.cos(h) * side * off, z = R.zAt(d) - Math.sin(h) * side * off, base = isDome ? (R.water ?? 0) - 5 : R.heightAt(x, z) - 4;
        const geo = isDome ? new THREE.SphereGeometry(1, 18, 14) : new THREE.CylinderGeometry(.85, 1, 1, 9, 2);
        const mesh = new THREE.Mesh(geo, mat);
        if (isDome) { mesh.scale.set(70 - i * 15, 230 - i * 70, 80 - i * 15); mesh.position.set(x, base, z); }
        else { const hh = 50 + r() * 90, w = 90 + r() * 160; mesh.scale.set(w, hh, w * (.6 + r() * .6)); mesh.position.set(x, base + hh / 2, z); mesh.rotation.y = r() * 3; }
        mesh.castShadow = false; this.scene.add(mesh);
      }
    }
    // Kühe auf der Weide (Bauernhof-Strecken)
    if (R.theme.cows) {
      const parts = [colored(new THREE.BoxGeometry(.7, .7, 1.5).translate(0, 1.05, 0), '#f4f2ee'), colored(new THREE.BoxGeometry(.72, .3, .5).translate(0, 1.25, .2), '#1d1d1f'), colored(new THREE.BoxGeometry(.5, .45, .55).translate(0, 1.35, -.95), '#f4f2ee'), colored(new THREE.BoxGeometry(.3, .2, .12).translate(0, 1.2, -1.25), '#e8a6a6'), colored(new THREE.BoxGeometry(.52, .15, .2).translate(0, 1.6, -.9), '#1d1d1f')];
      for (const [x, z] of [[-.25, -.55], [.25, -.55], [-.25, .55], [.25, .55]]) parts.push(colored(new THREE.BoxGeometry(.16, .75, .16).translate(x, .38, z), '#ece9e4'));
      const cg = merge(parts), r = rng(55), cnt = Math.min(260, Math.floor(R.total / 55)), im = new THREE.InstancedMesh(cg, this.vcMat, cnt), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0); let k = 0;
      this.cows = [];
      for (let i = 0; i < cnt; i++) {
        const d = r() * R.total, h = R.headAt(d), off = (r() < .5 ? -1 : 1) * (9 + r() * 55), x = R.xAt(d) + Math.cos(h) * off, z = R.zAt(d) + Math.sin(h) * off;
        q.setFromAxisAngle(up, r() * 6.28); m4.compose(new THREE.Vector3(x, R.heightAt(x, z) - .05, z), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(k++, m4); this.cows.push(d);
      }
      im.count = k; im.castShadow = true; this.scene.add(im);
    }
    // Mond: die Erde am Himmel
    if (R.theme.moon) {
      const tex = R.theme.planet === 'ring' ? ringPlanetTex(canvasTex) : canvasTex(256, 256, (x, w, h) => { const g = x.createRadialGradient(w * .42, h * .4, 10, w / 2, h / 2, w / 2); g.addColorStop(0, '#6fb2ff'); g.addColorStop(.75, '#1d5fbf'); g.addColorStop(1, 'rgba(10,30,80,0)'); x.fillStyle = g; x.beginPath(); x.arc(w / 2, h / 2, w / 2, 0, 7); x.fill(); const r = rng(3); x.fillStyle = '#3f9a4a'; for (let i = 0; i < 9; i++) { x.beginPath(); x.ellipse(w * (.25 + r() * .5), h * (.25 + r() * .5), 10 + r() * 30, 6 + r() * 18, r() * 3, 0, 7); x.fill(); } x.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 7; i++) { x.beginPath(); x.ellipse(w * (.2 + r() * .6), h * (.2 + r() * .6), 14 + r() * 30, 4 + r() * 6, r() * 3, 0, 7); x.fill(); } }, false);
      this.earth = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false })); if (R.theme.planet === 'ring') this.earth.scale.set(1500, 750, 1); else this.earth.scale.set(520, 520, 1); this.earth.renderOrder = -4; this.scene.add(this.earth);
    }
    // Fantasiewelten (Dinos, Vulkan, Tiefsee, Zuckerland, Kristalle)
    this.themeX = buildThemeExtras(this, R, { colored, merge, canvasTex });
    // Intervall-Zieltor (wird bei Bedarf positioniert)
    const gate = this.gate = new THREE.Group(); gate.visible = false;
    const gm = new THREE.MeshLambertMaterial({ color: 0x1b1e22 });
    for (const s of [-1, 1]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(.5, 6.2, .5), gm); pole.position.set(s * 5.1, 3.1, 0); pole.castShadow = true; gate.add(pole); }
    this.gateMat = new THREE.MeshBasicMaterial({ map: labelTex('INTERVALL', { w: 512, h: 96, size: 54, bg: '#ff6a3d', fg: '#111' }), side: THREE.DoubleSide });
    const gb = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 1.8), this.gateMat); gb.position.y = 5.6; gate.add(gb);
    this.gateRing = new THREE.Mesh(new THREE.PlaneGeometry(10.2, .25), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9 })); this.gateRing.position.y = .25; this.gateRing.rotation.x = -Math.PI / 2; gate.add(this.gateRing);
    this.scene.add(gate);
  }
  setGate(d, text, color = '#ff6a3d') {
    if (d == null) { this.gate.visible = false; this.gateKey = null; return; }
    const key = text + color;
    if (key !== this.gateKey) { this.gateKey = key; this.gateMat.map?.dispose(); this.gateMat.map = labelTex(text, { w: 512, h: 96, size: text.length > 16 ? 40 : 54, bg: color, fg: '#111' }); this.gateMat.needsUpdate = true; }
    const R = this.route, h = R.headAt(d); this.gate.position.set(R.xAt(d), R.eleAt(d) + .05, R.zAt(d)); this.gate.rotation.y = -h; this.gate.visible = true;
  }

  /* Instanzen für Bäume, Felsen, Häuser, Grasbüschel */
  // Welche Baumarten eingefärbt werden (Herbstlaub, Blüten, Korallen …)
  tintOn(k) { const th = this.route.theme; return !!th.tints && (!th.tintKinds || th.tintKinds.includes(k)); }
  buildInstances() {
    const cap = Math.round(18000 * this.Q.trees);
    const mk = (geo, mat, n, shadow = true) => { const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.castShadow = shadow; im.receiveShadow = false; im.frustumCulled = false; this.scene.add(im); return im; };
    this.inst = {
      conifer: mk(coniferGeo(this.tintOn('conifer'), !!this.route.theme.candy), this.vegMat || this.vcMat, cap), leafy: mk(leafyGeo(this.tintOn('leafy'), !!this.route.theme.candy), this.vegMat || this.vcMat, cap),
      rock: mk(rockGeo(), this.vcMat, 1500), tuft: mk(tuftGeo(), this.vegMat || this.vcMat, 24000, false),
      palm: mk(palmGeo(), this.vegMat || this.vcMat, Math.round(cap / 3)), cactus: mk(cactusGeo(), this.vcMat, Math.round(cap / 4)),
      wall: mk(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), new THREE.MeshLambertMaterial({ map: windowTex() }), 2000),
      roof: mk((() => { const g = new THREE.CylinderGeometry(.62, .62, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, .5, 1).translate(0, .155, 0).toNonIndexed(); g.computeVertexNormals(); return g; })(), new THREE.MeshLambertMaterial({ color: 0xffffff }), 2000), // Satteldach: First oben, Traufe auf der Wand (vorher stand das Dreieck auf der Spitze); flache Dachflächen ohne dunkle Verläufe
    };
    for (const k of ['wall', 'roof', 'leafy', 'conifer', 'palm', 'cactus']) this.inst[k].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.inst[k].instanceMatrix.count * 3).fill(1), 3);
  }

  /* Ferne Berge als Ring und Wolken */
  buildFar() {
    const R = this.route, amp = R.theme.mountains || .3, seg = 256, rad = 4200;
    const pos = [], colr = [], idx = [], horizon = col(R.theme.sky[1]), rock = col('#6f8297').lerp(horizon, .45), snow = col('#f4f7fa').lerp(horizon, .25);
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, hgt = 180 + amp * 520 * Math.max(0, fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, 5, 21) + .45);
      pos.push(Math.cos(a) * rad, -250, Math.sin(a) * rad, Math.cos(a) * rad, hgt, Math.sin(a) * rad);
      const c = hgt > 520 && amp > .6 ? snow : rock; colr.push(rock.r, rock.g, rock.b, c.r, c.g, c.b);
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setIndex(idx);
    this.far = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false })); this.far.renderOrder = -5; this.scene.add(this.far);
  }
  // Echtes Gelände in der Ferne: grobes Netz aus dem Höhenmodell (liegt etwas tiefer als die Nahkacheln)
  // Echte Gebäude (OpenStreetMap): Wände mit Fensterreihen, flache oder geneigte Dächer; je 600-m-Kachel eine Geometrie
  buildOsm() {
    const R = this.route, G = R.geo, M = 111320, clear = R.roadW / 2 + 3, tiles = new Map(), col = new THREE.Color();
    const WALL = [['#efe7d8', '#f4efe6', '#e2d4bd', '#f1e6d2', '#d9c9ae', '#e8dccb'], ['#b9bcc0', '#c4bfb4', '#a8adb2'], ['#d8cfbf', '#cbc1ae'], ['#dfe3e8', '#cdd5dd', '#e9e2d6', '#c3ccd6', '#f0ece4']];
    const ROOF = [['#9c4a3a', '#7d3b31', '#a5553f', '#5f5a55', '#8a4f3c', '#6b3a32'], ['#6f747a', '#80868c'], ['#5b6470', '#4f5966'], ['#6b7077', '#585e66', '#7a8088']];
    const hash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
    const inPoly = (px, pz, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) c = !c; } return c; };
    // Fenster-Muster: ein Feld = 3 m breit, 3,1 m hoch (ein Stockwerk); Wandfarbe kommt über die Vertex-Farbe dazu
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const c2 = cv.getContext('2d');
    c2.fillStyle = '#ffffff'; c2.fillRect(0, 0, 64, 64); c2.fillStyle = '#ece6dc'; c2.fillRect(0, 56, 64, 8);
    c2.fillStyle = '#5e6f80'; c2.fillRect(18, 14, 28, 30); c2.fillStyle = '#8fa3b6'; c2.fillRect(20, 16, 11, 12); c2.fillRect(33, 16, 11, 12); c2.fillStyle = '#d9d2c6'; c2.fillRect(16, 44, 32, 3);
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    let n = 0, skipped = 0;
    import('./osm.js').then(({ footprints }) => {
      for (const f of footprints(R.osm)) {
        const pts = f.p.map(([la, lo]) => [(lo - G.lon0) * G.kx, -(la - G.lat0) * M]);
        let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
        const nn = R.nearest(cx, cz); if (!nn || nn.dist > 420) continue;
        // Straße frei halten: kein Punkt der Kanten zu nah an der Straße, und die Straße darf nicht durch den Grundriss laufen
        let hit = false;
        for (let k = 0; k < pts.length && !hit; k++) { const [x1, z1] = pts[k], [x2, z2] = pts[(k + 1) % pts.length], L = Math.hypot(x2 - x1, z2 - z1), st = Math.max(1, Math.ceil(L / 2));
          for (let q = 0; q < st; q++) { const t = q / st, w = R.nearest(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t); if (w && w.dist < clear) { hit = true; break; } } }
        if (!hit) for (let k = Math.max(0, nn.i - 80); k <= Math.min(R.N, nn.i + 80); k += 2) if (inPoly(R.x[k], R.z[k], pts)) { hit = true; break; }
        if (hit) { skipped++; continue; }
        let base = Infinity; for (const [x, z] of pts) base = Math.min(base, R.heightAt(x, z)); if (!Number.isFinite(base)) continue;
        base -= .4; const top = base + .4 + f.h, key = Math.floor(cx / 600) + ',' + Math.floor(cz / 600);
        const T = tiles.get(key) || tiles.set(key, { wp: [], wc: [], wu: [], rp: [], rc: [] }).get(key), r = hash(cx, cz);
        const wc = col.set(WALL[f.kind][Math.floor(r * WALL[f.kind].length)]).clone(), rc = new THREE.Color(ROOF[f.kind][Math.floor(hash(cz, cx) * ROOF[f.kind].length)]);
        let area = 0; for (let k = 0; k < pts.length; k++) { const [x1, z1] = pts[k], [x2, z2] = pts[(k + 1) % pts.length]; area += x1 * z2 - x2 * z1; }
        const P = area < 0 ? pts : pts.slice().reverse(); area = Math.abs(area) / 2;
        // Wände mit Fenster-Koordinaten (u = Meter entlang der Fassade / 3, v = Höhe / 3,1)
        let u0 = 0; const vTop = f.h / 3.1;
        for (let k = 0; k < P.length; k++) {
          const [x1, z1] = P[k], [x2, z2] = P[(k + 1) % P.length], L = Math.hypot(x2 - x1, z2 - z1), u1 = u0 + Math.max(1, Math.round(L / 3)) , shade = .84 + .16 * Math.abs(Math.cos(Math.atan2(z2 - z1, x2 - x1)));
          T.wp.push(x1, base, z1, x2, base, z2, x2, top, z2, x1, base, z1, x2, top, z2, x1, top, z1);
          T.wu.push(u0, 0, u1, 0, u1, vTop, u0, 0, u1, vTop, u0, vTop); u0 = u1;
          for (let q = 0; q < 6; q++) T.wc.push(wc.r * shade, wc.g * shade, wc.b * shade);
        }
        // Dach: geneigt (Walmdach) bei Häusern bzw. laut OSM, sonst flach
        const pitched = f.roof === 1 || (f.roof === -1 && f.kind === 0 && area < 400) || (f.roof === -1 && f.kind === 2);
        if (pitched && area < 2500) {
          const rise = Math.min(f.kind === 2 ? 12 : 6, Math.sqrt(area) * (f.kind === 2 ? .7 : .42));
          for (let k = 0; k < P.length; k++) { const [x1, z1] = P[k], [x2, z2] = P[(k + 1) % P.length]; T.rp.push(x1, top, z1, cx, top + rise, cz, x2, top, z2); for (let q = 0; q < 3; q++) T.rc.push(rc.r * (q === 1 ? 1.12 : 1), rc.g * (q === 1 ? 1.12 : 1), rc.b * (q === 1 ? 1.12 : 1)); }
        } else {
          const tri = THREE.ShapeUtils.triangulateShape(P.map(([x, z]) => new THREE.Vector2(x, z)), []);
          for (const [a, b, c] of tri) for (const q of [a, c, b]) { T.rp.push(P[q][0], top, P[q][1]); T.rc.push(rc.r, rc.g, rc.b); }
          // Dachrand
          for (let k = 0; k < P.length; k++) { const [x1, z1] = P[k], [x2, z2] = P[(k + 1) % P.length]; T.rp.push(x1, top, z1, x2, top, z2, x2, top + .5, z2, x1, top, z1, x2, top + .5, z2, x1, top + .5, z1); for (let q = 0; q < 6; q++) T.rc.push(wc.r * .8, wc.g * .8, wc.b * .8); }
        }
        n++;
      }
      const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, side: THREE.DoubleSide }), roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.osmGroup = new THREE.Group();
      const mk = (pos, colr, uv, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = this.qKey === 'high'; m.receiveShadow = true; return m; };
      for (const T of tiles.values()) { if (T.wp.length) this.osmGroup.add(mk(T.wp, T.wc, T.wu, wallMat)); if (T.rp.length) this.osmGroup.add(mk(T.rp, T.rc, null, roofMat)); }
      this.scene.add(this.osmGroup); this.osmCount = n; this.osmSkipped = skipped;
    }).catch(e => console.warn('OSM-Gebäude', e));
  }
  buildDemFar() {
    const R = this.route, D = R.dem, step = Math.max(1, Math.ceil(Math.max(D.nx, D.nz) / 260));
    const nx = Math.floor((D.nx - 1) / step) + 1, nz = Math.floor((D.nz - 1) / step) + 1;
    const pos = new Float32Array(nx * nz * 3), colr = new Float32Array(nx * nz * 3), c = new THREE.Color();
    const g0 = col(R.theme.grass[0]), g1 = col('#4f7a3c'), rock = col('#8a8780'), snow = col('#f3f6f8'), sky = col(R.theme.sky[1]);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, gi = Math.min(D.nx - 1, i * step), gj = Math.min(D.nz - 1, j * step), y = D.data[gj * D.nx + gi] * D.scale;
      pos.set([D.x0 + gi * D.cell, y - 14, D.z0 + gj * D.cell], k * 3);
      c.copy(g0).lerp(g1, smooth(R.minE, R.minE + 600, y)).lerp(rock, smooth(1700, 2300, y)).lerp(snow, smooth(2500, 2900, y));
      colr.set([c.r, c.g, c.b], k * 3);
    }
    const idx = []; for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.demFar = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); this.scene.add(this.demFar);
    this.far.visible = false; // erzeugten Bergring ausblenden, die echten Berge stehen jetzt da
  }
  buildClouds() {
    const tex = cloudTex(), r = rng(9); this.clouds = [];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: .85, fog: false, depthWrite: false }));
      const sc = 400 + r() * 700; s.scale.set(sc, sc * .45, 1); s.userData = { ox: (r() - .5) * 6000, oz: (r() - .5) * 6000, y: 650 + r() * 500 };
      this.scene.add(s); this.clouds.push(s);
    }
  }

  /* Geländekacheln */
  chunkKey(cx, cz) { return cx + ',' + cz; }
  buildChunk(cx, cz) {
    const R = this.route, th = R.theme, res = this.Q.res, n = res + 1, s = CHUNK / res;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), colr = new Float32Array(n * n * 3);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const g0 = col(th.grass[0]), g1 = col(th.grass[1]), g2 = col(th.grass[2]), rockC = col(th.rock || '#7d7a74'), snowC = col('#f3f6f8'), sand = col('#d8c99a'), fields = th.fields?.map(f => f && col(f));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * s, z = z0 + j * s, k = j * n + i;
      pos[k * 3] = x; pos[k * 3 + 1] = R.heightAt(x, z); pos[k * 3 + 2] = z;
      uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
    }
    const idx = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const nor = g.attributes.normal.array, c = new THREE.Color();
    for (let k = 0; k < n * n; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], ny = nor[k * 3 + 1];
      const nz = fbm(x / 140, z / 140, 3, 4) * .5 + .5, nz2 = fbm(x / 35, z / 35, 2, 8) * .5 + .5;
      c.copy(g0).lerp(g1, nz).lerp(g2, smooth(.55, .9, nz2) * .6);
      // Flickenteppich aus Feldern (Lavendel, Weizen, Raps …) auf flachem Gelände
      if (fields && ny > .93) { const fx = Math.floor((x * .8 + z * .6) / 80), fz = Math.floor((-x * .6 + z * .8) / 50), fc = fields[(hash2(fx + 1000, fz + 2000) >>> 7) % fields.length]; if (fc) c.lerp(fc, .85); }
      if (ny < .82) c.lerp(rockC, smooth(.82, .62, ny));
      if (R.water != null && y < R.water + 2.2) c.lerp(sand, smooth(R.water + 2.2, R.water + .3, y));
      if (y > th.snow + (nz - .5) * 120) c.lerp(snowC, smooth(th.snow, th.snow + 90, y + (nz - .5) * 120) * (ny > .6 ? 1 : .4));
      colr[k * 3] = c.r; colr[k * 3 + 1] = c.g; colr[k * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const mesh = new THREE.Mesh(g, this.terrainMat); mesh.receiveShadow = true; this.scene.add(mesh);
    // Objekte
    const objs = { conifer: [], leafy: [], rock: [], tuft: [], house: [], palm: [], cactus: [] };
    const r = rng(hash2(cx + 5000, cz + 9000));
    const Q = this.Q.trees, treeline = th.snow - 220;
    const tries = Math.round(420 * th.trees * Q);
    for (let t = 0; t < tries; t++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, nn = R.nearest(x, z), dist = nn ? nn.dist : 999;
      if (dist < 9) continue;
      if (nn && dist < 60 && R.townAt(nn.i * R.step)) continue;
      const y = R.heightAt(x, z);
      if (R.water != null && y < R.water + 1.5) continue;
      if (y > treeline) continue;
      // Waldflächen: Rauschen bündelt Bäume
      if (!th.cactus && fbm(x / 260, z / 260, 2, 13) < (th.trees > .8 ? -.35 : -.05) && dist > 30) continue;
      const kind = r() < (th.palm || 0) ? 'palm' : r() < (th.cactus || 0) ? 'cactus' : r() < th.conifer ? 'conifer' : 'leafy';
      objs[kind].push([x, y - .2, z, .75 + r() * .75, r() * 6.28, .85 + r() * .3]);
    }
    for (let t = 0; t < Math.round(40 * th.rocks * 4 * Q); t++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, nn = R.nearest(x, z); if (nn && nn.dist < 7) continue;
      const y = R.heightAt(x, z); if (R.water != null && y < R.water) continue;
      objs.rock.push([x, y - .3, z, .6 + r() * 2.6, r() * 6.28, 1]);
    }
    for (let t = 0; t < Math.round(420 * Q); t++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, nn = R.nearest(x, z); if (!nn || nn.dist < 5.5 || nn.dist > 45) continue;
      const y = R.heightAt(x, z); if (R.water != null && y < R.water + 1) continue; if (y > th.snow) continue;
      if (!th.moon && !th.noTufts && (!th.dry || r() < .25)) objs.tuft.push([x, y - .05, z, .6 + r() * .9, r() * 6.28, 1]);
    }
    const hc = this.route.osm ? 0 : Math.round(th.houses * 40); // mit echten Gebäuden keine erfundenen Häuser
    for (let t = 0; t < hc; t++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, nn = R.nearest(x, z);
      if (!nn || nn.dist < 16 || nn.dist > 70) continue;
      if (fbm(x / 400, z / 400, 2, 17) < .05) continue;
      const y = R.heightAt(x, z); if (R.water != null && y < R.water + 1.5) continue;
      const h = R.head[nn.i];
      objs.house.push([x, y - .3, z, 7 + r() * 5, -h + (r() < .5 ? 0 : Math.PI / 2), 5 + r() * 3, 8 + r() * 6, (r() * 4) | 0]);
    }
    // Ortschaften: dichte Bebauung direkt an der Straße, mehrstöckig
    if (R.towns.length) {
      const placed = [];
      for (let t = 0; t < 260; t++) {
        const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, nn = R.nearest(x, z);
        if (!nn || nn.dist < 10 || nn.dist > 48 || !R.townAt(nn.i * R.step) || R.tunnelAt(nn.i * R.step, 40)) continue;
        if (placed.some(p => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 150)) continue;
        const near = nn.dist < 24, w = near ? 7 + r() * 4 : 8 + r() * 5, dd = near ? 8 + r() * 3 : 8 + r() * 6;
        // Abstand der Hauskante zur Straße einhalten
        if (nn.dist - Math.max(w, dd) / 2 < 7.5) continue;
        placed.push([x, z]);
        const y = R.heightAt(x, z), h = R.head[nn.i];
        objs.house.push([x, y - .4, z, w, -h, near ? 7 + r() * 8 : 5 + r() * 4, dd, (r() * 4) | 0]);
      }
    }
    return { mesh, objs };
  }
  updateChunks(px, pz, budgetMs = 6) {
    const rad = this.Q.radius, cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    const want = new Set();
    for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) if (a * a + b * b <= rad * rad + 1) want.add(this.chunkKey(cx + a, cz + b));
    for (const [k, c] of this.chunks) if (!want.has(k)) {
      const [a, b] = k.split(',').map(Number);
      if (Math.max(Math.abs(a - cx), Math.abs(b - cz)) > rad + 1) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); this.chunks.delete(k); this.instDirty = true; }
    }
    const missing = [...want].filter(k => !this.chunks.has(k)).map(k => { const [a, b] = k.split(',').map(Number); return { k, a, b, d: (a - cx) ** 2 + (b - cz) ** 2 }; }).sort((p, q) => p.d - q.d);
    const t0 = performance.now();
    for (const m of missing) {
      this.chunks.set(m.k, this.buildChunk(m.a, m.b)); this.instDirty = true;
      if (performance.now() - t0 > budgetMs) break;
    }
    return missing.length;
  }
  rebuildInstances() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const cnt = { conifer: 0, leafy: 0, rock: 0, tuft: 0, wall: 0, roof: 0, palm: 0, cactus: 0 };
    const th = this.route.theme, tints = th.tints?.map(col), wallCols = (th.walls || ['#f4efe6', '#efe2c4', '#e8d3b0', '#f6f6f2']).map(col), roofCols = (th.roofs || ['#a8442f', '#8b3a2b', '#5e5650', '#b5562c']).map(col);
    for (const ch of this.chunks.values()) {
      for (const k of ['conifer', 'leafy', 'rock', 'tuft', 'palm', 'cactus']) {
        const im = this.inst[k];
        for (const o of ch.objs[k]) {
          if (cnt[k] >= im.instanceMatrix.count) break;
          q.setFromAxisAngle(up, o[4]); s.set(o[3] * (k === 'leafy' && th.flatTrees ? 1.5 : 1), o[3] * (k === 'rock' ? .8 : k === 'leafy' && th.flatTrees ? .55 : 1), o[3] * (k === 'leafy' && th.flatTrees ? 1.5 : 1)); p.set(o[0], o[1], o[2]);
          m.compose(p, q, s); im.setMatrixAt(cnt[k], m);
          if (k === 'conifer' || k === 'leafy' || k === 'palm' || k === 'cactus') { if (tints && this.tintOn(k)) c.copy(tints[Math.abs(Math.floor(o[0] * 7 + o[2] * 13)) % tints.length]).multiplyScalar(o[5]); else c.setRGB(o[5] * .95, o[5], o[5] * .9); im.setColorAt(cnt[k], c); }
          cnt[k]++;
        }
      }
      for (const o of ch.objs.house) {
        if (cnt.wall >= this.inst.wall.instanceMatrix.count) break;
        q.setFromAxisAngle(up, o[4]); s.set(o[3], o[5], o[6]); p.set(o[0], o[1], o[2]); m.compose(p, q, s); this.inst.wall.setMatrixAt(cnt.wall, m); this.inst.wall.setColorAt(cnt.wall, wallCols[o[7]]);
        s.set(o[3] * 1.12, o[3] * .55, o[6] * 1.08); p.set(o[0], o[1] + o[5], o[2]); m.compose(p, q, s); this.inst.roof.setMatrixAt(cnt.roof, m); this.inst.roof.setColorAt(cnt.roof, roofCols[o[7]]);
        cnt.wall++; cnt.roof++;
      }
    }
    for (const k in cnt) { const im = this.inst[k]; im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.instDirty = false;
  }

  // Schrittmacher bzw. Trainingsbuddy (mit eigenem Aussehen und Namensschild)
  setPacer(on, look, name) {
    if (this.pacer && (!on || look)) { this.scene.remove(this.pacer.root); this.pacer = null; }
    if (on && !this.pacer) {
      this.pacer = new Rider(look || { jersey: '#7b4fd6', bikeColor: '#222831', helmet: '#7b4fd6', skin: '#c99272' }); this.scene.add(this.pacer.root);
      if (name) { const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex('🤝 ' + name, { w: 256, h: 56, size: 34, bg: '#7b4fd6', fg: '#fff' }), depthWrite: false, transparent: true, opacity: .92 })); lab.scale.set(1.1, .24, 1); lab.position.set(0, 2.05, 0); this.pacer.root.add(lab); }
    }
  }
  // Mitfahrer: Liste von { jersey, bikeColor, helmet, skin, name }
  // Namensschild eines Mitfahrers neu beschriften
  relabel(i, name, jersey) { const o = this.npcs[i]; if (!o) return; o.lab.material.map?.dispose(); o.lab.material.map = labelTex(name, { w: 256, h: 56, size: 34, bg: jersey, fg: '#fff' }); o.lab.material.needsUpdate = true; }
  setRiders(list) {
    for (const n of this.npcs) { this.scene.remove(n.rider.root); }
    this.npcs = list.map(c => {
      const rider = new Rider(c); rider.root.visible = false; this.scene.add(rider.root);
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(c.name, { w: 256, h: 56, size: 34, bg: c.jersey, fg: '#fff' }), depthWrite: false, transparent: true, opacity: .92 }));
      lab.scale.set(1.1, .24, 1); lab.position.set(0, 2.05, 0); rider.root.add(lab);
      // Echte Mitspieler: großer schwebender Pfeil und Leuchten, damit man sie im Feld sofort erkennt
      if (c.remote) {
        const arrow = new THREE.Sprite(new THREE.SpriteMaterial({ map: remoteArrowTex(), depthTest: false, depthWrite: false, transparent: true, fog: false }));
        arrow.renderOrder = 20; arrow.position.set(0, 3, 0); rider.root.add(arrow);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x2fe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: .8 }));
        glow.scale.set(2.8, 2.8, 1); glow.position.set(0, 1, 0); rider.root.add(glow);
        lab.scale.set(1.5, .33, 1); lab.position.set(0, 2.25, 0); lab.material.depthTest = false; lab.renderOrder = 19;
        return { rider, lab, arrow, glow, remote: true };
      }
      return { rider, lab };
    });
  }
  buildStars() {
    const r = rng(31), pos = [];
    for (let i = 0; i < 1500; i++) { const a = r() * Math.PI * 2, e = Math.asin(r() * .95 + .05), R = 5000; pos.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.renderOrder = -9; this.scene.add(this.stars);
  }
  buildRain() {
    const n = 2500, pos = new Float32Array(n * 6), r = rng(13);
    for (let i = 0; i < n; i++) { const x = (r() - .5) * 80, y = r() * 30, z = (r() - .5) * 80; pos.set([x, y, z, x + .05, y - .7, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c6, transparent: true, opacity: .45 }));
    this.rain.visible = false; this.rain.frustumCulled = false; this.scene.add(this.rain);
  }
  /* Tageszeit und Wetter. time: morning|day|evening|night, weather: clear|cloudy|rain|fog */
  setEnv({ time = 'day', weather = 'clear' } = {}) {
    this.env = { time, weather };
    const T = {
      morning: { top: '#5b8fd0', hor: '#f6c9a0', sun: [.75, .16, -.4], sunC: 0xffc89a, sunI: 1.6, hemi: .8, expo: 1.0 },
      day: { top: null, hor: null, sun: [.45, .55, -.7], sunC: 0xfff1dc, sunI: 2.4, hemi: 1.15, expo: 1.05 },
      evening: { top: '#3b4e8a', hor: '#ff9a62', sun: [-.7, .12, -.5], sunC: 0xff9a5a, sunI: 1.5, hemi: .7, expo: .95 },
      night: { top: '#050914', hor: '#1a2540', sun: [-.3, .6, .5], sunC: 0x9fb4ff, sunI: .28, hemi: .22, expo: .9 },
    }[time] || {};
    const top = T.top ? col(T.top) : this.baseTheme.sky[0].clone(), hor = T.hor ? col(T.hor) : this.baseTheme.sky[1].clone();
    const grey = col('#9aa3ad'), wet = weather === 'rain', cloudy = weather === 'cloudy' || wet, fog = weather === 'fog';
    if (cloudy || fog) { const k = fog ? .75 : wet ? .7 : .45; top.lerp(grey.clone().multiplyScalar(time === 'night' ? .12 : 1), k); hor.lerp(grey.clone().multiplyScalar(time === 'night' ? .2 : 1.05), k); }
    this.sunDir.set(...T.sun).normalize();
    this.skyMat.uniforms.top.value.copy(top); this.skyMat.uniforms.hor.value.copy(hor); this.skyMat.uniforms.sun.value.copy(this.sunDir).multiplyScalar(cloudy || fog ? 0 : 1);
    this.scene.background.copy(hor); this.scene.fog.color.copy(hor);
    const viewR = (this.Q.radius + .5) * CHUNK;
    const farR = this.demFar ? 7000 : viewR * .98, nearR = this.demFar ? viewR * .6 : viewR * .35;
    this.scene.fog.near = fog ? 20 : wet ? viewR * .15 : nearR; this.scene.fog.far = fog ? 260 : wet ? Math.min(farR, viewR * 1.5) : farR;
    this.sun.color.setHex(T.sunC); this.sun.intensity = T.sunI * (cloudy ? .45 : fog ? .5 : 1);
    this.hemi.intensity = T.hemi * (cloudy ? 1.1 : 1);
    this.hemi.color.copy(time === 'night' ? col('#6b7da8') : col('#dfefff'));
    this.expoBase = T.expo; this.renderer.toneMappingExposure = T.expo;
    this.stars.material.opacity = time === 'night' && !cloudy && !fog ? .9 : 0;
    for (const c of this.clouds) { c.material.opacity = cloudy ? .95 : time === 'night' ? .25 : .85; c.material.color.copy(cloudy ? col('#b9c0c8') : time === 'evening' ? col('#ffd2b0') : col('#ffffff')).multiplyScalar(time === 'night' ? .25 : 1); }
    if (this.demFar) this.demFar.material.color.setScalar(time === 'night' ? .35 : 1);
    this.far.material.color.setScalar(time === 'night' ? .25 : time === 'evening' || time === 'morning' ? .8 : 1);
    this.rain.visible = wet;
    const rm = this.roadMeshes?.[0]?.material; if (rm?.specular) { rm.specular.setHex(wet && (this.route.surface || 'asphalt') === 'asphalt' ? 0x6a6a6a : 0x0b0b0b); rm.shininess = wet ? 80 : 20; }
    FX.U.clouds.value = time === 'night' || fog ? 0 : cloudy ? .6 : 1; FX.U.wind.value = wet ? 1.8 : cloudy ? 1.3 : 1;
    this.roadMeshes[2].material.color.setScalar(time === 'night' ? .4 : time === 'day' ? 1 : .75);
    this.lamp.intensity = time === 'night' ? 30 : time === 'evening' && (cloudy || fog) ? 10 : 0;
    if (this.water) this.water.material.color.setHex(time === 'night' ? 0x0a1c2c : cloudy ? 0x2f4f63 : 0x1f5f8f);
    // Tiefsee: türkises Dämmerlicht von oben, dichter blauer Dunst, Lampe am Rad, kein Wetter
    if (this.route.theme.underwater) {
      this.skyMat.uniforms.top.value.set('#020a12'); this.skyMat.uniforms.hor.value.set('#0b4660'); this.skyMat.uniforms.sun.value.set(0, 0, 0);
      this.stars.material.opacity = 0; for (const c of this.clouds) c.material.opacity = 0; this.rain.visible = false; this.env.weather = 'clear';
      this.scene.background = col('#06324a'); this.scene.fog.color.set('#073a52'); this.scene.fog.near = 6; this.scene.fog.far = 170;
      this.sunDir.set(.1, 1, .2).normalize(); this.sun.color.set(0x7fd8ff); this.sun.intensity = time === 'night' ? .5 : 1.1; this.hemi.color.set('#5fc0e0'); this.hemi.intensity = .8; this.lamp.intensity = 28; this.far.material.color.setScalar(.3);
    }
    // Mond: immer schwarzer Himmel mit Sternen, keine Wolken, kein Wetter, harte Sonne
    if (this.route.theme.moon) {
      const blk = col('#000000'); this.skyMat.uniforms.top.value.copy(blk); this.skyMat.uniforms.hor.value.set(.03, .03, .05); this.skyMat.uniforms.sun.value.copy(this.sunDir);
      this.stars.material.opacity = 1; for (const c of this.clouds) c.material.opacity = 0; this.rain.visible = false; this.env.weather = 'clear';
      this.scene.background = col('#020205'); this.scene.fog.color.set('#05060a'); this.scene.fog.far = this.moonFar ??= this.scene.fog.far * 1.6;
      this.sun.intensity = 3.2; this.sun.color.set(0xffffff); this.hemi.intensity = .35; this.hemi.color.set('#9aa0b0');
    }
  }
  // Geist der eigenen Bestfahrt: halbdurchsichtiger Fahrer
  setGhost(on) {
    if (on && !this.ghost) {
      this.ghost = new Rider({ jersey: '#9fe8ff', bikeColor: '#cfefff', helmet: '#e8fbff', skin: '#d8f3ff' });
      this.ghost.root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .42; o.material.depthWrite = false; o.material.emissive?.set('#2a6f88'); } o.castShadow = false; });
      this.scene.add(this.ghost.root);
    }
    if (!on && this.ghost) { this.scene.remove(this.ghost.root); this.ghost = null; }
  }
  // Freunde-Geister: halbdurchsichtig in ihren eigenen Farben, mit Namensschild
  setFriendGhosts(list = []) {
    for (const g of this.fghosts || []) this.scene.remove(g.root);
    this.fghosts = list.map(c => {
      const r = new Rider({ ...c, jersey: c.jersey || '#c9b6ff' });
      r.root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .55; o.material.depthWrite = false; o.material.emissive?.set('#3b2a6f'); } o.castShadow = false; });
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(c.name, { w: 256, h: 56, size: 34, bg: '#6b4fd6', fg: '#fff' }), depthWrite: false, transparent: true, opacity: .95 }));
      lab.scale.set(1.1, .24, 1); lab.position.set(0, 2.05, 0); r.root.add(lab); this.scene.add(r.root); return r;
    });
  }
  setColors(p) { this.rider.setColors(p); }
  // Power-ups: schwebende, leuchtende Symbole über der Fahrspur
  setPickups(list) {
    this.pickups?.forEach(p => this.scene.remove(p)); this.pickups = [];
    const tex = labelTex('⚡', { w: 128, h: 128, size: 96, bg: 'rgba(0,0,0,0)', fg: '#ffd23f' });
    for (const it of list) {
      const g = new THREE.Group(), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); sp.scale.set(1.1, 1.1, 1); g.add(sp);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.75, .06, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .8 })); g.add(halo);
      this.place(g, it.d, 1.5); g.rotation.x = 0; g.position.y += 1.6; g.userData = { y: g.position.y, halo }; this.scene.add(g); this.pickups.push(g);
    }
  }
  // Verkehr: Autos und Lkw überholen von hinten. Die Welt bewegt sie selbst (flüssig pro Bild) und meldet das Vorbeifahren.
  spawnVehicle(kind, d, v, lat) {
    const R = this.route, c = ['#c8102e', '#1b1e22', '#f2f4f6', '#3fa7f5', '#8a8f96', '#f5c542', '#2e7d4f'][Math.random() * 7 | 0];
    const box = (w, h, l, y, z, col_) => colored(new THREE.BoxGeometry(w, h, l).translate(0, y, z), col_), parts = [];
    if (kind === 'truck') { parts.push(box(2.4, 2.3, 2.1, 1.75, -4.6, c), box(2.2, .9, 1.9, 2.3, -4.6, '#9fd0f0'), box(2.5, 2.9, 8.2, 2.05, .9, '#eef0f2'), box(2.5, .35, 9.8, .55, .1, '#2b2f35')); for (const z of [-4.8, -.6, 2.4, 3.8]) for (const x of [-1.15, 1.15]) parts.push(colored(new THREE.CylinderGeometry(.5, .5, .32, 12).rotateZ(Math.PI / 2).translate(x, .5, z), '#151618')); }
    else { parts.push(box(1.8, .7, 4.3, .65, 0, c), box(1.6, .62, 2.2, 1.28, .2, c), box(1.5, .5, 2.0, 1.3, .2, '#9fd0f0')); for (const z of [-1.35, 1.35]) for (const x of [-.85, .85]) parts.push(colored(new THREE.CylinderGeometry(.34, .34, .25, 12).rotateZ(Math.PI / 2).translate(x, .34, z), '#151618')); }
    const mesh = new THREE.Mesh(merge(parts), this.vcMat); mesh.castShadow = true; mesh.rotation.order = 'YXZ'; this.scene.add(mesh);
    (this.traffic ||= []).push({ kind, d, v, lat, mesh, passed: false });
  }
  clearTraffic() { for (const t of this.traffic || []) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); } this.traffic = []; }
  // Goldene Glocken: hängen tief über einer Fahrspur, man muss hindurch lenken
  setBells(list) {
    this.bells?.forEach(b => this.scene.remove(b)); this.bells = [];
    const tex = labelTex('🔔', { w: 128, h: 128, size: 96, bg: 'rgba(0,0,0,0)', fg: '#ffd23f' });
    for (const it of list) {
      const g = new THREE.Group(), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); sp.scale.set(.9, .9, 1); g.add(sp);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(.6, .05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .7 })); g.add(glow);
      this.place(g, it.d, it.lat); g.rotation.x = 0; g.position.y += 1.5; g.userData = { y: g.position.y, glow, i: it.i }; this.scene.add(g); this.bells.push(g);
    }
  }
  takeBell(i) { const b = this.bells?.find(x => x.userData.i === i); if (b) b.visible = false; }
  takePickup(i) { const p = this.pickups?.[i]; if (p) p.visible = false; }
  resetPickups() { this.pickups?.forEach(p => p.visible = true); }
  cycleView() { const order = [0, 1, 2, 3, 4, 6]; this.view = order[(order.indexOf(this.view) + 1) % order.length]; this.camInit = false; return this.view; }
  // Kurzer Kameraschwenk (z. B. am Zieltor), danach zurück zur gewählten Ansicht
  cinematic(sec = 3, view = 2) { if (document.documentElement.classList.contains('calm')) return; this.cine = { until: performance.now() + sec * 1000, view }; this.camInit = false; }

  // Position auf der Strecke mit Seitenversatz
  place(obj, d, lat) {
    lat *= this.latK ?? 1; // schmale Wege: Fahrer bleiben auf dem Pfad
    const R = this.route, h = R.headAt(d), x = R.xAt(d) + Math.cos(h) * lat, z = R.zAt(d) + Math.sin(h) * lat;
    obj.position.set(x, R.eleAt(d) + .1, z); obj.rotation.y = -h;
    obj.rotation.x = Math.atan(R.gradeAt(d) / 100);
  }
  update(st, dt) {
    const R = this.route, d = st.dist;
    const L = st.lat ?? 1.5; this.place(this.rider.root, d, L); this.rider.root.visible = this.view !== 4;
    this.rider.update(st.crank, st.v, dt, R.gradeAt(d));
    if (this.pacer && st.pacerDist != null) { this.place(this.pacer.root, st.pacerDist, .6); this.pacer.update(st.pacerCrank, st.pacerV, dt, R.gradeAt(st.pacerDist)); }
    if (this.fghosts && st.fghosts) this.fghosts.forEach((g, i) => { const f = st.fghosts[i]; if (!f) return; g.root.visible = f.show; if (f.show) { this.place(g.root, f.d, f.lat); g.update(f.crank, f.v, dt, R.gradeAt(f.d)); } });
    if (this.ghost && st.ghostDist != null) { this.place(this.ghost.root, st.ghostDist, 2.4); this.ghost.update(st.crank * 1.02, st.v, dt, R.gradeAt(st.ghostDist)); }
    // Dynamische Auflösung: bei Rucklern Pixeldichte senken, bei Luft wieder anheben
    this.frameAvg = (this.frameAvg ?? 16) * .95 + dt * 1000 * .05; this.frameN = (this.frameN || 0) + 1;
    if (this.frameN % 90 === 0) {
      const max = Math.min(window.devicePixelRatio || 1, this.Q.pr), cur = this.renderer.getPixelRatio();
      let next = cur;
      if (this.frameAvg > 24 && cur > .6) next = Math.max(.6, cur - .15);
      else if (this.frameAvg < 15 && cur < max) next = Math.min(max, cur + .1);
      if (next !== cur) { this.renderer.setPixelRatio(next); this.resize(); }
    }
    // Mitfahrer (weit entfernte nur jedes dritte Bild animieren)
    if (st.npcs) st.npcs.forEach((n, i) => {
      const o = this.npcs[i]; if (!o) return;
      let gap = n.d - d; if (R.loop) { if (gap > R.total / 2) gap -= R.total; if (gap < -R.total / 2) gap += R.total; }
      const vis = Math.abs(gap) < (o.remote ? 600 : this.qKey === 'low' ? 90 : 170); // echte Mitspieler weiter sichtbar
      o.rider.root.visible = vis; if (!vis) return;
      if (o.remote) {
        const t = performance.now() / 1000, far = Math.max(1, Math.abs(gap) / 18); // in der Ferne größer, damit der Pfeil erkennbar bleibt
        o.arrow.position.y = 3 + Math.sin(t * 3) * .2 + (far - 1) * .6; o.arrow.scale.set(1.1 * far, 1.4 * far, 1);
        o.glow.material.opacity = .55 + Math.sin(t * 4) * .25;
      }
      this.place(o.rider.root, n.d, n.lat);
      o.acc = (o.acc || 0) + dt;
      if (Math.abs(gap) < 90 || (this.frameN + i) % 2 === 0) { o.rider.update(n.crank, n.v, o.acc, R.gradeAt(n.d)); o.acc = 0; }
      o.lab.visible = o.remote ? this.view !== 3 && Math.abs(gap) > 4 && Math.abs(gap) < 200 : this.showNames !== false && gap > 7 && gap < 45 && this.view !== 3;
    });
    if (this.traffic?.length) {
      for (const t of [...this.traffic]) {
        t.d += t.v * dt; const gap = t.d - d;
        if (!t.passed && gap > -2.5) { t.passed = true; this.onPass?.(t, Math.abs((st.lat ?? 1.5) - t.lat)); this.shake = t.kind === 'truck' ? .5 : .25; }
        if (gap > 260 || (!R.loop && t.d > R.total - 5)) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); this.traffic.splice(this.traffic.indexOf(t), 1); continue; }
        this.place(t.mesh, R.loop ? ((t.d % R.total) + R.total) % R.total : t.d, t.lat);
      }
    }
    if (this.bells) { const t = performance.now() / 1000; for (const b of this.bells) if (b.visible) { b.position.y = b.userData.y + Math.sin(t * 3) * .1; b.userData.glow.rotation.y = t * 3; b.rotation.y = Math.sin(t) * .3; } }
    if (this.pickups) { const t = performance.now() / 1000; for (const p of this.pickups) if (p.visible) { p.position.y = p.userData.y + Math.sin(t * 2.2) * .15; p.userData.halo.rotation.y = t * 2; } }
    if (this.living) {
      const tt = performance.now() / 1000; FX.U.time.value = tt;
      FX.updateParticles(this.parts, this.camera, dt, st.v, this.rider.root.position.y);
      FX.updateSpectators(this.specs, d, tt);
      if (this.flare) FX.updateFlare(this.flare, this.camera, this.sunDir, this.env?.weather === 'clear' && this.env?.time !== 'night' && !R.tunnelAt(d, 25) && !this.photoHideFlare);
    }
    // Boote schaukeln
    if (this.boats) { const t = performance.now() / 1000; for (const b of this.boats) { b.rotation.z = Math.sin(t * .9 + b.userData.ph) * .06; b.position.y = R.water + Math.sin(t * .7 + b.userData.ph) * .15; } }
    if (this.gate?.visible) this.gateRing.material.opacity = .55 + .4 * Math.sin(performance.now() / 160);
    // Im Tunnel: dunkler, Kamera bleibt hinter dem Fahrer
    const inTun = !!R.tunnelAt(d, 25);
    if (this.rain.visible) { this.rain.position.set(this.camPos.x, this.camPos.y - 8 - ((performance.now() / 40) % 1) * 2.8, this.camPos.z); this.rain.visible = !inTun; }
    else if (this.env?.weather === 'rain' && !inTun) this.rain.visible = true;
    const expo = inTun ? .62 : this.expoBase; this.renderer.toneMappingExposure += (expo - this.renderer.toneMappingExposure) * Math.min(1, dt * 2.5);
    if (this.cine && performance.now() > this.cine.until) { this.cine = null; this.camInit = false; }
    let view = this.cine ? this.cine.view : this.view;
    if (inTun && view !== 4) view = 0;
    this.rider.root.visible = view !== 4;
    // Kamera
    const rp = this.rider.root.position, h = R.headAt(d);
    const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)), right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
    const pt = (dd, lat, up) => { lat *= this.latK ?? 1; const hh = R.headAt(dd); return new THREE.Vector3(R.xAt(dd) + Math.cos(hh) * lat, R.eleAt(dd) + up, R.zAt(dd) + Math.sin(hh) * lat); };
    let cp, look;
    switch (view) {
      case 5: cp = pt(d + 9, L - 3.7, 1.4); look = pt(d - 1, L, 1.1); break;
      case 6: cp = pt(d + 7, L - .15, 2.3); look = pt(d - 16, L, .9); break; // Rückblick: vor dem Fahrer, Blick nach hinten aufs Feld
      case 0: cp = pt(d - 5.2, L - .2, 2.05); look = pt(d + 7, L - .1, 1.05); break;
      case 1: cp = pt(d - 12, L - .3, 4.8); look = pt(d + 12, L - .1, .8); break;
      case 2: cp = rp.clone().addScaledVector(right, 4.2).addScaledVector(fwd, 1.2).add(new THREE.Vector3(0, 1.3, 0)); look = rp.clone().add(new THREE.Vector3(0, .9, 0)); break;
      case 3: cp = pt(d - 26, 1.5, 32); look = pt(d + 18, 1.5, 0); break;
      default: cp = pt(d + .2, L, 1.62); look = pt(d + 30, L, 1.2); break;
    }
    // Fotomodus: frei um den Fahrer drehen (yaw relativ zur Fahrtrichtung)
    if (this.photo) { const P = this.photo, a = -h + P.yaw, cpp = Math.cos(P.pitch); cp = rp.clone().add(new THREE.Vector3(Math.sin(a) * cpp * P.dist, 1 + Math.sin(P.pitch) * P.dist, Math.cos(a) * cpp * P.dist)); look = rp.clone().add(new THREE.Vector3(0, .95, 0)); }
    // Kamera folgt dem Fahrer ohne Verzögerung, nur der Versatz (Kurven, Ansichtswechsel) wird geglättet.
    // Vorher hinkte die Kamera bei 10 m/s rund 2,5 m hinterher, in der Seitenansicht lief der Fahrer davon.
    const k = this.camInit ? 1 - Math.pow(view === 4 ? .0001 : .03, dt) : 1;
    if (!this.camOff) { this.camOff = new THREE.Vector3(); this.lookOff = new THREE.Vector3(); }
    this.camOff.lerp(cp.clone().sub(rp), k); this.lookOff.lerp(look.clone().sub(rp), k); this.camInit = true;
    this.camPos.copy(rp).add(this.camOff); this.camLook.copy(rp).add(this.lookOff);
    if (!inTun) { const ground = R.heightAt(this.camPos.x, this.camPos.z) + .8; if (this.camPos.y < ground) this.camPos.y = ground; }
    // Tempo-Effekt: Sichtfeld weitet sich mit der Geschwindigkeit (kostet nichts)
    if (this.fx !== false && view !== 3) { const fov = 62 + clamp((st.v - 8) / 12, 0, 1) * 9; if (Math.abs(this.camera.fov - fov) > .05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2); this.camera.updateProjectionMatrix(); } }
    if (this.shake > .01) { const k = this.shake; this.camPos.x += (Math.random() - .5) * .12 * k; this.camPos.y += (Math.random() - .5) * .08 * k; this.shake *= Math.pow(.05, dt); }
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    // Umgebung mitführen
    const cx = this.camPos.x, cz = this.camPos.z;
    this.sky.position.set(cx, this.camPos.y, cz); this.far.position.set(cx, R.minE - 60, cz); this.stars.position.set(cx, this.camPos.y, cz);
    if (this.water) this.water.position.set(cx, R.water, cz);
    for (const cl of this.clouds) { const u = cl.userData; let ox = ((u.ox - cx * .15) % 6000 + 9000) % 6000 - 3000, oz = ((u.oz - cz * .15) % 6000 + 9000) % 6000 - 3000; cl.position.set(cx + ox, R.maxE + u.y, cz + oz); }
    if (this.earth) this.earth.position.set(this.camPos.x + 2600, this.camPos.y + 1500, this.camPos.z - 3800);
    if (this.themeX) updateThemeExtras(this.themeX, R, dt);
    this.sun.position.copy(rp).addScaledVector(this.sunDir, 200); this.sun.target.position.copy(rp);
    this.updateChunks(rp.x, rp.z, st.loading ? 40 : 5);
    const now = performance.now();
    if (this.instDirty && now - this.lastInst > 400) { this.rebuildInstances(); this.lastInst = now; }
    this.renderer.render(this.scene, this.camera);
  }
  // Ladebildschirm: nahe Kacheln vorab bauen
  preload(d) {
    const R = this.route; const x = R.xAt(d), z = R.zAt(d);
    let left = 1; let guard = 0;
    while (left > 0 && guard++ < 400) left = this.updateChunks(x, z, 1000);
    this.rebuildInstances();
  }
  capture(w = 1280) {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement, h = Math.round(w * src.height / src.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c;
  }
  // Alles freigeben: Geometrien, Texturen, Materialien, GPU-Kontext
  dispose() {
    for (const c of this.chunks.values()) c.mesh.geometry.dispose();
    this.chunks.clear();
    this.scene.traverse(o => { o.geometry?.dispose?.(); o.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
    this.scene.clear();
    this.renderer.renderLists?.dispose?.();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (e) { }
    this.npcs = []; this.boats = null;
  }
}
