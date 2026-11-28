// Admin-Panel für IndooRado Online: Kennzahlen, Nutzer (Rolle, Sperre, Daten löschen), Ankündigungen.
// Die Datenbank prüft selbst: nur Rolle "admin" mit bestätigter 2FA (aal2) darf hier lesen und schreiben.
import { $, esc, toast, dialog, fmtDate } from '../util.js';
import * as O from '../online/client.js';

export async function render(el) {
  const tok = window.__routeTok, gone = () => tok !== window.__routeTok;
  await O.loadSiteConfig();
  if (!O.configured()) { location.hash = '#/account'; return; }
  if (!O.online.ready) await O.initOnline().catch(() => { }); if (gone()) return;
  if (!O.loggedIn() || !O.isAdmin()) { el.innerHTML = '<section class="card"><h2>Kein Zugriff</h2><p class="muted">Nur für Administratoren.</p><a class="btn" href="#/account">Zum Konto</a></section>'; return; }
  if (O.online.aal?.currentLevel !== 'aal2') { el.innerHTML = '<section class="card"><h2>2FA erforderlich</h2><p class="muted">Admin-Funktionen sind nur mit bestätigter Zwei-Faktor-Anmeldung nutzbar.</p><a class="btn pri" href="#/account">2FA einrichten oder bestätigen</a></section>'; return; }
  const sb = await O.client();
  el.innerHTML = `
  <section class="pagehead"><h1>Admin</h1><span class="row"><button class="btn sm ghost" id="adRefresh">↻ Aktualisieren</button></span></section>
  <section class="kpis" id="adKpi"><div class="pageload"><div class="spinner"></div></div></section>
  <section class="card"><div class="row between"><h2>Nutzer</h2><span class="row"><label class="switch sm"><input type="checkbox" id="adPend"><span></span> nur wartende</label><input class="inp sm" id="adQ" placeholder="Suchen …" style="max-width:240px"></span></div><div class="scroll"><table class="tbl" id="adUsers"></table></div></section>
  <section class="grid2">
    <div class="card form"><h2>Neue Ankündigung</h2>
      <label class="f">Titel<input class="inp" id="anT" maxlength="80"></label>
      <label class="f">Text<textarea class="inp" id="anB" rows="3" maxlength="600"></textarea></label>
      <div class="grid2 tight"><label class="f">Art<select class="inp" id="anL"><option value="info">Info</option><option value="event">Event</option><option value="warn">Wartung / Warnung</option></select></label><label class="f">Sichtbar bis<input class="inp" id="anU" type="date"></label></div>
      <div class="row"><button class="btn pri" id="anGo">Veröffentlichen</button></div></div>
    <div class="card"><h2>Ankündigungen</h2><div id="anList" class="small"></div></div>
  </section>
  <section class="card form"><h2>🛡️ Chat-Filter</h2>
    <p class="small muted">Gilt für alle außer Admins: Diese Wörter werden im Chat durch Sternchen ersetzt (ganze Wörter, Groß- und Kleinschreibung egal). Links, E-Mail-Adressen und Telefonnummern werden immer abgelehnt. Ein Wort pro Zeile.</p>
    <textarea class="inp" id="cfWords" rows="8" spellcheck="false" placeholder="Wird geladen …"></textarea>
    <div class="row"><button class="btn" id="cfSave">Wortliste speichern</button><span class="small muted" id="cfInfo"></span></div>
    <label class="f">Filter testen <span class="muted small">(Ergebnis wie bei einem normalen Konto – Admins selbst schreiben ungefiltert)</span><span class="row"><input class="inp" id="cfTry" placeholder="z. B. Du Idiot, schau auf www.example.de" style="flex:1"><button class="btn" id="cfTest">Testen</button></span></label>
    <p class="small" id="cfOut"></p>
  </section>
  <section class="card form"><h2>📲 Push-Benachrichtigungen einrichten</h2>
    <p class="small muted">Push braucht ein Schlüsselpaar (VAPID). Es wird hier im Browser erzeugt und nirgends hingeschickt. Status: ${(await import('../push.js')).vapid() ? '✅ öffentlicher Schlüssel in online.json vorhanden' : '⚠️ noch kein öffentlicher Schlüssel in online.json'}</p>
    <div class="row"><button class="btn" id="vapGen">🔑 Schlüsselpaar erzeugen</button></div>
    <div id="vapOut" hidden>
      <label class="f">1. Öffentlicher Schlüssel → in <code>online.json</code> als <code>"vapid": "…"</code><input class="inp" id="vapPub" readonly></label>
      <label class="f">2. Privater Schlüssel → nur in Supabase › Edge Functions › Secrets als <code>VAPID_PRIVATE_KEY</code><input class="inp" id="vapPriv" readonly></label>
      <p class="small muted">3. Den öffentlichen Schlüssel zusätzlich als Secret <code>VAPID_PUBLIC_KEY</code> speichern. 4. Edge Function <code>push</code> anlegen (Verify JWT an). Den privaten Schlüssel nirgends sonst speichern oder verschicken; nach dem Schließen dieser Seite ist er weg. Ein neues Paar macht alle bisherigen Push-Anmeldungen ungültig (die Geräte melden sich beim nächsten Öffnen neu an).</p>
    </div>
  </section>
  <section class="card"><div class="row between"><h2>Aktivität (30 Tage)</h2><span class="small muted" id="adOnline"></span></div><canvas id="adChart" class="adchart"></canvas><div class="small muted" id="adTop"></div></section>
  <section class="grid2">
    <div class="card form"><h2>📅 Event planen</h2>
      <label class="f">Titel<input class="inp" id="evT" maxlength="80" placeholder="z. B. Sonntagsrunde"></label>
      <div class="grid2 tight"><label class="f">Art<select class="inp" id="evK"><option value="group">👥 Gruppenfahrt</option><option value="race">🏁 Rennen</option><option value="workout">🏋️ Gemeinsames Workout</option><option value="fun">🎉 Spaßfahrt</option></select></label>
        <label class="f">Strecke<select class="inp" id="evR"></select></label></div>
      <div class="grid2 tight"><label class="f">Beginn<input class="inp" id="evS" type="datetime-local"></label><label class="f">Dauer (min)<input class="inp" id="evD" type="number" min="10" max="480" value="60"></label></div>
      <label class="f">Workout (optional)<select class="inp" id="evW"><option value="">– freie Fahrt –</option></select></label>
      <label class="f">Beschreibung<textarea class="inp" id="evB" rows="2" maxlength="600"></textarea></label>
      <div class="row"><button class="btn pri" id="evGo">Event anlegen</button></div></div>
    <div class="card"><h2>Geplante Events</h2><div id="evAdm" class="small"></div></div>
  </section>
  <section class="grid2">
    <div class="card"><h2>🛡️ Teams</h2><div id="clAdm" class="small"></div></div>
    <div class="card form"><h2>🏆 Bestenliste prüfen</h2><p class="small muted">Unplausible Zeiten (z. B. manipulierte Fahrten) aus der Bestenliste entfernen.</p><label class="f">Strecke<select class="inp" id="lbR"></select></label><div id="lbAdm" class="small"></div></div>
  </section>
  <section class="card"><h2>Massenaktionen und Export</h2><div class="row">
    <button class="btn sm" data-bulk="approve_pending">✅ Alle Wartenden freischalten</button><button class="btn sm" data-bulk="extend_trials">⏳ Testphasen aller Wartenden +7 Tage</button><button class="btn sm" data-bulk="purge_old_events">🧹 Events älter als 30 Tage löschen</button><button class="btn sm ghost" id="adCsv">⬇ Nutzerliste als CSV</button></div>
    <p class="small muted">Die Liste enthält Name, Rolle, Status, Level und Daten – keine E-Mail-Adressen (die liegen nur bei Supabase Auth).</p></section>`;
  let users = [];
  const kpis = async () => {
    const { data, error } = await sb.rpc('admin_stats'); if (error) return toast(error.message, 5000);
    $('#adKpi', el).innerHTML = [['Nutzer', data.users], ['warten auf Freischaltung', data.pending ?? '–'], ['aktiv (7 Tage)', data.active7], ['Fahrten', data.rides], ['Fahrten (7 Tage)', data.rides7], ['Kilometer', Math.round(data.km).toLocaleString(document.documentElement.lang)], ['gesperrt', data.banned]].map(([l, v]) => `<div class="card kpi"><b class="num">${v}</b><span class="small muted">${l}</span></div>`).join('');
  };
  // Status je Nutzer: Admin, freigeschaltet, Testphase (Resttage) oder abgelaufen
  const stat = u => u.role === 'banned' ? ['Gesperrt', 'bad'] : u.role === 'admin' ? ['Admin', 'ok'] : u.approved || u.approved === undefined ? ['Freigeschaltet', 'ok'] : new Date(u.trial_until) > new Date() ? [`Test, noch ${Math.ceil((new Date(u.trial_until) - Date.now()) / 864e5)} T.`, 'trial'] : ['Test abgelaufen', 'bad'];
  const list = () => {
    const q = $('#adQ', el).value.trim().toLowerCase(), onlyP = $('#adPend', el)?.checked;
    const rows = users.filter(u => (!q || u.display_name.toLowerCase().includes(q) || u.id.startsWith(q)) && (!onlyP || (!u.approved && u.role === 'user')))
      .sort((a, b) => (a.approved || a.role !== 'user') - (b.approved || b.role !== 'user') || b.created_at.localeCompare(a.created_at));
    $('#adUsers', el).innerHTML = `<tr><th>Name</th><th>Status</th><th>Rolle</th><th class="n">Level</th><th>Zuletzt</th><th>Seit</th><th class="n">Aktionen</th></tr>` + rows.map(u => { const [st, c] = stat(u), me = u.id === O.online.user.id; return `<tr data-id="${u.id}">
      <td>${esc(u.display_name)}${u.public_profile ? '' : ' <span class="muted small">(privat)</span>'}</td>
      <td><span class="stbadge ${c}">${st}</span></td>
      <td><select class="inp sm" data-role ${me ? 'disabled' : ''}>${['user', 'admin', 'banned'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${{ user: 'Nutzer', admin: 'Admin', banned: 'Gesperrt' }[r]}</option>`).join('')}</select></td>
      <td class="n">${u.level}</td><td>${u.last_seen ? fmtDate(u.last_seen) : '–'}</td><td>${fmtDate(u.created_at)}</td>
      <td class="actcell"><div class="row" style="flex-wrap:nowrap;justify-content:flex-end">${u.role === 'user' ? (u.approved ? `<button class="btn xs ghost" data-appr="0" ${me ? 'disabled' : ''}>Freischaltung entziehen</button>` : `<button class="btn xs pri" data-appr="1">Freischalten</button><button class="btn xs ghost" data-trial>+7 Tage Test</button>`) : ''}${u.role !== 'admin' ? `<button class="btn xs ghost" data-mfa title="Zwei-Faktor-Schutz entfernen, z. B. bei verlorenem Handy">2FA zurücksetzen</button>` : ''}<button class="btn xs ghost danger" data-wipe ${me ? 'disabled' : ''}>Daten löschen</button><button class="btn xs danger" data-delacc ${me ? 'disabled title="Eigenes Konto unter Konto löschen"' : ''}>Konto löschen</button></div></td></tr>`; }).join('');
  };
  const loadUsers = async () => { const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(500); if (error) return toast(error.message, 5000); users = data; list(); };
  const anns = async () => {
    const { data } = await sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(30);
    $('#anList', el).innerHTML = (data || []).map(a => `<div class="row between anrow"><span><b>${esc(a.title)}</b> <span class="muted">${{ info: 'Info', event: 'Event', warn: 'Warnung' }[a.level]} · ${fmtDate(a.created_at)}${a.visible_until ? ' bis ' + fmtDate(a.visible_until) : ''}</span></span><button class="btn xs ghost danger" data-and="${a.id}">✕</button></div>`).join('') || '<span class="muted">Keine</span>';
  };
  // Alle Dateien eines Nutzers im Datenpaket (Ordner <id>/…) entfernen; braucht die Admin-Regeln aus Datenbankschema
  const wipeFiles = async uid => {
    const st = sb.storage.from('vault'), files = [];
    const walk = async dir => { const { data, error } = await st.list(dir, { limit: 1000 }); if (error) throw error; for (const f of data || []) { const p = dir + '/' + f.name; if (f.id) files.push(p); else await walk(p); } };
    await walk(uid);
    for (let i = 0; i < files.length; i += 100) { const { error } = await st.remove(files.slice(i, i + 100)); if (error) throw error; }
  };
  $('#adQ', el).oninput = list; $('#adPend', el).onchange = list;
  $('#adUsers', el).onchange = async e => {
    const s = e.target.closest('[data-role]'); if (!s) return; const id = s.closest('tr').dataset.id;
    const { error } = await sb.from('profiles').update({ role: s.value }).eq('id', id); if (error) return toast(error.message, 5000);
    toast('Rolle geändert'); users.find(u => u.id === id).role = s.value; kpis();
  };
  $('#adUsers', el).onclick = async e => {
    const ap = e.target.closest('[data-appr],[data-trial]');
    if (ap) {
      const id = ap.closest('tr').dataset.id, u = users.find(x => x.id === id);
      const patch = ap.dataset.trial != null ? { trial_until: new Date(Math.max(Date.now(), +new Date(u.trial_until || 0)) + 7 * 864e5).toISOString() } : { approved: ap.dataset.appr === '1' };
      const { error } = await sb.from('profiles').update(patch).eq('id', id); if (error) return toast(error.message, 5000);
      Object.assign(u, patch); list(); kpis(); toast(patch.approved ? esc(u.display_name) + ' freigeschaltet ✅' : patch.trial_until ? 'Testphase verlängert' : 'Freischaltung entzogen'); return;
    }
    const mf = e.target.closest('[data-mfa]');
    if (mf) {
      const id = mf.closest('tr').dataset.id, u = users.find(x => x.id === id);
      if (!(await dialog({ title: `2FA von ${u.display_name} zurücksetzen?`, html: '<p class="muted">Alle Authenticator-Einträge dieses Kontos werden entfernt. Danach meldet sich die Person nur mit Passwort bzw. E-Mail-Code an und sollte unter Konto sofort einen neuen Authenticator einrichten.</p><p class="small warn">Nur tun, wenn du sicher bist, dass die Anfrage wirklich von dieser Person kommt (z. B. Rückfrage über einen bekannten Kontaktweg) – sonst übernimmt womöglich jemand Fremdes das Konto.</p>', buttons: [{ label: 'Abbrechen', value: 0 }, { label: '2FA zurücksetzen', value: 1, cls: 'pri' }] }))) return;
      const { data, error } = await sb.rpc('admin_reset_mfa', { p_user: id }); if (error) return toast(/function|schema cache/i.test(error.message) ? 'Funktion fehlt: Datenbankschema erneut ausführen' : error.message, 6000);
      toast(data ? `2FA von ${u.display_name} entfernt (${data} Faktor${data === 1 ? '' : 'en'})` : 'Dieses Konto hatte keine 2FA'); return;
    }
    const del = e.target.closest('[data-delacc]');
    if (del) {
      const id = del.closest('tr').dataset.id, u = users.find(x => x.id === id);
      // Bestätigung: Name eintippen (der Dialog ist beim Auflösen schon entfernt, darum Eingabe mitlesen)
      let typed = ''; const onIn = e => { if (e.target.id === 'delName') typed = e.target.value.trim(); };
      document.addEventListener('input', onIn);
      const ok = await dialog({ title: 'Konto von ' + u.display_name + ' endgültig löschen?', html: `<p class="muted">Gelöscht werden Login, Profil, alle hochgeladenen Fahrten und das Online-Datenpaket. Das lässt sich nicht rückgängig machen.${u.role === 'admin' ? ' <b>Achtung: Das ist ein Admin-Konto.</b>' : ''}</p><label class="f">Zur Bestätigung den Namen „${esc(u.display_name)}“ eingeben<input class="inp" id="delName" autocomplete="off"></label>`, buttons: [{ label: 'Abbrechen', value: false }, { label: 'Konto löschen', value: true, cls: 'danger' }] });
      document.removeEventListener('input', onIn);
      if (!ok) return;
      if (typed !== u.display_name.trim()) return toast('Name stimmt nicht überein, nichts gelöscht', 4000);
      del.disabled = true; del.textContent = 'Wird gelöscht …';
      try {
        // Erst markieren: nur dann darf ein Admin die Dateien dieses Kontos überhaupt sehen und löschen (1 Stunde)
        { const { error } = await sb.rpc('admin_mark_delete', { p_user: id }); if (error) throw error; }
        await wipeFiles(id);
        const { error } = await sb.rpc('admin_delete_user', { p_user: id });
        if (error) throw error;
        users = users.filter(x => x.id !== id); list(); kpis(); toast(esc(u.display_name) + ' gelöscht');
      } catch (err) {
        del.disabled = false; del.textContent = 'Konto löschen';
        toast(/admin_delete_user|admin_mark_delete|function/i.test(err.message) ? 'Die Funktion fehlt in der Datenbank: Datenbankschema im SQL-Editor erneut ausführen.' : err.message, 7000);
      }
      return;
    }
    const b = e.target.closest('[data-wipe]'); if (!b) return; const id = b.closest('tr').dataset.id, u = users.find(x => x.id === id);
    if (!(await dialog({ title: 'Daten von ' + esc(u.display_name) + ' löschen?', html: '<p class="muted">Fahrten und das Online-Datenpaket werden gelöscht. Das Konto selbst bleibt bestehen (Löschen des Kontos im Supabase-Dashboard).</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, cls: 'danger' }] }))) return;
    const { error } = await sb.rpc('admin_wipe_user', { p_user: id }); if (error) return toast(error.message, 5000); toast('Gelöscht'); kpis();
  };
  $('#anGo', el).onclick = async () => {
    const t = $('#anT', el).value.trim(); if (!t) return toast('Titel fehlt');
    const until = $('#anU', el).value; const { error } = await sb.from('announcements').insert({ title: t, body: $('#anB', el).value.trim(), level: $('#anL', el).value, visible_until: until ? new Date(until + 'T23:59:59').toISOString() : null });
    if (error) return toast(error.message, 5000); toast('Veröffentlicht'); $('#anT', el).value = ''; $('#anB', el).value = ''; anns();
  };
  $('#anList', el).onclick = async e => { const b = e.target.closest('[data-and]'); if (!b) return; await sb.from('announcements').delete().eq('id', b.dataset.and); anns(); };
  $('#adRefresh', el).onclick = () => { kpis(); loadUsers(); anns(); activity(); evAdm(); clAdm(); lbAdm(); };
  // ---------- Aktivität, Events, Teams, Bestenliste, Massenaktionen ----------
  const miss = e => /function|relation|does not exist|schema cache/i.test(e?.message || '') ? 'Fehlt in der Datenbank: Datenbankschema erneut ausführen.' : e?.message;
  const [{ listRoutes }, { listWorkouts }] = await Promise.all([import('../routes.js'), import('../workouts.js')]);
  const [routes, wos] = await Promise.all([listRoutes(), listWorkouts()]), shared = routes.filter(r => r.builtin);
  $('#evR', el).innerHTML = shared.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('') + (routes.some(r => r.kit) ? `<optgroup label="Eigene Baukasten-Strecken (werden an alle verteilt)">${routes.filter(r => r.kit).map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</optgroup>` : '');
  $('#lbR', el).innerHTML = '<option value="">– Strecke wählen –</option>' + shared.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  $('#evW', el).innerHTML += wos.filter(w => w.builtin).map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
  { const d = new Date(Date.now() + 864e5); d.setMinutes(0, 0, 0); d.setHours(18); $('#evS', el).value = new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); }
  const activity = async () => {
    const [{ data, error }, s2] = await Promise.all([sb.rpc('admin_activity', { p_days: 30 }), sb.rpc('admin_stats2')]);
    if (error) { $('#adTop', el).textContent = miss(error); return; }
    const cv = $('#adChart', el), dpr = Math.min(2, devicePixelRatio || 1); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, mx = Math.max(1, ...data.map(d => d.rides)), bw = W / data.length;
    c.font = `${11 * dpr}px system-ui`; c.fillStyle = getComputedStyle(el).color;
    data.forEach((d, i) => { const h = d.rides / mx * (H - 30 * dpr); c.fillStyle = '#ff6a3d'; c.fillRect(i * bw + 2 * dpr, H - 16 * dpr - h, bw - 4 * dpr, h); if (d.new_users) { c.fillStyle = '#3ecf8e'; c.beginPath(); c.arc(i * bw + bw / 2, H - 22 * dpr - h, 4 * dpr, 0, 7); c.fill(); } if (i % 5 === 0) { c.fillStyle = '#8894a0'; c.fillText(new Date(d.day).toLocaleDateString(document.documentElement.lang, { day: '2-digit', month: '2-digit' }), i * bw, H - 3 * dpr); } });
    const x = s2.data || {}; $('#adTop', el).innerHTML = `🟧 Fahrten je Tag · 🟢 neue Nutzer · ${x.hours7 ?? 0} h gefahren (7 Tage) · ${x.events ?? 0} Events geplant (${x.signups ?? 0} Anmeldungen) · ${x.clubs ?? 0} Teams mit ${x.members ?? 0} Mitgliedern${x.topRoutes?.length ? '<br>Beliebteste Strecken (30 Tage): ' + x.topRoutes.map(t => `${esc(t.name)} (${t.n})`).join(', ') : ''}`;
    try { const PR = await import('../online/presence.js'); await PR.joinPresence(); const ps = [...PR.P.peers.values()]; $('#adOnline', el).textContent = `🟢 ${ps.length} gerade online${ps.length ? ': ' + ps.slice(0, 6).map(p => p.name + (p.where === 'ride' ? ' 🚴' : '')).join(', ') : ''}`; } catch (e) { }
  };
  const evAdm = async () => {
    const { data, error } = await sb.from('events').select('*').order('starts_at', { ascending: true }).limit(50); if (error) { $('#evAdm', el).textContent = miss(error); return; }
    $('#evAdm', el).innerHTML = data.length ? data.map(e => `<div class="row between anrow"><span><b>${esc(e.title)}</b> <span class="muted">${new Date(e.starts_at).toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' })} · ${esc(routes.find(r => r.id === e.route_id)?.name || e.route_id)}</span></span><button class="btn xs ghost danger" data-evdel="${e.id}">Löschen</button></div>`).join('') : '<p class="muted">Keine Events.</p>';
  };
  const clAdm = async () => {
    const { data, error } = await sb.rpc('club_overview'); if (error) { $('#clAdm', el).textContent = miss(error); return; }
    $('#clAdm', el).innerHTML = data.length ? data.map(c => `<div class="row between anrow"><span><span class="cltag" style="background:${esc(c.color)}">${esc(c.tag)}</span> <b>${esc(c.name)}</b> <span class="muted">${c.members} Mitglieder · ${c.km7} km/Woche</span></span><button class="btn xs ghost danger" data-cldel="${c.id}">Auflösen</button></div>`).join('') : '<p class="muted">Keine Teams.</p>';
  };
  const lbAdm = async () => {
    const r = $('#lbR', el).value; if (!r) { $('#lbAdm', el).innerHTML = ''; return; }
    const { data, error } = await sb.rpc('admin_leaderboard', { p_route: r }); if (error) { $('#lbAdm', el).textContent = miss(error); return; }
    const tm = s => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('#lbAdm', el).innerHTML = data.length ? data.map((x, i) => `<div class="row between anrow"><span>${i + 1}. <b>${esc(x.display_name)}</b> <span class="num">${tm(x.duration_s)}</span> <span class="muted">${x.avg_w ? x.avg_w + ' W · ' : ''}${fmtDate(x.started_at)}</span></span><button class="btn xs ghost danger" data-lbdel="${esc(x.user_id)}|${esc(x.ride_id)}">Entfernen</button></div>`).join('') : '<p class="muted">Keine Zeiten.</p>';
  };
  $('#lbR', el).onchange = lbAdm;
  $('#evGo', el).onclick = async () => {
    const t = $('#evT', el).value.trim(), st = $('#evS', el).value; if (t.length < 3 || !st) return toast('Titel (mind. 3 Zeichen) und Start angeben');
    const route_kit = await (await import('../online/sharedroute.js')).kitOf($('#evR', el).value);
    const { error } = await sb.from('events').insert({ route_kit, title: t, kind: $('#evK', el).value, route_id: $('#evR', el).value, workout_id: $('#evW', el).value || null, starts_at: new Date(st).toISOString(), duration_min: +$('#evD', el).value || 60, description: $('#evB', el).value.trim() });
    if (error) return toast(miss(error), 5000); toast('📅 Event angelegt'); $('#evT', el).value = ''; $('#evB', el).value = ''; evAdm();
  };
  const vg = el.querySelector('#vapGen'); if (vg) vg.onclick = async () => { const k = await (await import('../push.js')).makeVapid(); el.querySelector('#vapPub').value = k.publicKey; el.querySelector('#vapPriv').value = k.privateKey; el.querySelector('#vapOut').hidden = false; };
  { const ta = el.querySelector('#cfWords'), info = el.querySelector('#cfInfo');
    sb.rpc('chat_words_get').then(({ data, error }) => { ta.placeholder = ''; if (error) { info.textContent = /function|schema cache/i.test(error.message) ? 'Fehlt in der Datenbank: schema.sql ausführen' : error.message; return; } ta.value = data || ''; info.textContent = (data ? data.split('\n').length : 0) + ' Wörter'; });
    el.querySelector('#cfTest').onclick = async () => { const out = el.querySelector('#cfOut'); const { data, error } = await sb.rpc('chat_filter_test', { p_body: el.querySelector('#cfTry').value });
      if (error) { out.textContent = /function|schema cache/i.test(error.message) ? '⚠️ Fehlt in der Datenbank: schema.sql ausführen' : error.message; return; }
      out.innerHTML = `${data.active ? '✅ Filter ist in der Datenbank aktiv' : '⚠️ Filter ist in der Datenbank nicht aktiv – schema.sql erneut ausführen'} · ${data.words} Wörter<br>` + (data.error ? `❌ Würde abgelehnt: ${esc(String(data.error).replace(/^Chat-Filter: /, ''))}` : `➡️ ${esc(data.result)}`); };
    el.querySelector('#cfSave').onclick = async () => { const { data, error } = await sb.rpc('chat_words_set', { p_words: ta.value }); if (error) return toast(error.message, 5000); info.textContent = data + ' Wörter'; toast('🛡️ Chat-Filter gespeichert'); }; }
  el.addEventListener('click', async e => {
    const ev = e.target.closest('[data-evdel]'); if (ev) { const { error } = await sb.from('events').delete().eq('id', ev.dataset.evdel); if (error) return toast(miss(error)); evAdm(); return; }
    const cl = e.target.closest('[data-cldel]'); if (cl) { if (!(await dialog({ title: 'Team auflösen?', html: '<p class="muted">Alle Mitglieder verlieren ihr Team. Fahrten bleiben erhalten.</p>', buttons: [{ label: 'Abbrechen', value: 0 }, { label: 'Auflösen', value: 1, cls: 'pri' }] }))) return; const { error } = await sb.from('clubs').delete().eq('id', cl.dataset.cldel); if (error) return toast(miss(error)); clAdm(); return; }
    const lb = e.target.closest('[data-lbdel]'); if (lb) { const [u, r] = lb.dataset.lbdel.split('|'); const { error } = await sb.rpc('admin_remove_ride', { p_user: u, p_ride: r }); if (error) return toast(miss(error)); toast('Aus der Bestenliste entfernt'); lbAdm(); return; }
    const bk = e.target.closest('[data-bulk]'); if (bk) { const { data, error } = await sb.rpc('admin_bulk', { p_action: bk.dataset.bulk }); if (error) return toast(miss(error)); toast(`Erledigt: ${data} Einträge`); loadUsers(); kpis(); evAdm(); return; }
    if (e.target.closest('#adCsv')) {
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, st = u => stat(u)[0];
      const csv = ['Name;Rolle;Status;Level;Angelegt;Zuletzt online;Öffentlich', ...users.map(u => [u.display_name, u.role, st(u), u.level, u.created_at, u.last_seen || '', u.public_profile ? 'ja' : 'nein'].map(q).join(';'))].join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `indoorado-nutzer-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  });
  kpis(); loadUsers(); anns(); activity(); evAdm(); clAdm();
}
