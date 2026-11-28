// Echte Straßenbilder zur GPX-Strecke (Mapillary, frei unter CC BY-SA). Nur mit Konto und Einwilligung.
// Der Zugangsschlüssel ist ein öffentlicher Client-Schlüssel (MLY|…) aus online.json („mapillary“) oder aus den
// Einstellungen. Bilder werden per Abruf als Blob geladen (strenge Content-Security-Policy bleibt unverändert).
import { profile } from './state.js';
import { esc } from './util.js';

export const MLY_TERMS = 1;
const API = 'https://graph.mapillary.com/images';
export async function token() { const O = await import('./online/client.js'); return (profile.mlyToken || O.config?.().mapillary || '').trim(); }
export async function possible(route) {
  if (!route?.vraw && !route?.geo) return false;
  const O = await import('./online/client.js');
  return !route.builtin && !route.kit && O.loggedIn() && !!(await token()) && profile.streetImgs !== false;
}
export async function askConsent(force = false) {
  const { consent } = await import('./consent.js');
  return consent('mly', MLY_TERMS, { once: true, force, title: 'Echte Straßenbilder', html: `<p>Für Fotos der echten Straße fragt IndooRado den Dienst <b>Mapillary</b> (Meta Platforms Ireland Ltd.) nach Bildern entlang deiner Strecke. Dabei werden Kartenausschnitte deiner Strecke und – technisch bedingt – deine IP-Adresse an Mapillary übertragen.</p><p class="small muted">Die Bilder stammen von Freiwilligen und stehen unter CC BY-SA 4.0. Abschalten jederzeit unter Einstellungen › Fahrt &amp; Ton; Widerruf unter App &amp; Daten › Einwilligungen.</p>` });
}

/* Bilder entlang der Strecke: Abschnitte von ~600 m nacheinander vorausladen, jedem Bild die Streckenposition zuordnen */
export class StreetImages {
  constructor(route, box) {
    this.R = route; this.box = box; this.imgs = []; this.done = new Set(); this.busy = false; this.cur = null; this.blobs = new Map(); this.fail = 0;
    this.SEG = 600;
  }
  async seg(i) {
    if (this.done.has(i) || this.busy || this.fail > 3) return; this.busy = true; this.done.add(i);
    try {
      const R = this.R, d0 = i * this.SEG, d1 = Math.min(R.total, d0 + this.SEG); let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
      for (let d = d0; d <= d1; d += 50) { const la = R.latAt(d), lo = R.lonAt(d); la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
      const pad = .0004, q = new URLSearchParams({ access_token: await token(), fields: 'id,thumb_1024_url,computed_geometry,captured_at,compass_angle,computed_compass_angle,is_pano,camera_type', bbox: [lo0 - pad, la0 - pad, lo1 + pad, la1 + pad].map(v => v.toFixed(6)).join(','), limit: '200' });
      const r = await fetch(API + '?' + q, { referrerPolicy: 'no-referrer' }); if (!r.ok) { this.fail++; return; }
      const j = await r.json();
      for (const im of j.data || []) {
        const c = im.computed_geometry?.coordinates; if (!c || !im.thumb_1024_url) continue;
        // 360°-Aufnahmen und Fischaugen sehen als flaches Bild verzerrt aus (Motorhaube, gebogene Straße): weglassen
        if (im.is_pano || /spherical|equirect|fisheye/i.test(im.camera_type || '')) continue;
        const ang = im.computed_compass_angle ?? im.compass_angle; if (ang == null) continue;
        // nächste Streckenposition im Abschnitt suchen (Abstand höchstens 25 m)
        let best = null, bd = 25; const kx = 111320 * Math.cos(c[1] * Math.PI / 180);
        for (let d = d0; d <= d1; d += 10) { const dx = (R.lonAt(d) - c[0]) * kx, dy = (R.latAt(d) - c[1]) * 110540, dd = Math.hypot(dx, dy); if (dd < bd) { bd = dd; best = d; } }
        if (best == null) continue;
        // Nur Bilder in Fahrtrichtung (Blickrichtung höchstens 40° von der Strecke weg) – sonst sieht man Gegenrichtung oder Seitenstraßen
        const b = this.bearing(best), diff = Math.abs(((ang - b) % 360 + 540) % 360 - 180);
        if (diff <= 40) this.imgs.push({ id: im.id, d: best, url: im.thumb_1024_url, at: im.captured_at });
      }
      this.imgs.sort((a, b) => a.d - b.d);
    } catch (e) { this.fail++; } finally { this.busy = false; }
  }
  // Richtung der Strecke an dieser Stelle (Grad, 0 = Norden)
  bearing(d) { const R = this.R, a = Math.min(Math.max(0, d - 10), R.total - 20), la1 = R.latAt(a) * Math.PI / 180, la2 = R.latAt(a + 20) * Math.PI / 180, dl = (R.lonAt(a + 20) - R.lonAt(a)) * Math.PI / 180;
    return (Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360; }
  // je Bildposition nur das neueste Bild (alte Aufnahmen ausblenden)
  pick(d) { let p = null; for (const im of this.imgs) { if (im.d < d - 5) continue; if (im.d > d + 80) break; if (!p || Math.abs(im.d - d - 15) < Math.abs(p.d - d - 15) || (Math.abs(im.d - p.d) < 8 && (im.at || 0) > (p.at || 0))) p = im; } return p; }
  async update(d) {
    const i = Math.floor(d / this.SEG); this.seg(i); if (!this.busy) this.seg(i + 1);
    if (this.off) return;
    const im = this.pick(d);
    // Kein passendes Bild in der Nähe: altes Bild nicht stehen lassen (passt sonst nicht mehr zur Fahrt)
    if (!im) { if (this.curD != null && d - this.curD > 60) { this.box.querySelector('img').classList.remove('on'); this.box.classList.add('none'); this.cur = null; this.curD = null; } return; }
    if (im.id === this.cur) return; this.cur = im.id; this.curD = im.d;
    try {
      let u = this.blobs.get(im.id);
      if (!u) { const r = await fetch(im.url, { referrerPolicy: 'no-referrer' }); if (!r.ok) return; u = URL.createObjectURL(await r.blob()); this.blobs.set(im.id, u); if (this.blobs.size > 12) { const [k, v] = this.blobs.entries().next().value; URL.revokeObjectURL(v); this.blobs.delete(k); } }
      if (this.cur !== im.id) return;
      const img = this.box.querySelector('img'); img.classList.remove('on'); img.onload = () => img.classList.add('on'); img.src = u;
      this.box.hidden = false; this.box.classList.remove('none'); this.box.querySelector('.siat').textContent = im.at ? new Date(im.at).toLocaleDateString(document.documentElement.lang, { month: 'short', year: 'numeric' }) : '';
    } catch (e) { }
  }
  destroy() { for (const u of this.blobs.values()) URL.revokeObjectURL(u); this.blobs.clear(); this.box?.remove(); }
}
export const boxHtml = () => `<img alt="Straßenbild an dieser Stelle" draggable="false"><span class="sinone">Hier gibt es kein Straßenbild</span><span class="siattr">© Mapillary · CC BY-SA <span class="siat"></span></span><span class="sibtns"><button class="sibig" title="Größer/kleiner">⤢</button><button class="six" title="Straßenbilder für diese Fahrt ausblenden">✕</button></span>`;
// Fenster verschieben (ziehen), Größe umschalten, schließen; Lage wird gemerkt
export function mount(box, si) {
  const clampPos = () => { const r = box.getBoundingClientRect(), x = Math.min(Math.max(4, r.left), innerWidth - r.width - 4), y = Math.min(Math.max(4, r.top), innerHeight - r.height - 4); Object.assign(box.style, { left: x + 'px', top: y + 'px', right: 'auto' }); };
  try { const p = JSON.parse(localStorage.getItem('vvSiPos') || 'null'); if (p) { Object.assign(box.style, { left: p.x + 'px', top: p.y + 'px', right: 'auto' }); if (p.big) box.classList.add('big'); requestAnimationFrame(clampPos); } } catch (e) { }
  const keep = () => { const r = box.getBoundingClientRect(); try { localStorage.setItem('vvSiPos', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), big: box.classList.contains('big') })); } catch (e) { } };
  let drag = null;
  box.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = box.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', e => { if (!drag) return; drag.moved = true; box.classList.add('drag'); Object.assign(box.style, { left: Math.min(Math.max(4, e.clientX - drag.dx), innerWidth - box.offsetWidth - 4) + 'px', top: Math.min(Math.max(4, e.clientY - drag.dy), innerHeight - box.offsetHeight - 4) + 'px', right: 'auto' }); });
  const up = () => { if (!drag) return; const m = drag.moved; drag = null; box.classList.remove('drag'); if (m) keep(); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.querySelector('.sibig').onclick = () => { box.classList.toggle('big'); requestAnimationFrame(() => { clampPos(); keep(); }); };
  box.querySelector('.six').onclick = async () => { si.off = true; box.hidden = true; (await import('./util.js')).toast('Straßenbilder für diese Fahrt aus · dauerhaft unter ⚙️ Einstellungen › Fahransicht', 4500); };
  addEventListener('resize', clampPos);
}
