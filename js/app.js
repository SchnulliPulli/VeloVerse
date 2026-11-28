// Einstieg: Zustand laden, Router, Navigation
import { $, bus, toast, dialog, toggleFullscreen } from './util.js';
import { loadState, profile } from './state.js';
import { loadClickMap, setDemo, status, support, reconnectKnown } from './ble.js';
import { kv, persist } from './db.js';
import { ICON, avatarSvg } from './components.js';
import { loadPlan } from './plans.js';
import { loadSync, autoSync, sync, isConfigured, providerName, handleCloudRedirect } from './sync.js';
import { loadStrava, handleRedirect, strava, connected as stravaConnected } from './strava.js';
// Schutz gegen Clickjacking: IndooRado läuft nie eingebettet in einer fremden Seite (GitHub Pages kann dafür keinen Header setzen)
if (window.top !== window.self) { const a = document.createElement('a'); a.href = location.href; a.target = '_top'; a.textContent = 'IndooRado direkt öffnen'; document.body.replaceChildren(document.createTextNode('IndooRado kann nicht eingebettet werden. '), a); throw new Error('eingebettet'); }

const PAGES = {
  '': () => import('./pages/start.js'), ride: () => import('./pages/ride.js'), summary: () => import('./pages/summary.js'),
  workouts: () => import('./pages/workouts.js'), plans: () => import('./pages/plans.js'), routes: () => import('./pages/routes.js'), history: () => import('./pages/history.js'),
  progress: () => import('./pages/progress.js'), season: () => import('./pages/season.js'), builder: () => import('./pages/builder.js'), profile: () => import('./pages/profile.js'), devices: () => import('./pages/devices.js'), help: () => import('./pages/help.js'), editor: () => import('./pages/editor.js'), planner: () => import('./pages/planner.js'), ridesettings: () => import('./pages/ridesettings.js'), companion: () => import('./pages/companion.js'),
  // Einstellungen: gleiche Module, anderer Ausschnitt
  avatar: () => import('./pages/avatar.js'),
  legal: () => import('./pages/legal.js'),
  live: () => import('./pages/live.js'),
  report: () => import('./pages/report.js'),
  watch: () => import('./pages/watch.js'), // Zuschauer-Link (ohne Konto nutzbar)
  tv: () => import('./pages/watch.js').then(m => ({ ...m, render: el => m.renderCode(el) })), // Fernseher: Code eingeben
  events: () => import('./pages/community.js').then(m => ({ ...m, render: el => m.render(el, ['events']) })), clubs: () => import('./pages/community.js').then(m => ({ ...m, render: el => m.render(el, ['clubs']) })),
  lobby: () => import('./pages/online.js'), players: () => import('./pages/online.js').then(m => ({ ...m, render: el => m.render(el, ['players']) })), account: () => import('./pages/account.js'), admin: () => import('./pages/admin.js'),
  sound: () => import('./pages/ridesettings.js').then(m => ({ ...m, render: el => m.render(el, ['sound']) })),
  appsettings: () => import('./pages/profile.js').then(m => ({ ...m, render: el => m.render(el, ['app']) })),
  connect: () => import('./pages/profile.js').then(m => ({ ...m, render: el => m.render(el, ['connect']) })),
};
// Hauptmenü: sechs Bereiche, Unterseiten als Reiter oben auf der Seite
// Zusammengelegte Seiten: mehrere Bereiche untereinander auf einer Seite (weniger Reiter)
const combo = (...parts) => async () => {
  const mods = await Promise.all(parts.map(([imp]) => imp()));
  return {
    async render(el, params, q) { el.innerHTML = parts.map(() => '<div class="combo"></div>').join(''); const kids = [...el.children]; for (let i = 0; i < parts.length; i++) await mods[i].render(kids[i], parts[i][1] ?? params, q); },
    leave() { for (const m of new Set(mods)) try { m.leave?.(); } catch (e) { } },
  };
};
const P_RS = () => import('./pages/ridesettings.js'), P_PR = () => import('./pages/profile.js'), P_ON = () => import('./pages/online.js'), P_CO = () => import('./pages/community.js');
Object.assign(PAGES, {
  ridesettings: combo([P_RS, []], [P_RS, ['sound']]),
  appsettings: combo([P_PR, ['app']], [P_PR, ['connect']]),
  friends: () => import('./pages/friends.js'),
  community: combo([P_CO, ['events']], [P_CO, ['clubs']]),
  progress: combo([() => import('./pages/progress.js'), []], [() => import('./pages/season.js'), []]),
});
// Alte Adressen führen zum passenden Abschnitt der zusammengelegten Seite
const ALIAS = { sound: ['ridesettings', 1], connect: ['appsettings', 1], players: ['lobby', 1], events: ['community', 0], clubs: ['community', 1], season: ['progress', 1] };
const NAV = [
  { k: '', l: 'Start', i: 'home', also: ['companion', 'live'] },
  { k: 'workouts', l: 'Training', i: 'workout', tabs: [['workouts', 'Workouts'], ['plans', 'Trainingspläne']], also: ['editor', 'planner'] },
  { k: 'routes', l: 'Strecken', i: 'route', also: ['builder'] },
  { k: 'history', l: 'Aktivitäten', s: 'Fahrten', i: 'history', tabs: [['history', 'Verlauf'], ['progress', 'Fortschritt & Saison']], also: ['summary', 'season', 'report'] },
  { k: 'devices', l: 'Geräte', i: 'devices' },
  { k: 'lobby', l: 'Online', i: 'online', tabs: [['lobby', 'Lobby'], ['friends', 'Freunde'], ['community', 'Events & Teams'], ['account', 'Konto'], ['admin', 'Admin']], also: ['players', 'events', 'clubs'] },
  { k: 'profile', l: 'Einstellungen', s: 'Optionen', i: 'profile', tabs: [['profile', 'Profil'], ['avatar', 'Avatar'], ['ridesettings', 'Fahrt & Ton'], ['appsettings', 'App & Daten'], ['help', 'Hilfe']], also: ['sound', 'connect', 'legal'] },
];
const groupOf = k => NAV.find(g => g.k === k || g.tabs?.some(t => t[0] === k) || g.also?.includes(k)) || null;
let current = null, currentKey = null;

function nav() {
  $('#nav').innerHTML = NAV.map(g => `<a href="#/${g.k}" data-k="${g.k}" title="${g.l}">${ICON[g.i]}<span class="nl">${g.l}</span>${g.s ? `<span class="ns">${g.s}</span>` : ''}</a>`).join('')
    + `<div class="navfoot"><a href="#/legal/impressum">Impressum</a> · <a href="#/legal/datenschutz">Datenschutz</a><div class="navver" id="navVer"></div></div>`;
  import('./version.js').then(async V => { const i = await V.buildInfo(), e = document.getElementById('navVer'); if (e) { e.textContent = V.buildText(i); e.title = i.message || ''; } }).catch(() => { });
  $('#chips').innerHTML = ['trainer', 'hr', 'cad', 'click'].map(k => `<a class="chip" href="#/devices" data-d="${k}" title="${k}">${ICON[k]}</a>`).join('');
  const upd = () => { for (const c of document.querySelectorAll('#chips .chip')) c.dataset.st = status[c.dataset.d]; };
  bus.on('dev', upd); upd();
  // Cloud-Anzeige: sichtbar, sobald Daten außerhalb des Browsers landen (NAS-Abgleich oder Strava)
  const cc = document.createElement('a'); cc.className = 'chip cloudchip'; cc.href = '#/connect'; cc.id = 'cloudChip';
  cc.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18Z"/></svg><i></i>';
  $('#chips').after(cc);
  const cloudUpd = () => {
    const nas = !!(sync.cfg && (sync.cfg.host || sync.cfg.url || sync.cfg.clientId)), st = stravaConnected(); // nur echte Cloud-Speicher (NAS, OneDrive …), nicht das Online-Konto
    cc.hidden = !nas && !st;
    const state = !nas ? 'strava' : sync.busy ? 'busy' : sync.needLogin ? 'login' : sync.error ? 'error' : sync.last ? 'on' : 'off';
    cc.dataset.st = state;
    const when = sync.last ? new Date(sync.last).toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie';
    cc.title = [nas ? `Cloud-Speicher (${providerName()}): ${{ busy: 'Abgleich läuft', login: 'Anmeldung abgelaufen', error: 'Fehler: ' + sync.error, on: 'zuletzt abgeglichen ' + when, off: 'noch nicht abgeglichen' }[state]}` : '', st ? `Strava verbunden${strava.cfg?.auto ? ', Fahrten werden automatisch hochgeladen' : ''}` : ''].filter(Boolean).join(' · ');
  };
  bus.on('sync', cloudUpd); bus.on('strava', cloudUpd); setInterval(cloudUpd, 30000); cloudUpd(); window.__cloudUpd = cloudUpd;
  // Vollbild-Knopf in der Kopfleiste
  const fs = $('#fsBtn'), fsUpd = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); fs.innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>' : ICON.full; fs.title = on ? 'Vollbild beenden' : 'Vollbild'; fs.dataset.st = on ? 'on' : 'off'; };
  fs.onclick = toggleFullscreen; document.addEventListener('fullscreenchange', fsUpd); document.addEventListener('webkitfullscreenchange', fsUpd); fsUpd();
  if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) fs.hidden = true;
  // Anmelden-Knopf (nur wenn IndooRado Online eingerichtet ist); angemeldet zeigt er Initiale und Namen
  const lb = document.createElement('a'); lb.className = 'btn sm loginbtn'; lb.href = '#/account'; lb.hidden = true;
  document.querySelector('.ridebtn').before(lb);
  // Schnellstart oben rechts: neue Fahrt beginnt sofort mit der zuletzt gewählten Strecke (eine geparkte Fahrt wird einfach fortgesetzt)
  document.querySelector('.ridebtn').addEventListener('click', async e => { e.preventDefault(); try { const r = await import('./pages/ride.js'); if (!r.isRiding?.()) sessionStorage.setItem('quickStart', '1'); } catch (er) { } location.hash = '#/ride'; });
  const loginUpd = async () => {
    const O = await import('./online/client.js'); lb.__O = O;
    if (!O.configured()) { lb.hidden = true; return; }
    lb.hidden = false;
    if (O.loggedIn()) {
      const n = O.online.profile?.display_name || 'Konto', mfa = O.needsMfa();
      lb.className = 'loginbtn in'; lb.title = 'Angemeldet als ' + n + (mfa ? ' (2FA-Code fehlt noch)' : ''); lb.removeAttribute('href'); lb.setAttribute('role', 'button'); lb.tabIndex = 0;
      lb.innerHTML = `${avatarSvg(profile, 34)}${mfa ? '<i class="lbdot" title="2FA-Code fehlt"></i>' : ''}`;
    } else { lb.className = 'btn sm loginbtn'; lb.title = 'Anmelden oder registrieren'; lb.href = '#/account'; lb.removeAttribute('role'); lb.innerHTML = ICON.profile + '<span>Anmelden</span>'; }
  };
  bus.on('online', loginUpd); bus.on('profile', loginUpd); window.__loginUpd = loginUpd;
  // Nachrichten: Knopf in der Kopfleiste (und auf der Startseite) mit Anzahl Neuer, öffnet das Nachrichtenfenster
  const mc = document.createElement('button'); mc.className = 'chip msgchip'; mc.dataset.inbox = ''; mc.hidden = true; mc.title = 'Nachrichten'; mc.setAttribute('aria-label', 'Nachrichten'); lb.before(mc);
  // Wie viele andere sind online? (nur angemeldet)
  const oc = document.createElement('a'); oc.className = 'chip onlinechip'; oc.href = '#/players'; oc.hidden = true; lb.before(oc);
  bus.on('presence', async () => { const PR = await import('./online/presence.js'); const n = PR.P.peers.size; oc.hidden = !PR.P.ready; oc.innerHTML = `<i class="odot"></i><b>${n}</b>`; oc.title = n === 1 ? '1 anderer Spieler online' : n + ' andere Spieler online'; });
  // Angemeldet: Klick auf den Avatar öffnet ein kleines Menü
  const um = document.createElement('div'); um.className = 'usermenu'; um.hidden = true; document.body.appendChild(um);
  lb.addEventListener('click', e => {
    const O = lb.__O; if (!O?.loggedIn()) return; // abgemeldet: normaler Link zum Konto
    e.preventDefault(); if (!um.hidden) { um.hidden = true; return; }
    const n = (O.online.profile?.display_name || 'Fahrer').replace(/</g, '&lt;'), mail = (O.online.user?.email || '').replace(/</g, '&lt;');
    // Weitere angemeldete Konten auf diesem Gerät: Antippen wechselt (lädt neu, jedes Konto hat seine eigenen Daten)
    const others = O.accounts().filter(a => a.uid !== O.online.user?.id), e2 = t => String(t ?? '').replace(/</g, '&lt;');
    const accHtml = `<div class="umacc">${others.map(a => `<button class="umsw" data-sw="${e2(a.uid)}">${avatarSvg(a.look || {}, 30)}<span><b>${e2(a.name)}</b><small>${e2(a.email)}</small></span><i class="umx" data-forget="${e2(a.uid)}" title="Von diesem Gerät entfernen">✕</i></button>`).join('')}<button data-um-add>➕ Weiteres Konto hinzufügen</button></div>`;
    um.innerHTML = `<div class="umhead">${avatarSvg(profile, 44)}<div><b>${n}</b><small>${mail}</small></div></div>${accHtml}<a href="#/account">👤 Konto und Datenschutz</a><a href="#/avatar">🎨 Avatar gestalten</a>${O.isAdmin() ? '<a href="#/admin">🛠️ Admin-Konsole</a>' : ''}<button data-um-out>↩︎ Abmelden</button>`;
    const r = lb.getBoundingClientRect(); um.style.top = (r.bottom + 8) + 'px'; um.style.right = Math.max(8, innerWidth - r.right) + 'px'; um.hidden = false;
  });
  um.addEventListener('click', async e => {
    const fg = e.target.closest('[data-forget]');
    if (fg) { e.stopPropagation(); const O = await import('./online/client.js'); fg.closest('.umsw').remove(); await O.forgetAccount(fg.dataset.forget); toast('Konto von diesem Gerät entfernt (die lokalen Daten bleiben erhalten)'); return; }
    const sw = e.target.closest('[data-sw]');
    if (sw) { if ((document.querySelector('#rw') && currentKey === 'ride') || document.querySelector('.resumebar:not([hidden])')) { toast('Bitte erst die Fahrt beenden, dann das Konto wechseln', 3500); um.hidden = true; return; } const O = await import('./online/client.js'); sw.innerHTML = '<span class="spinner sm"></span> Wechsle …'; O.switchAccount(sw.dataset.sw); return; }
    if (e.target.closest('[data-um-add]')) { const O = await import('./online/client.js'); O.addAccount(); return; }
    if (e.target.closest('[data-um-out]')) { const O = await import('./online/client.js'); await O.signOut(); toast('Abgemeldet'); loginUpd(); if (currentKey === 'account') route(); } um.hidden = true; });
  document.addEventListener('click', e => { if (!e.target.closest('.usermenu,.loginbtn')) um.hidden = true; });
  addEventListener('hashchange', () => um.hidden = true);
  lb.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && lb.__O?.loggedIn()) { e.preventDefault(); lb.click(); } });
  // Handy: Sensoren, Cloud und Vollbild in einem Status-Knopf mit Ausklappmenü bündeln
  const box = document.createElement('div'); box.className = 'tbx'; box.id = 'tbx';
  $('#chips').before(box); box.append($('#chips'), cc, fs);
  const more = document.createElement('button'); more.className = 'chip tbmore'; more.id = 'tbMore'; more.setAttribute('aria-label', 'Geräte und Status'); more.setAttribute('aria-expanded', 'false');
  box.before(more);
  const sum = () => {
    const keys = ['trainer', 'hr', 'cad', 'click'], on = keys.filter(k => status[k] === 'on' || status[k] === 'demo').length, err = keys.some(k => status[k] === 'error');
    more.dataset.st = err ? 'error' : keys.some(k => status[k] === 'busy') ? 'busy' : on ? (status.trainer === 'demo' ? 'demo' : 'on') : 'off';
    more.innerHTML = ICON.devices + `<i class="tbn">${on}</i>`; more.title = on + ' von 4 Geräten verbunden';
  };
  bus.on('dev', sum); sum();
  const close = () => { box.classList.remove('open'); more.setAttribute('aria-expanded', 'false'); };
  more.onclick = e => { e.stopPropagation(); const o = box.classList.toggle('open'); more.setAttribute('aria-expanded', String(o)); };
  document.addEventListener('click', e => { if (!e.target.closest('#tbx')) close(); });
  addEventListener('hashchange', close);
}
window.__route = () => route();
// Anzahl neuer Nachrichten/Anfragen in alle Nachrichten-Knöpfe schreiben
let msgN = null, msgT = 0;
async function msgUpd(force = false) {
  if (!force && msgN != null && Date.now() - msgT < 8000) return paint(); msgT = Date.now();
  try { msgN = await (await import('./inbox.js')).newCount(); } catch (e) { msgN = null; } paint(); bus.emit('msgCount', msgN);
}
function paint() {
  for (const b of document.querySelectorAll('[data-inbox]')) {
    b.hidden = msgN == null; b.classList.toggle('has', msgN > 0);
    if (b.classList.contains('msgchip')) b.innerHTML = `💬${msgN > 0 ? `<b class="mbadge">${msgN > 9 ? '9+' : msgN}</b>` : ''}`;
    else b.innerHTML = `💬 Nachrichten${msgN > 0 ? ` <b class="mbadge">${msgN} neu</b>` : ''}`;
  }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-inbox],[data-inbox-open]'); if (b) import('./inbox.js').then(m => m.openInbox()); });
setInterval(() => document.hidden || msgUpd(true), 15e3);
setInterval(() => { if (document.hidden && profile.reminders === true && profile.notif?.msg !== false) msgUpd(true); }, 60e3); // im Hintergrund für Benachrichtigungen
bus.on('online', () => setTimeout(() => msgUpd(true), 500)); bus.on('inbox', () => msgUpd(true));
async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [key, ...params] = path.split('/');
  let k = key in PAGES ? key : '', jump = 0;
  // Kinderprofil: kein Online-Bereich (siehe unten, nach den Aliasen)
  if (ALIAS[k]) { [k, jump] = ALIAS[k]; history.replaceState(null, '', '#/' + k); }
  if (profile.kid && (groupOf(k)?.k === 'lobby' || ['admin', 'account', 'watch', 'tv'].includes(k))) { history.replaceState(null, '', '#/'); k = ''; }
  // Handy-Ansicht: die Startseite ist dann die kompakte Ansicht (umschalten unter Einstellungen › App)
  if (k === '' && wantsPhoneView()) k = 'companion';
  // Laufende Fahrt beim Verlassen nicht verwerfen, sondern pausiert im Hintergrund parken
  let parked = false;
  if (currentKey === 'ride' && k !== 'ride') { const ride = await import('./pages/ride.js'); if (ride.isRiding()) { ride.park(); parked = true; } }
  if (!parked) { try { current?.leave?.(); } catch (e) { console.error(e); } }
  resumeBar(k);
  document.body.dataset.page = k || 'start';
  const grp = groupOf(k);
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.k === grp?.k);
  const sub = $('#subnav');
  sub.hidden = !grp?.tabs || k === 'ride';
  sub.innerHTML = grp?.tabs ? grp.tabs.map(([t, l]) => `<a href="#/${t}" class="${t === k ? 'on' : ''}${t === 'admin' ? ' admintab' : ''}">${l}</a>`).join('') : '';
  window.__routeTok = (window.__routeTok || 0) + 1; // langsame Seiten prüfen damit, ob sie noch angezeigt werden sollen
  const el = $('#view'); el.innerHTML = '<div class="pageload"><div class="spinner"></div></div>';
  el.onclick = el.onchange = el.oninput = el.ondragover = el.ondrop = null;
  window.scrollTo(0, 0);
  try {
    const mod = await PAGES[k]();
    current = mod; currentKey = k;
    el.innerHTML = '';
    await mod.render(el, params.map(decodeURIComponent), query);
    if (jump) requestAnimationFrame(() => el.children[jump]?.scrollIntoView({ block: 'start' }));
    if ((grp?.k === 'profile' && k !== 'help' && k !== 'legal') || k === 'devices') import('./setsearch.js').then(m => m.attach(el, k, PAGES, mod)).catch(e => console.warn(e)); // Suche in den Einstellungen
    msgUpd();
    sessionStorage.removeItem('vvReloaded');
    if (k === 'lobby') announce(el);
    if (k === '' || k === 'companion') newsBar(el);
  } catch (e) {
    console.error(e);
    // Nach einem Update können kurz alte und neue Dateien gemischt im Browser liegen: einmal frisch laden
    if (/is not a function|does not provide an export|Failed to fetch dynamically imported module|Importing a module script failed/.test(String(e)) && !sessionStorage.getItem('vvReloaded')) {
      sessionStorage.setItem('vvReloaded', '1'); el.innerHTML = '<div class="pageload"><div class="spinner"></div></div>';
      try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) { }
      location.reload(); return;
    }
    el.innerHTML = `<div class="card"><h2>Fehler beim Laden</h2><pre class="log">${String(e.stack || e).replace(/</g, '&lt;')}</pre></div>`;
  }
}

// Balken "Zurück zur Fahrt", solange eine pausierte Fahrt geparkt ist
async function resumeBar(k) {
  let bar = $('#resumeBar');
  const ride = await import('./pages/ride.js'), info = k !== 'ride' && ride.parkedInfo();
  if (!info) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'resumeBar'; bar.className = 'resumebar'; document.body.appendChild(bar); }
  bar.innerHTML = `<span>⏸ Fahrt pausiert · <b>${info}</b></span><span class="row"><button class="btn sm ghost" data-end>Beenden</button><a class="btn sm pri" href="#/ride">▶ Zurück zur Fahrt</a></span>`;
  bar.querySelector('[data-end]').onclick = () => { sessionStorage.setItem('endAfterResume', '1'); location.hash = '#/ride'; };
}

// Handy: Touch als Hauptbedienung und kleiner Bildschirm (kürzere Seite unter 520 px) oder schmales Hochformat
export function isPhone() {
  const coarse = matchMedia('(pointer: coarse)').matches, short = Math.min(screen.width, screen.height), ar = innerWidth / innerHeight;
  return coarse && (short < 520 || (ar < .7 && innerWidth < 600)) || /iPhone|Android.+Mobile/.test(navigator.userAgent);
}
export function wantsPhoneView() { const m = profile.phoneView || 'auto'; return m === 'always' || (m === 'auto' && isPhone()); }
// Startseite: Benachrichtigungsleiste zum Wischen (mit Punkten): Ankündigungen vom Admin, offene Lobbys, wer gerade fährt.
// Nur angemeldet (sonst kein Kontakt zum Server). Zeigt sofort den zuletzt bekannten Stand und frischt im Hintergrund auf.
// Wechselt alle 7 s von selbst, pausiert bei Berührung oder Maus darüber.
async function newsBar(el) {
  const O = await import('./online/client.js'); if (!O.configured()) return;
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const seen = () => { try { return JSON.parse(localStorage.getItem('vvAnnSeen') || '[]'); } catch (e) { return []; } };
  let anns = []; try { anns = JSON.parse(localStorage.getItem('vvAnnCache') || '[]'); } catch (e) { }
  let PR = null, live = false, evs = [], soc = { req: 0, unread: 0 };
  const box = document.createElement('section'); box.className = 'newsbar'; box.hidden = true;
  box.innerHTML = '<div class="nbtrack"></div><button class="nbarr l" data-step="-1" aria-label="Zurück">‹</button><button class="nbarr r" data-step="1" aria-label="Weiter">›</button><div class="nbdots"></div>';
  el.querySelector('.pagehead, .comphead')?.after(box) ?? el.prepend(box);
  const track = box.querySelector('.nbtrack'), dots = box.querySelector('.nbdots');
  const min = ms => ms <= 0 ? 'startet jetzt' : ms < 60e3 ? `startet in ${Math.ceil(ms / 1000)} s` : `startet in ${Math.ceil(ms / 60e3)} min`;
  const LV = { info: ['📣', 'Ankündigung'], event: ['🎉', 'Event'], warn: ['⚠️', 'Hinweis'] };
  const slide = (kind, ico, kicker, title, sub, action = '') => ({ kind, html: `<div class="nbico">${ico}</div><div class="nbtxt"><small>${kicker}</small><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${action}` });
  const items = () => {
    const S = seen(), out = [];
    for (const a of anns) if (!S.includes(a.id)) { const [ic, k] = LV[a.level] || LV.info; out.push({ key: 'a' + a.id, ...slide('nb-ann nb-lv-' + (LV[a.level] ? a.level : 'info'), ic, k, esc(a.title), esc(a.body), `<button class="nbx" data-hide="${a.id}" aria-label="Ausblenden">✕</button>`) }); }
    // Freunde: neue Anfragen und ungelesene Nachrichten
    if (soc.req) out.push({ key: 'fr' + soc.req, ...slide('nb-event', '👥', 'Freunde', soc.req === 1 ? 'Neue Freundschaftsanfrage' : soc.req + ' neue Freundschaftsanfragen', '', '<button class="btn sm pri" data-inbox-open>Ansehen</button>') });
    if (soc.unread) out.push({ key: 'msg' + soc.unread, ...slide('nb-event', '💬', 'Chat', soc.unread === 1 ? '1 ungelesene Nachricht' : soc.unread + ' ungelesene Nachrichten', '', '<button class="btn sm pri" data-inbox-open>Lesen</button>') });
    // Geplante Events der nächsten 24 Stunden (angemeldete zuerst)
    for (const e of evs) { const ms = new Date(e.starts_at) - Date.now(); if (ms > 864e5 || ms < -e.duration_min * 60e3) continue; const now = ms < 10 * 60e3;
      out.push({ key: 'e' + e.id, ...slide('nb-event', '📅', `Event${e.me ? ' · du bist angemeldet' : ''} · ${now ? 'läuft jetzt' : min(ms).replace('startet ', '')}`, esc(e.title), `👥 ${e.riders} angemeldet`, `<a class="btn sm ${now ? 'pri' : ''}" href="#/events">${now ? 'Beitreten' : 'Ansehen'}</a>`) }); }
    if (PR && live) {
      for (const l of PR.lobbies()) out.push({ key: 'l' + l.id, ...slide('nb-lobby', '👥', `${l.race ? 'Rennen' : 'Gruppenfahrt'} · ${min(l.startAt - Date.now())}`, esc(l.title) + (l.mine ? ' <em>(deine)</em>' : ''), `${esc(l.routeName)} · von ${esc(l.hostName)} · ${l.members.length} dabei`, '<a class="btn sm pri" href="#/lobby">Zur Lobby</a>') });
      for (const [k, p] of PR.P.peers) if (p.where === 'ride' && p.route) out.push({ key: 'r' + k, ...slide('nb-ride', avatarSvg(p.look || {}, 40), 'Fährt gerade', esc(p.name), esc(p.routeName || ''), `<button class="btn sm" data-sid="${esc(k)}" data-route="${esc(p.route)}" data-name="${esc(p.name)}">Mitfahren</button>`) });
      const ps = [...PR.P.peers.values()];
      if (ps.length && !out.some(x => x.kind === 'nb-ride')) out.push({ key: 'online', ...slide('nb-online', '🟢', 'Gerade online', ps.slice(0, 3).map(p => esc(p.name)).join(', ') + (ps.length > 3 ? ` und ${ps.length - 3} weitere` : ''), 'Leg eine Gruppenfahrt an, alle sehen sie sofort.', '<a class="btn sm" href="#/lobby">Lobby</a>') });
    }
    return out;
  };
  let keys = [], idx = 0, hold = 0, off = null, t = null;
  const mark = () => [...dots.children].forEach((d, i) => d.setAttribute('aria-current', String(i === idx)));
  const go = (i, smooth = true) => { if (!keys.length) return; idx = (i + keys.length) % keys.length; track.scrollTo({ left: idx * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' }); mark(); };
  const draw = () => {
    if (!document.body.contains(box)) { off?.(); clearInterval(t); return; }
    const it = items(), nk = it.map(x => x.key);
    box.hidden = !it.length; if (!it.length) { keys = []; return; }
    if (nk.join() !== keys.join()) {
      const cur = keys[idx]; keys = nk;
      track.innerHTML = it.map(x => `<div class="nbslide ${x.kind}" data-k="${esc(x.key)}">${x.html}</div>`).join('');
      dots.innerHTML = it.length > 1 ? it.map((x, i) => `<button data-i="${i}" aria-label="Meldung ${i + 1}"></button>`).join('') : '';
      box.classList.toggle('multi', it.length > 1);
      go(Math.max(0, keys.indexOf(cur)), false);
    } else it.forEach((x, i) => { const sl = track.children[i]; if (sl && sl.innerHTML !== x.html) sl.innerHTML = x.html; });
  };
  track.addEventListener('scroll', () => { const i = Math.round(track.scrollLeft / (track.clientWidth || 1)); if (i !== idx) { idx = i; mark(); } }, { passive: true });
  box.addEventListener('pointerenter', () => hold = Date.now() + 1e9); box.addEventListener('pointerleave', () => hold = Date.now() + 4000);
  box.addEventListener('touchstart', () => hold = Date.now() + 10000, { passive: true });
  box.onclick = async e => {
    const st = e.target.closest('[data-step]'); if (st) { go(idx + +st.dataset.step); hold = Date.now() + 10000; return; }
    const d = e.target.closest('.nbdots [data-i]'); if (d) { go(+d.dataset.i); hold = Date.now() + 10000; return; }
    const h = e.target.closest('[data-hide]'); if (h) { const S = seen(); S.push(+h.dataset.hide); localStorage.setItem('vvAnnSeen', JSON.stringify(S.slice(-50))); draw(); return; }
    const b = e.target.closest('[data-sid]'); if (b) { if (!(await (await import('./online/sharedroute.js')).prepareJoin(b.dataset.sid, b.dataset.route, toast))) return; const { sel, saveSel } = await import('./state.js'); sel.routeId = b.dataset.route; saveSel(); sessionStorage.setItem('joinRider', JSON.stringify({ sid: b.dataset.sid, name: b.dataset.name })); location.hash = '#/ride'; }
  };
  // Sofort: zuletzt bekannte Ankündigungen (nur wenn zuletzt angemeldet)
  if (localStorage.getItem('vv-auth') || sessionStorage.getItem('vv-auth')) draw();
  let tick = 0; t = setInterval(() => { draw(); if (++tick % 7 === 0 && keys.length > 1 && Date.now() > hold) go(idx + 1); }, 1000);
  // Danach: Anmeldung abwarten, Anwesenheit und frische Ankündigungen parallel holen
  if (!O.online.ready) await new Promise(r => { const o = bus.on('online', () => { o(); r(); }); setTimeout(() => { o(); r(); }, 15000); });
  if (!document.body.contains(box)) return;
  if (!O.loggedIn() || O.needsMfa()) { anns = []; draw(); return; }
  if (O.access().ok) { const loadEv = () => { O.client().then(sb => sb.rpc('event_list')).then(({ data }) => { evs = (data || []).sort((a, b) => b.me - a.me); draw(); }).catch(() => { }); O.client().then(sb => sb.rpc('friend_list')).then(({ data }) => { if (!data) return; soc = { req: data.filter(f => f.status === 'pending' && f.incoming).length, unread: data.reduce((a, f) => a + (+f.unread || 0), 0) }; draw(); }).catch(() => { }); }; loadEv(); const et = setInterval(() => document.body.contains(box) ? loadEv() : clearInterval(et), 120e3);
    PR = await import('./online/presence.js'); live = true; off = bus.on('presence', draw); PR.joinPresence().catch(() => { }); draw(); }
  import('./online/sync.js').then(m => m.announcements()).then(a => { anns = a || []; try { localStorage.setItem('vvAnnCache', JSON.stringify(anns.map(x => ({ id: x.id, level: x.level, title: x.title, body: x.body })))); } catch (e) { } draw(); }).catch(() => { });
}
// Einladung eines anderen Spielers: Karte unten rechts auf jeder Seite, mit Beitreten bzw. Mitfahren
const invSeen = new Map();
// Einladung annehmen (aus der Karte, dem Nachrichtencenter oder einer Push-Meldung)
export async function acceptInvite(inv) {
  const PR = await import('./online/presence.js'), { sel, saveSel } = await import('./state.js');
  if (inv.kind === 'lobby') { PR.joinLobby(inv.lobby); toast('Beigetreten, die Fahrt startet automatisch'); location.hash = '#/lobby'; return; }
  let sid = inv.from; if (inv.uid && !PR.P.peers.has(sid)) { for (let i = 0; i < 40 && !PR.sidsOf(inv.uid).length; i++) await new Promise(r => setTimeout(r, 250)); sid = PR.sidsOf(inv.uid)[0]; }
  if (!sid) return toast(`${inv.name || 'Dein Freund'} fährt gerade nicht mehr`, 5000);
  if (!(await (await import('./online/sharedroute.js')).prepareJoin(sid, inv.route, toast))) return; sel.routeId = inv.route; saveSel(); sessionStorage.setItem('joinRider', JSON.stringify({ sid, name: inv.name })); location.hash = '#/ride';
}
bus.on('invite', async inv => {
  const ik = (inv.uid || inv.from) + ':' + (inv.lobby || inv.route); if (Date.now() - (invSeen.get(ik) || 0) < 120e3) return; invSeen.set(ik, Date.now()); // Live-Signal und Push nicht doppelt
  import('./notilog.js').then(N => N.addNote({ icon: '🚴', title: `${inv.name} ${inv.kind === 'lobby' ? 'lädt dich zur Gruppenfahrt ein' : 'möchte, dass du mitfährst'}`, body: inv.kind === 'lobby' ? `„${inv.title || ''}“ · ${inv.routeName || ''}` : inv.routeName || '', act: { t: 'invite', inv: { kind: inv.kind, lobby: inv.lobby, route: inv.route, from: inv.from, uid: inv.uid, name: inv.name, title: inv.title, routeName: inv.routeName } }, ttl: 15 * 60e3 })).catch(() => { });
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const box = document.querySelector('.invstack') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'invstack' }));
  const c = document.createElement('div'); c.className = 'card invcard';
  const min = ms => ms <= 0 ? 'startet jetzt' : ms < 60e3 ? `startet in ${Math.ceil(ms / 1000)} s` : `startet in ${Math.ceil(ms / 60e3)} min`;
  c.innerHTML = `<div class="nbico">${avatarSvg(inv.look || {}, 40)}</div><div class="nbtxt"><small>📨 Einladung</small><b>${esc(inv.name)} ${inv.kind === 'lobby' ? 'lädt dich zur Gruppenfahrt ein' : 'möchte, dass du mitfährst'}</b><span>${inv.kind === 'lobby' ? `„${esc(inv.title)}“ · ${esc(inv.routeName)}${inv.startAt ? ' · ' + min(inv.startAt - Date.now()) : ''}` : esc(inv.routeName)}</span><div class="row"><button class="btn sm pri" data-ok>${inv.kind === 'lobby' ? 'Beitreten' : 'Mitfahren'}</button><button class="btn sm ghost" data-no>Später</button></div></div>`;
  box.appendChild(c);
  try { (await import('./sound.js')).sound?.pass?.(); } catch (e) { }
  const t = setTimeout(() => c.remove(), 90e3);
  c.onclick = async e => {
    if (e.target.closest('[data-no]')) { clearTimeout(t); c.remove(); return; }
    if (!e.target.closest('[data-ok]')) return;
    clearTimeout(t); c.remove(); acceptInvite(inv);
  };
});
async function announce(el) {
  const O = await import('./online/client.js'); if (!O.configured()) return;
  // Beim App-Start läuft die Anmeldung noch: einmal auf das Ergebnis warten statt die Ankündigungen zu verpassen
  if (!O.online.ready) await new Promise(r => { const off = bus.on('online', () => { off(); r(); }); setTimeout(() => { off(); r(); }, 15000); });
  if (!O.online.ready || !O.loggedIn() || O.needsMfa() || !document.body.contains(el) || el.querySelector('.annbox')) return; // nur angemeldet: sonst kein Kontakt zum Server
  try {
    const list = await (await import('./online/sync.js')).announcements(), seen = JSON.parse(localStorage.getItem('vvAnnSeen') || '[]');
    const box = document.createElement('div'); box.className = 'annbox';
    box.innerHTML = list.filter(a => !seen.includes(a.id)).map(a => `<div class="card ann ${a.level}" data-id="${a.id}"><div><b>${a.level === 'event' ? '🎉 ' : a.level === 'warn' ? '⚠️ ' : '📣 '}${a.title.replace(/</g, '&lt;')}</b>${a.body ? `<p class="small">${a.body.replace(/</g, '&lt;')}</p>` : ''}</div><button class="btn xs ghost" aria-label="Ausblenden">✕</button></div>`).join('');
    if (!box.children.length || !document.body.contains(el)) return;
    box.onclick = e => { const c = e.target.closest('button') && e.target.closest('.ann'); if (!c) return; seen.push(+c.dataset.id); localStorage.setItem('vvAnnSeen', JSON.stringify(seen.slice(-50))); c.remove(); };
    el.querySelector('.pagehead, .comphead')?.after(box) ?? el.prepend(box);
  } catch (e) { }
}
// Online angemeldet: Abgleich läuft über das Konto, NAS und andere Cloud-Speicher pausieren. Abgemeldet: zurück zum bisherigen Speicher.
// Abgleichfehler höchstens alle 15 Minuten melden (der Abgleich läuft oft automatisch)
let lastSyncErr = 0;
function syncErrToast(msg) { if (Date.now() - lastSyncErr < 15 * 60e3) return; lastSyncErr = Date.now(); toast(msg, 6000); }
async function bindOnline(O) {
  const S = await import('./sync.js');
  const on = O.loggedIn() && !O.needsMfa() && O.access().ok; // ohne Zugang (Testphase abgelaufen, gesperrt) kein Online-Abgleich
  document.body.classList.toggle('is-admin', O.isAdmin() && !O.needsMfa());
  const PR = await import('./online/presence.js'); if (on) PR.joinPresence().catch(() => { }); else PR.leavePresence();
  await S.setOnlineBackend(on ? { sb: O.online.client, uid: O.online.user.id } : null);
  window.__cloudUpd?.();
  if (on) {
    const pulled = await autoSync().catch(e => { syncErrToast('Online-Abgleich: ' + (sync.error || e.message)); return null; });
    if (pulled) { await loadState(); await loadPlan(); toast(sync.info || 'Neuerer Stand aus dem Konto übernommen', sync.info ? 6000 : 3000); sync.info = ''; if (currentKey !== 'ride') route(); }
    (await import('./online/sync.js')).pushRides().catch(() => { });
  }
}
let bound = false;
function onlineHooks(O) {
  bindOnline(O);
  if (bound) return; bound = true;
  // Wurde dieses Gerät von einem anderen abgemeldet? (beim Anmelden und Start prüfen)
  bus.on('online', ev => { if (['SIGNED_IN', 'init', 'code', 'MFA_CHALLENGE_VERIFIED', 'mfa'].includes(ev)) setTimeout(() => import('./online/devices.js').then(m => m.checkRevoked()).catch(() => { }), 2500); });
  // Admins: Hinweis, wenn die Datenbank älter ist als die App (neue Funktionen fehlen dann)
  bus.on('online', async ev => { if (!['SIGNED_IN', 'MFA_CHALLENGE_VERIFIED', 'mfa'].includes(ev) || window.__schemaChecked) return; const O = await import('./online/client.js'); await new Promise(r => setTimeout(r, 4000)); if (!O.isAdmin?.() || window.__schemaChecked) return; window.__schemaChecked = true; if (!(await O.schemaOk())) toast('🛠️ Die Datenbank ist älter als die App: supabase/schema.sql aus dem privaten Repo im Supabase-SQL-Editor neu ausführen.', 9000); });
  bus.on('online', ev => { if (['SIGNED_IN', 'SIGNED_OUT', 'MFA_CHALLENGE_VERIFIED', 'mfa', 'out'].includes(ev)) bindOnline(O); });
  bus.on('rideSaved', async () => { if (sync.online) (await import('./online/sync.js')).pushRides().catch(() => { }); });
}
// Ladeanzeige für Online-Anfragen: erscheint erst nach 400 ms, damit schnelle Antworten nicht flackern
function netIndicator() {
  const pill = document.createElement('div'); pill.className = 'netpill'; pill.hidden = true; pill.setAttribute('role', 'status');
  pill.innerHTML = '<span class="spinner sm"></span><span>Online-Infos werden geladen …</span>'; document.body.appendChild(pill);
  let t = null;
  bus.on('netbusy', n => { clearTimeout(t); if (n > 0) t = setTimeout(() => { pill.hidden = currentKey === 'ride'; }, 400); else pill.hidden = true; });
}
export async function pushOpen(href) {
  let h = ''; try { h = new URL(href, location.href).hash; } catch (e) { return; }
  // Meldung für ein anderes Konto auf diesem Gerät: erst dorthin wechseln, danach die Aktion ausführen
  const acct = (h.match(/[?&]acct=([0-9a-f-]{36})/i) || [])[1];
  if (acct) {
    const O = await import('./online/client.js'); for (let i = 0; i < 40 && !O.online.ready; i++) await new Promise(r => setTimeout(r, 250));
    if (O.online.user?.id !== acct) {
      if (!O.accounts().some(a => a.uid === acct)) { toast('Dieses Konto ist auf diesem Gerät nicht mehr angemeldet', 5000); return; }
      try { sessionStorage.setItem('vvPendingPush', href); } catch (e) { }
      toast('Wechsle zum richtigen Konto …', 2500); O.switchAccount(acct); return;
    }
  }
  const qp0 = new URLSearchParams(h.split('?')[1] || '');
  if (qp0.has('pgo')) { location.hash = '#/' + (qp0.get('pgo') === 'lobby' ? 'lobby' : 'friends'); return; }
  const qp = new URLSearchParams(h.split('?')[1] || ''), waitOnline = async () => { const O = await import('./online/client.js'); for (let i = 0; i < 160 && !(O.loggedIn() && O.online.ready && O.access().ok); i++) await new Promise(r => setTimeout(r, 250)); return O; };
  if (qp.has('pdecline')) { // Anruf aus der Meldung abgelehnt
    history.replaceState(null, '', location.pathname + '#/'); const room = qp.get('pdecline'), from = qp.get('from'); await waitOnline();
    if (/^IndooRado-[A-Za-z0-9]{24}$/.test(room)) { const C = await import('./call.js'); C.callState(room, 'decline'); import('./online/presence.js').then(PR => PR.callSignal(from, 'callend')).catch(() => { }); toast('📵 Anruf abgelehnt'); }
    return;
  }
  if (qp.has('pfreq')) { // Freundschaftsanfrage aus der Meldung annehmen
    history.replaceState(null, '', location.pathname + '#/friends'); const O = await waitOnline(); const id = qp.get('pfreq');
    if (/^[0-9a-f-]{36}$/i.test(id)) { const { error } = await (await O.client()).rpc('friend_respond', { p_other: id, p_accept: true }); toast(error ? error.message : '🎉 Ihr seid jetzt Freunde'); bus.emit('inbox'); }
    route(); return;
  }
  if (qp.has('pinv')) { // Einladung aus der Meldung annehmen
    history.replaceState(null, '', location.pathname + '#/'); await waitOnline(); await import('./online/presence.js');
    const inv = { kind: qp.get('k') === 'ride' ? 'ride' : 'lobby', uid: qp.get('from'), from: '', name: qp.get('name') || 'Freund', lobby: qp.get('lobby'), route: qp.get('route') };
    for (let i = 0; i < 40; i++) { const PR = await import('./online/presence.js'); if (PR.P.ready) break; await new Promise(r => setTimeout(r, 250)); }
    acceptInvite(inv); return;
  }
  const m = h.match(/[?&]pcall=(IndooRado-[A-Za-z0-9]{24})/);
  if (!m) { const o = h.match(/^#\/friends\?open=([0-9a-f-]{36})(&|$)/i); if (o) { const O = await import('./online/client.js'); for (let i = 0; i < 120 && !(O.loggedIn() && O.online.ready); i++) await new Promise(r => setTimeout(r, 250)); (await import('./pages/friends.js')).openChatWith(o[1]); } return; }
  const q = new URLSearchParams(h.split('?')[1] || ''), peer = { id: q.get('from') || '', name: (q.get('name') || 'Freund').slice(0, 40) };
  history.replaceState(null, '', location.pathname + '#/'); route();
  // Nach dem Öffnen aus der Benachrichtigung läuft die Anmeldung oft noch: bis zu 45 s warten, dann annehmen
  const O = await import('./online/client.js');
  const ready = () => O.loggedIn() && O.online.ready && O.access().ok;
  if (!ready()) toast(`📹 Anruf von ${peer.name} wird verbunden …`, 4000);
  for (let i = 0; i < 180 && !ready(); i++) {
    await new Promise(r => setTimeout(r, 250));
    if (i === 40 && O.access().mfa) toast('Bitte zuerst die Zwei-Faktor-Anmeldung abschließen – danach geht der Anruf weiter', 6000);
  }
  if (!ready()) { toast(O.loggedIn() ? 'Anruf: Anmeldung noch nicht abgeschlossen – bitte im Chat erneut beitreten' : 'Anruf: Auf diesem Gerät ist niemand angemeldet', 7000); return; }
  (await import('./call.js')).joinCall(m[1], peer);
}
async function init() {
  { const I = await import('./i18n.js'); await I.initI18n(); if (!I.langChosen() && !/^#\/(watch\/|tv\b)/.test(location.hash) && await I.pickLanguage()) return; } // Sprache wählen (erstes Öffnen)
  netIndicator();
  await loadState(); await loadClickMap(); await loadPlan();
  import('./tv.js').then(m => m.applyTv()); // Fernseher-Modus, Gamepad, Handy-Fernbedienung
  import('./comfort.js').then(m => m.scheduleReminders()); // Erinnerungen, App installieren
  { const F = await import('./family.js'); await F.applySeed(); document.body.classList.toggle('kidmode', !!profile.kid); // Familienprofile / Kindermodus
    const fn = F.currentName(); if (fn) { const fc = document.createElement('a'); fc.className = 'chip famchip'; fc.href = '#/profile'; fc.title = 'Familienprofil wechseln'; fc.textContent = (profile.kid ? '🧒 ' : '🚴 ') + fn; const lbx = document.querySelector('.loginbtn'); if (lbx) lbx.before(fc); else document.querySelector('.topbar .ridebtn')?.before(fc); } }
  const { applyAppTheme } = await import('./pages/profile.js'); applyAppTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyAppTheme);
  nav();
  bus.on('toast', m => toast(m));
  if (await kv.get('demo', !support().ok)) setDemo(true);
  persist();
  // IndooRado Online läuft im Hintergrund an, die Startseite wartet nicht darauf.
  // Nur bei Rückkehr vom Login (?code=…) erst die Anmeldung abschließen, damit niemand sonst den Code nimmt.
  const O = await import('./online/client.js');
  const onlineP = O.loadSiteConfig().then(() => { window.__loginUpd?.(); if (O.configured()) return O.initOnline().then(() => window.__loginUpd?.()); }).catch(e => console.warn('Online:', e.message));
  if (new URLSearchParams(location.search).has('code') && O.expectingReturn()) await onlineP;
  // Rückkehr von OneDrive/Google/Dropbox-Anmeldung zuerst auswerten (sonst hält Strava den Code für seinen)
  await loadSync();
  try { const who = await handleCloudRedirect(); if (who) toast('Verbunden mit ' + who, 4000); } catch (e) { toast(e.message, 7000); }
  await loadStrava(); window.__cloudUpd?.();
  try { const who = await handleRedirect(); if (who) toast('Mit Strava verbunden' + (typeof who === 'string' && who ? ': ' + who : '')); }
  catch (e) { toast(e.message, 6000); }
  // Handy erkannt: beim App-Start gleich die Handy-Ansicht öffnen (Einstellung unter App)
  window.addEventListener('hashchange', route);
  await route();
  if (!/^#\/(watch\/|tv\b)/.test(location.hash)) import('./onboard.js').then(m => m.onboarding()).catch(e => console.error(e)); // Zuschauer sehen keine Einführung
  import('./eggs.js').then(m => m.initEggs()).catch(e => console.error(e));
  setTimeout(() => import('./ridesnap.js').then(m => m.offerResume()).catch(e => console.warn(e)), 1200); // unterbrochene Fahrt?
  // Nach der Einrichtung einmal nach Benachrichtigungen fragen (wartet, bis kein anderes Fenster offen ist)
  if (!/^#\/(watch\/|tv\b)/.test(location.hash)) (async () => {
    const { kv } = await import('./db.js');
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      if (document.hidden || document.querySelector('.modal.on, .tour') || document.body.dataset.page === 'ride' || !(await kv.get('onboarded', false))) continue;
      return (await import('./comfort.js')).askNotifications();
    }
  })().catch(() => { });
  // Aus einer Push-Benachrichtigung geöffnet: Anruf annehmen bzw. Chat öffnen
  { let pend = null; try { pend = sessionStorage.getItem('vvPendingPush'); sessionStorage.removeItem('vvPendingPush'); } catch (e) { }
    if (pend) pushOpen(pend); // nach dem Kontowechsel die gemerkte Aktion ausführen
    else if (/[?&](pcall|pinv|pfreq|pdecline|pgo|acct)=/.test(location.hash) || /^#\/friends\?open=/.test(location.hash)) pushOpen(location.href); } // aus einer Gerätemeldung geöffnet
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type === 'ping' && e.ports?.[0]) { const port = e.ports[0], t0 = Date.now(); requestAnimationFrame(() => port.postMessage({ active: document.visibilityState === 'visible' && document.hasFocus() && Date.now() - t0 < 600 })); return; } // bei gesperrtem Handy zeichnet die Seite nicht – keine Antwort
    if (e.data?.type === 'pushOpen') pushOpen(e.data.url);
    if (e.data?.type === 'pushOther') import('./otherpop.js').then(m => m.showOther(e.data.d || {}, pushOpen)); // für ein anderes angemeldetes Konto
    // Push bei offener App im Fokus: statt Gerätemeldung der Hinweis in der App
    if (e.data?.type === 'pushIn') { const d = e.data.d || {}; if (!/^[0-9a-f-]{36}$/i.test(d.from || '')) return;
      if (d.kind === 'msg') bus.emit('chatsignal', { uid: d.from, name: d.name });
      else if (d.kind === 'call') bus.emit('callsignal', { kind: 'call', uid: d.from, name: d.name, look: {} });
      else if (d.kind === 'friendreq') { toast(`👋 ${d.name || 'Jemand'} möchte mit dir befreundet sein – siehe Nachrichten`, 6000); bus.emit('inbox'); }
      else if (d.kind === 'invite') { const i = d.info || {}; bus.emit('invite', { kind: i.k === 'ride' ? 'ride' : 'lobby', uid: d.from, from: '', name: d.name, lobby: i.lobby, title: i.title, route: i.route, routeName: i.routeName, look: {} }); }
      else if (d.kind === 'missed') { bus.emit('callsignal', { kind: 'callend', uid: d.from, name: d.name }); toast(`📵 Verpasster Anruf von ${d.name || 'Freund'}`, 6000); import('./notilog.js').then(N => N.addNote({ icon: '📵', title: `Verpasster Anruf von ${d.name || 'Freund'}`, act: { t: 'chat', uid: d.from } })); bus.emit('inbox'); } }
  });
  bus.on('online', ev => { if (ev === 'SIGNED_IN' || ev === 'init') import('./push.js').then(m => m.refreshPush()).catch(() => { }); });
  reconnectKnown().catch(() => { });
  // Barrierefreiheit: Sprunglink zum Inhalt (ohne den Hash-Router zu stören), Tastenkürzel-Übersicht mit ?
  const sk = document.getElementById('skipLink'); if (sk) sk.onclick = e => { e.preventDefault(); document.getElementById('view')?.focus(); };
  import('./shortcuts.js').then(m => m.initShortcuts());
  onlineP.finally(() => import('./online/client.js').then(O => { if (O.configured()) { import('./call.js'); import('./msgpop.js'); } })); // erst nach dem Laden der Online-Konfiguration // Videoanrufe: nur mit Online-Konto, lädt nichts Externes ohne Anruf
  import('./sensors.js').then(m => m.reconnectSensors()).catch(() => { });
  // NAS-Abgleich: neuerer Stand vom NAS wird übernommen, danach Seite neu aufbauen
  // Erst den Online-Login abwarten: angemeldet läuft der Abgleich über das Konto (bindOnline), sonst wie bisher über NAS/Cloud
  onlineP.then(loadSync).then(async () => { if (O.configured()) { onlineHooks(O); if (O.loggedIn()) return null; } window.__cloudUpd?.(); return autoSync(); }).then(async pulled => {
    if (sync.needLogin && !sync.online) toast('NAS: Anmeldung abgelaufen, unter Einstellungen › Verbindungen neu anmelden', 5000);
    if (!pulled) return;
    await loadState(); await loadPlan(); await loadClickMap(); toast(sync.info || 'Neuerer Stand von ' + providerName() + ' übernommen', sync.info ? 6000 : 3000); sync.info = '';
    if (currentKey !== 'ride') route();
  }).catch(e => syncErrToast(providerName() + '-Abgleich: ' + (sync.error || e.message)));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || currentKey === 'ride') return;
    try { const pulled = await autoSync(); if (pulled) { await loadState(); await loadPlan(); toast('Neuer Stand von ' + providerName() + ' übernommen'); route(); } } catch (e) { }
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadCtrl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => { });
    // Neue App-Version übernommen: einmal neu laden, damit alle Dateien zur selben Version gehören (während der Fahrt erst danach)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadCtrl) return;
      const go = () => { toast('Neue Version geladen', 1500); setTimeout(() => location.reload(), 600); };
      if (currentKey !== 'ride') go(); else bus.on('rideEnded', go);
    });
  }
}
// Lesefelder mit Text (z. B. Strava-Titel): Antippen markiert alles (statt Inline-onclick, wegen Content Security Policy)
document.addEventListener('click', e => { const f = e.target.closest?.('[data-selectall]'); if (f) f.select(); });
init();

// Hinweis bei fehlender Internetverbindung und bei abgerissener Server-Verbindung (Online-Bereiche)
{
  const nb = document.createElement('div'); nb.className = 'netbar'; nb.setAttribute('role', 'status'); nb.setAttribute('aria-live', 'polite'); nb.hidden = true; document.body.appendChild(nb);
  let lost = 0, lostT = null;
  const show = (txt, kind) => { nb.innerHTML = txt; nb.className = 'netbar ' + kind; nb.hidden = false; };
  const hide = () => { nb.hidden = true; };
  // Nur echte Ausfälle melden: kurzes Flackern (Netzwechsel) ignorieren, und weil manche Browser das „online“-Ereignis
  // nicht zuverlässig senden, regelmäßig selbst nachsehen, ob die Verbindung wieder da ist.
  let offT = null, chk = null;
  const back = () => { clearTimeout(offT); offT = null; clearInterval(chk); chk = null; if (!nb.hidden && nb.classList.contains('off')) { hide(); toast('✓ Wieder online', 2500); } };
  const offline = () => {
    if (offT || chk) return;
    offT = setTimeout(() => { offT = null; if (navigator.onLine) return; show('📡 <b>Keine Internetverbindung</b> · Fahrten und Daten bleiben auf dem Gerät, Online-Funktionen pausieren', 'off'); chk = setInterval(() => { if (navigator.onLine) back(); }, 3000); }, 4000);
  };
  addEventListener('offline', offline);
  addEventListener('online', back);
  if (!navigator.onLine) offline();
  // Server: Anwesenheitskanal war verbunden und ist länger als 8 s weg (bei bestehendem Internet)
  bus.on('presence', async () => {
    const PR = await import('./online/presence.js');
    if (PR.P.ready) { if (!nb.hidden && nb.classList.contains('off')) back(); clearTimeout(lostT); lostT = null; if (lost && !nb.hidden && nb.classList.contains('srv')) { hide(); toast('✓ Verbindung zum Server wiederhergestellt', 2500); } lost = 0; window.__wasReady = true; return; }
    if (!window.__wasReady || !navigator.onLine || lostT) return;
    lostT = setTimeout(() => { lostT = null; if (PR.P.ready || !navigator.onLine || !PR.P.ch || document.hidden) return; lost = Date.now(); show('⚠️ <b>Verbindung zum Server unterbrochen</b> · wird neu aufgebaut …', 'srv'); }, 15000);
  });
}

// Handy: seitlich wischen wechselt zwischen den Reitern eines Bereichs. Die Seite folgt dem Finger,
// ab ~50 px oder bei schnellem Wisch wird umgeschaltet, sonst federt sie zurück.
{
  let st = null;
  const small = () => matchMedia('(max-width: 900px)').matches;
  const scrollsX = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { if (n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true; } return false; };
  const view = document.getElementById('view');
  const tabsNow = () => { const grp = groupOf(currentKey); if (!grp?.tabs) return null; const tabs = grp.tabs.filter(([k]) => k !== 'admin' || document.body.classList.contains('is-admin')); const i = tabs.findIndex(([k]) => k === currentKey); return i < 0 ? null : { tabs, i }; };
  const reset = (anim = true) => { view.style.transition = anim ? 'transform .22s ease-out, opacity .22s' : ''; view.style.transform = ''; view.style.opacity = ''; setTimeout(() => { view.style.transition = ''; }, 240); };
  view.addEventListener('touchstart', e => {
    st = null;
    if (!small() || e.touches.length !== 1 || currentKey === 'ride' || document.querySelector('.modal')) return;
    const t = e.target; if (t.closest('input,textarea,select,canvas,[contenteditable],[data-noswipe],.leaflet-container,.kitpal,.chat') || scrollsX(t)) return;
    const T = tabsNow(); if (!T) return;
    const p = e.touches[0]; st = { x: p.clientX, y: p.clientY, t: performance.now(), lock: null, dx: 0, T };
  }, { passive: true });
  view.addEventListener('touchmove', e => {
    if (!st) return; const p = e.touches[0], dx = p.clientX - st.x, dy = p.clientY - st.y;
    if (!st.lock) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; st.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'; }
    if (st.lock !== 'x') { st = null; return; }
    e.preventDefault(); // waagrecht: Seite nicht senkrecht scrollen
    const edge = (dx > 0 && st.T.i === 0) || (dx < 0 && st.T.i === st.T.tabs.length - 1); // am Rand: nur leicht nachgeben
    st.dx = dx; view.style.transition = ''; view.style.transform = `translateX(${edge ? dx * .25 : dx * .9}px)`; view.style.opacity = String(1 - Math.min(.35, Math.abs(dx) / 900));
  }, { passive: false });
  const end = e => {
    if (!st) return; const s0 = st; st = null; if (s0.lock !== 'x') return;
    const dt = performance.now() - s0.t, v = Math.abs(s0.dx) / Math.max(1, dt), j = s0.T.i + (s0.dx < 0 ? 1 : -1);
    if ((Math.abs(s0.dx) > 50 || (v > .35 && Math.abs(s0.dx) > 20)) && j >= 0 && j < s0.T.tabs.length) {
      const dir = s0.dx < 0 ? -1 : 1;
      view.style.transition = 'transform .14s ease-in, opacity .14s'; view.style.transform = `translateX(${dir * innerWidth * .35}px)`; view.style.opacity = '0';
      setTimeout(() => {
        view.style.transition = ''; view.style.transform = `translateX(${-dir * 40}px)`; // neue Seite kommt von der anderen Seite herein
        location.hash = '#/' + s0.T.tabs[j][0];
        requestAnimationFrame(() => requestAnimationFrame(reset));
        document.querySelector('#subnav a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
      }, 140);
    } else reset();
  };
  view.addEventListener('touchend', end, { passive: true }); view.addEventListener('touchcancel', end, { passive: true });
  // Aktiven Reiter in der Leiste sichtbar halten
  addEventListener('hashchange', () => setTimeout(() => document.querySelector('#subnav a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 50));
}
