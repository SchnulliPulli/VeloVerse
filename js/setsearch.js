// Suche in den Einstellungen: ein Suchfeld oben auf allen Einstellungsseiten. Beim ersten Tippen werden die
// Einstellungsseiten unsichtbar aufgebaut und alle Schalter, Felder und Überschriften eingesammelt (in der
// gewählten Sprache). Ein Treffer springt zur Seite, scrollt zur Option und hebt sie kurz hervor.
import { tr } from './i18n.js';
const PAGES = [['profile', 'Profil'], ['ridesettings', 'Fahrt & Ton'], ['notify', 'Benachrichtigungen'], ['appsettings', 'App & Daten'], ['devices', 'Geräte']];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
const clean = s => String(s || '').replace(/\s+/g, ' ').trim().replace(/\s*[:·]\s*[-+]?[\d.,]+\s*(%|W|bpm|min|km|s|°C)?$/, ''); // aktuelle Zahlenwerte (Regler) nicht mitsuchen
let IDX = null, building = null;

// Einträge einer gerenderten Seite: [Element, Titel, Beschreibung]
function items(root) {
  const out = [];
  for (const e of root.querySelectorAll('label.switch, label.f, label.chk, h2, h3.sub, .snpre')) {
    let t = '', d = '';
    if (e.matches('label.switch')) { t = e.querySelector('.swt i')?.textContent || [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '); d = e.querySelector('small')?.textContent || ''; }
    else if (e.matches('label.f')) { t = [...e.childNodes].filter(n => n.nodeType === 3 || (n.nodeType === 1 && !n.matches('input,select,textarea,button,small'))).map(n => n.textContent).join(' '); d = e.querySelector('small')?.textContent || ''; }
    else if (e.matches('label.chk')) { t = e.querySelector('b')?.textContent || e.textContent; d = e.querySelector('small')?.textContent || ''; }
    else if (e.matches('.snpre')) { t = e.querySelector('b')?.textContent; d = e.querySelector('small')?.textContent || ''; }
    else t = e.textContent;
    t = clean(t); if (t.length < 2 || t.length > 120) continue;
    out.push([e, t, clean(d).slice(0, 160)]);
  }
  return out;
}
const kindOf = e => e.matches('h2, h3') ? 'sec' : 'opt';

async function build(loaders, currentMod) {
  const all = [];
  for (const [k, label] of PAGES) {
    if (!loaders[k]) continue;
    const box = document.createElement('div'); box.className = 'ssbuild'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box);
    try {
      const mod = await loaders[k]();
      await Promise.race([mod.render(box, [], ''), new Promise(r => setTimeout(r, 4000))]);
      await new Promise(r => setTimeout(r, 60)); // Übersetzung abwarten
      let sec = '', seen = {};
      for (const [e, t, d] of items(box)) {
        if (kindOf(e) === 'sec') sec = t;
        const key = norm(t); seen[key] = (seen[key] || 0) + 1;
        all.push({ page: k, pageL: tr(label), sec: kindOf(e) === 'sec' ? '' : sec, t, d, nth: seen[key] - 1, s: norm([t, d, sec, label].join(' ')) });
      }
      if (mod.leave && mod.leave !== currentMod?.leave) try { mod.leave(); } catch (e) { } // nicht die gerade sichtbare Seite stören
    } catch (e) { console.warn('Suche', k, e); }
    box.remove();
  }
  return all;
}
export function search(q) {
  const words = norm(q).split(' ').filter(Boolean); if (!words.length || !IDX) return [];
  return IDX.filter(x => words.every(w => x.s.includes(w)))
    .sort((a, b) => (norm(b.t).startsWith(words[0]) - norm(a.t).startsWith(words[0])) || ((b.sec === '') - (a.sec === '')) || a.t.length - b.t.length)
    .slice(0, 14);
}
// Option auf der aktuellen Seite finden, hinscrollen, hervorheben
export function highlight(root, t, nth = 0) {
  const hits = items(root).filter(([, x]) => norm(x) === norm(t)), e = hits[Math.min(nth, hits.length - 1)]?.[0]; if (!e) return false;
  for (let d = e.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  const tgt = e.matches('label') ? e : e.closest('.card') || e;
  tgt.scrollIntoView({ block: 'center', behavior: 'smooth' });
  tgt.classList.remove('sshit'); void tgt.offsetWidth; tgt.classList.add('sshit'); setTimeout(() => tgt.classList.remove('sshit'), 2600);
  const f = e.matches('label') ? e.querySelector('input,select,textarea') : null; if (f) setTimeout(() => f.focus({ preventScroll: true }), 400);
  return true;
}

export function attach(el, k, loaders, currentMod) {
  const bar = document.createElement('div'); bar.className = 'setsearch';
  bar.innerHTML = '<input class="inp" type="search" placeholder="🔍 Einstellungen durchsuchen …" aria-label="Einstellungen durchsuchen" autocomplete="off"><div class="ssres" role="listbox" hidden></div>';
  el.prepend(bar);
  const inp = bar.querySelector('input'), res = bar.querySelector('.ssres');
  const draw = () => {
    const r = search(inp.value); res.hidden = !inp.value.trim();
    res.innerHTML = !IDX ? '<div class="ssempty">Wird vorbereitet …</div>' : r.length ? r.map((x, i) => `<button class="ssitem" data-i="${i}" role="option"><b></b><small></small></button>`).join('') : '<div class="ssempty">Nichts gefunden</div>';
    res.querySelectorAll('.ssitem').forEach((b, i) => { const x = r[i]; b.querySelector('b').textContent = x.t; b.querySelector('small').textContent = [x.pageL, x.sec].filter(Boolean).join(' › ') + (x.d ? ' · ' + x.d.slice(0, 80) : ''); b.onclick = () => go(x); });
  };
  const go = x => {
    res.hidden = true; inp.value = '';
    if (x.page === k) { highlight(el, x.t, x.nth); return; }
    try { sessionStorage.setItem('setFind', JSON.stringify({ t: x.t, nth: x.nth })); } catch (e) { }
    location.hash = '#/' + x.page;
  };
  inp.addEventListener('input', async () => {
    if (!IDX) { draw(); building ||= build(loaders, currentMod).then(a => { IDX = a; }); await building; }
    draw();
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = search(inp.value); if (r[0]) go(r[0]); } else if (e.key === 'Escape') { inp.value = ''; res.hidden = true; } else if (e.key === 'ArrowDown') { e.preventDefault(); res.querySelector('.ssitem')?.focus(); } });
  res.addEventListener('keydown', e => { const a = document.activeElement; if (e.key === 'ArrowDown') { e.preventDefault(); a.nextElementSibling?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (a.previousElementSibling || inp).focus(); } });
  document.addEventListener('click', function off(e) { if (!bar.isConnected) return document.removeEventListener('click', off); if (!bar.contains(e.target)) res.hidden = true; });
  // Nach dem Seitenwechsel aus einem Treffer: Option hervorheben
  let f = null; try { f = JSON.parse(sessionStorage.getItem('setFind') || 'null'); sessionStorage.removeItem('setFind'); } catch (e) { }
  if (f) setTimeout(() => highlight(el, f.t, f.nth), 250);
}
