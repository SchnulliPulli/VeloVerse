// Kleine Helfer, die überall gebraucht werden
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtT(s, alwaysH = false) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h || alwaysH ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
export const fmtKm = m => (m / 1000).toFixed(m < 100000 ? 1 : 0).replace('.', ',');
export const fmtNum = (v, d = 0) => (v == null || isNaN(v)) ? '–' : Number(v).toFixed(d).replace('.', ',');
export const fmtDate = (iso, opt = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(iso).toLocaleString(document.documentElement.lang, opt);
export const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };

// Ereignisse quer durch die App
export class Bus {
  constructor() { this.m = new Map(); }
  on(ev, fn) { if (!this.m.has(ev)) this.m.set(ev, new Set()); this.m.get(ev).add(fn); return () => this.m.get(ev).delete(fn); }
  emit(ev, data) { const s = this.m.get(ev); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error(e); } } }
}
export const bus = new Bus();

// Toast-Meldungen
export function toast(msg, ms = 3200) {
  let box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
}

// Modaler Dialog, gibt Promise mit gewähltem Wert zurück
export function dialog({ title, html, buttons, cls = '' }) {
  return new Promise(res => {
    const wrap = document.createElement('div');
    wrap.className = 'modal on';
    wrap.innerHTML = `<div class="card dlg ${cls}" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="dlg-body">${html || ''}</div><div class="row end">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(wrap);
    const prevFocus = document.activeElement, dlg = wrap.querySelector('.dlg'), h = dlg.querySelector('h2');
    h.id = 'dlg' + Math.random().toString(36).slice(2, 8); dlg.setAttribute('aria-labelledby', h.id);
    const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); try { prevFocus?.focus?.(); } catch (e) { } res(v); };
    // Barrierefrei: Esc schließt, Tab bleibt im Dialog
    const onKey = e => {
      if (!wrap.isConnected || [...document.querySelectorAll('.modal')].at(-1) !== wrap) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
      if (e.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return; const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) close(buttons[+b.dataset.i].value);
      else if (e.target === wrap) close(null);
    });
    (wrap.querySelector('.dlg > .row .btn.pri') || wrap.querySelector('.btn:last-child'))?.focus();
  });
}

// Als App installiert (Chrome/Edge „Installieren“, Android-Startbildschirm, iPhone „Zum Home-Bildschirm“)?
export const isPWA = () => { try { return matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch (e) { return false; } };
// Läuft die installierte App schon von sich aus im Vollbild (Handy/Tablet, Manifest „fullscreen“, iPhone vom Home-Bildschirm)?
// Als Fenster geöffnet (PC, Samsung DeX, Chromebook) gilt das nicht: dort bleibt Vollbild freiwillig über den Knopf.
export const appFullscreen = () => { try { return matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; } catch (e) { return false; } };
// Vollbild für die ganze App: bleibt beim Wechsel zwischen den Seiten erhalten
export function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d)?.catch?.(() => { });
  else { const e = d.documentElement; (e.requestFullscreen || e.webkitRequestFullscreen)?.call(e, { navigationUI: 'hide' })?.catch?.(() => { }); }
}
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// Canvas an CSS-Größe und Pixeldichte anpassen
export function fitCanvas(c, maxDpr = 2) {
  const r = c.getBoundingClientRect(), d = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w, h, d, cw: r.width, ch: r.height };
}

// Deterministischer Zufall
export function rng(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
export function hash2(x, y) { let h = (x * 374761393 + y * 668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return (h ^ (h >>> 16)) >>> 0; }

// Wertrauschen und fBm für Gelände und Strecken
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const r = (a, b) => hash2(a + seed * 1013, b - seed * 7919) / 4294967296;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(r(xi, yi), r(xi + 1, yi), u), lerp(r(xi, yi + 1), r(xi + 1, yi + 1), u), v) * 2 - 1;
}
export function fbm(x, y, oct = 4, seed = 1) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
export const noise1 = (x, seed = 1) => fbm(x, 0.37, 4, seed);

export const ZONES = [
  { n: 'Z1 Erholung', max: 0.55, c: '#8d99a6' }, { n: 'Z2 Grundlage', max: 0.75, c: '#3fa7f5' },
  { n: 'Z3 Tempo', max: 0.9, c: '#4fd18b' }, { n: 'Z4 Schwelle', max: 1.05, c: '#f5c542' },
  { n: 'Z5 VO2max', max: 1.2, c: '#ff8a3d' }, { n: 'Z6 Anaerob', max: 1.5, c: '#ef4458' }, { n: 'Z7 Neuromuskulär', max: 99, c: '#b06cf0' }];
export const HRZONES = [
  { n: 'Z1', max: 0.68, c: '#8d99a6' }, { n: 'Z2', max: 0.83, c: '#3fa7f5' }, { n: 'Z3', max: 0.94, c: '#4fd18b' }, { n: 'Z4', max: 1.05, c: '#f5c542' }, { n: 'Z5', max: 99, c: '#ef4458' }];
export const zoneOf = (p, ftp) => { const f = p / ftp; return ZONES.findIndex(z => f < z.max); };
export const zoneColor = f => f == null ? '#56606a' : ZONES.find(z => f < z.max).c;
