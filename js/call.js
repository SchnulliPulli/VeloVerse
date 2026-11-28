// Videoanrufe zwischen Freunden: direkt per WebRTC (Signal über Supabase Realtime), Weiterleitung über TURN, Jitsi als Ausweichlösung. Nur angemeldet, nach Zustimmung.
// Ablauf: Raumname (zufällig, nicht erratbar) geht als private Chat-Nachricht an den Freund (nur Freunde können sie lesen),
// über die Lobby-Verbindung nur ein „es klingelt“ ohne Raum. Das Anruffenster bleibt über Seitenwechsel und während der Fahrt offen.
import { $, esc, toast, dialog, bus } from './util.js';
import { profile, sel } from './state.js';
import * as O from './online/client.js';

export const CALL_TERMS = 4;
// Verbindungshelfer (STUN): verraten den Geräten ihre öffentliche Adresse, damit sie sich direkt erreichen. Kein Bild/Ton läuft darüber.
const ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.nextcloud.com:443'] }];
// Weiterleitung (TURN, Cloudflare), wenn keine direkte Verbindung möglich ist (Gast-WLAN, Mobilfunk, strenge Router).
// Kurzlebige Zugangsdaten holt die Supabase-Funktion „turn“, nur für Teilnehmer dieses Anrufs. Fehlt sie: nur STUN.
async function iceFor(room) {
  try {
    const sb = await O.client();
    const r = await Promise.race([sb.functions.invoke('turn', { body: { room } }), new Promise(res => setTimeout(() => res(null), 5000))]);
    const list = r && !r.error && Array.isArray(r.data?.iceServers) ? r.data.iceServers.filter(x => x && x.urls) : [];
    return list.length ? [...ICE, ...list] : ICE;
  } catch (e) { return ICE; }
}
const JITSI = 'meet.ffmuc.net'; // Ausweichlösung im eigenen Fenster
const MARK = /^\[\[call:(IndooRado-[A-Za-z0-9]{24})\]\]$/;
export const callRoom = body => (MARK.exec(body || '') || [])[1] || null;
// Anrufverlauf (Tabelle calls): laufend = noch nicht beendet und in der letzten Minute aktiv bzw. frisch angerufen
// Dieses Gerät (ein Konto kann auf mehreren Geräten angemeldet sein: angenommen wird nur auf einem)
export const myDev = (() => { try { let d = localStorage.getItem('vvDev'); if (!d) { d = Math.random().toString(36).slice(2, 12); localStorage.setItem('vvDev', d); } return d; } catch (e) { return 'x' + Math.random().toString(36).slice(2, 10); } })();
export const callState = (room, ev) => O.client().then(async sb => { const r = await sb.rpc('call_state', { p_room: room, p_ev: ev, p_dev: myDev }); if (r.error && /function|schema cache/i.test(r.error.message)) return sb.rpc('call_state', { p_room: room, p_ev: ev }); return r; }).catch(() => { });
export async function callStates(rooms) {
  const m = new Map(); rooms = [...new Set(rooms.filter(Boolean))].slice(0, 100); if (!rooms.length) return m;
  try { const { data } = await (await O.client()).from('calls').select('*').in('room', rooms); for (const c of data || []) m.set(c.room, c); } catch (e) { }
  return m;
}
export function callInfo(c, msg, me) {
  const t = +new Date(msg.created_at), out = msg.sender === me, now = Date.now();
  if (!c) return { active: now - t < 60e3, text: (out ? 'Ausgehender' : 'Eingehender') + ' Anruf' }; // Verlauf fehlt (ältere Anrufe)
  const alive = c.alive_at ? +new Date(c.alive_at) : 0;
  const active = !c.ended_at && !c.declined && (now - alive < 75e3 || (!c.answered_at && now - t < 60e3));
  const dir = out ? 'Ausgehender Anruf' : 'Eingehender Anruf';
  if (active) return { active, text: c.answered_at ? '📹 Anruf läuft' : out ? '📹 Es klingelt …' : '📹 Anruf' };
  if (c.declined) return { active, text: `${dir} · abgelehnt` };
  if (!c.answered_at) return { active, text: out ? `${dir} · nicht angenommen` : `${dir} · verpasst`, missed: !out };
  const end = c.ended_at ? +new Date(c.ended_at) : alive, mins = Math.max(0, Math.round((end - +new Date(c.answered_at)) / 60e3));
  return { active, text: `${dir} · ${mins < 1 ? 'unter 1 min' : mins + ' min'}` };
}
export const call = { room: null, peer: null, win: null, pc: null, ch: null, local: null, peers: new Map() };
const rand = n => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', u = crypto.getRandomValues(new Uint8Array(n)); return [...u].map(x => a[x % a.length]).join(''); };

async function allowed() {
  if (!O.loggedIn() || !O.access().ok) { toast('Videoanrufe gibt es nur mit Anmeldung'); return false; }
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') { toast('Dieser Browser kann keine Videoanrufe'); return false; }
  const { consent } = await import('./consent.js');
  return consent('call', CALL_TERMS, { title: 'Videoanrufe', html: `
    <p>Bild und Ton gehen <b>direkt und verschlüsselt</b> von deinem Gerät zu deinem Freund (WebRTC, Ende-zu-Ende). Kein Server zeichnet etwas auf, auch IndooRado nicht.</p>
    <p>Für den Verbindungsaufbau tauschen eure Geräte über IndooRado Online (Supabase) kurz technische Verbindungsdaten aus. Dabei sieht dein Gesprächspartner – wie bei jedem direkten Anruf – deine <b>IP-Adresse</b>. Zum Finden der Verbindung werden die STUN-Server von Cloudflare und Nextcloud angefragt (sie sehen ebenfalls nur die IP-Adresse).</p>
    <p>Klappt keine direkte Verbindung (z. B. Gast-WLAN, Mobilfunk), wird der Anruf über einen <b>Weiterleitungsserver (TURN) von Cloudflare</b> geleitet. Bild und Ton bleiben dabei Ende-zu-Ende-verschlüsselt – Cloudflare kann sie nicht ansehen oder anhören, sieht aber IP-Adressen und Datenmenge.</p>
    <p>Gespeichert wird nur die Einladung als private Chat-Nachricht zwischen euch beiden (Raumname, Zeitpunkt), gelöscht nach 12 Monaten. Kamera und Mikrofon fragt dein Browser jeweils ab.</p>
    <p><b>Gruppenanrufe</b> (bis zu 4 Personen): Jeder Teilnehmer kann eigene Freunde dazuholen. Dann verbinden sich alle Geräte direkt miteinander – auch Personen, mit denen du selbst nicht befreundet bist, sehen dabei deine IP-Adresse, deinen Anzeigenamen und Bild/Ton.</p>
    <p class="small muted">Bitte nur Freunde anrufen, die das möchten, und keine Gespräche ohne Einverständnis aufnehmen.</p>` });
}
// Was teile ich? Bild und Ton, nur Ton oder nur Bild (der Browser fragt nur das jeweils Nötige ab)
const MODES = { av: '📹 Bild und Ton', audio: '🎙️ Nur Ton', video: '📷 Nur Bild' };
const MODE_INFO = { av: ['📹', 'Video', 'Kamera und Mikrofon'], audio: ['🎙️', 'Nur Ton', 'Mikrofon, ohne Kamera'], video: ['📷', 'Nur Bild', 'Kamera, ohne Mikrofon'] };
// Auswahl vor dem Anruf: große Kacheln, die zuletzt gewählte Art ist vorausgewählt
export function pickMode(title, peer) {
  return new Promise(async res => {
    const last = MODES[profile.callMode] ? profile.callMode : 'av';
    let av = ''; try { if (peer?.avatar) av = (await import('./components.js')).avatarSvg(peer.avatar, 56); } catch (e) { }
    const w = document.createElement('div'); w.className = 'modal on';
    w.innerHTML = `<div class="card dlg callpick" role="dialog" aria-modal="true" aria-labelledby="cpT">
      <div class="cphead">${av ? `<div class="cpav">${av}</div>` : '<div class="cpav cpico">📞</div>'}<div><h2 id="cpT">${esc(title)}</h2><p class="small muted">Wie möchtest du sprechen?</p></div></div>
      <div class="cpmodes" role="radiogroup">${Object.entries(MODE_INFO).map(([k, [i, l, d]]) => `<button class="cpmode ${k === last ? 'on' : ''}" role="radio" aria-checked="${k === last}" data-m="${k}"><span class="cpi" aria-hidden="true">${i}</span><b>${l}</b><small>${d}</small>${k === last ? '<em>zuletzt</em>' : ''}</button>`).join('')}</div>
      <p class="small muted cpnote">Mikrofon und Kamera lassen sich im Gespräch jederzeit stummschalten. Verbindung direkt und Ende-zu-Ende-verschlüsselt.</p>
      <div class="row end"><button class="btn ghost" data-c>Abbrechen</button><button class="btn pri cpgo" data-go>📞 Anrufen</button></div></div>`;
    document.body.appendChild(w);
    let cur = last; const go = w.querySelector('[data-go]');
    if (/annehmen/i.test(title)) go.textContent = '📞 Annehmen';
    const pick = k => { cur = k; w.querySelectorAll('.cpmode').forEach(b => { const on = b.dataset.m === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); };
    const done = v => { w.remove(); document.removeEventListener('keydown', key, true); if (v) { profile.callMode = v; import('./state.js').then(m => m.saveProfile()).catch(() => { }); } res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } else if (e.key === 'Enter' && !e.target.closest('[data-c]')) { e.preventDefault(); e.stopPropagation(); done(cur); } else if (/Arrow(Left|Right|Up|Down)/.test(e.key)) { const ks = Object.keys(MODE_INFO), i = ks.indexOf(cur); pick(ks[(i + (/Right|Down/.test(e.key) ? 1 : ks.length - 1)) % ks.length]); w.querySelector('.cpmode.on').focus(); e.preventDefault(); } };
    document.addEventListener('keydown', key, true);
    w.addEventListener('click', e => { const m = e.target.closest('[data-m]'); if (m) { pick(m.dataset.m); if (e.detail === 2) done(cur); return; } if (e.target.closest('[data-go]')) done(cur); else if (e.target.closest('[data-c]') || e.target === w) done(null); });
    go.focus();
  });
}
// Anrufen: Raum anlegen, Einladung als private Nachricht, Klingeln an alle Geräte des Freundes
// Ist dieses Konto auch in dieser App (auf diesem Gerät) angemeldet? Dann klingelt es nur bei sich selbst – kein Anruf
export const sameApp = id => !!id && id !== O.online.user?.id && O.accounts().some(a => a.uid === id);
export async function startCall(friend) {
  if (sameApp(friend.id)) return toast('📵 Dieses Konto ist auch in dieser App angemeldet – Anrufe an eigene Konten auf demselben Gerät sind nicht möglich. Nachrichten gehen.', 5000);
  if (!(await allowed())) return;
  const mode = await pickMode(`${friend.display_name || friend.name} anrufen`, friend); if (!mode) return;
  const sb = await O.client();
  // Raum vom Server: nur unter Freunden, kryptografisch zufällig, Kanal danach nur für euch beide
  const cr = await sb.rpc('call_create', { p_friend: friend.id }); if (cr.error) return toast(/Anrufe nicht erlaubt/.test(cr.error.message) ? `📵 ${friend.name || friend.display_name || 'Dein Freund'} nimmt gerade keine Anrufe an` : 'Anruf nicht möglich: ' + (/function|schema cache/i.test(cr.error.message) ? 'Datenbankschema erneut ausführen' : cr.error.message));
  const room = cr.data;
  const { error } = await sb.from('chat_messages').insert({ recipient: friend.id, body: `[[call:${room}]]` });
  if (!error) import('./push.js').then(P => P.pushTo(friend.id, 'call', room)).catch(() => { });
  if (error) return toast('Anruf nicht möglich: ' + (/row-level/i.test(error.message) ? 'ihr seid nicht (mehr) befreundet oder zu viele Nachrichten' : error.message));
  const PR = await import('./online/presence.js'); const n = await PR.callSignal(friend.id, 'call');
  openWindow(room, { id: friend.id, name: friend.display_name || friend.name }, mode); call.isCaller = true;
  // Keine Antwort nach 45 s: auflegen, der Freund bekommt „Verpasster Anruf“
  // Abgelehnt? (auch wenn das Live-Signal nicht ankommt, z. B. Ablehnen aus der Gerätemeldung)
  const decT = setInterval(async () => { if (call.room !== room) return clearInterval(decT); const st = (await callStates([room])).get(room); if (st?.answered_at) return clearInterval(decT); if (st?.declined) { clearInterval(decT); toast(`📵 ${friend.display_name || friend.name} hat abgelehnt`, 4000); call.isCaller = false; hangUp(false); } }, 2500);
  setTimeout(async () => { if (call.room !== room) return; const st = (await callStates([room])).get(room); if (st && !st.answered_at && !st.ended_at) { toast(`📵 ${friend.display_name || friend.name} hat nicht abgenommen`, 4000); hangUp(); } }, 45e3);
  toast(n ? `📞 Es klingelt bei ${friend.display_name || friend.name} …` : `${friend.display_name || friend.name} ist gerade nicht online – die Einladung liegt im Chat`, 4000);
}
// Beitreten (aus dem Chat oder beim Klingeln)
export async function joinCall(room, peer) {
  if (!/^IndooRado-[A-Za-z0-9]{24}$/.test(room) || !(await allowed())) return;
  if (call.room === room) { call.win?.classList.add('flash'); setTimeout(() => call.win?.classList.remove('flash'), 800); return; } // läuft schon auf diesem Gerät
  // Schon auf einem anderen Gerät dieses Kontos angenommen? Dann fragen, ob der Anruf hierher geholt werden soll
  const st = (await callStates([room])).get(room), me = O.online.user?.id;
  if (st && (st.ended_at || st.declined)) return toast('Dieser Anruf ist schon vorbei', 3000);
  const other = st?.answered_at && st.answered_dev && st.answered_dev !== myDev && st.a !== me && Date.now() - +new Date(st.alive_at || st.answered_at) < 75e3;
  if (other) { if (!(await dialog({ title: '📱 Anruf läuft auf einem anderen Gerät', html: `<p class="muted">Du hast den Anruf mit ${esc(peer?.name || 'deinem Freund')} schon auf einem anderen Gerät angenommen. Soll er auf dieses Gerät wechseln? Das andere Gerät legt dann auf, das Gespräch läuft hier weiter.</p>`, buttons: [{ label: 'Abbrechen', value: 0 }, { label: 'Hierher holen', value: 1, cls: 'pri' }] }))) return; }
  const mode = await pickMode(`Anruf von ${peer?.name || 'Freund'} annehmen`, peer); if (mode) openWindow(room, peer, mode, other); }
export async function hangUp(notify = true, local = false) {
  const notifyIds = [...new Set([call.peer?.id, ...call.peers.keys()].filter(Boolean))];
  if (local) notify = false;
  if (call.room && !local && call.isCaller && call.peer?.id) { const room = call.room, to = call.peer.id; callStates([room]).then(m => { const st = m.get(room); if (st && !st.answered_at && !st.declined) import('./push.js').then(P => P.pushTo(to, 'missed', room)); }).catch(() => { }); }
  clearInterval(call.devT); if (call.room && !local) { clearInterval(call.aliveT); const others = [...call.peers.values()].some(P => P.pc?.connectionState === 'connected'); if (!others || call.peers.size <= 1) callState(call.room, 'end'); } // letzter im Anruf (bzw. Zweiergespräch): Anruf ist vorbei
  if (!local) try { call.ch?.send({ type: 'broadcast', event: 'sig', payload: { t: 'bye', from: O.online.user?.id, dev: myDev } }); } catch (e) { }
  else clearInterval(call.aliveT);
  for (const P of call.peers.values()) { try { P.pc.close(); } catch (e) { } }
  call.local?.getTracks().forEach(t => t.stop());
  try { if (call.ch) (await O.client()).removeChannel(call.ch); } catch (e) { }
  call.win?.remove(); call.peers.clear(); call.away = null; Object.assign(call, { win: null, room: null, peer: null, pc: null, ch: null, local: null, isCaller: false, maxPeers: 0 });
  // Klingeln beenden, falls noch niemand abgenommen hat
  if (notify) { try { const PR = await import('./online/presence.js'); for (const id of notifyIds) PR.callSignal(id, 'callend'); } catch (e) { } }
}

/* ---------- Anruffenster und Verbindungen (bis zu 4 Personen: jeder mit jedem, „Mesh“) ----------
   Signale laufen über den privaten Kanal call:<Raum> (nur Teilnehmer, siehe call_member). Jede Nachricht trägt
   from/to; jedes Paar handelt seine eigene WebRTC-Verbindung mit „perfekter Aushandlung“ aus. */
async function openWindow(room, peer, mode = 'av', take = false) {
  await hangUp(false); call.room = room; call.peer = peer; call.mode = mode;
  // Wurde der Anruf auf ein anderes Gerät dieses Kontos geholt? Dann hier still auflegen (Gespräch läuft dort weiter)
  const moved = () => { if (call.room !== room) return; hangUp(false, true); toast('📱 Anruf läuft jetzt auf deinem anderen Gerät', 4000); };
  call.devT = setInterval(async () => { if (call.room !== room) return clearInterval(call.devT); const st = (await callStates([room])).get(room); if (st?.answered_dev && st.answered_dev !== myDev && st.a !== O.online.user?.id && st.b === O.online.user?.id) moved(); }, 6000);
  call.moved = moved;
  import('./push.js').then(P => P.closeNotes('call-')).catch(() => { }); callState(room, take ? 'take' : 'join'); clearInterval(call.aliveT); call.aliveT = setInterval(() => call.room === room ? callState(room, 'alive') : clearInterval(call.aliveT), 30e3);
  let g = {}; try { g = JSON.parse(localStorage.getItem('vvCallWin') || '{}'); } catch (e) { }
  const w = document.createElement('div'); w.className = 'callwin'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'Videoanruf');
  Object.assign(w.style, { width: (g.w || 340) + 'px', height: (g.h || 260) + 'px', left: (g.x ?? Math.max(8, innerWidth - (g.w || 340) - 16)) + 'px', top: (g.y ?? 80) + 'px' });
  w.innerHTML = `<div class="cwhead"><span class="cwt">📹 <span class="cwnames">${esc(peer?.name || 'Anruf')}</span> <small class="cwst">verbinde …</small></span><span class="row"><button class="btn xs ghost" data-cw="add" title="Freund dazuholen (bis zu 4 Personen)">➕</button><button class="btn xs ghost" data-cw="lobby" title="Zur Gruppenfahrt einladen">👥</button><button class="btn xs ghost" data-cw="jitsi" title="Klappt die direkte Verbindung nicht: über Jitsi in neuem Fenster">↗</button><button class="btn xs danger" data-cw="end" title="Auflegen">✕</button></span></div>
    <div class="cwsas" hidden title="Sicherheitscode: Seht ihr beide dieselbe Zahl, ist die Verbindung Ende-zu-Ende verschlüsselt und niemand sitzt dazwischen – auch kein Server."></div>
    <div class="cwbody"><div class="cwgrid"></div><video class="cwlocal" autoplay playsinline muted></video><div class="cwwait">Warte auf ${esc(peer?.name || 'deinen Freund')} …</div>
    <div class="cwctl">${mode !== 'video' ? '<button class="btn xs" data-cw="mic" title="Mikrofon an/aus">🎙️</button>' : ''}${mode !== 'audio' ? '<button class="btn xs" data-cw="cam" title="Kamera an/aus">📷</button>' : ''}</div></div>`;
  document.body.appendChild(w); call.win = w;
  const st = t => { const e = w.querySelector('.cwst'); if (e) e.textContent = t; };
  // Verschieben am Kopf, Größe über die Ecke (CSS resize); Lage merken
  const head = w.querySelector('.cwhead'); let drag = null;
  const keep = () => { const r = w.getBoundingClientRect(); try { localStorage.setItem('vvCallWin', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })); } catch (e) { } };
  head.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = w.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; head.setPointerCapture(e.pointerId); w.classList.add('drag'); });
  head.addEventListener('pointermove', e => { if (!drag) return; w.style.left = Math.min(innerWidth - 60, Math.max(-w.offsetWidth + 80, e.clientX - drag.dx)) + 'px'; w.style.top = Math.min(innerHeight - 40, Math.max(0, e.clientY - drag.dy)) + 'px'; });
  head.addEventListener('pointerup', () => { drag = null; w.classList.remove('drag'); keep(); });
  new ResizeObserver(() => keep()).observe(w);
  w.addEventListener('click', async e => {
    const b = e.target.closest('[data-cw]'); if (!b) return;
    if (b.dataset.cw === 'end') return hangUp();
    if (b.dataset.cw === 'jitsi') { window.open(`https://${JITSI}/${encodeURIComponent(room)}`, '_blank', 'noopener'); return; }
    if (b.dataset.cw === 'lobby') return inviteToLobby();
    if (b.dataset.cw === 'add') return addToCall();
    if (b.dataset.cw === 'mic' || b.dataset.cw === 'cam') { const tr = call.local?.getTracks().filter(t => t.kind === (b.dataset.cw === 'mic' ? 'audio' : 'video')) || []; tr.forEach(t => t.enabled = !t.enabled); b.classList.toggle('off', tr.length && !tr[0].enabled); }
  });
  // Kamera und Mikrofon
  const want = { audio: mode !== 'video' ? { echoCancellation: true, noiseSuppression: true } : false, video: mode !== 'audio' ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false };
  try { call.local = await navigator.mediaDevices.getUserMedia(want); }
  catch (e) { toast(`Kein Zugriff auf ${mode === 'audio' ? 'das Mikrofon' : mode === 'video' ? 'die Kamera' : 'Kamera/Mikrofon'}: ${e.message}`, 5000); return hangUp(false); }
  if (call.room !== room) return;
  if (mode === 'audio') w.querySelector('.cwlocal').remove(); else w.querySelector('.cwlocal').srcObject = call.local;
  const iceServers = await iceFor(room); if (call.room !== room) return;
  // Test: localStorage.vvRelay = '1' erzwingt die Weiterleitung (prüft, ob TURN eingerichtet ist)
  let relayOnly = false; try { relayOnly = localStorage.getItem('vvRelay') === '1' && iceServers.some(x => /^turns?:/.test([].concat(x.urls)[0] || '')); } catch (e) { }
  const me = O.online.user.id, myName = O.online.profile?.display_name || profile.name || 'Fahrer';
  const sb = await O.client(); await O.realtimeAuth().catch(() => { });
  const ch = call.ch = sb.channel('call:' + room, { config: { private: true, broadcast: { self: false } } });
  const send = (to, payload) => ch.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: me, to, dev: myDev } });
  const grid = w.querySelector('.cwgrid');
  const names = () => { const n = [...call.peers.values()].map(P => P.name); w.querySelector('.cwnames').textContent = n.length ? n.join(', ') : (peer?.name || 'Anruf'); w.classList.toggle('group', call.peers.size > 1); grid.dataset.n = call.peers.size; };
  const bitrate = () => { const k = call.peers.size > 1 ? 400000 : 600000; for (const P of call.peers.values()) if (!P.relay) capVideo(P.pc, k); }; // mehr Teilnehmer = je Verbindung weniger
  const status = () => {
    const L = [...call.peers.values()], on = L.filter(P => P.pc.connectionState === 'connected');
    if (!L.length) { st('verbinde …'); return; }
    if (!on.length) { st(L.some(P => P.pc.connectionState === 'failed') ? 'keine direkte Verbindung' : L.some(P => P.pc.connectionState === 'disconnected') ? 'Verbindung wackelt …' : 'verbinde …'); return; }
    st(L.length > 1 ? `${on.length + 1} von ${L.length + 1} verbunden` : on[0].relay ? 'verbunden · über Weiterleitung' : on[0].relay === false ? 'verbunden · direkt' : 'verbunden');
  };
  // Eine Verbindung je Gegenüber
  const mk = (uid, name) => {
    if (call.peers.has(uid)) { const P = call.peers.get(uid); if (name) { P.name = name; P.tile.querySelector('.cwname').textContent = name; names(); } return P; }
    if (call.peers.size >= 3) return null; // höchstens 4 Personen
    const pc = new RTCPeerConnection({ iceServers, ...(relayOnly ? { iceTransportPolicy: 'relay' } : {}) });
    const tile = document.createElement('div'); tile.className = 'cwtile'; tile.innerHTML = `<video autoplay playsinline></video><span class="cwname">${esc(name || 'Freund')}</span><span class="cwtsas" hidden></span>`;
    grid.appendChild(tile); w.querySelector('.cwwait')?.remove();
    const P = { uid, name: name || 'Freund', pc, tile, polite: me > uid, makingOffer: false, ignoreOffer: false, started: false, relay: null, restartT: null };
    call.peers.set(uid, P); call.maxPeers = Math.max(call.maxPeers || 0, call.peers.size); if (!call.pc) call.pc = pc; names();
    P.start = () => { if (P.started) return; P.started = true; for (const t of call.local.getTracks()) { const snd = pc.addTrack(t, call.local); if (t.kind === 'video') { try { const pr = snd.getParameters(); pr.encodings = pr.encodings?.length ? pr.encodings : [{}]; pr.encodings[0].maxBitrate = 600000; pr.degradationPreference = 'balanced'; snd.setParameters(pr).catch(() => { }); } catch (e) { } } } bitrate(); };
    pc.onnegotiationneeded = async () => { try { P.makingOffer = true; await pc.setLocalDescription(); send(uid, { desc: pc.localDescription.toJSON() }); } catch (e) { console.warn('Anruf', e); } finally { P.makingOffer = false; } };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send(uid, { cand: candidate.toJSON() }); };
    pc.ontrack = ({ streams, track }) => {
      const s = streams[0] || new MediaStream([track]), v = tile.querySelector('video');
      const upd = () => { if (v.srcObject !== s) v.srcObject = s; const hasV = s.getVideoTracks().length > 0; tile.classList.toggle('audio', !hasV); };
      upd(); s.onaddtrack = upd;
    };
    // Netz gewechselt oder kurz weg: ICE neu aushandeln statt aufzugeben (nur eine Seite stößt an)
    const restart = () => { if (call.peers.get(uid) !== P || P.polite) return; try { pc.restartIce(); } catch (e) { } };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState; clearTimeout(P.restartT);
      if (s === 'disconnected') P.restartT = setTimeout(restart, 4000); if (s === 'failed') restart();
      if (s === 'connected') {
        setTimeout(() => route(pc).then(r => { if (!r || call.peers.get(uid) !== P) return; P.relay = r.relay; if (r.relay) capVideo(pc, 300000); status(); }), 600);
        sas(pc).then(c => { if (!c) return; const e = tile.querySelector('.cwtsas'); e.hidden = false; e.textContent = '🔒 ' + c; e.title = `Sicherheitscode mit ${P.name}: sieht ${P.name} dieselbe Zahl?`;
          if (call.peers.size === 1) { const top = w.querySelector('.cwsas'); top.hidden = false; top.innerHTML = `🔒 Sicherheitscode <b class="num">${c}</b> <span class="small">– sieht ${esc(P.name)} dieselbe Zahl?</span>`; } else w.querySelector('.cwsas').hidden = true; });
      }
      status();
      if (s === 'failed' && call.peers.size === 1) toast('Keine Verbindung möglich (strenges Netzwerk). Tipp: ↗ öffnet den Anruf über Jitsi in einem neuen Fenster.', 7000);
    };
    return P;
  };
  const drop = (uid, why) => {
    const P = call.peers.get(uid); if (!P) return; try { P.pc.close(); } catch (e) { } P.tile.remove(); call.peers.delete(uid);
    if (call.pc === P.pc) call.pc = [...call.peers.values()][0]?.pc || null; names(); bitrate(); status();
    if (why) hangToast(why);
    if (!call.peers.size) setTimeout(() => { if (call.room === room && !call.peers.size) { if (call.maxPeers > 1) hangToast('📴 Alle haben aufgelegt'); hangUp(false); } }, 1500); // Zweiergespräch: „… hat aufgelegt“ reicht
  };
  call.dropPeer = drop; call.sendAll = payload => send(null, payload);
  call.resume = () => { for (const P of call.peers.values()) if (!P.polite && P.pc.connectionState !== 'connected') { try { P.pc.restartIce(); } catch (e) { } } };
  ch.on('broadcast', { event: 'sig' }, async ({ payload: m }) => {
    if (m?.t === 'take' && m.from === me && m.dev !== myDev && call.room === room) return moved(); // eigenes anderes Gerät übernimmt
    if (!m?.from || m.from === me || call.room !== room) return;
    if (m.to && m.to !== me) return; // gilt einem anderen Teilnehmer
    // Gegenüber hat den Anruf auf ein anderes Gerät geholt: alte Verbindung ersetzen, Signale des alten Geräts nicht mehr beachten
    { const P0 = call.peers.get(m.from); if (P0 && m.dev && P0.dev && m.dev !== P0.dev) { if (m.t === 'hello' && !m.reply) { try { P0.pc.close(); } catch (e) { } P0.tile.remove(); call.peers.delete(m.from); } else return; } }
    try {
      if (m.t === 'hello') { const P = mk(m.from, m.name); if (!P) { send(m.from, { t: 'full' }); return; } if (m.dev) P.dev = m.dev; if (!m.reply) send(m.from, { t: 'hello', reply: true, name: myName }); if (!P.polite) P.start(); return; } // nur eine Seite je Paar beginnt, die andere antwortet (keine Kollision)
      if (m.t === 'bye') return drop(m.from, `📴 ${call.peers.get(m.from)?.name || 'Jemand'} hat aufgelegt`);
      if (m.t === 'full') { toast('Der Anruf ist voll (höchstens 4 Personen)'); return; }
      if (m.t === 'away' || m.t === 'back') { const P = call.peers.get(m.from); P?.tile.classList.toggle('away', m.t === 'away'); return; }
      const P = call.peers.get(m.from) || mk(m.from, m.name); if (!P) return; if (m.dev && !P.dev) P.dev = m.dev;
      // Signale je Gegenüber streng nacheinander verarbeiten (sonst kann ein Kandidat vor seiner Beschreibung ankommen)
      P.q = (P.q || Promise.resolve()).then(async () => {
        if (m.desc) {
          const collision = m.desc.type === 'offer' && (P.makingOffer || P.pc.signalingState !== 'stable');
          P.ignoreOffer = !P.polite && collision; if (P.ignoreOffer) return;
          await P.pc.setRemoteDescription(m.desc);
          if (m.desc.type === 'offer') { P.start(); await P.pc.setLocalDescription(); send(m.from, { desc: P.pc.localDescription.toJSON() }); }
        } else if (m.cand) { try { await P.pc.addIceCandidate(m.cand); } catch (e) { if (!P.ignoreOffer) console.warn('Kandidat', e.message); } }
      }).catch(e => console.warn('Anruf-Signal', e));
    } catch (e) { console.warn('Anruf-Signal', e); }
  });
  ch.subscribe(stt => { if (stt === 'SUBSCRIBED') { if (take) send(null, { t: 'take' }); send(null, { t: 'hello', name: myName }); } else if (stt === 'CHANNEL_ERROR' || stt === 'TIMED_OUT') st('Signal gestört – Datenbankschema aktuell?'); });
}
// Freund dazuholen: Teilnehmer in der Datenbank eintragen, Einladung in seinen Chat, Klingeln
async function addToCall() {
  if (!call.room) return;
  if (call.peers.size >= 3) return toast('Höchstens 4 Personen pro Anruf');
  const sb = await O.client(), { data, error } = await sb.rpc('friend_list');
  if (error) return toast(error.message, 4000);
  const inCall = new Set([...call.peers.keys(), call.peer?.id]), list = (data || []).filter(f => f.status === 'accepted' && !inCall.has(f.id) && !sameApp(f.id)); // eigene Konten in dieser App nicht
  if (!list.length) return toast('Keine weiteren Freunde zum Dazuholen');
  const PR = await import('./online/presence.js');
  const v = await dialog({ title: '➕ Freund dazuholen', html: `<p class="small muted">Bis zu 4 Personen. Bei mehreren Teilnehmern geht jede Verbindung direkt von Gerät zu Gerät, das braucht etwas mehr Upload.</p><div class="addlist">${list.map(f => `<label class="switch"><input type="radio" name="addf" value="${esc(f.id)}"><span></span> <div class="swt">${esc(f.display_name)}${PR.sidsOf(f.id).length ? ' <small class="muted">● online</small>' : ''}</div></label>`).join('')}</div>`, buttons: [{ label: 'Abbrechen', value: null }, { label: 'Anrufen', value: 'ok', cls: 'pri' }] });
  const id = window.__addPick; window.__addPick = null; if (v !== 'ok' || !id) return;
  const f = list.find(x => x.id === id); if (!f) return;
  const r = await sb.rpc('call_add', { p_room: call.room, p_friend: f.id }); if (r.error) return toast(/function|schema cache/i.test(r.error.message) ? 'Gruppenanrufe fehlen in der Datenbank: schema.sql neu ausführen' : r.error.message, 6000);
  const ins = await sb.from('chat_messages').insert({ recipient: f.id, body: `[[call:${call.room}]]` }); if (ins.error) return toast(ins.error.message, 4000); import('./push.js').then(P => P.pushTo(f.id, 'call', call.room)).catch(() => { });
  const n = await PR.callSignal(f.id, 'call');
  toast(n ? `📞 Es klingelt bei ${f.display_name} …` : `${f.display_name} ist gerade nicht online – die Einladung liegt im Chat`, 4000);
}
document.addEventListener('change', e => { if (e.target.name === 'addf') window.__addPick = e.target.value; });
// Läuft die Verbindung direkt oder über den Weiterleitungsserver (TURN)?
async function route(pc) {
  try {
    const stats = await pc.getStats(); let pair = null;
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
    if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair ||= r; });
    if (!pair) return null;
    const l = stats.get(pair.localCandidateId), rm = stats.get(pair.remoteCandidateId);
    return { relay: l?.candidateType === 'relay' || rm?.candidateType === 'relay' };
  } catch (e) { return null; }
}
// Über die Weiterleitung weniger Datenrate (spart TURN-Kontingent)
function capVideo(pc, bps) { for (const snd of pc.getSenders()) if (snd.track?.kind === 'video') { try { const pr = snd.getParameters(); pr.encodings = pr.encodings?.length ? pr.encodings : [{}]; pr.encodings[0].maxBitrate = bps; snd.setParameters(pr).catch(() => { }); } catch (e) { } } }
// Sicherheitscode aus den Schlüssel-Fingerabdrücken beider Geräte (DTLS): gleich auf beiden Seiten, wenn niemand dazwischen sitzt
async function sas(pc) {
  try {
    const fp = sdp => (String(sdp).match(/a=fingerprint:sha-256 ([0-9A-F:]+)/i) || [])[1]?.toUpperCase();
    const a = fp(pc.localDescription?.sdp), b = fp(pc.remoteDescription?.sdp); if (!a || !b) return null;
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([a, b].sort().join('|'))));
    const n = ((h[0] << 16) | (h[1] << 8) | h[2]) % 1000000; return String(n).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
  } catch (e) { return null; }
}
// Während des Anrufs zur Gruppenfahrt einladen (legt bei Bedarf eine an: gewählte Strecke, Start in 3 Minuten)
async function inviteToLobby() {
  const ppl = call.peers.size ? [...call.peers.values()].map(P => ({ id: P.uid, name: P.name })) : call.peer?.id ? [call.peer] : []; if (!ppl.length) return;
  const p = { name: ppl.map(x => x.name).join(', ') };
  const PR = await import('./online/presence.js'), sids = ppl.flatMap(x => PR.sidsOf(x.id));
  if (!sids.length) return toast(`${p.name} ${ppl.length > 1 ? 'sind' : 'ist'} gerade nicht in IndooRado online`);
  if (!PR.inviteOffer()) {
    const { getRaw } = await import('./routes.js'), r = await getRaw(sel.routeId), kit = await (await import('./online/sharedroute.js')).kitOf(sel.routeId);
    PR.createLobby({ title: `Fahrt mit ${p.name}`, route: sel.routeId, routeName: r?.name || 'Strecke', minutes: 3, race: false, settings: {}, kit });
    await new Promise(f => setTimeout(f, 800));
  }
  try { for (const s of sids) await PR.invite(s); toast(`📨 ${p.name} zur Gruppenfahrt eingeladen – Start in der Lobby`); location.hash = '#/lobby'; } catch (e) { toast(e.message, 4000); }
}

// Klingeln und Auflegen vom Gegenüber
bus.on('callsignal', async s => {
  if (s.kind === 'callend') { document.querySelectorAll(`.callring[data-uid="${CSS.escape(s.uid || '')}"]`).forEach(x => x.remove()); import('./push.js').then(P => P.closeNotes('call-')).catch(() => { }); if (call.peers.has(s.uid)) call.dropPeer?.(s.uid, `📴 ${s.name} hat aufgelegt`); else if (call.peer?.id === s.uid && !call.peers.size) { hangToast(`📴 ${s.name} hat aufgelegt`); hangUp(false); } return; }
  if (call.room) return; // schon im Gespräch
  // Einladung aus dem privaten Chat holen (nur Freunde können sie schreiben); älter als 3 Minuten = verpasst
  const sb = await O.client(), me = O.online.user?.id; if (!me) return;
  const { data } = await sb.from('chat_messages').select('body,created_at').eq('sender', s.uid).eq('recipient', me).like('body', '[[call:%').order('created_at', { ascending: false }).limit(1);
  const room = callRoom(data?.[0]?.body); if (!room || Date.now() - new Date(data[0].created_at) > 180e3) return;
  { const st = (await callStates([room])).get(room); if (st && (st.ended_at || st.declined)) return; } // schon vorbei
  const { avatarSvg } = await import('./components.js');
  { const P = await import('./push.js');
    if (!(await P.appActive())) { if (!(await P.pushActive())) import('./comfort.js').then(C => C.notify(`📹 ${s.name} ruft an`, 'Videoanruf in IndooRado – zum Annehmen die App öffnen.', 'call-' + room, 'call')).catch(() => { }); return; } // mit Push kommt die Meldung schon vom Server
    setTimeout(() => P.closeNotes('call-' + room), 1500); } // gesperrt/Hintergrund: nur Gerätemeldung, kein Klingeln in der App. App ist offen: Klingel-Fenster reicht, Meldung in der Leiste schließen
  if (document.querySelector(`.callring[data-uid="${CSS.escape(s.uid)}"]`)) return; // klingelt schon (Live-Signal und Push gleichzeitig)
  const c = document.createElement('div'); c.className = 'invcard callring'; c.dataset.uid = s.uid; c.setAttribute('role', 'alertdialog');
  c.innerHTML = `<div class="row">${avatarSvg(s.look || {}, 40)}<div><b>📹 ${esc(s.name)} ruft an</b><div class="small muted">Videoanruf</div></div></div><div class="row end"><button class="btn sm ghost" data-no>📵 Ablehnen</button><button class="btn sm pri" data-ok>📞 Annehmen</button></div>`;
  document.body.appendChild(c); const t = setTimeout(() => c.remove(), 60e3);
  // Auf einem anderen Gerät dieses Kontos angenommen oder abgelehnt: hier nicht weiterklingeln
  const pollT = setInterval(async () => { if (!c.isConnected) return clearInterval(pollT); const st = (await callStates([room])).get(room); if (!st || !c.isConnected) return;
    if (st.answered_at || st.ended_at || st.declined) { clearInterval(pollT); c.remove(); import('./push.js').then(P => P.closeNotes('call-' + room)).catch(() => { }); if (st.answered_at && !st.ended_at) toast(`📱 Anruf mit ${s.name} auf einem anderen Gerät angenommen`, 4000); } }, 2000);
  const stopRing = ringTone(); const obs = new MutationObserver(() => { if (!c.isConnected) { stopRing(); obs.disconnect(); } }); obs.observe(document.body, { childList: true });
  c.onclick = async e => {
    if (e.target.closest('[data-no]')) { clearTimeout(t); c.remove(); callState(room, 'decline'); import('./push.js').then(P => P.closeNotes('call-' + room)).catch(() => { }); (await import('./online/presence.js')).callSignal(s.uid, 'callend'); return; }
    if (e.target.closest('[data-ok]')) { clearTimeout(t); c.remove(); joinCall(room, { id: s.uid, name: s.name }); }
  };
});
// Auflegen-Meldungen nur einmal (Signal über den Anrufkanal und über die Lobby kommen beide an)
let lastHang = 0;
function hangToast(t) { if (Date.now() - lastHang < 5000) return; lastHang = Date.now(); toast(t, 3000); }
// Klingeln in der offenen App: Ton wie ein Telefon (zwei Töne, Pause) und Vibration, bis angenommen, abgelehnt oder 45 s
export function ringTone() {
  let ac = null, stop = false; const until = Date.now() + 45e3;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume?.(); } catch (e) { }
  const tone = (f, t0, d) => { if (!ac) return; const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.18, t0 + .02); g.gain.setValueAtTime(.18, t0 + d - .05); g.gain.linearRampToValueAtTime(0, t0 + d); o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + d + .02); };
  const ring = () => {
    if (stop || Date.now() > until) return;
    if (ac) { const t = ac.currentTime + .02; for (let i = 0; i < 2; i++) { tone(880, t + i * .5, .38); tone(1175, t + i * .5, .38); } }
    try { navigator.vibrate?.([450, 200, 450]); } catch (e) { }
    setTimeout(ring, 2600);
  };
  ring();
  return () => { stop = true; try { navigator.vibrate?.(0); } catch (e) { } try { ac?.close(); } catch (e) { } };
}
// App verlassen (Handy gesperrt, andere App): Kamera und Mikrofon pausieren, die anderen sehen „pausiert“.
// Zurück in der App: alles wie vorher an, abgerissene Verbindungen werden neu ausgehandelt.
function callAway() {
  if (!call.room || !call.local || call.away) return;
  call.away = call.local.getTracks().map(t => [t, t.enabled]); call.local.getTracks().forEach(t => t.enabled = false);
  call.win?.querySelectorAll('.cwtile video').forEach(v => { v.muted = true; v.pause(); }); // auch die anderen nicht mehr hören
  call.win?.classList.add('paused'); try { call.sendAll?.({ t: 'away' }); } catch (e) { }
}
function callBack() {
  if (!call.room || !call.away) return;
  for (const [t, on] of call.away) t.enabled = on; call.away = null;
  call.win?.querySelectorAll('.cwtile video').forEach(v => { v.muted = false; v.play().catch(() => { }); });
  call.win?.classList.remove('paused'); try { call.sendAll?.({ t: 'back' }); } catch (e) { }
  setTimeout(() => call.resume?.(), 800);
}
document.addEventListener('visibilitychange', () => document.hidden ? callAway() : callBack());
addEventListener('pagehide', callAway);
addEventListener('pageshow', () => { if (!document.hidden) callBack(); });
// Abmelden beendet ein laufendes Gespräch
bus.on('online', () => { if (call.room && !O.loggedIn()) hangUp(false); });
