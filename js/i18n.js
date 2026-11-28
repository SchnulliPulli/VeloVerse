// Mehrsprachigkeit: Die App ist auf Deutsch geschrieben. Diese Schicht übersetzt angezeigte Texte (Textknoten und
// title/placeholder/aria-label) beim Einfügen ins Dokument anhand eines Wörterbuchs (i18n/<sprache>.tsv).
// Zahlen werden beim Nachschlagen durch # ersetzt und danach wieder eingesetzt („3 Wochen“ → „# Wochen“ → „3 weeks“).
// Fehlt ein ganzer Satz, werden seine Teile (getrennt durch · – : , /) einzeln übersetzt. Fehlt eine Übersetzung
// in Spanisch/Französisch/Italienisch/Niederländisch, wird Englisch genommen, sonst bleibt der deutsche Text.
// Die Sprache gilt je Gerät (localStorage „vvLang“), gewählt beim ersten Öffnen, änderbar unter Einstellungen › App & Daten.
export const LANGS = [
  ['de', 'Deutsch', '🇩🇪'], ['en', 'English', '🇬🇧'], ['es', 'Español', '🇪🇸'], ['fr', 'Français', '🇫🇷'], ['it', 'Italiano', '🇮🇹'], ['nl', 'Nederlands', '🇳🇱'],
];
const LOCALE = { de: 'de-DE', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL' };
const stored = () => { try { return localStorage.getItem('vvLang'); } catch (e) { return null; } };
export const lang = () => { const l = stored(); return LANGS.some(x => x[0] === l) ? l : 'de'; };
export const langChosen = () => !!stored();
export const locale = () => LOCALE[lang()];
// Vorschlag fürs erste Öffnen: Sprache des Browsers, falls vorhanden
export const suggested = () => { for (const l of navigator.languages || [navigator.language || 'de']) { const k = String(l).slice(0, 2).toLowerCase(); if (LANGS.some(x => x[0] === k)) return k; } return 'en'; };
export function setLang(l, reload = true) { try { localStorage.setItem('vvLang', l); } catch (e) { } if (reload) location.reload(); }

let D = null, FB = null; // Wörterbuch der Sprache und Englisch als Rückfall
// Prüfhilfe für Übersetzungen: fehlende Texte sammeln (nur wenn localStorage „vvI18nMiss“ = 1, sonst aus)
const MISS = (() => { try { return localStorage.getItem('vvI18nMiss') === '1' ? (window.__i18nMiss = Object.assign(new Set(), { fb: new Set() })) : null; } catch (e) { return null; } })();
const cache = new Map();
async function loadTsv(l) {
  try {
    const r = await fetch(`i18n/${l}.tsv`); if (!r.ok) return new Map();
    const m = new Map(); for (const line of (await r.text()).split('\n')) { const i = line.indexOf('\t'); if (i > 0) { const v = line.slice(i + 1).trim(); if (v) m.set(line.slice(0, i), v); } } return m;
  } catch (e) { return new Map(); }
}
const num = /\d+(?:[.,]\d+)?/g;
const LEAD = /^[^\p{L}\d#(„"]+/u, TRAIL = /[^\p{L}\d#)“"!?.…]+$/u;
function look(s) {
  const nums = []; const k = s.replace(num, m => { nums.push(m); return '#'; });
  let v = D.get(k); if (v == null) { v = FB?.get(k); if (v != null) MISS?.fb?.add(k); } if (v == null) return null;
  let i = 0; return v.replace(/#/g, () => nums[i++] ?? '#');
}
function core(s) {
  const r = look(s); if (r != null) return r;
  const lead = s.match(LEAD)?.[0] || '', rest = s.slice(lead.length), trail = rest.match(TRAIL)?.[0] || '', mid = rest.slice(0, rest.length - trail.length);
  if (mid && (lead || trail)) { const m = look(mid); if (m != null) return lead + m + trail; }
  return null;
}
export function tr(s) {
  if (!D || s == null) return s; s = String(s); const t = s.trim(); if (!t || !/\p{L}{2}/u.test(t)) return s;
  if (cache.has(t)) { const v = cache.get(t); return v === t ? s : s.replace(t, v); }
  let v = core(t);
  if (v == null && t.length < 400) { // Teile einzeln übersetzen
    const parts = t.split(/( · | – | — |: |, | \/ | \| |\(|\)|\n)/); let hit = false;
    if (parts.length > 1) { v = parts.map(p => { if (!/\p{L}{2}/u.test(p)) return p; const x = core(p.trim()); if (x == null) { MISS?.add(p.trim()); return p; } hit = true; return p.replace(p.trim(), x); }).join(''); if (!hit) v = null; }
  }
  if (v == null) MISS?.add(t);
  v ??= t; if (cache.size > 5000) cache.clear(); cache.set(t, v);
  return v === t ? s : s.replace(t, v);
}
// Deutsche Texte im Code (z. B. Sprachausgabe), die nicht durchs Dokument gehen
export const t = s => tr(s);

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
const SKIP = 'script,style,textarea,code,pre,[data-noi18n],[contenteditable],.chatlog .msgtxt';
function node(n) {
  if (n.nodeType === 3) { const p = n.parentElement; if (!p || p.closest(SKIP)) return; const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; return; }
  if (n.nodeType !== 1 || n.closest(SKIP)) return;
  for (const a of ATTRS) { const o = n.getAttribute(a); if (o) { const v = tr(o); if (v !== o) n.setAttribute(a, v); } }
  if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) { const v = tr(n.value); if (v !== n.value) n.value = v; }
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: x => x.nodeType === 1 && x.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); let c;
  while ((c = w.nextNode())) {
    if (c.nodeType === 1) { for (const a of ATTRS) { const o = c.getAttribute(a); if (o) { const v = tr(o); if (v !== o) c.setAttribute(a, v); } } }
    else { const v = tr(c.nodeValue); if (v !== c.nodeValue) c.nodeValue = v; }
  }
}
export async function initI18n() {
  const l = lang(); document.documentElement.lang = l; if (l === 'de') return;
  const [d, fb] = await Promise.all([loadTsv(l), l === 'en' ? null : loadTsv('en')]); D = d; FB = fb;
  document.title = tr(document.title);
  node(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(node);
      else if (m.type === 'characterData') { const n = m.target, p = n.parentElement; if (p && !p.closest(SKIP)) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
      else if (m.type === 'attributes') { const o = m.target.getAttribute(m.attributeName); if (o) { const v = tr(o); if (v !== o) m.target.setAttribute(m.attributeName, v); } }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// Auswahl beim ersten Öffnen (eigenes, schlichtes Fenster, noch vor der Einführung)
export function pickLanguage() {
  return new Promise(res => {
    const sug = suggested(), box = document.createElement('div'); box.className = 'modal on langpick'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML = `<div class="box" data-noi18n><h2>🌍 Sprache · Language</h2><p class="small muted">Später änderbar unter Einstellungen › App &amp; Daten · Change it later in Settings › App &amp; data</p>
      <div class="langgrid">${LANGS.map(([k, n, f]) => `<button class="btn${k === sug ? ' pri' : ''}" data-l="${k}"><span aria-hidden="true">${f}</span> ${n}</button>`).join('')}</div></div>`;
    document.body.appendChild(box); box.querySelector('.pri')?.focus();
    box.addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; const l = b.dataset.l; box.remove(); if (l === 'de') { setLang('de', false); res(false); } else { setLang(l, true); res(true); } });
  });
}
