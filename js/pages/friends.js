// Freunde: suchen, Anfragen (gegenseitige Zustimmung), Profil mit Kennzahlen, einzelne Fahrten nur mit Erlaubnis, einfacher Chat.
// Keine Gesundheitsdaten (Puls, Gewicht, Alter) – die Datenbank gibt sie gar nicht heraus.
import { $, esc, toast, fmtKm, fmtDur, fmtDate, dialog, bus } from '../util.js';
import { avatarSvg } from '../components.js';
import * as O from '../online/client.js';
import { gate } from './online.js';

const miss = e => /function|relation|does not exist|schema cache/i.test(e?.message || '') ? 'Freunde und Chat fehlen in der Datenbank: Datenbankschema im SQL-Editor erneut ausführen.' : e?.message;
let timers = [], chatT = null;
export function leave() { timers.forEach(clearInterval); timers = []; clearInterval(chatT); document.querySelector('.frdlg')?.closest('.modal')?.remove(); }

export async function render(el, params = [], query = '') {
  leave();
  if (!(await gate(el))) return;
  const sb = await O.client(), me = O.online.user.id;
  el.innerHTML = `<section class="pagehead"><h1>👥 Freunde</h1><span class="small muted">Gegenseitig bestätigt · Profil und Chat nur unter Freunden</span></section>
  <section class="grid2">
    <div class="card"><h2>Freunde</h2><div id="frList"><div class="pageload"><div class="spinner"></div></div></div></div>
    <div class="card form"><h2>Freunde finden</h2>
      <div class="frcode"><div><div class="small muted">Dein Freundescode</div><b class="num" id="frMy">…</b></div><span class="row"><button class="btn sm" id="frCopy">📋 Kopieren</button><button class="btn sm ghost" id="frNew" title="Neuen Code erzeugen, der alte wird ungültig">↻</button></span></div>
      <div class="row frcodein"><input class="inp" id="frCode" placeholder="Code eines Freundes, z. B. K7QM-2XPA" maxlength="12" autocomplete="off"><button class="btn pri" id="frCodeGo">Anfragen</button></div>
      <p class="small muted">Am einfachsten: Code weitergeben (Messenger, persönlich). Oder in der Lobby bei „Wer ist online“ auf „➕ Freund“ tippen.</p>
      <h3 class="sub">Nach Namen suchen</h3><input class="inp" id="frQ" type="search" placeholder="Name (mind. 3 Buchstaben)" maxlength="40" autocomplete="off"><div id="frRes" class="frlist"></div>
      <p class="small muted">Die Suche findet nur Spieler, die „In der Suche auffindbar“ eingeschaltet haben.</p>
      <h3 class="sub">Privatsphäre</h3>
      <label class="switch"><input type="checkbox" id="frShare" ${O.online.profile?.share_rides ? 'checked' : ''}><span></span> <div class="swt">Freunde dürfen meine einzelnen Fahrten sehen<small class="muted">Datum, Strecke, Distanz, Dauer, Höhenmeter, Ø Watt. Ohne diese Erlaubnis sehen Freunde nur Level und Summen. Puls, Gewicht und Alter sieht nie jemand.</small></div></label>
      <label class="switch"><input type="checkbox" id="frFind" ${O.online.profile?.discoverable !== false ? 'checked' : ''}><span></span> <div class="swt">In der Suche auffindbar<small class="muted">Andere angemeldete Spieler finden dich über deinen Namen und sehen dabei Name, Avatar und Level. Standardmäßig an. Ausgeschaltet können dich Freunde trotzdem per Freundescode oder über die Online-Liste anfragen.</small></div></label>
      <label class="switch"><input type="checkbox" id="frCalls" ${O.online.profile?.allow_calls !== false ? 'checked' : ''}><span></span> <div class="swt">Freunde dürfen mich anrufen<small class="muted">Ausgeschaltet kann dich niemand per Video- oder Sprachanruf erreichen. Du selbst kannst weiter anrufen. Standardmäßig an.</small></div></label>
      <label class="switch"><input type="checkbox" id="frMsgs" ${O.online.profile?.allow_msgs !== false ? 'checked' : ''}><span></span> <div class="swt">Freunde dürfen mir Nachrichten schreiben<small class="muted">Ausgeschaltet kommen keine neuen Chat-Nachrichten mehr an; der bisherige Verlauf bleibt. Standardmäßig an.</small></div></label>
    </div>
  </section>`;
  let list = [];
  const row = (f, extra = '') => `<div class="frrow" data-id="${esc(f.id)}">${avatarSvg(f.avatar || {}, 38)}<div class="frn"><b>${esc(f.display_name)}</b>${f.club_tag ? ` <span class="cltag sm">${esc(f.club_tag)}</span>` : ''}<div class="small muted">Level ${f.level}${f.last_seen ? ' · zuletzt ' + fmtDate(f.last_seen) : ''}</div></div>${extra}</div>`;
  const draw = async () => {
    const { data, error } = await sb.rpc('friend_list'); if (!el.isConnected) return;
    if (error) { $('#frList', el).innerHTML = `<p class="muted">${esc(miss(error))}</p>`; return; }
    list = data; const inc = data.filter(f => f.status === 'pending' && f.incoming), out = data.filter(f => f.status === 'pending' && !f.incoming), fr = data.filter(f => f.status === 'accepted'), bl = data.filter(f => f.status === 'blocked');
    $('#frList', el).innerHTML = (inc.length ? `<h3 class="sub">📨 Anfragen an dich</h3><div class="frlist">${inc.map(f => row(f, `<span class="row"><button class="btn sm pri" data-acc="${f.id}">Annehmen</button><button class="btn sm ghost" data-dec="${f.id}">Ablehnen</button></span>`)).join('')}</div>` : '')
      + (fr.length ? `<div class="frlist">${fr.map(f => row(f, `${f.unread ? `<span class="badge">${f.unread}</span>` : ''}<button class="btn sm" data-open="${f.id}">${f.unread ? '💬 Lesen' : 'Profil & Chat'}</button>`)).join('')}</div>` : '<p class="muted small">Noch keine Freunde. Suche rechts nach Namen und schicke eine Anfrage – sobald sie angenommen ist, seht ihr eure Profile und könnt chatten.</p>')
      + (out.length ? `<h3 class="sub">⏳ Gesendete Anfragen</h3><div class="frlist">${out.map(f => row(f, `<button class="btn sm ghost" data-del="${f.id}">Zurückziehen</button>`)).join('')}</div>` : '')
      + (bl.length ? `<details class="small"><summary>🚫 Blockiert (${bl.length})</summary><div class="frlist">${bl.map(f => row(f, `<button class="btn sm ghost" data-del="${f.id}">Freigeben</button>`)).join('')}</div></details>` : '');
  };
  let qT = null;
  $('#frQ', el).oninput = e => { clearTimeout(qT); const q = e.target.value.trim(); if (q.length < 3) { $('#frRes', el).innerHTML = ''; return; }
    qT = setTimeout(async () => { const { data, error } = await sb.rpc('user_search', { p_q: q }); if (error) { $('#frRes', el).innerHTML = `<p class="muted small">${esc(miss(error))}</p>`; return; }
      $('#frRes', el).innerHTML = data.length ? data.map(u => row(u, { none: `<button class="btn sm pri" data-req="${u.id}">+ Anfrage</button>`, sent: '<span class="small muted">angefragt</span>', received: `<button class="btn sm pri" data-acc="${u.id}">Annehmen</button>`, friend: '<span class="small muted">✓ Freund</span>', blocked: '<span class="small muted">blockiert</span>' }[u.relation] || '')).join('') : '<p class="muted small">Niemand gefunden. Manche Spieler sind nicht auffindbar.</p>'; }, 350); };
  const act = async (fn, args, msg) => { const { error } = await sb.rpc(fn, args); if (error) { toast(miss(error)); return false; } if (msg) toast(msg); draw(); $('#frQ', el).dispatchEvent(new Event('input')); return true; };
  el.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.req) { const to = t.dataset.req; await act('friend_request', { p_to: to }, 'Anfrage gesendet'); import('../push.js').then(P => P.pushTo(to, 'friendreq')).catch(() => { }); return; }
    if (t.dataset.acc) return act('friend_respond', { p_other: t.dataset.acc, p_accept: true }, '🎉 Ihr seid jetzt Freunde');
    if (t.dataset.dec) return act('friend_respond', { p_other: t.dataset.dec, p_accept: false }, 'Abgelehnt');
    if (t.dataset.del) return act('friend_remove', { p_other: t.dataset.del }, 'Erledigt');
    if (t.dataset.open) return openFriend(sb, me, list.find(f => f.id === t.dataset.open), draw);
    if (t.id === 'frCopy') { const c = $('#frMy', el).textContent; try { await navigator.clipboard.writeText(c); toast('Code kopiert: ' + c); } catch (er) { toast('Dein Code: ' + c, 6000); } return; }
    if (t.id === 'frNew') { if (!(await dialog({ title: 'Neuen Freundescode erzeugen?', html: '<p class="muted">Der alte Code funktioniert dann nicht mehr. Bestehende Freundschaften bleiben.</p>', buttons: [{ label: 'Abbrechen', value: 0 }, { label: 'Neuer Code', value: 1, cls: 'pri' }] }))) return; loadCode(true); return; }
    if (t.id === 'frCodeGo') { const c = $('#frCode', el).value.trim(); if (c.replace(/[^a-z0-9]/gi, '').length !== 8) return toast('Der Code hat 8 Zeichen'); const { data, error } = await sb.rpc('friend_request_code', { p_code: c }); if (error) return toast(miss(error)); $('#frCode', el).value = ''; toast(data === 'friend' ? '🎉 Ihr seid jetzt Freunde' : 'Anfrage gesendet'); draw(); return; }
  };
  el.onchange = async e => {
    const k = { frShare: 'share_rides', frFind: 'discoverable', frCalls: 'allow_calls', frMsgs: 'allow_msgs' }[e.target.id]; if (!k) return;
    try { await O.updateProfile({ [k]: e.target.checked }); toast('Gespeichert', 900); } catch (er) { e.target.checked = !e.target.checked; toast(miss(er)); }
  };
  const loadCode = async (fresh = false) => { const { data, error } = await sb.rpc('my_friend_code', { p_new: fresh }); $('#frMy', el).textContent = error ? '–' : String(data).replace(/^(.{4})/, '$1-'); if (error) toast(miss(error)); };
  $('#frCode', el).onkeydown = e => { if (e.key === 'Enter') $('#frCodeGo', el).click(); };
  const openId = new URLSearchParams(query || '').get('open');
  loadCode(); draw().then(() => { const f = openId && list.find(x => x.id === openId && x.status === 'accepted'); if (f) openFriend(sb, me, f, draw); }); timers.push(setInterval(() => el.isConnected ? draw() : leave(), 30e3));
}

// Profil eines Freundes mit Chat
// Chat mit einem Freund von überall öffnen (Nachrichtencenter, Hinweis unten rechts, Push)
export async function openChatWith(id, { focus = true } = {}) {
  const ex = document.querySelector(`.frdlg[data-chat="${CSS.escape(id)}"]`); if (ex) { ex.querySelector('#chTxt')?.focus(); return; }
  document.querySelector('.frdlg')?.closest('.modal')?.remove();
  const sb = await O.client(), me = O.online.user?.id; if (!me) return;
  const { data } = await sb.rpc('friend_list'); const f = (data || []).find(x => x.id === id && x.status === 'accepted'); if (!f) return toast('Chat nicht gefunden');
  await openFriend(sb, me, f, () => { });
  if (!focus) document.activeElement?.blur();
}
async function openFriend(sb, me, f, redraw) {
  if (!f) return;
  const w = document.createElement('div'); w.className = 'modal on';
  w.innerHTML = `<div class="card dlg frdlg" data-chat="${esc(f.id)}" role="dialog" aria-modal="true" aria-label="${esc(f.display_name)}"><div class="row between"><div class="row">${avatarSvg(f.avatar || {}, 44)}<div><h2 style="margin:0">${esc(f.display_name)}</h2><div class="small muted" id="fpSub">Level ${f.level}</div></div></div><button class="btn sm ghost" data-x aria-label="Schließen">✕</button></div>
    <div class="row between"><div class="frtabs seg sm"><button aria-pressed="true" data-tab="chat">💬 Chat</button><button aria-pressed="false" data-tab="prof">📊 Profil</button></div><span class="row"><button class="btn sm ghost" data-clear title="Chat löschen">🗑</button><button class="btn sm pri" data-call title="Videoanruf">📹 Anrufen</button></span></div>
    <div data-pane="chat"><div class="chat" id="chLog"><div class="pageload"><div class="spinner"></div></div></div>
      <form class="chatin" id="chForm"><input class="inp" id="chTxt" maxlength="1000" placeholder="Nachricht schreiben …" autocomplete="off"><button class="btn pri" type="submit">Senden</button></form></div>
    <div data-pane="prof" hidden><div id="fpBody"><div class="pageload"><div class="spinner"></div></div></div>
      <div class="row end" style="margin-top:12px"><button class="btn sm ghost" data-rm>Freundschaft beenden</button><button class="btn sm ghost danger" data-block>Blockieren</button></div></div></div>`;
  document.body.appendChild(w);
  const close = () => { clearInterval(chatT); w.remove(); document.removeEventListener('keydown', esck, true); redraw(); bus.emit('inbox'); };
  const esck = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', esck, true);
  const log = w.querySelector('#chLog');
  let last = null; // null: auch ein leerer Chat wird einmal gezeichnet (Platzhalter statt Ladesymbol)
  const loadChat = async () => {
    const { data, error } = await sb.from('chat_messages').select('id,sender,body,created_at').or(`and(sender.eq.${me},recipient.eq.${f.id}),and(sender.eq.${f.id},recipient.eq.${me})`).order('created_at', { ascending: false }).limit(100);
    if (!w.isConnected) return; if (error) { log.innerHTML = `<p class="muted small">${esc(miss(error))}</p>`; return; }
    const key = data.map(m => m.id).join() + (data.some(m => /^\[\[call:/.test(m.body)) ? '|' + Math.floor(Date.now() / 15e3) : ''); if (key === last) return; last = key; // Anrufstand regelmäßig auffrischen
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const C = await import('../call.js');
    // Anrufe: laufende mit „Beitreten“, vergangene als kurze Zeile (ausgehend/eingehend, Dauer, verpasst, abgelehnt)
    const states = await C.callStates(data.map(m => C.callRoom(m.body)));
    const when = d => new Date(d).toLocaleString(document.documentElement.lang, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    log.innerHTML = data.length ? data.reverse().map(m => {
      const room = C.callRoom(m.body);
      if (!room) return `<div class="msg ${m.sender === me ? 'me' : ''}"><span data-noi18n>${esc(m.body)}</span><small>${new Date(m.created_at).toLocaleString(document.documentElement.lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>`;
      const ci = C.callInfo(states.get(room), m, me);
      return ci.active ? `<div class="msg call ${m.sender === me ? 'me' : ''}"><span>${esc(ci.text)} <button class="btn xs ${m.sender === me ? 'ghost' : 'pri'}" data-join="${esc(room)}">${m.sender === me ? 'Zurück zum Anruf' : 'Beitreten'}</button></span><small>${when(m.created_at)}</small></div>`
        : `<div class="calllog ${ci.missed ? 'missed' : ''}">📹 ${esc(ci.text)} · ${when(m.created_at)}</div>`;
    }).join('') : `<div class="empty"><div class="emi">💬</div><b>Noch keine Nachrichten</b><span>Schreib ${esc(f.display_name)} die erste Nachricht – oder ruf mit 📹 an.</span></div>`;
    if (atBottom || data.length) log.scrollTop = log.scrollHeight;
    sb.rpc('chat_read', { p_other: f.id }).then(() => { });
  };
  w.querySelector('#chForm').onsubmit = async e => {
    e.preventDefault(); const inp = w.querySelector('#chTxt'), body = inp.value.trim(); if (!body) return;
    inp.disabled = true; const { error } = await sb.from('chat_messages').insert({ recipient: f.id, body }); inp.disabled = false; if (!error) { import('../push.js').then(P => P.pushTo(f.id, 'msg')).catch(() => { }); import('../online/presence.js').then(PR => PR.callSignal(f.id, 'msg')).catch(() => { }); bus.emit('chatnew', { uid: f.id }); }
    if (error) return toast(/Chat-Filter: /.test(error.message) ? '🛡️ ' + error.message.replace(/^.*Chat-Filter: /, '') + ' – die Nachricht wurde nicht gesendet' : /row-level security/i.test(error.message) ? 'Nicht gesendet (zu viele Nachrichten in kurzer Zeit, keine Freundschaft mehr oder dein Freund empfängt gerade keine Nachrichten)' : miss(error), 6000);
    inp.value = ''; inp.focus(); loadChat();
  };
  const loadProf = async () => {
    const { data: p, error } = await sb.rpc('friend_profile', { p_other: f.id }); const box = w.querySelector('#fpBody');
    if (error) { box.innerHTML = `<p class="muted">${esc(miss(error))}</p>`; return; }
    w.querySelector('#fpSub').innerHTML = `Level ${p.level} · dabei seit ${fmtDate(p.since)}${p.club ? ` · <span class="cltag sm" style="background:${esc(p.club.color)}">${esc(p.club.tag)}</span> ${esc(p.club.name)}` : ''}`;
    const tile = (v, l) => `<div class="kpi"><b class="num">${v}</b><span>${l}</span></div>`;
    box.innerHTML = `<h3 class="sub">Diese Woche</h3><div class="kpis">${tile(p.week.rides, 'Fahrten')}${tile(String(p.week.km).replace('.', ','), 'km')}${tile(String(p.week.hours).replace('.', ','), 'Stunden')}</div>
      <h3 class="sub">Insgesamt</h3><div class="kpis">${tile(p.total.rides, 'Fahrten')}${tile(p.total.km, 'km')}${tile(String(p.total.hours).replace('.', ','), 'Stunden')}${tile(p.total.hm, 'Höhenmeter')}</div>
      <h3 class="sub">Letzte Fahrten</h3>${p.rides ? (p.rides.length ? `<div class="frrides">${p.rides.map(r => `<div class="frride"><b>${esc(r.title || r.route_name || 'Fahrt')}</b><span class="small muted">${fmtDate(r.started_at)}</span><span class="num small">${fmtKm(r.distance_m || 0)} km · ${fmtDur(r.duration_s || 0)}${r.ascent_m ? ' · ' + r.ascent_m + ' hm' : ''}${r.avg_w ? ' · Ø ' + r.avg_w + ' W' : ''}</span></div>`).join('')}</div>` : '<p class="muted small">Noch keine Fahrten online.</p>') : `<p class="muted small">🔒 ${esc(p.name)} teilt einzelne Fahrten nicht.</p>`}`;
  };
  w.addEventListener('click', async e => {
    if (e.target === w || e.target.closest('[data-x]')) return close();
    if (e.target.closest('[data-call]')) { (await import('../call.js')).startCall(f); return; }
    if (e.target.closest('[data-clear]')) {
      const v = await dialog({ title: `Chat mit ${f.display_name} löschen?`, html: '<p class="muted"><b>Nur für mich:</b> Der Verlauf verschwindet bei dir, dein Freund behält seine Kopie.<br><b>Meine Nachrichten für beide:</b> Was du geschrieben hast, wird auch bei deinem Freund entfernt; seine Nachrichten werden bei dir ausgeblendet.</p>', buttons: [{ label: 'Abbrechen', value: 0 }, { label: 'Nur für mich', value: 1 }, { label: 'Meine Nachrichten für beide', value: 2, cls: 'danger' }] });
      if (!v) return; const { error } = await sb.rpc('chat_clear', { p_other: f.id, p_for_both: v === 2 }); if (error) return toast(miss(error));
      last = null; loadChat(); toast('Chat gelöscht'); return;
    }
    const jn = e.target.closest('[data-join]'); if (jn) { (await import('../call.js')).joinCall(jn.dataset.join, { id: f.id, name: f.display_name }); return; }
    const tb = e.target.closest('[data-tab]'); if (tb) { w.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b === tb))); w.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== tb.dataset.tab); if (tb.dataset.tab === 'prof') loadProf(); return; }
    if (e.target.closest('[data-rm]')) { if (await dialog({ title: `Freundschaft mit ${f.display_name} beenden?`, html: '<p class="muted">Ihr seht dann keine Profile mehr und könnt nicht mehr chatten. Bisherige Nachrichten bleiben bei euch beiden gespeichert, bis ihr sie löscht oder sie nach 12 Monaten entfernt werden.</p>', buttons: [{ label: 'Abbrechen', value: 0 }, { label: 'Beenden', value: 1, cls: 'danger' }] })) { await sb.rpc('friend_remove', { p_other: f.id }); close(); } return; }
    if (e.target.closest('[data-block]')) { if (await dialog({ title: `${f.display_name} blockieren?`, html: '<p class="muted">Die Freundschaft endet, und ihr könnt euch keine Anfragen oder Nachrichten mehr schicken. Unter „Blockiert“ kannst du das rückgängig machen.</p>', buttons: [{ label: 'Abbrechen', value: 0 }, { label: 'Blockieren', value: 1, cls: 'danger' }] })) { await sb.rpc('friend_block', { p_other: f.id }); toast('Blockiert'); close(); } return; }
  });
  // Eigenes zweites Konto in dieser App: Anrufen geht nicht (würde nur hier selbst klingeln)
  import('../call.js').then(C => { const cb = w.querySelector('[data-call]'); if (C.sameApp(f.id) && cb) { cb.disabled = true; cb.title = 'Dieses Konto ist auch in dieser App angemeldet – Anrufen nicht möglich'; } });
  // Darf ich diesen Freund anrufen bzw. anschreiben? (Einstellung des Freundes, vom Server geprüft)
  sb.rpc('friend_privacy', { p_other: f.id }).then(({ data }) => {
    if (!data || !w.isConnected) return;
    const cb = w.querySelector('[data-call]'); if (data.calls === false && cb) { cb.disabled = true; cb.title = `${f.display_name} nimmt keine Anrufe an`; }
    if (data.msgs === false) { const fm = w.querySelector('#chForm'); fm.classList.add('chatoff'); fm.innerHTML = `<p class="small muted">🔕 ${esc(f.display_name)} empfängt gerade keine Nachrichten.</p>`; }
  }, () => { });
  loadChat(); clearInterval(chatT); chatT = setInterval(() => w.isConnected ? loadChat() : clearInterval(chatT), 5000);
  const offNew = bus.on('chatnew', x => { if (!w.isConnected) return offNew(); if (x?.uid === f.id) loadChat(); }); // neue Nachricht sofort anzeigen
  w.dataset.chat = f.id;
  setTimeout(() => w.querySelector('#chTxt')?.focus(), 50);
}
