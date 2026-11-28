import { vault, loadVault, enableVault, unlockVault, disableVaultMeta, isEncrypted, encrypt, decrypt } from './vault.js';
// Abgleich mit dem NAS, zusätzlich zum Browser-Speicher.
// Zwei Wege: Synology-Anmeldung (DSM-Konto inkl. 2FA, File Station API) oder WebDAV.
// Aufbau im Ordner: state.json (Einstellungen, Fortschritt, eigene Strecken/Workouts), rides/<id>.json, shots/<id>.jpg
import { SCHEMA } from './store.js';
import { db, kv } from './db.js';
import { bus } from './util.js';
import { PROVIDERS, isOAuth, backend, finishOAuth, fresh } from './cloud.js';

const LOCAL_ONLY_SET = new Set(['sync', 'syncMeta', 'demo', 'strava', 'musicFiles', 'device', 'kvTimes', 'cloudApps', 'videoHandles', 'intervalsIcu', 'rideSnap', 'notiLog']);
// Tresor-Schlüssel bleiben immer nur auf dem Gerät
const LOCAL_ONLY = { has: k => LOCAL_ONLY_SET.has(k) || String(k).startsWith('vaultKey:') };
// Listen gelöschter Einträge: werden zwischen den Geräten zusammengeführt, nicht überschrieben
const TOMBS = ['deletedRides', 'deletedWorkouts', 'deletedRoutes', 'deletedPlans'];
export const sync = { online: false, cfg: null, busy: false, last: null, error: null, dirsOk: false, needLogin: false, rev: null, devices: {}, device: null, info: '' };

/* ---------- IndooRado Online als Speicherort ----------
   Solange man online angemeldet ist, läuft der Abgleich über den privaten Supabase-Ordner des Kontos;
   NAS, WebDAV, OneDrive, Google Drive und Dropbox pausieren – bis auf die Fahrtfotos: Die landen nie in Supabase,
   sondern nur im verbundenen eigenen Speicher (siehe photoSync), und werden von dort zu den Fahrten nachgeladen. */
let ON = null; // { sb, uid }
const META = () => ON ? 'syncMetaOnline' : 'syncMeta';
export async function setOnlineBackend(o) {
  const was = !!ON; ON = o && o.uid ? o : null; vault.status = 'unknown'; vault.key = null; vault.meta = null; sync.online = !!ON; sync.dirsOk = false; sync.needLogin = false; sync.error = null;
  if (was !== !!ON) { const m = await kv.get(META(), {}); sync.last = m.at || null; sync.rev = m.rev ?? null; sync.revAt = m.revAt || null; sync.devices = m.devices || {}; }
  bus.emit('sync');
}
export const nasPaused = () => !!ON && !!(sync.cfg && (sync.cfg.host || sync.cfg.url || sync.cfg.clientId));
// Lesbare Fehlermeldung aus Supabase-Fehlern (manche haben nur einen HTTP-Status)
const sbErr = e => e?.message && e.message !== '{}' ? e.message : (e?.status ?? e?.statusCode ?? e?.originalError?.status) ? 'HTTP ' + (e.status ?? e.statusCode ?? e.originalError.status) + (e.originalError?.statusText ? ' ' + e.originalError.statusText : '') : 'unbekannter Fehler';
// Online-Speicher (Supabase). Ist der Tresor eingeschaltet, wird jede Datei vor dem Hochladen verschlüsselt und nach dem
// Herunterladen entschlüsselt (siehe vault.js). Ohne Schlüssel auf diesem Gerät wird nichts unverschlüsselt hochgeladen.
const typeOf = rel => /\.jpe?g$/.test(rel) ? 'image/jpeg' : /\.json$/.test(rel) ? 'application/json' : 'application/octet-stream';
async function vaultReady() { if (vault.status === 'unknown') await loadVault(SBK); }
const SBK = {
  p: rel => `${ON.uid}/sync/${rel}`.replace(/\/+$/, ''),
  async mkdir() { },
  async put(rel, body, type) {
    await vaultReady();
    if (vault.status === 'locked') { const e = new Error('Online-Daten sind verschlüsselt: bitte unter Konto › Tresor das Tresor-Passwort eingeben.'); e.locked = true; throw e; }
    if (vault.status === 'on') return SBK.putRaw(rel, new Blob([await encrypt(body instanceof Blob ? body : String(body))], { type: 'application/octet-stream' }), 'application/octet-stream');
    return SBK.putRaw(rel, body, type);
  },
  async get(rel) {
    await vaultReady();
    const b = await SBK.getRaw(rel); if (!b) return null;
    const u8 = new Uint8Array(await b.arrayBuffer());
    // Tresor an, aber Datei unverschlüsselt (z. B. von einem Gerät geschrieben, das den Tresor noch nicht kannte): annehmen
    // und gleich verschlüsselt neu ablegen, damit nichts unverschlüsselt online bleibt
    if (!isEncrypted(u8)) { if (vault.status === 'on' && rel !== 'vault.json') encrypt(u8).then(c => SBK.putRaw(rel, new Blob([c]), 'application/octet-stream')).catch(() => { }); return new Blob([u8], { type: typeOf(rel) }); }
    return new Blob([await decrypt(u8)], { type: typeOf(rel) });
  },
  async delRaw(rel) { await ON.sb.storage.from('vault').remove([SBK.p(rel)]); },
  async putRaw(rel, body, type) { const { error } = await ON.sb.storage.from('vault').upload(SBK.p(rel), body instanceof Blob ? body : new Blob([body], { type: type || 'application/octet-stream' }), { upsert: true, contentType: type || 'application/octet-stream' }); if (error) throw new Error('Online: ' + sbErr(error)); },
  // Fehlende Datei = null. Supabase meldet das je nach Version als 400/404 oder mit leerem Fehlerobjekt "{}".
  async getRaw(rel) { const { data, error } = await ON.sb.storage.from('vault').download(SBK.p(rel)); if (error) { const st = error.status ?? error.statusCode ?? error.originalError?.status; if ([400, 404].includes(+st) || /not.?found|Object not found|^\{\}$/i.test(error.message || '{}')) return null; throw new Error('Online: ' + sbErr(error)); } return data; },
  async list(rel) {
    const out = []; for (let off = 0; ; off += 1000) { const { data, error } = await ON.sb.storage.from('vault').list(SBK.p(rel), { limit: 1000, offset: off }); if (error) throw new Error('Online: ' + sbErr(error)); out.push(...data.map(f => f.name).filter(n => n !== '.emptyFolderPlaceholder')); if (data.length < 1000) break; }
    return out;
  },
  async del(rel) { await ON.sb.storage.from('vault').remove([SBK.p(rel)]); },
};
/* ---------- Tresor verwalten (nur Online-Konto) ---------- */
// Exklusiv (kein Abgleich parallel), Fehler gehen an den Aufrufer
async function exclusive(fn) { for (let i = 0; i < 100 && sync.busy; i++) await new Promise(r => setTimeout(r, 200)); sync.busy = true; bus.emit('sync'); try { return await fn(); } finally { sync.busy = false; bus.emit('sync'); } }
export async function vaultInfo() { if (!ON) return { status: 'off' }; await loadVault(SBK); return { status: vault.status, meta: vault.meta }; }
// Alle vorhandenen Dateien im Online-Speicher ver- bzw. entschlüsseln (beim Ein- und Ausschalten)
async function recodeAll(encryptNow, onStep) {
  const files = ['state.json', 'live.json', ...(await SBK.list('rides/')).map(f => 'rides/' + f)];
  let n = 0;
  for (const f of files) {
    const b = await SBK.getRaw(f); n++; onStep?.(n, files.length); if (!b) continue;
    const u8 = new Uint8Array(await b.arrayBuffer()), enc = isEncrypted(u8);
    if (encryptNow && !enc) await SBK.putRaw(f, new Blob([await encrypt(u8)]), 'application/octet-stream');
    if (!encryptNow && enc) await SBK.putRaw(f, new Blob([await decrypt(u8)], { type: typeOf(f) }), typeOf(f));
  }
  return files.length;
}
export async function vaultEnable(pass, onStep) { if (!ON) throw new Error('Nur mit IndooRado-Konto'); return exclusive(async () => { await enableVault(SBK, pass); return recodeAll(true, onStep); }); }
export async function vaultUnlock(pass) { await loadVault(SBK); await unlockVault(pass); sync.error = null; bus.emit('sync'); }
export async function vaultDisable(onStep) { if (!ON) return; return exclusive(async () => { await loadVault(SBK); if (vault.status !== 'on') throw new Error('Zum Ausschalten muss der Tresor auf diesem Gerät entsperrt sein'); const n = await recodeAll(false, onStep); await disableVaultMeta(SBK); return n; }); }

// Was online landen darf (Einstellungen › Konto › Daten online)
// Fotos nie (shots bleibt fest aus): die liegen nur im eigenen NAS bzw. Cloud-Speicher
export const PREF_DEFAULT = { rides: 'full', hr: false, cad: true, power: true, gps: true, shots: false, leaderboard: true };
const prefs = async () => ({ ...PREF_DEFAULT, ...(await kv.get('onlinePrefs', {})) });
async function filterRide(r) {
  const P = await prefs(); if (!ON) return r;
  if (P.rides === 'summary') return { ...r, samples: [], samplesOmitted: true };
  if (P.hr && P.cad && P.power && P.gps) return r;
  const samples = (r.samples || []).map(x => { const y = { ...x }; if (!P.hr) y.hr = null; if (!P.cad) y.cad = null; if (!P.power) y.p = 0; if (!P.gps) { delete y.la; delete y.lo; } return y; });
  const sum = { ...r.sum }; if (!P.hr) { sum.avgHr = null; sum.maxHr = null; sum.hrz = []; }
  return { ...r, samples, sum, intervals: P.hr ? r.intervals : (r.intervals || []).map(v => ({ ...v, hr: null })) };
}

export async function loadSync() {
  sync.cfg = await kv.get('sync', null);
  const m = await kv.get(META(), {}); sync.last = m.at || null; sync.rev = m.rev ?? null; sync.revAt = m.revAt || null; sync.devices = m.devices || {};
  sync.device = await kv.get('device', null);
  if (!sync.device) { sync.device = { id: Math.random().toString(36).slice(2, 10), name: deviceName() }; await kv.set('device', sync.device); }
  kvT = await kv.get('kvTimes', {});
  // Einmalig: Geräte, die wegen eines Rechtefehlers nie wirklich abgemeldet wurden, wieder in die Liste holen
  if (!(await kv.get('devRmReset1', false))) { await kv.set('removedDevices', []); await kv.set('devRmReset1', true); }
}
// Kurzer Gerätename aus dem Browser, z. B. „Windows · Chrome“ oder „Android · Chrome“
function deviceName() {
  const u = navigator.userAgent, os = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iPhone/iPad' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'Gerät';
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox/.test(u) ? 'Firefox' : /Chrome/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : 'Browser';
  return os + ' · ' + br;
}
export async function renameDevice(name) { sync.device.name = name.trim().slice(0, 40) || deviceName(); await kv.set('device', sync.device); schedulePush(1000); }
// Änderungszeit je Einstellung, damit beim Abgleich die jeweils neuere Seite gewinnt
let kvT = {}, applying = false, tSave = null;
bus.on('dbchange', ({ s, k }) => {
  if (s !== 'kv' || applying || LOCAL_ONLY.has(k)) return;
  kvT[k] = Date.now(); clearTimeout(tSave); tSave = setTimeout(() => kv.set('kvTimes', kvT), 300);
});
export async function saveSyncCfg(cfg) {
  const key = c => c ? [c.mode, c.host, c.folder, c.url, c.clientId].join('|') : '';
  // Anderes Ziel: zählt als erstes Verbinden, damit dort zuerst nur gelesen wird
  if (key(cfg) !== key(sync.cfg)) { sync.rev = null; sync.last = null; sync.devices = {}; await kv.set('syncMeta', {}); }
  sync.cfg = cfg; sync.dirsOk = false; await kv.set('sync', cfg);
}
const extConfigured = () => !!(sync.cfg && (isOAuth(sync.cfg.mode) ? sync.cfg.refresh || sync.cfg.access : sync.cfg.mode === 'dsm' ? sync.cfg.host && sync.cfg.folder : sync.cfg.url));
const configured = () => !!ON || extConfigured();
export const isConfigured = configured;
// Anzeigename des Speichers: Synology, WebDAV, OneDrive, Google Drive, Dropbox
export const providerName = (m = ON ? 'online' : sync.cfg?.mode) => m === 'online' ? 'IndooRado Online' : PROVIDERS[m]?.name || (m === 'webdav' ? 'WebDAV' : m === 'dsm' ? 'Synology' : 'Cloud');
// Rückkehr von der Anmeldung bei OneDrive, Google oder Dropbox
export async function handleCloudRedirect() {
  const cfg = await finishOAuth(); if (!cfg) return null;
  const apps = await kv.get('cloudApps', {}); apps[cfg.mode] = { clientId: cfg.clientId, secret: cfg.secret }; await kv.set('cloudApps', apps);
  await saveSyncCfg(cfg); sync.needLogin = false; sync.error = null; bus.emit('sync');
  return providerName(cfg.mode) + (cfg.account ? ': ' + cfg.account : '');
}

/* ---------- Synology DSM (File Station API) ---------- */
const DSM_ERR = { 400: 'Benutzername oder Passwort falsch', 401: 'Konto deaktiviert', 402: 'Keine Berechtigung', 403: '2FA-Code nötig', 404: '2FA-Code falsch', 406: 'Für dieses Konto muss erst 2FA eingerichtet werden', 407: 'IP-Adresse gesperrt (zu viele Fehlversuche)', 408: 'Ordner oder Datei nicht gefunden', 119: 'Anmeldung abgelaufen', 106: 'Anmeldung abgelaufen', 105: 'Keine Berechtigung für diesen Ordner', 1100: 'Ordner konnte nicht angelegt werden' };
export class DsmError extends Error { constructor(code) { super(DSM_ERR[code] || 'DSM-Fehler ' + code); this.code = code; } }
const dsmBase = () => sync.cfg.host.replace(/\/+$/, '') + '/webapi/entry.cgi';
const enc = v => typeof v === 'string' ? v : JSON.stringify(v);
async function dsmCall(params, { post = false, body = null } = {}) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, enc(v)]));
  if (sync.cfg.sid) q.set('_sid', sync.cfg.sid);
  const r = post ? await fetch(dsmBase() + (body ? '?' + q : ''), { method: 'POST', body: body || q, cache: 'no-store' }) : await fetch(dsmBase() + '?' + q, { cache: 'no-store' });
  return r;
}
async function dsmJson(params, opt) {
  const r = await dsmCall(params, opt); const j = await r.json().catch(() => null);
  if (!j) throw new Error('Unerwartete Antwort vom NAS (HTTP ' + r.status + ')');
  if (!j.success) { const c = j.error?.code; if (c === 119 || c === 106 || c === 107) { sync.cfg.sid = null; sync.needLogin = true; } throw new DsmError(c); }
  return j.data || {};
}
// Anmeldung mit DSM-Konto. Bei aktivierter 2FA zuerst ohne Code (Fehler 403), dann mit Code.
// "Gerät merken" (device token) erspart den Code bei späteren Anmeldungen.
// NAS-Adresse vereinheitlichen: immer https, Standardport 443 (kein Port nötig), ohne Pfad am Ende
export function normalizeHost(v) {
  let s = String(v || '').trim();
  if (!s) return s;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/^http:\/\//i, 'https://');
  try { const u = new URL(s); if (u.port === '443') u.port = ''; return (u.origin + u.pathname).replace(/\/+$/, ''); } catch (e) { return s.replace(/\/+$/, ''); }
}
export async function dsmLogin({ host, folder, user, pass, otp, remember, auto }) {
  const prev = sync.cfg || {};
  host = location.protocol === 'https:' ? normalizeHost(host) : host.trim().replace(/\/+$/, ''); // lokal (http) zum Testen unverändert
  sync.cfg = { mode: 'dsm', host, folder: '/' + folder.trim().replace(/^\/+|\/+$/g, ''), user: user.trim(), auto: !!auto, remember: !!remember, did: prev.host === host ? prev.did : null, sid: null };
  const p = { api: 'SYNO.API.Auth', version: '6', method: 'login', account: user.trim(), passwd: pass, session: 'FileStation', format: 'sid', enable_device_token: 'yes', device_name: 'IndooRado' };
  if (otp) p.otp_code = otp.trim();
  if (sync.cfg.did) p.device_id = sync.cfg.did;
  try {
    const d = await dsmJson(p, { post: true });
    sync.cfg.sid = d.sid; if (d.did || d.device_id) sync.cfg.did = d.did || d.device_id;
    if (remember) sync.cfg.pass = pass; // nur auf Wunsch, damit abgelaufene Sitzungen ohne Nachfrage erneuert werden
    sync.needLogin = false; sync.dirsOk = false;
    await kv.set('sync', sync.cfg);
    return true;
  } catch (e) { if (e.code !== 403 && e.code !== 404) { /* Konfiguration trotzdem merken */ await kv.set('sync', { ...sync.cfg, sid: null }); } throw e; }
}
export async function dsmLogout() {
  try { if (sync.cfg?.sid) await dsmJson({ api: 'SYNO.API.Auth', version: '6', method: 'logout', session: 'FileStation' }); } catch (e) { }
  if (sync.cfg) { sync.cfg.sid = null; delete sync.cfg.pass; await kv.set('sync', sync.cfg); }
}
async function ensureSid() {
  if (sync.cfg.sid) return;
  if (sync.cfg.pass) { await dsmLogin({ ...sync.cfg, pass: sync.cfg.pass, remember: true }); return; }
  sync.needLogin = true; throw new Error('Bitte unter Einstellungen › Verbindungen beim NAS anmelden');
}
const join = (...p) => p.join('/').replace(/\/+/g, '/');
const DSM = {
  async mkdir(rel) {
    const full = join(sync.cfg.folder, rel).replace(/\/$/, ''), i = full.lastIndexOf('/');
    try { await dsmJson({ api: 'SYNO.FileStation.CreateFolder', version: '2', method: 'create', folder_path: [full.slice(0, i) || '/'], name: [full.slice(i + 1)], force_parent: 'true' }); }
    catch (e) { if (e.code !== 1100) throw e; }
  },
  async put(rel, body, type) {
    const full = join(sync.cfg.folder, rel), i = full.lastIndexOf('/');
    const fd = new FormData(); fd.append('path', full.slice(0, i)); fd.append('create_parents', 'true'); fd.append('overwrite', 'true');
    fd.append('file', body instanceof Blob ? body : new Blob([body], { type: type || 'application/octet-stream' }), full.slice(i + 1));
    await dsmJson({ api: 'SYNO.FileStation.Upload', version: '2', method: 'upload' }, { post: true, body: fd });
  },
  async get(rel) {
    const r = await dsmCall({ api: 'SYNO.FileStation.Download', version: '2', method: 'download', path: [join(sync.cfg.folder, rel)], mode: 'open' });
    const t = r.headers.get('content-type') || '';
    if (/json/.test(t) && !/\.json$/.test(rel)) { const j = await r.json(); if (!j.success) throw new DsmError(j.error?.code); }
    if (!r.ok) return null;
    const b = await r.blob();
    // Fehler kommen als kleines JSON zurück
    if (b.size < 200) { try { const j = JSON.parse(await b.text()); if (j && j.success === false) { if (j.error?.code === 408) return null; if ([119, 106].includes(j.error?.code)) { sync.cfg.sid = null; sync.needLogin = true; } throw new DsmError(j.error?.code); } } catch (e) { if (e instanceof DsmError) throw e; } }
    return b;
  },
  async list(rel) {
    try { const d = await dsmJson({ api: 'SYNO.FileStation.List', version: '2', method: 'list', folder_path: join(sync.cfg.folder, rel).replace(/\/$/, ''), limit: '5000' }); return (d.files || []).map(f => f.name); }
    catch (e) { if (e.code === 408) return []; throw e; }
  },
  async del(rel) { try { await dsmJson({ api: 'SYNO.FileStation.Delete', version: '2', method: 'start', path: [join(sync.cfg.folder, rel)] }); } catch (e) { } },
};

/* ---------- WebDAV ---------- */
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
function davBase() { let u = sync.cfg.url.trim(); if (!u.endsWith('/')) u += '/'; return u; }
const dav = (method, path, body, headers = {}) => fetch(davBase() + path, { method, body, headers: { Authorization: 'Basic ' + b64(sync.cfg.user + ':' + sync.cfg.pass), ...headers }, cache: 'no-store' });
async function davOk(r, what) { if (!r.ok && r.status !== 207) throw new Error(`${what}: HTTP ${r.status}${r.status === 401 ? ' (Benutzer oder Passwort falsch)' : r.status === 404 ? ' (Ordner nicht gefunden)' : ''}`); return r; }
const DAV = {
  async mkdir(rel) { const r = await dav('MKCOL', rel); if (!(r.ok || r.status === 405 || r.status === 301)) throw new Error(`Ordner ${rel} anlegen: HTTP ${r.status}`); },
  async put(rel, body, type) { await davOk(await dav('PUT', rel, body, { 'Content-Type': type || 'application/octet-stream' }), rel); },
  async get(rel) { const r = await dav('GET', rel); if (r.status === 404) return null; await davOk(r, rel); return r.blob(); },
  async list(rel) {
    const r = await dav('PROPFIND', rel, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>', { Depth: '1', 'Content-Type': 'application/xml' });
    if (r.status === 404) return [];
    await davOk(r, 'Liste ' + rel);
    const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
    return [...doc.getElementsByTagNameNS('DAV:', 'href')].map(h => decodeURIComponent(h.textContent).replace(/\/$/, '').split('/').pop()).filter(Boolean);
  },
  async del(rel) { await dav('DELETE', rel); },
};
const saveTok = c => kv.set('sync', c);
const EXT = () => isOAuth(sync.cfg.mode) ? backend(sync.cfg, saveTok) : sync.cfg.mode === 'dsm' ? DSM : DAV;
const B = () => ON ? SBK : EXT();
async function prep() {
  if (ON) return;
  await prepExt();
}
async function prepExt() {
  if (sync.cfg.mode === 'dsm') await ensureSid();
  else if (isOAuth(sync.cfg.mode)) { try { await fresh(sync.cfg, saveTok); } catch (e) { if (e.login) { sync.needLogin = true; bus.emit('sync'); } throw e; } }
}

// Verbindung prüfen: Ordner anlegen, Testdatei schreiben, lesen, löschen
export async function testConnection() {
  await prep();
  try { await B().mkdir(''); } catch (e) { if (sync.cfg?.mode === 'dsm') throw e; }
  await B().put('.indoorado-test', 'ok', 'text/plain');
  const b = await B().get('.indoorado-test');
  if (!b || (await b.text()).trim() !== 'ok') throw new Error('Testdatei ließ sich nicht zurücklesen');
  await B().del('.indoorado-test');
  return true;
}

async function stateObj(rev) {
  const now = new Date().toISOString();
  const gone = new Set(await kv.get('removedDevices', [])); for (const id of gone) if (id !== sync.device.id) delete sync.devices[id];
  const out = { app: 'trittwerk', format: 'indoorado-data', schema: SCHEMA, savedAt: now, rev, by: { ...sync.device }, devices: { ...sync.devices, [sync.device.id]: { name: sync.device.name, last: now } }, kvT: {}, kv: {}, routes: (await db.all('routes')).map(r => ({ ...r, dem: undefined, osm: undefined })), workouts: await db.all('workouts') };
  for (const k of await db.keys('kv')) if (!LOCAL_ONLY.has(k)) { out.kv[k] = await db.get('kv', k); out.kvT[k] = kvT[k] || 0; }
  return out;
}
async function readState() { const b = await B().get('state.json'); if (!b) return null; const st = JSON.parse(await b.text()); if (st.app !== 'trittwerk') throw new Error('state.json gehört nicht zu IndooRado'); return st; }

// Stand vom NAS einarbeiten. how: 'remote' = NAS gewinnt überall (erstes Verbinden, „Vom NAS laden“), 'merge' = je Einstellung gewinnt die neuere Seite
async function applyRemote(st, how) {
  const T = {}; for (const k of TOMBS) T[k] = new Set([...(st.kv[k] || []), ...await kv.get(k, [])]);
  const gone = T.deletedRides, goneW = T.deletedWorkouts, goneR = T.deletedRoutes, goneP = T.deletedPlans;
  const rT = st.kvT || {}; let changed = 0;
  applying = true;
  try {
    for (const k in st.kv) {
      if (LOCAL_ONLY.has(k) || TOMBS.includes(k)) continue;
      const remoteT = rT[k] || 0, localT = kvT[k] || 0, remoteWins = how === 'remote' || remoteT > localT || (!localT && !remoteT);
      let val = st.kv[k];
      if (k === 'customPlans') {
        // Eigene Pläne je Plan zusammenführen: neue von beiden Seiten behalten, gelöschte entfernen
        const loc = await kv.get('customPlans', []), m = new Map(loc.map(c => [c.id, c]));
        for (const c of val || []) if (!m.has(c.id) || remoteWins) m.set(c.id, c);
        val = [...m.values()].filter(c => !goneP.has(c.id));
      } else if (!remoteWins) continue;
      if (JSON.stringify(await db.get('kv', k)) !== JSON.stringify(val)) { await db.put('kv', val, k); changed++; }
      if (remoteWins) kvT[k] = remoteT;
    }
    for (const k of TOMBS) await db.put('kv', [...T[k]], k);
    for (const x of st.routes || []) { if (goneR.has(x.id)) continue; const loc = await db.get('routes', x.id); if (!loc || how === 'remote' || (x.updated || 0) >= (loc.updated || 0)) await db.put('routes', loc ? { ...x, dem: x.dem || loc.dem, osm: x.osm || loc.osm } : x); }
    for (const x of st.workouts || []) { if (goneW.has(x.id)) continue; const loc = await db.get('workouts', x.id); if (!loc || how === 'remote' || (x.updated || 0) >= (loc.updated || 0)) await db.put('workouts', x); }
    // Auf anderen Geräten gelöschte Strecken und Workouts hier entfernen
    for (const id of goneR) if (await db.get('routes', id)) { await db.del('routes', id); changed++; }
    for (const id of goneW) if (await db.get('workouts', id)) { await db.del('workouts', id); changed++; }
  } finally { applying = false; await kv.set('kvTimes', kvT); }
  // Fahrten und Fotos: nur ergänzen, gelöschte entfernen
  const haveR = new Set((await db.keys('rides')).map(String)), haveS = new Set((await db.keys('shots')).map(String));
  for (const id of gone) if (haveR.has(id)) { await db.del('rides', id); await db.delByIndex('shots', 'ride', id); changed++; }
  let n = 0;
  for (const f of await B().list('rides/')) { const id = f.replace(/\.json$/, ''); if (f.endsWith('.json') && !haveR.has(id) && !gone.has(id)) { const b = await B().get('rides/' + f); if (b) { await db.put('rides', JSON.parse(await b.text())); n++; } } }
  if (!ON) for (const f of await B().list('shots/')) {
    if (!f.endsWith('.json')) continue; const id = f.replace(/\.json$/, ''); if (haveS.has(id) || [...gone].some(g => id.startsWith(g + '-'))) continue;
    const m = await B().get('shots/' + f), img = await B().get('shots/' + id + '.jpg');
    if (m && img) await db.put('shots', { ...JSON.parse(await m.text()), blob: img });
  }
  return { rides: n, changed: changed + n };
}

// Fahrten und Fotos hochladen, die auf dem NAS fehlen; gelöschte dort entfernen
async function pushFiles() {
  const haveR = new Set(await B().list('rides/')), haveS = new Set(await B().list('shots/')), gone = new Set(await kv.get('deletedRides', []));
  let n = 0, f = 0;
  const P = ON ? await prefs() : null;
  // Online: Fotos gehören nicht in Supabase. Reste aus älteren Versionen entfernen.
  // Vorher fehlende Fotos aufs Gerät holen, damit nichts verloren geht (gehen danach in den eigenen Speicher, falls verbunden).
  if (ON && haveS.size) {
    for (const f of haveS) { if (!f.endsWith('.json')) continue; const id = f.slice(0, -5); if (await db.get('shots', id) || gone.has(id.replace(/-\d+$/, ''))) continue; const m = await SBK.get('shots/' + f), img = await SBK.get('shots/' + id + '.jpg'); if (m && img) await db.put('shots', { ...JSON.parse(await m.text()), blob: new Blob([img], { type: 'image/jpeg' }) }); }
    const l = [...haveS].map(x => SBK.p('shots/' + x)); for (let i = 0; i < l.length; i += 100) await ON.sb.storage.from('vault').remove(l.slice(i, i + 100)); haveS.clear();
  }
  if (!P || P.rides !== 'none') for (const r of await db.all('rides')) if (!haveR.has(r.id + '.json') && !gone.has(r.id) && !r.demo) { await B().put('rides/' + r.id + '.json', JSON.stringify(await filterRide(r)), 'application/json'); n++; }
  // Foto zuerst, Beschreibung danach: fehlt die Beschreibung, wird beim nächsten Mal beides neu geschrieben
  if (!ON) for (const s of await db.all('shots')) if (!haveS.has(s.id + '.json') && !gone.has(s.rideId)) { await B().put('shots/' + s.id + '.jpg', s.blob, 'image/jpeg'); await B().put('shots/' + s.id + '.json', JSON.stringify({ ...s, blob: undefined }), 'application/json'); f++; }
  for (const id of gone) {
    if (haveR.has(id + '.json')) await B().del('rides/' + id + '.json');
    for (const x of haveS) if (x.startsWith(id + '-')) await B().del('shots/' + x);
  }
  return { rides: n, shots: f };
}

// Ein Abgleich: erst den Stand auf dem NAS lesen und einarbeiten, dann den gemeinsamen Stand mit neuer Versionsnummer schreiben.
// Ein neu verbundenes Gerät übernimmt zuerst alles vom NAS und überschreibt dort nichts.
export async function syncAll({ preferRemote = false } = {}) {
  await prep();
  // Tresor-Zustand bei jedem Abgleich frisch lesen: Hat ein anderes Gerät den Tresor inzwischen ein- oder ausgeschaltet,
  // lädt dieses Gerät nichts mehr unverschlüsselt hoch bzw. verschlüsselt nicht mehr mit einem alten Schlüssel
  if (ON) await loadVault(SBK);
  if (!sync.dirsOk) { await B().mkdir(''); await B().mkdir('rides'); await B().mkdir('shots'); sync.dirsOk = true; }
  let st = await readState(), pulled = null;
  if (st) {
    const rRev = st.rev || 0, first = sync.rev == null && !sync.last;
    const legacyLocalWins = sync.rev == null && sync.last && st.savedAt <= sync.last; // älterer Stand ohne Versionsnummer, NAS seitdem unverändert
    if (preferRemote || first) { pulled = await applyRemote(st, 'remote'); sync.info = first ? `Erstes Verbinden: Daten von „${st.by?.name || 'einem anderen Gerät'}“ übernommen, auf dem NAS wurde nichts überschrieben.` : ''; }
    // Neuer Stand eines anderen Geräts? Versionsnummer allein reicht nicht: schreiben zwei Geräte fast gleichzeitig, haben
    // beide dieselbe Nummer – dann unterscheidet sie der Zeitstempel, und es wird zusammengeführt statt überschrieben
    else if ((rRev !== sync.rev || (sync.revAt && st.savedAt && st.savedAt !== sync.revAt)) && !legacyLocalWins) pulled = await applyRemote(st, 'merge');
    sync.devices = st.devices || {};
    // Kurz vor dem Schreiben erneut prüfen, ob inzwischen ein anderes Gerät geschrieben hat
    const again = await readState();
    if (again && ((again.rev || 0) !== rRev || again.savedAt !== st.savedAt)) { const p2 = await applyRemote(again, 'merge'); pulled = { rides: (pulled?.rides || 0) + p2.rides, changed: (pulled?.changed || 0) + p2.changed }; st = again; sync.devices = again.devices || {}; }
  }
  const files = await pushFiles();
  if (ON) { const ph = await photoSync(); if (ph) { files.shots = ph.up; files.shotsDown = ph.down; } }
  const rev = (st?.rev || 0) + 1, mine = await stateObj(rev);
  await B().put('state.json', JSON.stringify(mine), 'application/json');
  sync.rev = rev; sync.revAt = mine.savedAt; sync.devices = mine.devices;
  return { pulled: pulled && pulled.changed ? pulled : null, rides: pulled?.rides || 0, up: files, savedAt: mine.savedAt };
}

async function mark() { sync.last = new Date().toISOString(); sync.error = null; await kv.set(META(), { at: sync.last, rev: sync.rev, revAt: sync.revAt, devices: sync.devices }); bus.emit('sync'); }
async function guarded(fn) {
  if (!configured() || sync.busy) return null;
  sync.busy = true; bus.emit('sync');
  try { const res = await fn(); await mark(); return res; }
  catch (e) { if (e.login) sync.needLogin = true; sync.error = e.message === 'Failed to fetch' ? (isOAuth(sync.cfg?.mode) ? providerName() + ' nicht erreichbar (Internetverbindung?)' : 'NAS nicht erreichbar oder Zugriff von dieser Adresse nicht freigegeben (siehe Einrichtung)') : e.message; bus.emit('sync'); throw e; }
  finally { sync.busy = false; bus.emit('sync'); }
}
export const pushNow = () => guarded(() => syncAll());
export const pullNow = () => guarded(() => syncAll({ preferRemote: true }));

// Beim Start und beim Zurückkehren zur App: abgleichen; Rückgabe ist gesetzt, wenn sich lokal etwas geändert hat
export async function autoSync() {
  if (!configured() || !(ON || sync.cfg.auto)) return;
  if (!ON && sync.cfg.mode === 'dsm' && !sync.cfg.sid && !sync.cfg.pass) { sync.needLogin = true; bus.emit('sync'); return; }
  const r = await guarded(() => syncAll());
  return r?.pulled || null;
}
// Nach Änderungen verzögert hochladen (nicht während eines Abgleichs)
let pend = null;
bus.on('dbchange', ({ s, k }) => { if (sync.busy || (s === 'kv' && LOCAL_ONLY.has(k))) return; schedulePush(s === 'rides' ? 1500 : 8000); });
export function schedulePush(ms = 4000) {
  if (!configured() || !(ON || sync.cfg.auto) || sync.needLogin) return;
  clearTimeout(pend); pend = setTimeout(() => pushNow().catch(() => { }), ms);
}

/* ---------- Live-Fahrt für die Companion-Ansicht (kleine Datei live.json im NAS-Ordner) ---------- */
export const syncReady = () => configured() && !sync.needLogin && (ON || sync.cfg.mode !== 'dsm' || sync.cfg.sid || sync.cfg.pass);
let liveBusy = false;
// store = false: nur über den Echtzeitkanal (jede Sekunde), in den Speicher nur alle paar Sekunden
export async function putLive(obj, { store = true } = {}) {
  if (ON) import('./tv.js').then(m => m.sendLive(store ? obj : { ...obj, hist: undefined })).catch(() => { }); // sofort über den Echtzeitkanal des Kontos
  if (!store) return;
  if (!syncReady() || liveBusy) return;
  liveBusy = true;
  try { await prep(); await B().put('live.json', JSON.stringify({ ...obj, ts: Date.now() }), 'application/json'); } catch (e) { } finally { liveBusy = false; }
}
// Läuft gerade wirklich eine Fahrt – auf einem ANDEREN Gerät bzw. Tab? (nicht die eigene geparkte, nicht nur „bereit“, nicht veraltet)
export function liveFresh(L) {
  if (!L || ['ended', 'ready'].includes(L.state)) return false;
  let me = ''; try { me = sessionStorage.getItem('vvTab') || ''; } catch (e) { }
  if (L.tab && L.tab === me) return false;
  const age = Date.now() - (+L.ts || 0); return age < 30000 && age > -120000; // Uhren der Geräte können etwas abweichen
}
export async function getLive() {
  if (!syncReady()) return null;
  await prep();
  const b = await B().get('live.json'); if (!b) return null;
  try { return JSON.parse(await b.text()); } catch (e) { return null; }
}

/* ---------- Fotos im eigenen Speicher, während der Abgleich über IndooRado Online läuft ----------
   Fahrten liegen in Supabase, die zugehörigen Fotos im NAS bzw. in OneDrive/Google Drive/Dropbox (Ordner shots/).
   Fehler dort (z. B. abgelaufene NAS-Anmeldung) stören den Online-Abgleich nicht, sie landen in sync.extError. */
export const photoTarget = () => ON && extConfigured() ? providerName(sync.cfg.mode) : null;
async function withExt(fn) {
  if (!extConfigured() || (sync.cfg.mode === 'dsm' && !sync.cfg.sid && !sync.cfg.pass)) { sync.extNeedLogin = extConfigured(); return null; }
  const nl = sync.needLogin;
  try { await prepExt(); const r = await fn(EXT()); sync.extError = null; sync.extNeedLogin = false; return r; }
  catch (e) { sync.extError = e.message === 'Failed to fetch' ? providerName(sync.cfg.mode) + ' nicht erreichbar' : e.message; sync.extNeedLogin = sync.needLogin && !nl; return null; }
  finally { sync.needLogin = nl; }
}
let extDirs = false;
async function photoSync() {
  return withExt(async X => {
    if (!extDirs) { try { await X.mkdir(''); await X.mkdir('shots'); } catch (e) { } extDirs = true; }
    const have = new Set(await X.list('shots/')), gone = new Set(await kv.get('deletedRides', []));
    const rides = new Set((await db.keys('rides')).map(String)), local = await db.all('shots'), loc = new Set(local.map(s => s.id));
    let up = 0, down = 0;
    for (const s of local) if (!have.has(s.id + '.json') && !gone.has(s.rideId)) { await X.put('shots/' + s.id + '.jpg', s.blob, 'image/jpeg'); await X.put('shots/' + s.id + '.json', JSON.stringify({ ...s, blob: undefined }), 'application/json'); up++; }
    for (const f of have) {
      if (!f.endsWith('.json')) continue; const id = f.replace(/\.json$/, ''), rid = id.replace(/-\d+$/, '');
      if (gone.has(rid)) { await X.del('shots/' + f); await X.del('shots/' + id + '.jpg'); continue; }
      if (loc.has(id) || !rides.has(rid)) continue;
      const m = await X.get('shots/' + f), img = await X.get('shots/' + id + '.jpg');
      if (m && img) { await db.put('shots', { ...JSON.parse(await m.text()), blob: img }); down++; }
    }
    return { up, down };
  });
}

// Fotos einer Fahrt direkt vom NAS holen, falls sie auf diesem Gerät fehlen (z. B. auf dem Handy)
export async function fetchShots(rideId, count) {
  if (!count) return 0;
  const run = async X => {
    let n = 0;
    for (let k = 0; k < count; k++) {
      const id = rideId + '-' + k; if (await db.get('shots', id)) continue;
      const m = await X.get('shots/' + id + '.json'); if (!m) continue;
      const img = await X.get('shots/' + id + '.jpg'); if (!img) continue;
      await db.put('shots', { ...JSON.parse(await m.text()), blob: img }); n++;
    }
    return n;
  };
  if (ON) return (await withExt(run)) || 0; // online: Fotos nur aus dem eigenen Speicher
  if (!syncReady()) return 0;
  await prep(); return run(B());
}
