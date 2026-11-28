// Bedienkomfort: App installieren, Erinnerungen (Benachrichtigungen), Sprachsteuerung, Plan in den Kalender.
import { profile, saveProfile, progress } from './state.js';
import { bus, toast, dialog, esc, download } from './util.js';

/* ---------- App installieren (Startbildschirm) ---------- */
let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; bus.emit('installable'); });
addEventListener('appinstalled', () => { deferred = null; toast('📲 IndooRado ist installiert'); });
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !isStandalone() && (!!deferred || isIos());
export async function install() {
  if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; return r?.outcome === 'accepted'; }
  if (isIos()) { await dialog({ title: '📲 Zum Home-Bildschirm', html: '<p>In Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil) tippen, dann <b>„Zum Home-Bildschirm“</b>. IndooRado startet danach wie eine App – im Vollbild, ohne Adressleiste.</p>', buttons: [{ label: 'OK', value: true, cls: 'pri' }] }); return false; }
  toast('Im Browser-Menü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen'); return false;
}

/* ---------- Erinnerungen ----------
   Benachrichtigungen des Geräts, solange IndooRado geöffnet ist (auch im Hintergrund). Echte Push-Nachrichten bei
   geschlossener App bräuchten einen eigenen Server-Dienst und sind hier bewusst nicht eingebaut. */
const today = () => new Date().toISOString().slice(0, 10);
// Arten von Benachrichtigungen, einzeln an- und abwählbar (profile.notif[k] === false = aus)
export const NOTIF = [
  ['plan', '🚴 Training des Tages', 'zur eingestellten Uhrzeit, wenn du heute noch nicht gefahren bist'],
  ['streak', '🔥 Serie in Gefahr', 'um 20:30, wenn deine Serie heute endet'],
  ['missions', '🎯 Wochenmissionen', 'Sonntag um 18:00, wenn noch Missionen offen sind'],
  ['friend', '👥 Freund fährt gerade', 'wenn ein Freund eine Fahrt startet (nur angemeldet)'],
  ['msg', '💬 Nachrichten und Freundschaftsanfragen', 'neue Nachricht oder Anfrage (nur angemeldet)'],
  ['call', '📹 Eingehender Anruf', 'wenn dich ein Freund anruft (nur angemeldet)'],
  ['friendreq', '👋 Freundschaftsanfragen', 'wenn dir jemand eine Anfrage schickt (nur angemeldet)'],
  ['invite', '🚴 Einladungen zu Gruppenfahrten', 'wenn dich ein Freund zu einer Gruppenfahrt oder zum Mitfahren einlädt'],
];
export const notifOn = k => profile.reminders === true && profile.notif?.[k] !== false;
export function setNotif(k, on) { profile.notif = { ...(profile.notif || {}), [k]: !!on }; saveProfile(); scheduleReminders(); }
export async function notify(title, body, tag, kind) {
  if ((kind && !notifOn(kind)) || profile.reminders !== true || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (tag !== 'test' && await (await import('./push.js')).appActive()) { toast(`${title} – ${body}`, 6000); import('./notilog.js').then(N => N.addNote({ icon: '🔔', title, body })).catch(() => { }); return true; } // App aktiv: nur in der App
  import('./notilog.js').then(N => N.addNote({ icon: '🔔', title, body })).catch(() => { });
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' }); else new Notification(title, { body, tag }); return true; } catch (e) { return false; }
}
export const testNotify = () => notify('🔔 IndooRado', 'So sehen Benachrichtigungen aus.', 'test');
// Beim ersten Öffnen (nach der Einrichtung) einmal fragen, ob Benachrichtigungen an sollen. „Später“ fragt nach 3 Tagen erneut.
export async function askNotifications() {
  if (typeof Notification === 'undefined' || profile.kid) return;
  const ls = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  if (Notification.permission === 'denied' || ls('vvNotifAsked') === 'done' || +ls('vvNotifLater') > Date.now()) return;
  if (Notification.permission === 'granted') { if (profile.reminders == null) { profile.reminders = true; saveProfile(); scheduleReminders(); } set('vvNotifAsked', 'done'); import('./push.js').then(m => m.refreshPush()).catch(() => { }); return; }
  const v = await dialog({ title: '🔔 Benachrichtigungen aktivieren?', html: `<p>IndooRado kann dich benachrichtigen:</p><ul class="tips"><li>💬 <b>Nachrichten und 📹 Anrufe</b> von Freunden – auch wenn die App geschlossen ist</li><li>🚴 ans <b>Training des Tages</b> und wenn deine <b>Serie</b> in Gefahr ist</li><li>👥 wenn ein Freund gerade fährt</li></ul><p class="small muted">Jede Art lässt sich später einzeln abwählen: Einstellungen › App &amp; Daten › Benachrichtigungen. Nachrichten und Anrufe bei geschlossener App brauchen ein Konto; der Hinweis (ohne Nachrichteninhalt) läuft verschlüsselt über den Push-Dienst deines Geräts.</p>`, buttons: [{ label: 'Später', value: false }, { label: '🔔 Aktivieren', value: true, cls: 'pri' }] });
  if (!v) { set('vvNotifLater', String(Date.now() + 3 * 864e5)); return; }
  set('vvNotifAsked', 'done');
  if (await enableReminders(true)) { toast('🔔 Benachrichtigungen an'); import('./push.js').then(m => m.refreshPush()).catch(() => { }); }
}
export async function enableReminders(on) {
  if (on) {
    if (typeof Notification === 'undefined') { toast('Dieser Browser kann keine Benachrichtigungen'); return false; }
    const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Benachrichtigungen wurden nicht erlaubt (Browser-Einstellungen)', 5000); return false; }
  }
  profile.reminders = !!on; saveProfile(); scheduleReminders(); return true;
}
let tm = [];
export function scheduleReminders() {
  tm.forEach(clearTimeout); tm = []; if (profile.reminders !== true) return;
  const at = (hhmm, fn) => { const [h, m] = String(hhmm).split(':').map(Number), d = new Date(); d.setHours(h || 18, m || 0, 0, 0); const ms = d - Date.now(); if (ms > 0 && ms < 864e5) tm.push(setTimeout(fn, ms)); };
  const rodeToday = async () => { const { db } = await import('./db.js'); return (await db.all('rides')).some(r => r.date.slice(0, 10) === today()); };
  // Training des Tages (aktiver Plan) zur gewählten Uhrzeit
  at(profile.remindAt || '18:00', async () => {
    if (await rodeToday() || progress.lastRemind === today()) return; progress.lastRemind = today();
    const P = await import('./plans.js'), n = P.nextWorkout?.();
    notify('🚴 Zeit fürs Training', n ? `Heute steht „${n.name}“ an.` : 'Eine kurze Runde hält die Form – und deine Serie.', 'plan', 'plan');
  });
  // Wochenmissionen: Sonntag 18:00, wenn noch offen
  if (new Date().getDay() === 0) at('18:00', async () => {
    const G = await import('./game.js'), { db } = await import('./db.js'), open = G.missionState(await db.all('rides')).filter(m => !m.done);
    if (open.length) notify('🎯 Wochenmissionen', `Noch ${open.length} offen bis heute Nacht: ${open.map(m => m.text || m.name || '').filter(Boolean).slice(0, 2).join(', ')}`, 'missions', 'missions');
  });
  // Serie in Gefahr (20:30)
  at('20:30', async () => {
    const A = await import('./analysis.js'), { db } = await import('./db.js'), t = A.totals(await db.all('rides'));
    if (t.streak >= 2 && !(await rodeToday())) notify('🔥 Deine Serie endet heute', `${t.streak} Tage am Stück – schon 15 Minuten reichen, um sie zu halten.`, 'streak', 'streak');
  });
}
// Freund startet eine Fahrt (nur angemeldet, nur wenn die App gerade im Hintergrund ist)
let friends = null, riding = new Set();
bus.on('presence', async () => {
  if (!notifOn('friend') || !document.hidden) return;
  try {
    const PR = await import('./online/presence.js'), O = await import('./online/client.js'); if (!O.loggedIn()) return;
    if (!friends) { const { data } = await (await O.client()).rpc('friend_list'); friends = new Map((data || []).filter(f => f.status === 'accepted').map(f => [f.id, f.display_name])); }
    for (const p of PR.P.peers.values()) { const uid = p.uid, where = p.where; if (!uid || !friends.has(uid)) continue; if (where === 'ride' && !riding.has(uid)) { riding.add(uid); notify(`🚴 ${friends.get(uid)} fährt gerade`, `${p.routeName ? 'Auf ' + p.routeName + ' – ' : ''}fahr mit!`, 'friend-' + uid, 'friend'); } if (where !== 'ride') riding.delete(uid); }
  } catch (e) { }
});

/* ---------- Sprachsteuerung in der Fahrt ----------
   Spracherkennung des Browsers (Chrome/Edge/Safari). Achtung: Chrome schickt den Ton dafür an Google. */
const CMDS = [[/\b(pause|stopp|anhalten)\b/, 'pause'], [/\b(weiter|los)\b(?!.*intervall)/, 'pause'], [/schwerer|hoch(schalten)?|mehr/, 'up'], [/leichter|runter(schalten)?|weniger/, 'down'],
  [/n(ä|ae)chste[sr]? intervall|intervall weiter|überspringen/, 'next'], [/intervall zurück|vorherige[sr]? intervall/, 'prev'], [/foto|bild/, 'photo'], [/kamera|ansicht/, 'cam'], [/ride ?on|daumen/, 'rideon'], [/musik|n(ä|ae)chstes lied|lied/, 'music'], [/links/, 'left'], [/rechts/, 'right']];
// Befehle in den anderen Sprachen der App
const CMDS_L = {
  en: [[/\b(pause|stop|halt)\b/, 'pause'], [/\b(resume|go|continue)\b/, 'pause'], [/harder|shift up|more/, 'up'], [/easier|shift down|less/, 'down'], [/next interval|skip/, 'next'], [/previous interval|back interval/, 'prev'], [/photo|picture/, 'photo'], [/camera|view/, 'cam'], [/ride ?on|thumbs/, 'rideon'], [/music|next song|song/, 'music'], [/left/, 'left'], [/right/, 'right']],
  es: [[/\b(pausa|para|alto)\b/, 'pause'], [/\b(sigue|seguir|vamos)\b/, 'pause'], [/m(á|a)s duro|subir|m(á|a)s/, 'up'], [/m(á|a)s f(á|a)cil|bajar|menos/, 'down'], [/siguiente intervalo|saltar/, 'next'], [/intervalo anterior/, 'prev'], [/foto/, 'photo'], [/c(á|a)mara|vista/, 'cam'], [/ride ?on|pulgar/, 'rideon'], [/m(ú|u)sica|canci(ó|o)n/, 'music'], [/izquierda/, 'left'], [/derecha/, 'right']],
  fr: [[/\b(pause|stop|arr(ê|e)te)\b/, 'pause'], [/\b(reprendre|continue|go)\b/, 'pause'], [/plus dur|monter|plus/, 'up'], [/plus facile|descendre|moins/, 'down'], [/intervalle suivant|passer/, 'next'], [/intervalle pr(é|e)c(é|e)dent/, 'prev'], [/photo/, 'photo'], [/cam(é|e)ra|vue/, 'cam'], [/ride ?on|pouce/, 'rideon'], [/musique|chanson/, 'music'], [/gauche/, 'left'], [/droite/, 'right']],
  it: [[/\b(pausa|stop|ferma)\b/, 'pause'], [/\b(riprendi|vai|continua)\b/, 'pause'], [/pi(ù|u) duro|su|pi(ù|u)/, 'up'], [/pi(ù|u) facile|gi(ù|u)|meno/, 'down'], [/prossimo intervallo|salta/, 'next'], [/intervallo precedente/, 'prev'], [/foto/, 'photo'], [/telecamera|camera|vista/, 'cam'], [/ride ?on|pollice/, 'rideon'], [/musica|canzone/, 'music'], [/sinistra/, 'left'], [/destra/, 'right']],
  nl: [[/\b(pauze|stop)\b/, 'pause'], [/\b(verder|doorgaan|go)\b/, 'pause'], [/zwaarder|opschakelen|meer/, 'up'], [/lichter|terugschakelen|minder/, 'down'], [/volgend interval|overslaan/, 'next'], [/vorig interval/, 'prev'], [/foto/, 'photo'], [/camera|weergave/, 'cam'], [/ride ?on|duim/, 'rideon'], [/muziek|liedje/, 'music'], [/links/, 'left'], [/rechts/, 'right']],
};
let rec = null, listening = false;
export const voiceSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export async function toggleVoice(onCmd, flash) {
  if (listening) { listening = false; try { rec?.stop(); } catch (e) { } flash('🎙️ Sprachsteuerung aus', 1200); return false; }
  if (!voiceSupported()) { toast('Dieser Browser kann keine Sprachsteuerung (Chrome, Edge oder Safari nehmen)', 5000); return false; }
  const { consent } = await import('./consent.js');
  if (!(await consent('voice', 1, { title: '🎙️ Sprachsteuerung', html: '<p>Sag während der Fahrt z. B. <b>„Pause“</b>, <b>„schwerer“</b>, <b>„leichter“</b>, <b>„nächstes Intervall“</b>, <b>„Foto“</b>, <b>„Kamera“</b>, <b>„Ride On“</b>, <b>„Musik“</b>.</p><p class="small muted">Die Erkennung macht dein Browser. <b>Chrome und Edge schicken den Ton dafür an Google bzw. Microsoft</b>, Safari je nach Gerät an Apple. IndooRado speichert nichts. Abschalten mit demselben Knopf.</p>' }))) return false;
  // Befehle in der App-Sprache (Deutsch immer zusätzlich), Erkennung mit Ländercode
  const lg = (document.documentElement.lang || 'de').slice(0, 2), cmds = [...(CMDS_L[lg] || []), ...CMDS];
  const LOC = { de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL' };
  const R = window.SpeechRecognition || window.webkitSpeechRecognition; rec = new R(); rec.lang = LOC[lg] || 'de-DE'; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 3;
  let netErr = 0;
  rec.onresult = e => {
    const r = e.results[e.results.length - 1]; if (!r?.isFinal && r?.isFinal !== undefined) return;
    // alle Varianten der Erkennung prüfen (z. B. „schwerer“ wird manchmal als „schwere“ oder „Schweden“ verstanden)
    const alts = [...r].map(a => a.transcript.toLowerCase().trim()).filter(Boolean);
    for (const t of alts) { const c = cmds.find(([re]) => re.test(t)); if (c) { onCmd(c[1]); flash('🎙️ „' + t + '“', 1100); return; } }
    if (alts[0]) flash('🎙️ nicht verstanden: „' + alts[0] + '“', 1300);
  };
  rec.onend = () => { if (listening && !document.hidden) setTimeout(() => { if (listening) try { rec.start(); } catch (e) { } }, 250); }; // Chrome beendet die Erkennung immer wieder von selbst
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { listening = false; toast('Mikrofon nicht erlaubt – in den Website-Einstellungen des Browsers freigeben', 5000); bus.emit('voiceState', false); }
    else if (e.error === 'network' && ++netErr === 2) toast('Sprachsteuerung braucht Internet (der Browser erkennt die Sprache über seinen Online-Dienst)', 5000);
    else if (e.error === 'audio-capture') { listening = false; toast('Kein Mikrofon gefunden', 4000); bus.emit('voiceState', false); }
  };
  // Nach dem Zurückkehren in die App wieder zuhören
  document.addEventListener('visibilitychange', () => { if (listening && !document.hidden) try { rec.start(); } catch (e) { } });
  try { rec.start(); listening = true; flash('🎙️ Sprachsteuerung an – sag z. B. „schwerer“', 2200); } catch (e) { toast(e.message, 4000); }
  return listening;
}
export function stopVoice() { listening = false; try { rec?.stop(); } catch (e) { } }

/* ---------- Plan in den Kalender (.ics) ---------- */
const DAYS = { 2: [2, 6], 3: [2, 4, 6], 4: [2, 4, 6, 0], 5: [1, 2, 4, 6, 0], 6: [1, 2, 3, 4, 6, 0], 7: [1, 2, 3, 4, 5, 6, 0] };
export function planIcs(p, done = {}, time = profile.remindAt || '18:00') {
  const todo = p.all.filter(w => !done[w.id]), days = DAYS[Math.min(7, Math.max(2, p.perWeek))] || DAYS[4];
  const [hh, mm] = time.split(':').map(Number), out = [], d = new Date(); d.setHours(hh, mm, 0, 0); if (d < Date.now()) d.setDate(d.getDate() + 1);
  const pad = n => String(n).padStart(2, '0'), fmt = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  for (const w of todo) {
    while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1);
    const dur = w.segs.reduce((a, g) => a + g.dur, 0), e = new Date(+d + dur * 1000);
    out.push(['BEGIN:VEVENT', `UID:${w.id}@indoorado.de`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(d)}`, `DTEND:${fmt(e)}`, `SUMMARY:🚴 ${w.name}`, `DESCRIPTION:${(w.desc || '').replace(/[,;\\]/g, ' ').replace(/\n/g, ' ')} – ${location.origin}/`, 'END:VEVENT'].join('\r\n'));
    d.setDate(d.getDate() + 1);
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IndooRado//Trainingsplan//DE', `X-WR-CALNAME:IndooRado · ${p.name}`, ...out, 'END:VCALENDAR'].join('\r\n');
}
export function downloadPlanIcs(p, done) { download((p.name.replace(/[^\wäöüÄÖÜß -]+/g, '').trim() || 'plan') + '.ics', planIcs(p, done), 'text/calendar'); }

// Neue Nachrichten/Anfragen (Zähler aus der Kopfleiste), nur wenn die App gerade im Hintergrund ist
let lastMsgN = null;
bus.on('msgCount', async n => { if (n != null && lastMsgN != null && n > lastMsgN && document.hidden && !(await import('./push.js').then(P => P.pushActive()).catch(() => false))) notify('💬 IndooRado', n - lastMsgN === 1 ? 'Du hast eine neue Nachricht oder Freundschaftsanfrage.' : `${n - lastMsgN} neue Nachrichten oder Anfragen.`, 'msg', 'msg'); if (n != null) lastMsgN = n; });
