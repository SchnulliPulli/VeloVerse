// Einstellungen: Profil (Fahrer, Trainer, Avatar), App (Thema, Grafik, Daten), Verbindungen (NAS/Cloud, Strava)
import * as I18N from '../i18n.js';
import { NOTIF as C_NOTIF } from '../comfort.js';
import { $, esc, toast, dialog, download, fmtDate, bus } from '../util.js';
import { profile, saveProfile, progress, levelOf } from '../state.js';
import { UNLOCKS } from '../game.js';
import { backup, restore, wipeAll, usage, persist } from '../db.js';
import { autoQuality } from '../world.js';
import { sync, saveSyncCfg, testConnection, pushNow, pullNow, dsmLogin, dsmLogout, normalizeHost, renameDevice, providerName } from '../sync.js';
import { PROVIDERS, isOAuth, startOAuth, redirectUri } from '../cloud.js';
import { kv } from '../db.js';
import { strava, connected as stravaConnected, setApp as setStravaApp, setAuto as setStravaAuto, authorize as stravaAuthorize, disconnect as stravaDisconnect } from '../strava.js';

const F = (id, label, type, extra = '', hint = '') => `<label class="f">${label}<input class="inp" id="${id}" type="${type}" ${extra} value="${esc(profile[id])}">${hint ? `<span class="small muted">${hint}</span>` : ''}</label>`;
const SW = (id, label) => `<label class="switch"><input type="checkbox" id="${id}" ${profile[id] ? 'checked' : ''}><span></span> ${label}</label>`;

// Strava: eigene API-App, Schlüssel bleiben nur in diesem Browser
function stravaCard(box) {
  const c = strava.cfg || {}, con = stravaConnected();
  box.innerHTML = `<h2>Strava</h2>
    ${con ? `<p>✅ Verbunden${c.athlete ? ' als <b>' + esc(c.athlete) + '</b>' : ''}. Fahrten werden mit passendem Titel und Beschreibung direkt hochgeladen.</p>
      <label class="switch"><input type="checkbox" id="sAuto" ${c.auto ? 'checked' : ''}><span></span> Jede gespeicherte Fahrt automatisch hochladen</label>
      <div class="row"><button class="btn sm ghost danger" id="sOff">Verbindung trennen</button></div>`
    : `<p class="small muted"><b>Auch ohne Verbindung geht es:</b> In der Zusammenfassung lädt „Zu Strava“ die FIT-Datei und die Bilder herunter, kopiert Titel und Beschreibung und öffnet die Upload-Seite von Strava. Die direkte Verbindung braucht eine eigene Strava-API-App; Strava bietet das inzwischen nur noch mit Abo an.</p><p class="small muted">Für den direkten Upload brauchst du eine eigene Strava-API-App. Client-ID und Client-Secret bleiben nur in diesem Browser, sie landen weder in der Sicherungsdatei noch auf dem NAS.</p>
      <ol class="tips small muted"><li>Auf <b>strava.com/settings/api</b> eine App anlegen (Name z. B. „IndooRado“, Website beliebig).</li><li>Als <b>Authorization Callback Domain</b> eintragen: <code>${esc(location.hostname)}</code></li><li>Client-ID und Client-Secret hier eintragen und „Mit Strava verbinden“ tippen.</li></ol>
      <div class="grid2 tight"><label class="f">Client-ID<input class="inp" id="sId" inputmode="numeric" value="${esc(c.clientId || '')}"></label><label class="f">Client-Secret<input class="inp" id="sSec" type="password" autocomplete="off" value="${esc(c.clientSecret || '')}"></label></div>
      <label class="switch"><input type="checkbox" id="sAuto2" ${c.auto !== false ? 'checked' : ''}><span></span> Danach jede gespeicherte Fahrt automatisch hochladen</label>
      <div class="row"><button class="btn pri sm" id="sCon">Mit Strava verbinden</button></div>`}
    <p class="small muted">Fotos nimmt die Strava-Schnittstelle nicht an. Übersichtsbild und Fahrtfoto speichert die App beim Upload mit, du kannst sie in der Strava-App zur Aktivität hinzufügen.</p>`;
  box.querySelector('#sAuto')?.addEventListener('change', e => setStravaAuto(e.target.checked));
  box.querySelector('#sOff')?.addEventListener('click', async () => { await stravaDisconnect(); toast('Strava getrennt'); stravaCard(box); });
  box.querySelector('#sCon')?.addEventListener('click', async () => {
    const id = box.querySelector('#sId').value.trim(), sec = box.querySelector('#sSec').value.trim();
    if (!/^\d+$/.test(id) || sec.length < 20) { toast('Bitte Client-ID (Zahl) und Client-Secret aus den Strava-API-Einstellungen eintragen', 5000); return; }
    await setStravaApp(id, sec, box.querySelector('#sAuto2').checked); stravaAuthorize();
  });
}

// Cloud-Speicher: Synology-Anmeldung (DSM-Konto mit 2FA), WebDAV/Nextcloud, OneDrive, Google Drive, Dropbox
const MODES = [['dsm', 'Synology'], ['webdav', 'WebDAV / Nextcloud'], ['onedrive', 'OneDrive'], ['gdrive', 'Google Drive'], ['dropbox', 'Dropbox']];
// Anleitung zur App-Registrierung je Dienst
function oauthHelp(mode) {
  const ru = esc(redirectUri()), og = esc(location.origin);
  if (mode === 'onedrive') return `<ol class="tips"><li><a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Microsoft Entra → App-Registrierungen</a> → <b>Neue Registrierung</b> (mit deinem Microsoft-Konto, kostenlos).</li>
    <li>Name z. B. „IndooRado“. Unterstützte Kontotypen: <b>Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten</b>.</li>
    <li>Umleitungs-URI: Plattform <b>Single-Page-Anwendung (SPA)</b>, Adresse <code>${ru}</code>.</li>
    <li>Die <b>Anwendungs-ID (Client-ID)</b> von der Übersichtsseite hier eintragen. Ein Geheimnis ist nicht nötig.</li>
    <li>Beim Verbinden fragt Microsoft einmal nach der Erlaubnis. IndooRado sieht nur seinen eigenen Ordner <b>Apps/IndooRado</b>, nicht deine übrigen Dateien.</li>
    <li>Hinweis: Microsoft lässt Browser-Apps höchstens 24 Stunden ohne neue Anmeldung zu. Danach einmal auf „Neu verbinden“ tippen, die Daten bleiben.</li></ol>`;
  if (mode === 'gdrive') return `<ol class="tips"><li><a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> → neues Projekt anlegen.</li>
    <li>APIs &amp; Dienste → Bibliothek → <b>Google Drive API</b> aktivieren.</li>
    <li>OAuth-Zustimmungsbildschirm: Typ <b>Extern</b>, App-Name, deine E-Mail. Danach unter „Zielgruppe“ <b>App veröffentlichen</b> (der verwendete Zugriff „nur von der App erstellte Dateien“ braucht keine Google-Prüfung). Im Testmodus läuft die Anmeldung sonst nach 7 Tagen ab.</li>
    <li>Anmeldedaten → <b>OAuth-Client-ID</b> → Typ <b>Webanwendung</b>. Autorisierte JavaScript-Quellen: <code>${og}</code>, autorisierte Weiterleitungs-URIs: <code>${ru}</code>.</li>
    <li><b>Client-ID</b> und <b>Clientschlüssel</b> hier eintragen (bleiben nur in diesem Browser). Die Daten landen sichtbar im Ordner <b>IndooRado</b> in „Meine Ablage“.</li></ol>`;
  return `<ol class="tips"><li><a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener">Dropbox App Console</a> → <b>Create app</b> → Scoped access → <b>App folder</b> → Name z. B. „IndooRado“.</li>
    <li>Reiter <b>Permissions</b>: <code>files.metadata.read</code>, <code>files.content.read</code>, <code>files.content.write</code> anhaken → Submit.</li>
    <li>Reiter <b>Settings</b>: unter OAuth 2 Redirect URIs <code>${ru}</code> hinzufügen, „Allow public clients (Implicit Grant &amp; PKCE)“ auf <b>Allow</b>.</li>
    <li>Den <b>App key</b> hier eintragen. Ein Geheimnis ist nicht nötig, die Anmeldung bleibt dauerhaft bestehen.</li></ol>`;
}
async function oauthBlock(box, mode, c, connected) {
  const P = PROVIDERS[mode], app = (await kv.get('cloudApps', {}))[mode] || {};
  if (connected) return `<p>Verbunden mit <b>${esc(P.name)}</b>${c.account ? ' als <b>' + esc(c.account) + '</b>' : ''}<br><span class="small muted">Dateien: ${esc(P.where)}</span></p>
      <label class="switch"><input type="checkbox" id="nAuto" ${c.auto !== false ? 'checked' : ''}><span></span> Automatisch abgleichen (beim Start und nach jeder Änderung)</label>
      <div class="row"><button class="btn sm" id="nPush">Jetzt abgleichen</button><button class="btn sm" id="nPull">Alles aus ${esc(P.name)} übernehmen</button><button class="btn sm ghost danger" id="nOff">Trennen</button></div>`;
  return `${c.mode === mode && sync.needLogin ? `<p class="warn small">🔑 Die Anmeldung bei ${esc(P.name)} ist abgelaufen. Einmal neu verbinden, die Daten bleiben.</p>` : ''}
      <p class="small muted">Einmalig eine eigene, kostenlose App bei ${esc(P.name)} anlegen und die Kennung hier eintragen. IndooRado spricht ${esc(P.name)} dann direkt aus dem Browser an, ohne fremden Server.</p>
      <details class="small"><summary><b>So legst du die App an</b></summary>${oauthHelp(mode)}</details>
      <label class="f">${mode === 'dropbox' ? 'App key' : 'Client-ID'}<input class="inp" id="oId" value="${esc(app.clientId || (c.mode === mode ? c.clientId : '') || '')}" autocomplete="off" spellcheck="false"></label>
      ${P.secret ? `<label class="f">Clientschlüssel (Client-Secret)<input class="inp" id="oSec" type="password" value="${esc(app.secret || (c.mode === mode ? c.secret : '') || '')}" autocomplete="off"></label>` : ''}
      <div class="row"><button class="btn pri sm" id="oConnect">${c.mode === mode && c.clientId ? 'Neu verbinden' : 'Mit ' + esc(P.name) + ' verbinden'}</button>${c.mode === mode && c.clientId ? '<button class="btn sm ghost danger" id="nOff">Trennen</button>' : ''}</div>`;
}
const isConfiguredCfg = c => !!c && (isOAuth(c.mode) ? !!(c.refresh || c.access) : c.mode === 'dsm' ? !!c.host : !!c.url);
async function nasCard(box) {
  if (!box.__devrm) { box.__devrm = true; box.addEventListener('click', async e => { const b = e.target.closest('[data-devrm]'); if (!b) return;
    if (!(await dialog({ title: `„${b.dataset.devname}“ entfernen?`, html: '<p class="muted">Das Gerät verschwindet aus der Liste. Ist es mit deinem IndooRado-Konto angemeldet, wird es dort auch abgemeldet. Gleicht es weiter mit diesem Speicher ab, taucht es wieder auf – dann dort die Verbindung trennen.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Entfernen', value: true, cls: 'danger' }] }))) return;
    await (await import('../online/devices.js')).revokeDevice(b.dataset.devrm); toast('Gerät entfernt'); nasCard(box); }); }
  const c = sync.cfg || { mode: box.dataset.mode || 'dsm', auto: true };
  const mode = box.dataset.mode || c.mode || (c.url ? 'webdav' : 'dsm');
  const oauthOn = isOAuth(mode) && c.mode === mode && !!(c.refresh || c.access);
  const on = c.mode === mode && (isOAuth(mode) ? oauthOn : mode === 'dsm' ? !!c.host : !!c.url);
  const oblock = isOAuth(mode) ? await oauthBlock(box, mode, c, oauthOn && !sync.needLogin) : '';
  const status = () => sync.online && on ? (sync.extNeedLogin ? '<span style="color:var(--warn)">🔑 Anmeldung abgelaufen, bitte neu anmelden (für die Fotos)</span>' : sync.extError ? `<span style="color:#ff8b97">⚠ ${esc(sync.extError)}</span>` : '📷 Speichert die Fotos deiner Fahrten (Fahrten und Einstellungen laufen über dein IndooRado-Konto)') : sync.busy ? '⏳ Abgleich läuft …' : sync.needLogin ? '<span style="color:var(--warn)">🔑 Anmeldung abgelaufen, bitte neu anmelden</span>' : sync.error ? `<span style="color:#ff8b97">⚠ ${esc(sync.error)}</span>` : sync.last ? `✅ Zuletzt abgeglichen: ${fmtDate(sync.last)}` : on ? 'Noch nicht abgeglichen' : 'Nicht eingerichtet';
  box.innerHTML = `<h2>Cloud-Speicher</h2>
    <p class="small muted">Zusätzlich zum Browser landen alle Daten in einem Ordner auf deinem NAS oder in deiner Cloud (immer nur ein Speicher gleichzeitig): <code>state.json</code> mit Einstellungen und Fortschritt, jede Fahrt als eigene Datei, Fotos als JPG.</p>
    <p class="small muted">Mit IndooRado-Konto angemeldet: Fahrten und Einstellungen gleicht das Konto ab, hier landen dann nur die <b>Fotos der Fahrten</b> (die werden nie im Konto gespeichert). Die App zeigt beides zusammen an.</p>
    <p class="small muted">Ein neu verbundenes Gerät holt zuerst den Stand aus dem Speicher und überschreibt dort nichts. Danach gewinnt bei jeder Einstellung die zuletzt geänderte Seite; Fahrten, Fotos und eigene Pläne werden nur ergänzt, gelöschte Fahrten, Workouts, Strecken und Pläne verschwinden überall.</p>
    <div class="seg sm wrap" id="nMode">${MODES.map(([m, l]) => `<button data-m="${m}" aria-pressed="${mode === m}">${l}${sync.cfg?.mode === m && isConfiguredCfg(sync.cfg) ? ' ✓' : ''}</button>`).join('')}</div>
    ${isOAuth(mode) ? oblock : mode === 'dsm' ? (c.host && (c.sid || c.pass) && !sync.needLogin ? `
      <p>Angemeldet als <b>${esc(c.user)}</b> auf <b>${esc(c.host)}</b><br><span class="small muted">Ordner: ${esc(c.folder)}${c.pass ? ' · bleibt angemeldet' : ''}${c.did ? ' · Gerät für 2FA gemerkt' : ''}</span></p>
      <label class="switch"><input type="checkbox" id="nAuto" ${c.auto ? 'checked' : ''}><span></span> Automatisch abgleichen (beim Start und nach jeder Änderung)</label>
      <div class="row"><button class="btn sm" id="nPush">Jetzt abgleichen</button><button class="btn sm" id="nPull">Alles vom NAS übernehmen</button><button class="btn sm ghost" id="nLogout">Abmelden</button></div>`
    : `<p class="small muted">Anmeldung wie in DSM, Synology Drive oder Photos, mit deinem DSM-Konto und, falls aktiviert, dem 2FA-Code aus der Authenticator-App.</p>
      <div class="row"><button class="btn pri sm" id="nLogin">${c.host ? 'Neu anmelden' : 'Beim NAS anmelden'}</button>${c.host ? '<button class="btn sm ghost danger" id="nOff">Trennen</button>' : ''}</div>`)
    : `<label class="f">WebDAV-Adresse des Ordners<input class="inp" id="nUrl" type="url" placeholder="https://dav.deine-domain.de/home/indoorado" value="${esc(c.url || '')}"></label>
      <div class="grid2 tight"><label class="f">Benutzer<input class="inp" id="nUser" autocomplete="username" value="${esc(c.user || '')}"></label><label class="f">Passwort<input class="inp" id="nPass" type="password" autocomplete="current-password" value="${esc(c.pass || '')}"></label></div>
      <label class="switch"><input type="checkbox" id="nAuto" ${c.auto !== false ? 'checked' : ''}><span></span> Automatisch abgleichen</label>
      <p class="small muted">WebDAV kennt keine 2FA, das Passwort bleibt dafür in diesem Browser. Für Synology besser die Synology-Anmeldung nutzen. <b>Nextcloud/ownCloud</b>: Adresse <code>https://cloud.example.de/remote.php/dav/files/BENUTZER/IndooRado</code>, dazu ein App-Passwort (Einstellungen → Sicherheit) und eine CORS-Freigabe für ${esc(location.origin)} auf dem Server.</p>
      <div class="row"><button class="btn sm" id="nSave">Speichern und testen</button><button class="btn sm" id="nPush">Jetzt abgleichen</button><button class="btn sm" id="nPull">Alles vom NAS übernehmen</button>${c.url ? '<button class="btn sm ghost danger" id="nOff">Trennen</button>' : ''}</div>`}
    <div class="small" id="nStat">${status()}</div>
    ${on && sync.device ? `<div class="devlist small"><label class="f">Name dieses Geräts<input class="inp" id="nDev" value="${esc(sync.device.name)}" maxlength="40"></label>
      ${Object.keys(sync.devices || {}).length ? `<div class="muted">Mit diesem NAS-Ordner verbunden:</div><ul class="tips">${Object.entries(sync.devices).sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([id, d]) => `<li><b>${esc(d.name)}</b>${id === sync.device.id ? ' (dieses Gerät)' : ''} · zuletzt ${fmtDate(d.last)}${id === sync.device.id ? '' : ` <button class="btn xs ghost danger" data-devrm="${esc(id)}" data-devname="${esc(d.name)}" title="Aus der Liste entfernen">✕</button>`}</li>`).join('')}</ul><div class="muted">Stand Nr. ${sync.rev ?? '–'}</div>` : ''}</div>` : ''}
    ${isOAuth(mode) ? '' : `<details class="small muted"><summary>Einrichtung auf der Synology</summary>
      <p>Der Browser darf das NAS von <b>${esc(location.origin)}</b> aus nur ansprechen, wenn das NAS das erlaubt. Die DSM-Anmeldeseite selbst lässt sich aus Sicherheitsgründen nicht in fremde Seiten einbetten, darum meldet sich die App direkt über die DSM-Schnittstelle an, mit denselben Zugangsdaten und 2FA.</p>
      <ol class="tips">
        <li>Das NAS braucht HTTPS mit gültigem Zertifikat (Systemsteuerung → Sicherheit → Zertifikat, z. B. Let’s Encrypt für deine Domain).</li>
        <li>Systemsteuerung → Anmeldeportal → Erweitert → <b>Reverse Proxy</b> → Erstellen. Quelle: HTTPS, z. B. <code>nas-api.deine-domain.de</code>, Port 443. Ziel: HTTPS, <code>localhost</code>, Port <b>5001</b> (für WebDAV: 5006).</li>
        <li>Im selben Eintrag unter „Benutzerdefinierte Kopfzeile“ hinzufügen:<br><code>Access-Control-Allow-Origin</code> = <code>${esc(location.origin)}</code>${mode === 'webdav' ? '<br><code>Access-Control-Allow-Methods</code> = <code>GET, PUT, DELETE, MKCOL, PROPFIND, OPTIONS</code><br><code>Access-Control-Allow-Headers</code> = <code>Authorization, Content-Type, Depth</code>' : ''}</li>
        <li>${mode === 'dsm' ? 'Als NAS-Adresse dann <code>https://nas-api.deine-domain.de</code> eintragen. Als Ordner z. B. <code>/home/Drive/IndooRado</code> (erscheint in Synology Drive unter „Meine Dateien“) oder einen freigegebenen Ordner wie <code>/Sport/IndooRado</code>.' : 'Das Paket „WebDAV Server“ installieren und die Ordner-Adresse über den Reverse Proxy eintragen.'}</li>
        <li>Am besten ein eigenes DSM-Konto nur mit Zugriff auf diesen Ordner und auf File Station verwenden.</li>
        <li><b>NAS hinter einem eigenen Server (VPS, Tunnel)</b>: Die Kopfzeile dann im Proxy auf dem VPS setzen statt in DSM, die NAS-Adresse ist die öffentliche Subdomain (Port 443).<br>nginx: <code>add_header Access-Control-Allow-Origin "${esc(location.origin)}" always;</code>${mode === 'webdav' ? ' <code>add_header Access-Control-Allow-Methods "GET, PUT, DELETE, MKCOL, PROPFIND, OPTIONS" always; add_header Access-Control-Allow-Headers "Authorization, Content-Type, Depth" always;</code>' : ''}<br>Caddy: <code>header Access-Control-Allow-Origin "${esc(location.origin)}"</code><br>Weiterleiten muss der Proxy dabei mindestens den Pfad <code>/webapi/</code> an DSM (Port 5001).</li>
      </ol>
    </details>`}`;
  const stat = () => { const s = box.querySelector('#nStat'); if (s) s.innerHTML = status(); };
  const off = bus.on('sync', stat); const mo = new MutationObserver(() => { if (!box.isConnected) { off(); mo.disconnect(); } }); mo.observe(document.body, { childList: true, subtree: true });
  // Reiter wechseln zeigt nur die Einrichtung; der aktive Speicher bleibt, bis ein anderer verbunden wird
  box.querySelector('#nMode').onclick = e => { const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === mode) return; box.dataset.mode = b.dataset.m; nasCard(box); };
  box.querySelector('#oConnect')?.addEventListener('click', async () => {
    const id = box.querySelector('#oId').value.trim(), sec = box.querySelector('#oSec')?.value.trim() || '';
    const apps = await kv.get('cloudApps', {}); apps[mode] = { clientId: id, secret: sec || undefined }; await kv.set('cloudApps', apps);
    if (sync.cfg && sync.cfg.mode !== mode && isConfiguredCfg(sync.cfg) && !(await dialog({ title: `Zu ${PROVIDERS[mode].name} wechseln?`, html: `<p class="muted">Der Abgleich mit ${esc(providerName(sync.cfg.mode))} wird beendet. Die Daten dort und im Browser bleiben. ${esc(PROVIDERS[mode].name)} wird beim ersten Verbinden zuerst nur gelesen.</p>`, buttons: [{ label: 'Abbrechen', value: false }, { label: 'Wechseln', value: true, cls: 'pri' }] }))) return;
    try { await startOAuth(mode, id, sec); } catch (err) { toast(err.message, 5000); }
  });
  box.querySelector('#nAuto')?.addEventListener('change', async e => { sync.cfg.auto = e.target.checked; await saveSyncCfg(sync.cfg); });
  box.querySelector('#nPush')?.addEventListener('click', () => connectSync(box));
  box.querySelector('#nPull')?.addEventListener('click', async () => {
    if (!(await dialog({ title: 'Alles vom NAS übernehmen?', html: '<p class="muted">Einstellungen, Profil, Fortschritt und Pläne werden durch den Stand auf dem NAS ersetzt. Fahrten und Fotos auf diesem Gerät bleiben und werden ergänzt.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', value: true, cls: 'pri' }] }))) return;
    try { const r = await pullNow(); if (r) { toast(`Vom NAS übernommen (${r.rides} neue Fahrten), App wird neu geladen`); setTimeout(() => location.reload(), 1200); } } catch (e) { }
  });
  box.querySelector('#nDev')?.addEventListener('change', e => renameDevice(e.target.value));
  box.querySelector('#nOff')?.addEventListener('click', async () => { if (!isOAuth(sync.cfg?.mode)) await dsmLogout(); await saveSyncCfg(null); sync.last = null; sync.error = null; sync.needLogin = false; nasCard(box); toast('Cloud-Speicher getrennt, die Daten im Browser bleiben'); });
  box.querySelector('#nLogout')?.addEventListener('click', async () => { await dsmLogout(); nasCard(box); toast('Abgemeldet'); });
  box.querySelector('#nLogin')?.addEventListener('click', async () => { if (await loginDialog()) { toast('Angemeldet, Verbindung klappt'); nasCard(box); connectSync(box); } });
  box.querySelector('#nSave')?.addEventListener('click', async () => {
    const cfg = { mode: 'webdav', url: normalizeHost(box.querySelector('#nUrl').value), user: box.querySelector('#nUser').value.trim(), pass: box.querySelector('#nPass').value, auto: box.querySelector('#nAuto').checked };
    if (!/^https?:\/\//.test(cfg.url)) { toast('Bitte eine vollständige Adresse mit https:// eingeben'); return; }
    if (location.protocol === 'https:' && cfg.url.startsWith('http:')) { toast('Die App läuft über https, das NAS muss auch über https erreichbar sein', 5000); return; }
    await saveSyncCfg(cfg); sync.error = null;
    try { await testConnection(); toast('Verbindung klappt'); nasCard(box); connectSync(box); }
    catch (e) { sync.error = e.message === 'Failed to fetch' ? 'NAS nicht erreichbar oder Zugriff nicht freigegeben (siehe Einrichtung)' : e.message; stat(); }
  });
}

// Abgleichen; hat sich dabei lokal etwas geändert (z. B. beim ersten Verbinden), die App neu laden
async function connectSync(box) {
  try {
    const r = await pushNow(); if (!r) return;
    if (r.pulled) { toast(sync.info || `Neuerer Stand vom NAS übernommen (${r.rides} Fahrten), App wird neu geladen`, 5000); sync.info = ''; setTimeout(() => location.reload(), 2500); }
    else { toast(`Abgeglichen${r.up.rides || r.up.shots ? ` (${r.up.rides} Fahrten, ${r.up.shots} Fotos hochgeladen)` : ''}`); nasCard(box); }
  } catch (e) { }
}

// Anmeldedialog wie bei den Synology-Apps: Adresse, Konto, Passwort, bei Bedarf 2FA-Code
function loginDialog() {
  const c = sync.cfg || {};
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'modal on';
    w.innerHTML = `<form class="card dlg form syno" autocomplete="on">
      <div class="syno-head"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="1"/><circle cx="7" cy="16.5" r="1"/></svg><div><h2 style="margin:0">Beim NAS anmelden</h2><div class="small muted">Synology DSM-Konto</div></div></div>
      <label class="f">NAS-Adresse (HTTPS, Port 443)<input class="inp" name="host" type="text" inputmode="url" required placeholder="nas.deine-domain.de" value="${esc(c.host || '')}"></label>
      <label class="f">Ordner für IndooRado<input class="inp" name="folder" required placeholder="/home/Drive/IndooRado" value="${esc(c.folder || '/home/Drive/IndooRado')}"></label>
      <label class="f">Benutzername<input class="inp" name="user" required autocomplete="username" value="${esc(c.user || '')}"></label>
      <label class="f">Passwort<input class="inp" name="pass" type="password" required autocomplete="current-password"></label>
      <label class="f" id="otpBox" hidden>Bestätigungscode (2FA)<input class="inp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="6-stelliger Code aus der Authenticator-App"></label>
      <label class="switch"><input type="checkbox" name="remember" ${c.pass ? 'checked' : ''}><span></span> Angemeldet bleiben (Passwort in diesem Browser speichern)</label>
      <label class="switch"><input type="checkbox" name="auto" ${c.auto !== false ? 'checked' : ''}><span></span> Automatisch abgleichen</label>
      <div class="small" id="lgMsg"></div>
      <div class="row end"><button type="button" class="btn ghost" data-x>Abbrechen</button><button class="btn pri" type="submit">Anmelden</button></div>
    </form>`;
    document.body.appendChild(w);
    const f = w.querySelector('form'), msg = w.querySelector('#lgMsg');
    const close = v => { w.remove(); res(v); };
    w.querySelector('[data-x]').onclick = () => close(false);
    (c.host ? f.pass : f.host).focus();
    f.onsubmit = async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f)); v.remember = !!f.remember.checked; v.auto = !!f.auto.checked;
      if (location.protocol === 'https:') v.host = normalizeHost(v.host); f.host.value = v.host;

      msg.textContent = 'Anmelden …'; f.querySelector('[type=submit]').disabled = true;
      try { await dsmLogin(v); msg.textContent = 'Verbindung wird geprüft …'; await testConnection(); close(true); }
      catch (err) {
        f.querySelector('[type=submit]').disabled = false;
        if (err.code === 403) { w.querySelector('#otpBox').hidden = false; f.otp.focus(); msg.textContent = 'Dein Konto nutzt 2FA: bitte den Code aus der Authenticator-App eingeben.'; return; }
        if (err.code === 404) { f.otp.value = ''; f.otp.focus(); }
        msg.innerHTML = `<span style="color:#ff8b97">${esc(err.message === 'Failed to fetch' ? 'NAS nicht erreichbar oder Zugriff von dieser Adresse nicht freigegeben (siehe Einrichtung).' : err.message)}</span>`;
      }
    };
  });
}

export { APP_VERSION } from '../version.js';
import { APP_VERSION } from '../version.js';
// App-Thema und Akzentfarbe sofort anwenden, für den nächsten Start auch in localStorage merken
export function applyAppTheme() {
  const t = profile.appTheme || 'dark', acc = profile.appAccent || '#ff6a3d';
  const eff = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = eff; document.documentElement.style.setProperty('--acc', acc); document.documentElement.style.setProperty('--acc2', `color-mix(in srgb, ${acc} 78%, ${eff === 'light' ? '#000' : '#fff'})`);
  // Barrierefreiheit: Schriftgröße, hoher Kontrast, weniger Bewegung
  const de = document.documentElement; de.style.setProperty('--fs', profile.fontScale || 1);
  de.classList.toggle('hc', !!profile.highContrast); de.classList.toggle('calm', profile.reduceMotion === true || (profile.reduceMotion !== false && matchMedia('(prefers-reduced-motion: reduce)').matches));
  try { localStorage.setItem('vvTheme', JSON.stringify({ theme: eff, acc, fs: profile.fontScale || 1, hc: !!profile.highContrast })); } catch (e) { }
}
// sec: 'profile' (Fahrer, Trainer, Avatar), 'notify' (Benachrichtigungen, Privatsphäre), 'app' (Darstellung, Grafik, Daten), 'connect' (Strava, Cloud)
export async function render(el, params = []) {
  const sec = params[0] || 'profile';
  const u = await usage(), pers = await persist(), lv = levelOf(progress.xp).lv;
  const theme = profile.appTheme || 'dark', acc = profile.appAccent || '#ff6a3d';
  const html = {
  profile: `
  <section class="pagehead"><h1>Profil</h1></section>
  <section class="card form" id="famCard"></section>
  <section class="grid2">
    <div class="card form"><h2>Fahrer</h2>
      ${F('name', 'Name', 'text', 'maxlength="30"')}
      <div class="grid2 tight">${F('ftp', 'FTP (Watt)', 'number', 'min="50" max="600" inputmode="numeric"')}${F('kg', 'Gewicht (kg)', 'number', 'min="30" max="200" step="0.5" inputmode="decimal"')}</div>
      <div class="grid2 tight">${F('hrMax', 'Max. Puls', 'number', 'min="120" max="230" inputmode="numeric"')}${F('bike', 'Radgewicht (kg)', 'number', 'min="5" max="25" step="0.5" inputmode="decimal"')}</div>
      <div class="grid2 tight">${F('age', 'Alter', 'number', 'min="10" max="99" inputmode="numeric"')}<label class="f">Geschlecht (für Kalorien aus dem Puls)<select class="inp" id="sex"><option value="m" ${profile.sex !== 'f' ? 'selected' : ''}>männlich</option><option value="f" ${profile.sex === 'f' ? 'selected' : ''}>weiblich</option></select></label></div>
      <div class="grid2 tight">${F('hrRest', 'Ruhepuls', 'number', 'min="30" max="100" inputmode="numeric"')}<span></span></div>
      <label class="f">Sitzposition<select class="inp" id="cda">${[['0.40', 'Aufrecht (CdA 0,40)'], ['0.32', 'Oberlenker (CdA 0,32)'], ['0.28', 'Unterlenker (CdA 0,28)'], ['0.24', 'Zeitfahren (CdA 0,24)']].map(([v, l]) => `<option value="${v}" ${+v === +profile.cda ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="small muted">Leistungszonen: ${[['Z2', .56, .75], ['Z3', .76, .9], ['Z4', .91, 1.05], ['Z5', 1.06, 1.2]].map(([z, a, b]) => `${z} ${Math.round(a * profile.ftp)}–${Math.round(b * profile.ftp)} W`).join(' · ')}</p>
    </div>
    <div class="card form"><h2>Trainer</h2>
      <div class="grid2 tight">${F('circ', 'Radumfang (mm)', 'number', 'min="1800" max="2400" inputmode="numeric"', '700×25c: 2105, 700×28c: 2136')}${F('maxW', 'Max. Trainerleistung (W)', 'number', 'min="200" max="2500" inputmode="numeric"', 'D100: 600 W')}</div>
      <p class="small muted">Fahrgefühl, automatische Pause, Fotos und Hinweise stellst du unter <a href="#/ridesettings">Fahransicht</a> ein.</p>
    </div>
  </section>
  <section class="card avteaser"><div class="row between"><div><h2>Avatar</h2><p class="small muted">Trikotmuster, Helm, Brille, Bart, Socken, Schuhe und Extras im 3D-Designer.</p></div><a class="btn pri" href="#/avatar">Avatar gestalten</a></div>
  </section>`,
  notify: `
  <section class="pagehead"><h1>Benachrichtigungen & Privatsphäre</h1></section>
  <section class="grid2">
    <div class="card form"><h2>Benachrichtigungen</h2>
      <label class="switch"><input type="checkbox" id="remOn" ${profile.reminders === true ? 'checked' : ''}><span></span> <div class="swt"><i style="font-style:normal">🔔 Benachrichtigungen</i><small class="muted">Erinnerungen und Hinweise des Geräts, solange IndooRado geöffnet ist (auch im Hintergrund). Was genau, wählst du darunter.</small></div></label>
      <div class="notifkinds" id="notifKinds" ${profile.reminders === true ? '' : 'hidden'}>
        ${C_NOTIF.map(([k, l, d]) => `<label class="chk"><input type="checkbox" data-notif="${k}" ${profile.notif?.[k] !== false ? 'checked' : ''}><span><b>${l}</b><small class="muted">${d}</small></span></label>${k === 'plan' ? `<label class="f notifat">Uhrzeit für das Training des Tages<input class="inp" id="remAt" type="time" value="${esc(profile.remindAt || '18:00')}"></label>` : ''}`).join('')}
        <label class="switch pushsw"><input type="checkbox" id="pushOn" ${localStorage.getItem('vvPush') !== '0' ? 'checked' : ''}><span></span> <div class="swt"><i style="font-style:normal">📲 Auch bei geschlossener App (Push) <b class="muted small" style="font-weight:400">(dieses Gerät)</b></i><small class="muted">Nachrichten und Anrufe kommen auch an, wenn IndooRado nicht läuft; tippen öffnet Chat bzw. Anruf. Braucht ein Konto. Die kurze Meldung (ohne Nachrichteninhalt) läuft verschlüsselt über den Push-Dienst deines Geräts (Google, Apple, Mozilla). iPhone/iPad: nur als App vom Home-Bildschirm.</small></div></label>
        <div class="row"><button class="btn sm" id="notifTest">🔔 Test-Benachrichtigung</button><button class="btn sm" id="pushTest">📲 Test-Push</button></div>
      </div>
    </div>
    <div class="card form" id="privCard"><h2>Privatsphäre</h2><p class="small muted">Wird geladen …</p></div>
  </section>`,
  app: `
  <section class="pagehead"><h1>App</h1></section>
  <section class="grid2">
    <div class="card form"><h2>Erscheinungsbild</h2>
      <label class="f"><span data-noi18n>🌍 Sprache · Language</span><select class="inp" id="appLang" data-noi18n>${I18N.LANGS.map(([k, n, f]) => `<option value="${k}" ${I18N.lang() === k ? 'selected' : ''}>${f} ${n}</option>`).join('')}</select></label>
      <label class="f">Thema<select class="inp" id="appTheme">${[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'Wie das Gerät']].map(([v, l]) => `<option value="${v}" ${theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="f">Akzentfarbe<div class="swatches" id="appAcc">${['#ff6a3d', '#3fa7f5', '#4fd18b', '#f5c542', '#b06cf0', '#ef4458', '#00c2c7'].map(c => `<button style="background:${c}" data-c="${c}" aria-pressed="${acc === c}" aria-label="Farbe ${c}"></button>`).join('')}</div></div>
      <p class="small muted">Gilt für Menüs und Seiten. Die Anzeige während der Fahrt hat einen eigenen Stil unter <a href="#/ridesettings">Fahransicht</a>.</p>
      <p class="small muted">🔔 Benachrichtigungen und Push stellst du unter <a href="#/notify">Einstellungen › Benachrichtigungen</a> ein.</p>
      <div class="row" id="instRow" hidden><button class="btn" id="instBtn">📲 IndooRado als App installieren</button></div>
      <label class="f">Mapillary-Schlüssel für Straßenbilder <span class="muted small">(optional)</span><input class="inp" id="mlyTok" autocomplete="off" spellcheck="false" placeholder="MLY|…" value="${esc(profile.mlyToken || '')}"><small class="muted">Öffentlicher Client-Schlüssel von mapillary.com › Developers (kostenlos). Ohne Eintrag gilt der Schlüssel des Betreibers, falls vorhanden.</small></label>
      <label class="switch"><input type="checkbox" id="tvMode" ${localStorage.getItem('vvTv') === '1' ? 'checked' : ''}><span></span> <div class="swt"><i style="font-style:normal">📺 Fernseher-Modus <b class="muted small" style="font-weight:400">(nur dieses Gerät)</b></i><small class="muted">Große Schrift, Bedienung mit den Pfeiltasten der Fernbedienung (Enter = auswählen, Zurück = zurück). Gamepads gehen immer: Steuerkreuz, A, B, Start = Pause, LB/RB = Gang, X = Kamera, Y = Ride On. Handy als Fernbedienung: in der Handy-Ansicht mit demselben Konto.</small></div></label>
      <label class="f">Ansicht der Startseite<select class="inp" id="phoneView">${[['auto', 'Automatisch: auf Handys kompakt'], ['always', 'Immer kompakte Handy-Ansicht'], ['never', 'Immer volle Ansicht']].map(([v, l]) => `<option value="${v}" ${(profile.phoneView || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="small muted">Die kompakte Ansicht zeigt nächste Fahrt, Woche, Missionen und eine laufende Fahrt, gut lesbar auf dem Handy. Dieses Gerät wird gerade als ${(await import('../app.js')).isPhone() ? '<b>Handy</b>' : '<b>Tablet oder Computer</b>'} erkannt.</p>
      <h2 style="margin-top:18px">Barrierefreiheit</h2>
      <label class="f">Schriftgröße<select class="inp" id="fontScale">${[['0.9', 'Klein (90 %)'], ['1', 'Normal'], ['1.15', 'Groß (115 %)'], ['1.3', 'Sehr groß (130 %)']].map(([v, l]) => `<option value="${v}" ${+v === +(profile.fontScale || 1) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="switch"><input type="checkbox" id="highContrast" ${profile.highContrast ? 'checked' : ''}><span></span> <div class="swt">Hoher Kontrast<small class="muted">Kräftigere Schrift, deutlichere Ränder und Fokusrahmen</small></div></label>
      <label class="f">Bewegung und Animationen<select class="inp" id="reduceMotion">${[['auto', 'Wie im Gerät eingestellt'], ['on', 'Reduzieren (keine Wackler, weniger Kamerafahrten)'], ['off', 'Alle Animationen']].map(([v, l]) => `<option value="${v}" ${(profile.reduceMotion === true ? 'on' : profile.reduceMotion === false ? 'off' : 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="small muted">Alle Knöpfe sind per Tastatur erreichbar (Tab, Enter). Mit <kbd>?</kbd> siehst du alle Tastenkürzel. Sprachansagen für die Fahrt findest du unter <a href="#/sound">Ton</a>.</p>
      <h2 style="margin-top:18px">Grafik</h2>
      <label class="f">Qualität der 3D-Welt<select class="inp" id="quality">${[['auto', 'Automatisch (' + ({ high: 'hoch', medium: 'mittel' }[autoQuality()]) + ')'], ['high', 'Hoch: Schatten, weite Sicht'], ['medium', 'Mittel: für Tablets'], ['low', 'Niedrig: für ältere Geräte']].map(([v, l]) => `<option value="${v}" ${profile.quality === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="small muted">Ruckelt die Fahrt, senkt die App die Auflösung automatisch. Auf schwachen Geräten hilft zusätzlich „Mittel“ oder „Niedrig“.</p>
    </div>
    <div class="card form"><h2>Daten</h2>
      <p class="small muted">Gespeichert werden Profil, Einstellungen, gekoppelte Geräte und Tastenbelegung, Fahrten mit Fotos, Level, Abzeichen, Missionen, Bestzeiten, Trainingsplan-Fortschritt sowie eigene Strecken, Pläne und Workouts. Die Sicherung enthält alles davon in einer Datei, aber keine Passwörter oder Schlüssel.</p>
      <p class="small muted">Alles wird in diesem Browser unter <b>${esc(location.origin)}</b> gespeichert. Unter einer anderen Adresse siehst du andere Daten. Sichere regelmäßig oder richte unter <a href="#/connect">Verbindungen</a> einen Cloud-Speicher ein (NAS, OneDrive, Google Drive, Dropbox).</p>
      <p class="small muted">Belegt: ${u ? (u.usage / 1048576).toFixed(1).replace('.', ',') + ' MB' : 'unbekannt'} · Dauerhafter Speicher: ${pers ? 'ja' : 'nicht bestätigt'}</p>
      <label class="switch"><input type="checkbox" id="bkSec"><span></span> <div class="swt">Anmeldungen mitsichern<small class="muted">Strava, Cloud-Speicher und NAS, mit einem Passwort verschlüsselt. So bist du nach dem Einspielen sofort wieder angemeldet.</small></div></label>
      <div class="row"><button class="btn" id="bk">Sicherung herunterladen</button><label class="btn">Sicherung einspielen<input type="file" id="rs" accept=".json" hidden></label></div>
      <div class="row"><button class="btn ghost danger" id="wp">🗑 App zurücksetzen</button></div><p class="small muted">Löscht alle Daten der App auf diesem Gerät (Werkseinstellungen). Was in deinem Konto online gespeichert ist, bleibt erhalten.</p>
    </div>
  </section>
  <section class="card form"><h2>Einwilligungen</h2>
    <p class="small muted">Funktionen, die Daten an einen fremden Dienst schicken, fragen vor der ersten Nutzung. Hier siehst du den Stand, kannst Zustimmungen widerrufen oder abgelehnte nachträglich erteilen.</p>
    <div id="cnsList">${(() => { const N = { osm: 'Echte Gebäude (OpenStreetMap / Overpass)', call: 'Videoanrufe (WebRTC, TURN)', mly: 'Echte Straßenbilder (Mapillary)', voice: 'Sprachsteuerung (Spracherkennung des Browsers)' }, c = profile.consents || {}; const no = profile.consentsNo || {}; return Object.keys(N).map(k => c[k] ? `<div class="row between cnsrow"><span>✅ ${N[k]}</span><button class="btn xs ghost" data-revoke="${k}">Widerrufen</button></div>` : `<div class="row between cnsrow"><span>${no[k] ? '🚫' : '⚪'} ${N[k]}${no[k] ? ' <small class="muted">(abgelehnt)</small>' : ''}</span>${k === 'mly' ? `<button class="btn xs" data-grant="${k}">Zustimmen</button>` : '<small class="muted">wird bei der Nutzung gefragt</small>'}</div>`).join(''); })()}</div>
  </section>
  <section class="card form"><h2>Technik</h2>
    <label class="switch"><input type="checkbox" id="saveDemo" ${profile.saveDemo ? 'checked' : ''}><span></span> <div class="swt">Fahrten mit Demo-Geräten speichern<small class="muted">Zum Testen, z. B. des Strava-Uploads. Solche Fahrten zählen dann wie echte Fahrten (XP, Rekorde, Trainingsplan) und sind in der Zusammenfassung als Demo markiert. Danach am besten wieder ausschalten.</small></div></label>
    <p class="small muted"><span id="buildInfo">Version ${esc(APP_VERSION)}</span> · ${navigator.bluetooth ? 'Bluetooth verfügbar' : 'Kein Web-Bluetooth in diesem Browser (Chrome oder Edge nötig)'} · ${location.protocol === 'https:' ? 'Offline-Betrieb aktiv' : 'Offline-Betrieb nur über https'}</p>
    <div class="row"><button class="btn sm" id="onbAgain">Einrichtung erneut starten</button><button class="btn sm" id="appReload" title="Zwischengespeicherte App-Dateien verwerfen und neu laden, Daten bleiben erhalten">App aktualisieren</button></div>
  </section>`,
  connect: `
  <section class="pagehead"><h1>Verbindungen</h1></section>
  ${sync.online ? `<section class="card pausebox"><b>☁ Abgleich läuft über IndooRado Online.</b> <span class="small muted">Solange du angemeldet bist, pausiert ${sync.cfg && (sync.cfg.host || sync.cfg.url || sync.cfg.clientId) ? 'der Abgleich mit ' + esc(providerName(sync.cfg.mode)) : 'jeder andere Cloud-Speicher'}. Nach dem Abmelden geht es dort automatisch weiter. Strava ist davon unabhängig.</span> <a href="#/account" class="small">Zum Konto</a></section>` : ''}
  <section class="card form" id="stravaCard"></section>
  <section class="card form" id="nasCard"></section>`,
  };
  el.innerHTML = html[sec] || html.profile;
  { const fb = el.querySelector('#famCard'); if (fb) { const F = await import('../family.js'); fb.innerHTML = F.familyCardHtml(esc); F.wireFamilyCard(fb, esc, dialog, toast); } }
  const on = (sel, ev, fn) => { const x = $(sel, el); if (x) x[ev] = fn; };
  // Privatsphäre unter Freunden (gespeichert im Online-Profil, vom Server durchgesetzt)
  if ($('#privCard', el)) { const O = await import('../online/client.js'), pc = $('#privCard', el);
    if (!O.loggedIn()) pc.innerHTML = '<h2>Privatsphäre</h2><p class="small muted">Gilt für Freunde, Anrufe und Nachrichten und braucht ein IndooRado-Konto.</p><a class="btn sm" href="#/account">Anmelden</a>';
    else { pc.innerHTML = `<h2>Privatsphäre</h2>
      <label class="switch"><input type="checkbox" id="frShare" ${O.online.profile?.share_rides ? 'checked' : ''}><span></span> <div class="swt">Freunde dürfen meine einzelnen Fahrten sehen<small class="muted">Datum, Strecke, Distanz, Dauer, Höhenmeter, Ø Watt. Ohne diese Erlaubnis sehen Freunde nur Level und Summen. Puls, Gewicht und Alter sieht nie jemand.</small></div></label>
      <label class="switch"><input type="checkbox" id="frFind" ${O.online.profile?.discoverable !== false ? 'checked' : ''}><span></span> <div class="swt">In der Suche auffindbar<small class="muted">Andere angemeldete Spieler finden dich über deinen Namen und sehen dabei Name, Avatar und Level. Standardmäßig an. Ausgeschaltet können dich Freunde trotzdem per Freundescode oder über die Online-Liste anfragen.</small></div></label>
      <label class="switch"><input type="checkbox" id="frCalls" ${O.online.profile?.allow_calls !== false ? 'checked' : ''}><span></span> <div class="swt">Anrufe (Video und Sprache)<small class="muted">Ausgeschaltet kann dich niemand anrufen, und du rufst auch selbst niemanden an. Nachrichten gehen weiter. Standardmäßig an.</small></div></label>
      <label class="switch"><input type="checkbox" id="frMsgs" ${O.online.profile?.allow_msgs !== false ? 'checked' : ''}><span></span> <div class="swt">Freunde dürfen mir Nachrichten schreiben<small class="muted">Ausgeschaltet kommen keine neuen Chat-Nachrichten mehr an; der bisherige Verlauf bleibt. Standardmäßig an.</small></div></label>
`;
      pc.onchange = async e => { const k = { frShare: 'share_rides', frFind: 'discoverable', frCalls: 'allow_calls', frMsgs: 'allow_msgs' }[e.target.id]; if (!k) return;
        try { await O.updateProfile({ [k]: e.target.checked }); toast('Gespeichert', 900); } catch (er) { e.target.checked = !e.target.checked; toast(er.message, 4000); } }; } }
  if ($('#nasCard', el)) nasCard($('#nasCard', el));
  if ($('#stravaCard', el)) stravaCard($('#stravaCard', el));
  on('#onbAgain', 'onclick', () => import('../onboard.js').then(m => m.onboarding(true)));
  const num = ['ftp', 'kg', 'hrMax', 'bike', 'circ', 'maxW', 'age', 'hrRest'];
  on('#sex', 'onchange', e => { profile.sex = e.target.value; saveProfile(); toast('Gespeichert', 1200); });
  for (const k of ['name', ...num]) on('#' + k, 'onchange', e => { const v = num.includes(k) ? parseFloat(e.target.value) : e.target.value.trim(); if (num.includes(k) && isNaN(v)) return; if (k === 'ftp' && v !== profile.ftp) profile.ftpHistory = [...(profile.ftpHistory || []), { date: new Date().toISOString(), ftp: v, source: 'manuell' }]; profile[k] = v; saveProfile(); toast('Gespeichert', 1200); });
  on('#appReload', 'onclick', async () => { try { for (const k of await caches.keys()) await caches.delete(k); for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.update(); } catch (e) { } location.reload(); });
  on('#cda', 'onchange', e => { profile.cda = +e.target.value; saveProfile(); });
  // Version mit Commit und Build (aus build.json)
  if ($('#buildInfo', el)) import('../version.js').then(async V => { const i = await V.buildInfo(), u = V.commitUrl(i), b = $('#buildInfo', el); if (!b) return; b.innerHTML = 'Version ' + esc(V.buildText(i)) + (u ? ` · <a href="${esc(u)}" target="_blank" rel="noopener">Commit ansehen</a>` : ''); b.title = i.message || ''; });
  on('#saveDemo', 'onchange', e => { profile.saveDemo = e.target.checked; saveProfile(); toast(e.target.checked ? 'Demo-Fahrten werden gespeichert' : 'Demo-Fahrten werden nicht mehr gespeichert', 2000); });
  on('#quality', 'onchange', e => { profile.quality = e.target.value; saveProfile(); toast('Gilt ab der nächsten Fahrt', 1500); });
  on('#phoneView', 'onchange', e => { profile.phoneView = e.target.value; saveProfile(); toast('Gespeichert', 900); });
  el.querySelectorAll('[data-grant]').forEach(b => b.onclick = async () => { if (b.dataset.grant === 'mly' && (await (await import('../streetimg.js')).askConsent(true))) { toast('Zugestimmt – Straßenbilder erscheinen ab der nächsten passenden Fahrt'); render(el, ['app']); } });
  el.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => { (await import('../consent.js')).revoke(b.dataset.revoke); toast('Einwilligung widerrufen'); b.closest('.row').remove(); });
  on('#appTheme', 'onchange', e => { profile.appTheme = e.target.value; saveProfile(); applyAppTheme(); });
  on('#mlyTok', 'onchange', e => { const v = e.target.value.trim(); if (v && !/^MLY\|[\w|]{10,200}$/.test(v)) { toast('Das sieht nicht wie ein Mapillary-Client-Schlüssel (MLY|…) aus'); return; } profile.mlyToken = v; saveProfile(); toast(v ? 'Mapillary-Schlüssel gespeichert' : 'Mapillary-Schlüssel entfernt'); });
  on('#remOn', 'onchange', async e => { const C = await import('../comfort.js'); if (!(await C.enableReminders(e.target.checked))) e.target.checked = false; else toast(e.target.checked ? '🔔 Benachrichtigungen an' : 'Benachrichtigungen aus'); const k = $('#notifKinds', el); if (k) k.hidden = !e.target.checked; });
  el.querySelectorAll('[data-notif]').forEach(x => x.onchange = async () => { (await import('../comfort.js')).setNotif(x.dataset.notif, x.checked); toast('Gespeichert', 900); if (['msg', 'call', 'friendreq', 'invite'].includes(x.dataset.notif)) (await import('../push.js')).refreshPush(); });
  on('#pushOn', 'onchange', async e => { const P = await import('../push.js'); if (e.target.checked) { try { await P.enablePush(); toast('📲 Push-Benachrichtigungen an'); } catch (x) { e.target.checked = false; toast(x.message, 6000); } } else { await P.disablePush(); toast('Push aus'); } });
  on('#pushTest', 'onclick', async e => { const b = e.currentTarget; b.disabled = true; try { const r = await (await import('../push.js')).selfTest(); toast(`📲 Test-Push verschickt (${r.sent} von ${r.devices} Gerät${r.devices === 1 ? '' : 'en'}) – kommt in 6 Sekunden. Jetzt zum Startbildschirm wechseln, dann erscheint er als Pop-up.`, 6000); } catch (x) { toast('Test-Push: ' + x.message, 8000); } finally { b.disabled = false; } });
  on('#notifTest', 'onclick', async () => { if (!(await (await import('../comfort.js')).testNotify())) toast('Keine Benachrichtigung möglich – im Browser oder Gerät erlaubt?', 5000); });
  on('#remAt', 'onchange', async e => { profile.remindAt = e.target.value || '18:00'; saveProfile(); (await import('../comfort.js')).scheduleReminders(); });
  import('../comfort.js').then(C => { const r = $('#instRow', el); if (r && C.canInstall()) { r.hidden = false; $('#instBtn', el).onclick = () => C.install(); } });
  on('#appLang', 'onchange', e => I18N.setLang(e.target.value));
  on('#tvMode', 'onchange', async e => { (await import('../tv.js')).setTv(e.target.checked); if (profile.tvMode) { delete profile.tvMode; saveProfile(); } });
  on('#fontScale', 'onchange', e => { profile.fontScale = +e.target.value; saveProfile(); applyAppTheme(); });
  on('#highContrast', 'onchange', e => { profile.highContrast = e.target.checked; saveProfile(); applyAppTheme(); });
  on('#reduceMotion', 'onchange', e => { profile.reduceMotion = { on: true, off: false }[e.target.value]; if (e.target.value === 'auto') delete profile.reduceMotion; saveProfile(); applyAppTheme(); });
  on('#appAcc', 'onclick', e => { const b = e.target.closest('[data-c]'); if (!b) return; profile.appAccent = b.dataset.c; saveProfile(); applyAppTheme(); for (const x of el.querySelectorAll('#appAcc [data-c]')) x.setAttribute('aria-pressed', String(x === b)); });
  el.querySelectorAll('.swatches[data-k]').forEach(sw => {
    sw.onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; profile[sw.dataset.k] = b.dataset.c; saveProfile(); for (const x of sw.querySelectorAll('[data-c]')) x.setAttribute('aria-pressed', String(x === b)); };
    sw.oninput = e => { if (e.target.type === 'color') { profile[sw.dataset.k] = e.target.value; saveProfile(); } };
  });
  const askPass = (title, confirm) => new Promise(async res => {
    let v1 = '', v2 = '';
    const p = dialog({ title, html: `<input class="inp" id="pw1" type="password" placeholder="Passwort" autocomplete="new-password">${confirm ? '<input class="inp" id="pw2" type="password" placeholder="Passwort wiederholen" style="margin-top:8px">' : ''}<p class="small muted">Ohne dieses Passwort lassen sich die Anmeldungen nicht wiederherstellen.</p>`, buttons: [{ label: 'Abbrechen', value: null }, { label: 'OK', value: 'ok', cls: 'pri' }] });
    const i1 = document.getElementById('pw1'), i2 = document.getElementById('pw2'); i1.focus(); i1.oninput = () => v1 = i1.value; if (i2) i2.oninput = () => v2 = i2.value;
    if (await p !== 'ok' || !v1) return res(null);
    if (confirm && v1 !== v2) { toast('Passwörter stimmen nicht überein', 3000); return res(null); }
    if (confirm && v1.length < 6) { toast('Bitte mindestens 6 Zeichen', 3000); return res(null); }
    res(v1);
  });
  on('#bk', 'onclick', async () => {
    let secretsPass = null;
    if ($('#bkSec', el)?.checked) { secretsPass = await askPass('Passwort für die Anmeldungen', true); if (!secretsPass) return; }
    download('indoorado-sicherung-' + new Date().toISOString().slice(0, 10) + '.json', await backup({ secretsPass }), 'application/json');
  });
  on('#rs', 'onchange', async e => { try { await restore(await e.target.files[0].text(), { askPass: () => askPass('Sicherung enthält Anmeldungen: Passwort eingeben') }); toast('Sicherung eingespielt, App wird neu geladen'); setTimeout(() => location.reload(), 1200); } catch (err) { toast('Fehler: ' + err.message, 5000); } });
  on('#wp', 'onclick', async () => {
    const nas = sync.cfg?.url;
    if (!(await dialog({ title: 'Alle lokalen Daten löschen?', html: `<p>Die App wird auf diesem Gerät in den <b>Auslieferungszustand</b> zurückgesetzt. Unwiderruflich gelöscht werden: alle Fahrten und Fotos, Fortschritt, Pläne, eigene Strecken und Workouts, Einstellungen, Geräte, <b>alle Familienprofile</b>, die Anmeldung aller IndooRado-Konten auf diesem Gerät, NAS-, Cloud- und Strava-Zugang sowie der App-Cache. Danach startet die App neu wie beim ersten Öffnen.</p><p class="muted small">Was in deinem IndooRado-Konto online gespeichert ist, bleibt erhalten und kommt nach erneuter Anmeldung zurück.</p><p class="muted small">${nas ? 'Die Daten auf dem NAS bleiben erhalten und lassen sich danach mit „Vom NAS laden“ zurückholen.' : 'Ohne Sicherungsdatei oder NAS sind die Daten danach weg.'}</p>`, buttons: [{ label: 'Abbrechen', value: false }, { label: 'Endgültig löschen', value: true, cls: 'danger' }] }))) return;
    await wipeAll(); location.replace(location.pathname + '#/');
    setTimeout(() => location.reload(), 50);
  });
}
