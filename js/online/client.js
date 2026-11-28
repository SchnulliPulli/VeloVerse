// IndooRado Online: Verbindung zu Supabase (Login, Profil, 2FA). Ohne Konfiguration bleibt alles aus und die App läuft rein lokal.
// Die Supabase-Bibliothek wird erst geladen, wenn Online wirklich genutzt wird.
import { bus } from '../util.js';
import { CONFIG } from './config.js';

const LS = 'vvOnline';
export const online = { client: null, session: null, user: null, profile: null, aal: null, ready: false };

// Reihenfolge: online.json neben der App (Server-Version) > Eintrag im Browser > config.js
// So bleibt eine Codebasis: ohne online.json (z. B. GitHub Pages) ist die App rein lokal, mit online.json auf dem Webserver online.
let site = null;
export async function loadSiteConfig() {
  if (site) return site;
  try { const r = await fetch('online.json', { cache: 'no-cache' }); site = r.ok ? await r.json() : {}; } catch (e) { site = {}; }
  return site;
}
// Mindest-Stand der Datenbank (public.schema_version in schema.sql)
export const SCHEMA_NEED = 20261202;
export async function schemaOk() { try { const { data, error } = await (await client()).rpc('schema_version'); return !error && data >= SCHEMA_NEED; } catch (e) { return true; } }
export function config() {
  let o = {}; try { o = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { }
  const s = site || {};
  return { url: s.url || o.url || CONFIG.url, anonKey: s.anonKey || o.anonKey || CONFIG.anonKey, providers: s.providers || CONFIG.providers, site: !!s.url,
    mapillary: typeof s.mapillary === 'string' ? s.mapillary : '', vapid: typeof s.vapid === 'string' ? s.vapid : '' }; // öffentliche Schlüssel aus online.json
}
export function setConfig(url, anonKey) { localStorage.setItem(LS, JSON.stringify({ url: url.trim().replace(/\/$/, ''), anonKey: anonKey.trim() })); online.client = null; }
export const configured = () => { const c = config(); return !!(c.url && c.anonKey); };

// "Angemeldet bleiben": Sitzung in localStorage (bleibt, bis du dich abmeldest; das Token wird automatisch erneuert),
// sonst in sessionStorage (endet, wenn der Tab bzw. Browser geschlossen wird)
export const remember = () => localStorage.getItem('vvRemember') !== '0';
export function setRemember(on) {
  localStorage.setItem('vvRemember', on ? '1' : '0');
  // vorhandene Sitzung in den passenden Speicher umziehen
  const [from, to] = on ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
  for (const k of Object.keys(from)) if (k.startsWith('vv-auth')) { to.setItem(k, from.getItem(k)); from.removeItem(k); }
}
const authStore = {
  getItem: k => (remember() ? localStorage : sessionStorage).getItem(k) ?? sessionStorage.getItem(k) ?? localStorage.getItem(k),
  setItem: (k, v) => { (remember() ? localStorage : sessionStorage).setItem(k, v); (remember() ? sessionStorage : localStorage).removeItem(k); },
  removeItem: k => { localStorage.removeItem(k); sessionStorage.removeItem(k); },
};
// Sperre nur innerhalb dieses Tabs statt navigator.locks: die browserweite Sperre bleibt bekanntermaßen manchmal hängen
// (Tab im Hintergrund, mehrere Tabs), dann wartet jede Anfrage ewig. Notfalls geht es nach 5 s ohne Sperre weiter.
let lockChain = Promise.resolve();
async function tabLock(name, timeout, fn) {
  const prev = lockChain; let release; lockChain = new Promise(r => release = r);
  try { await Promise.race([prev, new Promise(r => setTimeout(r, 5000))]); return await fn(); } finally { release(); }
}
// Jede Anfrage ans Backend zählen: dauert etwas, zeigt die App unten eine kleine Ladeanzeige (blockiert nichts)
export const net = { busy: 0 };
const trackedFetch = (...a) => { net.busy++; bus.emit('netbusy', net.busy); return fetch(...a).finally(() => { net.busy--; bus.emit('netbusy', net.busy); }); };
/* ---------- Mehrere Konten auf einem Gerät ----------
   Jedes Konto bekommt seine eigene lokale Datenbank (Fahrten, Einstellungen, Fortschritt), damit beim Abgleich nie Daten
   eines Kontos in ein anderes wandern. Das erste Konto behält die bisherige Datenbank. Wechseln = Sitzung tauschen und neu laden.
   Gespeichert werden die Sitzungen wie die normale Anmeldung (localStorage bei „Angemeldet bleiben“, sonst nur für diesen Tab). */
const ACC = 'vv-accounts', DBMAP = 'vvAcctDb';
const accStore = () => remember() ? localStorage : sessionStorage;
export function accounts() { try { return JSON.parse(accStore().getItem(ACC) || '[]'); } catch (e) { return []; } }
const setAccounts = a => { try { accStore().setItem(ACC, JSON.stringify(a.slice(0, 6))); } catch (e) { } };
export const currentDb = () => localStorage.getItem('vvDb') || 'trittwerk';
export function dbFor(uid) {
  let m = {}; try { m = JSON.parse(localStorage.getItem(DBMAP) || '{}'); } catch (e) { }
  if (!m[uid]) { m[uid] = Object.keys(m).length ? 'trittwerk-' + uid.replace(/[^\w]/g, '').slice(0, 12) : currentDb(); localStorage.setItem(DBMAP, JSON.stringify(m)); }
  return m[uid];
}
// Passt die lokale Datenbank zum angemeldeten Konto? Sonst umstellen und neu laden, bevor irgendein Abgleich startet
function ensureDb(uid) {
  if (!uid) return false; const want = dbFor(uid);
  if (want === currentDb()) return false;
  localStorage.setItem('vvDb', want); online.switching = true; setTimeout(() => location.reload(), 30); return true;
}
export function rememberAccount() {
  const s = online.session || (online.user ? { user: online.user } : null); if (!s?.user) return;
  setTimeout(acctCache, 0);
  dbFor(s.user.id); // aktuelles Konto behält die Datenbank, in der es gerade läuft
  const list = accounts(), old = list.find(x => x.uid === s.user.id) || {};
  setAccounts([{ ...old, uid: s.user.id, email: s.user.email, name: online.profile?.display_name || old.name || s.user.email, look: online.profile?.avatar || old.look || null, session: s }, ...list.filter(x => x.uid !== s.user.id)]);
}
export function switchAccount(uid) {
  rememberAccount();
  const t = accounts().find(x => x.uid === uid); if (!t?.session?.refresh_token) return;
  authStore.setItem('vv-auth', JSON.stringify(t.session)); localStorage.setItem('vvDb', dbFor(uid));
  online.switching = true; location.hash = '#/'; location.reload();
}
// Weiteres Konto: aktuelles merken, ohne es abzumelden (Abmelden würde die Sitzung beim Server beenden), dann zur Anmeldung
export function addAccount() { rememberAccount(); authStore.removeItem('vv-auth'); online.switching = true; location.hash = '#/account'; location.reload(); }
// Konto von diesem Gerät entfernen: Push-Anmeldung dieses Geräts für das Konto löschen und die gespeicherte Sitzung beim Server
// abmelden (sonst kämen weiter Meldungen „für …“), dann aus der Liste nehmen
export async function forgetAccount(uid) {
  if (uid !== online.user?.id) try {
    let ep = null; try { ep = (await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription())?.endpoint || null; } catch (e) { }
    await Promise.race([withAccount(uid, async sb => { if (ep) await sb.rpc('push_unsubscribe', { p_endpoint: ep }); await sb.auth.signOut({ scope: 'local' }); }), new Promise(r => setTimeout(r, 6000))]);
  } catch (e) { }
  setAccounts(accounts().filter(x => x.uid !== uid)); try { localStorage.removeItem('vvPushAcc:' + uid); localStorage.removeItem('vvProf:' + uid); } catch (e) { }
  acctCache();
}
// Mit einem anderen gespeicherten Konto kurz etwas erledigen (z. B. Push für alle Konten anmelden), ohne zu wechseln.
// Abgelaufene Sitzung: erneuern und die neue Sitzung gleich wieder speichern (sonst wäre der alte Schlüssel verbraucht).
export async function withAccount(uid, fn) {
  const t = accounts().find(x => x.uid === uid); if (!t?.session?.refresh_token || !configured()) return null;
  const { createClient } = await import('../../vendor/supabase.esm.js'), c = config();
  const mem = {}, store = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  const sb = createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'vv-tmp-' + uid, storage: store } });
  const { data, error } = await sb.auth.setSession({ access_token: t.session.access_token, refresh_token: t.session.refresh_token });
  if (error || !data?.session) return null;
  if (data.session.refresh_token !== t.session.refresh_token) setAccounts(accounts().map(x => x.uid === uid ? { ...x, session: data.session } : x)); // erneuert: merken
  try { return await fn(sb); } finally { try { sb.realtime?.disconnect?.(); } catch (e) { } }
}
// Für den Service Worker: welches Konto ist gerade aktiv, welche gibt es (Namen für Meldungen an andere Konten)
export async function acctCache() {
  try { const cc = await caches.open('indoorado-acct'); await cc.put('/__acct.json', new Response(JSON.stringify({ cur: online.user?.id || null, list: accounts().map(a => ({ uid: a.uid, name: a.name || a.email || 'Konto' })) }), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { }
}

// Live-Dienst braucht den Anmelde-Schlüssel für private Kanäle
export async function realtimeAuth() { const sb = await client(); const { data } = await sb.auth.getSession(); if (data.session) await sb.realtime.setAuth(data.session.access_token); return !!data.session; }
export async function client() {
  if (online.client) return online.client;
  if (!configured()) throw new Error('IndooRado Online ist nicht eingerichtet');
  const { createClient } = await import('../../vendor/supabase.esm.js');
  const CL = await import('./connlog.js');
  const c = config();
  online.client = createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: loginReturn(), flowType: 'pkce', storageKey: 'vv-auth', storage: authStore, lock: tabLock }, global: { fetch: trackedFetch },
    // Stabilere Live-Verbindung: Herzschlag aus einem Worker (läuft auch im Hintergrund), mehr Geduld bei langsamen Netzen
    realtime: { worker: typeof Worker !== 'undefined', workerUrl: new URL('./rt-worker.js', import.meta.url).href, heartbeatIntervalMs: 25000, timeout: 10000, logger: CL.rtLogger, heartbeatCallback: CL.rtHeartbeat } });
  // Laut Supabase-Doku keine Supabase-Aufrufe direkt im Callback (kann blockieren): erst danach ausführen
  online.client.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') online.recovery = true;
    const was = online.user?.id; online.session = session; online.user = session?.user || null;
    if (online.user && ensureDb(online.user.id)) return; // anderes Konto: erst auf dessen Datenbank umschalten (Neuladen)
    if (session && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED'].includes(ev)) rememberAccount();
    // Gleicher Nutzer (Token erneuert, 2FA in einem anderen Tab bestätigt): nur den 2FA-Status neu lesen, das ist lokal und schnell
    if (ev === 'TOKEN_REFRESHED' || ev === 'MFA_CHALLENGE_VERIFIED' || (ev === 'SIGNED_IN' && was === online.user?.id && online.profile)) {
      setTimeout(async () => { try { online.aal = (await online.client.auth.mfa.getAuthenticatorAssuranceLevel()).data; } catch (e) { } bus.emit('online', ev); }); return;
    }
    setTimeout(() => refresh().catch(() => { }).finally(() => bus.emit('online', ev)), 0);
  });
  addEventListener('storage', e => { if (e.key === 'vv-auth' && online.client) setTimeout(async () => { try { const { data } = await online.client.auth.getSession(); const was = online.user?.id; online.session = data.session; online.user = data.session?.user || null; if (online.user?.id !== was) { location.reload(); return; } online.aal = (await online.client.auth.mfa.getAuthenticatorAssuranceLevel()).data; bus.emit('online', 'storage'); } catch (er) { } }); });
  return online.client;
}
// Beim App-Start: Sitzung wiederherstellen (auch nach OAuth-Rückkehr mit ?code=...)
// Ohne gespeicherte Anmeldung und ohne Rückkehr vom Login wird Supabase gar nicht erst kontaktiert (keine Datenflüsse ohne Login)
const loginReturn = () => expectingReturn() && new URLSearchParams(location.search).has('code');
export const hasStoredSession = () => [localStorage, sessionStorage].some(s => { try { return !!s.getItem('vv-auth'); } catch (e) { return false; } });
export async function initOnline() {
  await loadSiteConfig();
  if (!configured() || (!hasStoredSession() && !loginReturn())) { online.ready = true; online.user = null; online.session = null; return null; }
  const sb = await client();
  const { data } = await withTimeout(sb.auth.getSession(), 8000, 'Anmeldung');
  if (expectingReturn() && new URLSearchParams(location.search).has('code')) { localStorage.removeItem('vvOnlineReturn'); history.replaceState(null, '', location.pathname + (location.hash || '#/account')); }
  online.session = data.session; online.user = data.session?.user || null;
  if (online.user && ensureDb(online.user.id)) return new Promise(() => { }); // lädt gleich mit der richtigen Datenbank neu
  // Schneller Start: zuletzt bekanntes Profil sofort verwenden (2FA-Stufe kommt lokal aus dem Anmeldeschlüssel),
  // das frische Profil vom Server kommt im Hintergrund nach. Ohne gespeichertes Profil wie bisher auf den Server warten.
  const cached = online.user && profCache(online.user.id);
  if (cached) {
    online.profile = cached;
    try { online.aal = (await withTimeout(sb.auth.mfa.getAuthenticatorAssuranceLevel(), 3000, '2FA-Status')).data; } catch (e) { }
    online.ready = true; rememberAccount(); bus.emit('online', 'init');
    const key = p => JSON.stringify([p?.role, p?.approved, p?.trial_until, p?.banned]);
    refresh().then(() => { bus.emit('profile'); if (key(online.profile) !== key(cached)) bus.emit('online', 'refresh'); }).catch(() => { });
    return online.user;
  }
  await refresh(); online.ready = true; rememberAccount(); bus.emit('online', 'init');
  return online.user;
}
export const refreshProfile = () => refresh();
// Zuletzt bekanntes Profil dieses Kontos (nur auf diesem Gerät, für einen schnellen Start)
function profCache(uid) { try { const p = JSON.parse(localStorage.getItem('vvProf:' + uid) || 'null'); return p?.id === uid ? p : null; } catch (e) { return null; } }
// Nichts darf die Oberfläche ewig blockieren: Serveraufrufe mit Zeitlimit
export const withTimeout = (p, ms = 8000, what = 'Server') => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' antwortet nicht (Zeitüberschreitung)')), ms))]);
async function refresh() {
  const sb = online.client; if (!sb || !online.user) { online.profile = null; online.aal = null; return; }
  const [aal, prof] = await Promise.all([withTimeout(sb.auth.mfa.getAuthenticatorAssuranceLevel(), 8000, '2FA-Status'), withTimeout(sb.from('profiles').select('*').eq('id', online.user.id).maybeSingle(), 8000, 'Profil')]);
  online.aal = aal.data; online.profileError = prof.error?.message || null;
  let p = prof.data;
  // Kein Profil (Konto älter als die Datenbank-Einrichtung): einmal anlegen lassen
  if (!p) { await sb.rpc('ensure_profile'); ({ data: p } = await sb.from('profiles').select('*').eq('id', online.user.id).maybeSingle()); }
  online.profile = p; if (p) try { localStorage.setItem('vvProf:' + online.user.id, JSON.stringify(p)); } catch (e) { }
  if (p && (!p.last_seen || Date.now() - new Date(p.last_seen) > 5 * 60e3)) sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', online.user.id).then(() => { });
}
export const loggedIn = () => !!online.user;
export const isAdmin = () => online.profile?.role === 'admin';
export const needsMfa = () => online.aal && online.aal.nextLevel === 'aal2' && online.aal.currentLevel !== 'aal2';

/* ---------- Anmeldung ---------- */
const back = () => location.origin + location.pathname + '#/account';
// Merker, damit der App-Start den ?code= aus der Rückleitung Supabase zuordnet (Strava und Cloud nutzen denselben Parameter)
const mark = () => localStorage.setItem('vvOnlineReturn', String(Date.now()));
export const expectingReturn = () => Date.now() - (+localStorage.getItem('vvOnlineReturn') || 0) < 30 * 60e3;
export async function signUp(email, password, name) { mark(); const { error } = await (await client()).auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: back() } }); if (error) throw error; }
export async function signIn(email, password) { const { data, error } = await (await client()).auth.signInWithPassword({ email, password }); if (error) throw error; online.session = data.session; online.user = data.user || data.session?.user || null; await refresh(); }
// Passwortfrei: Einmal-Code (und Link) per E-Mail. Nur für bestehende Konten (neue Konten über die Registrierung).
export async function emailCode(email) { mark(); const { error } = await (await client()).auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: back() } }); if (error) throw error; }
export async function verifyCode(email, token) {
  const { data, error } = await withTimeout((await client()).auth.verifyOtp({ email, token, type: 'email' }), 15000, 'Code-Prüfung'); if (error) throw error;
  online.session = data.session; online.user = data.user; await refresh(); bus.emit('online', 'code'); return data;
}
export async function magicLink(email) { mark(); const { error } = await (await client()).auth.signInWithOtp({ email, options: { emailRedirectTo: back() } }); if (error) throw error; }
export async function oauth(provider) { mark(); const { error } = await (await client()).auth.signInWithOAuth({ provider, options: { redirectTo: back() } }); if (error) throw error; }
export async function resetPassword(email) { mark(); const { error } = await (await client()).auth.resetPasswordForEmail(email, { redirectTo: back() }); if (error) throw error; }
export async function signOut(scope = 'local') {
  const uid = online.user?.id;
  await (await client()).auth.signOut({ scope }); online.profile = null;
  if (uid) forgetAccount(uid);
  // Noch weitere Konten auf diesem Gerät: zum nächsten wechseln
  const next = accounts()[0]; if (next) return switchAccount(next.uid);
  bus.emit('online', 'out');
}

/* ---------- Zwei-Faktor (TOTP, z. B. Google Authenticator, 1Password, Aegis) ---------- */
// Alle TOTP-Faktoren, auch halb eingerichtete (data.totp enthält nur bestätigte)
export async function mfaFactors() { const { data, error } = await (await client()).auth.mfa.listFactors(); if (error) throw error; return (data.all || data.totp || []).filter(f => (f.factor_type || 'totp') === 'totp'); }
// 2FA-Liste für 60 s zwischenspeichern (spart einen Serveraufruf bei jedem Seitenaufbau)
let fCache = null;
export async function mfaFactorsCached() { if (fCache && Date.now() - fCache.t < 60e3) return fCache.list; const list = await mfaFactors(); fCache = { t: Date.now(), list }; return list; }
export const dropFactorCache = () => { fCache = null; };
// QR-Code als sichere data:-Adresse (Supabase liefert rohes SVG mit Anführungszeichen, das in einem HTML-Attribut zerbricht)
export function qrSrc(q) { if (!q) return ''; const m = /^data:image\/svg\+xml;(?:utf-8|charset=utf-8),(.*)$/s.exec(q); const svg = m ? m[1] : q.trim().startsWith('<svg') ? q : null; return svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : q; }
export async function mfaEnroll() { dropFactorCache(); const { data, error } = await (await client()).auth.mfa.enroll({ factorType: 'totp', friendlyName: 'IndooRado ' + new Date().toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }) + ' ' + Math.random().toString(36).slice(2, 6) }); if (error) throw error; return data; } // { id, totp: { qr_code, secret, uri } }
export async function mfaVerify(factorId, code) { dropFactorCache();
  const sb = await client();
  const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId }); if (e1) throw e1;
  const { error: e2 } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.replace(/\s/g, '') }); if (e2) throw e2;
  await refresh(); bus.emit('online', 'mfa');
}
export async function mfaRemove(factorId) { dropFactorCache(); const { error } = await (await client()).auth.mfa.unenroll({ factorId }); if (error) throw error; await refresh(); }

export async function updateProfile(patch) {
  const { data, error } = await (await client()).from('profiles').update(patch).eq('id', online.user.id).select().single(); if (error) throw error; online.profile = data; try { localStorage.setItem('vvProf:' + data.id, JSON.stringify(data)); } catch (e) { } return data;
}

/* ---------- Konto verwalten ---------- */
export async function resendSignup(email) { mark(); const { error } = await (await client()).auth.resend({ type: 'signup', email, options: { emailRedirectTo: back() } }); if (error) throw error; }
export async function verifyPassword(password) { const { error } = await (await client()).auth.signInWithPassword({ email: online.user.email, password }); if (error) throw new Error('Aktuelles Passwort stimmt nicht'); await refresh(); }
export async function reauthenticate() { const { error } = await (await client()).auth.reauthenticate(); if (error) throw error; }
// Liefert 'reauth', wenn Supabase einen Bestätigungscode per E-Mail verlangt (Einstellung "Secure password change")
export async function updatePassword(password, nonce) {
  const { error } = await (await client()).auth.updateUser(nonce ? { password, nonce } : { password });
  if (error) { if (/reauth|nonce/i.test(error.message)) return 'reauth'; throw error; }
  online.recovery = false; return 'ok';
}
export async function updateEmail(email) { mark(); const { error } = await (await client()).auth.updateUser({ email }, { emailRedirectTo: back() }); if (error) throw error; }

// Online-Zugang: Admin, freigeschaltet oder in der 7-tägigen Testphase. Ältere Datenbank ohne diese Spalten = Zugang.
export function access() {
  // Anmeldung erst mit dem zweiten Faktor abgeschlossen: bis dahin bleiben alle Online-Bereiche aus (Server prüft dasselbe über mfa_ok)
  if (online.user && (!online.aal || needsMfa())) return { ok: false, mfa: true };
  const p = online.profile; if (!p) return { ok: false, noProfile: true };
  if (p.role === 'banned') return { ok: false, banned: true };
  if (p.role === 'admin') return { ok: true, admin: true };
  if (p.approved === undefined || p.approved) return { ok: true, approved: true };
  const left = (new Date(p.trial_until) - Date.now()) / 864e5;
  return { ok: left > 0, trial: true, daysLeft: Math.max(0, Math.ceil(left)), until: p.trial_until };
}

/* ---------- Verbindungsdiagnose: jeden Schritt einzeln mit Dauer und Fehler ---------- */
export async function diagnose(onStep) {
  const step = async (name, fn) => { const t0 = performance.now(); try { const r = await withTimeout(fn(), 10000, name); onStep({ name, ok: true, ms: Math.round(performance.now() - t0), info: r }); return r; } catch (e) { onStep({ name, ok: false, ms: Math.round(performance.now() - t0), info: e.message || String(e) }); return null; } };
  const sb = await client();
  await step('Anmeldung (Sitzung)', async () => { const { data, error } = await sb.auth.getSession(); if (error) throw error; if (!data.session) throw new Error('keine Sitzung, bitte anmelden'); return 'angemeldet als ' + data.session.user.email; });
  await step('Datenbank-Version', async () => { const { data, error } = await sb.rpc('schema_version'); if (error || !data) throw new Error('veraltet: supabase/schema.sql im SQL-Editor neu ausführen'); if (data < SCHEMA_NEED) throw new Error(`Stand ${data}, die App braucht ${SCHEMA_NEED}: schema.sql neu ausführen`); return 'Stand ' + data; });
  await step('2FA-Status', async () => { const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); if (error) throw error; return `aktuell ${data.currentLevel}, möglich ${data.nextLevel}`; });
  await step('Profil direkt (ohne Bibliothek)', async () => { const { data } = await sb.auth.getSession(); const c = config(); const r = await fetch(`${c.url}/rest/v1/profiles?id=eq.${online.user.id}&select=role,approved`, { headers: { apikey: c.anonKey, Authorization: 'Bearer ' + data.session.access_token } }); const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (j.message || JSON.stringify(j))); return j.length ? `Rolle ${j[0].role}, freigeschaltet ${j[0].approved}` : 'leer (Regel verhindert Lesen?)'; });
  await step('Profil lesen', async () => { const { data, error } = await sb.from('profiles').select('role,approved,trial_until,display_name').eq('id', online.user.id).maybeSingle(); if (error) throw error; if (!data) throw new Error('kein Profil vorhanden'); return `Rolle ${data.role}, freigeschaltet ${data.approved}, Test bis ${data.trial_until ? new Date(data.trial_until).toLocaleString(document.documentElement.lang) : '–'}`; });
  await step('Zugang (has_access)', async () => { const { data, error } = await sb.rpc('has_access'); if (error) throw error; return data ? 'ja' : 'nein'; });
  await step('Admin (is_admin, braucht 2FA)', async () => { const { data, error } = await sb.rpc('is_admin'); if (error) throw error; return data ? 'ja' : 'nein'; });
  await step('Speicher (Ordner lesen)', async () => { const { data, error } = await sb.storage.from('vault').list(online.user.id, { limit: 5 }); if (error) throw error; return data.length + ' Einträge'; });
  await step('Live-Dienst: Verbindung öffnen', () => new Promise((res, rej) => {
    const rt = sb.realtime; let done = false; const fin = (ok, m) => { if (done) return; done = true; ok ? res(m) : rej(new Error(m)); };
    if (rt.isConnected?.()) return fin(true, 'schon verbunden');
    rt.onOpen?.(() => fin(true, 'verbunden'));
    rt.onClose?.(ev => fin(false, `geschlossen (Code ${ev?.code ?? '?'}${ev?.reason ? ', ' + ev.reason : ''})`));
    rt.onError?.(ev => fin(false, 'Fehler: ' + (ev?.message || ev?.type || 'WebSocket-Fehler')));
    try { rt.connect(); } catch (e) { fin(false, e.message); }
    setTimeout(() => fin(false, 'keine Antwort nach 8 s'), 8000);
  }));
  await step('Anmeldeschlüssel an Live-Dienst', async () => (await realtimeAuth()) ? 'gesetzt' : 'keine Sitzung');
  // Privaten Kanal beitreten und die Rohantworten des Servers mitschneiden (Grund bei Ablehnung)
  const tryJoin = topic => new Promise((res, rej) => {
    const rt = sb.realtime, log = [], full = 'realtime:' + topic;
    const existing = sb.getChannels().find(c => c.topic === full);
    if (existing) return res('schon offen, Status: ' + existing.state);
    const tap = m => { if (m.topic === full && log.length < 6) log.push(m.event + ' ' + JSON.stringify(m.payload).slice(0, 220)); };
    rt.stateChangeCallbacks.message.push(tap);
    const done = (ok, msg) => setTimeout(() => { const k = rt.stateChangeCallbacks.message.indexOf(tap); if (k >= 0) rt.stateChangeCallbacks.message.splice(k, 1); ok ? res(msg) : rej(new Error(msg + (log.length ? ' · Server: ' + log.join(' | ') : ' · keine Serverantwort'))); }, 300);
    const ch = sb.channel(topic, { config: { private: true } });
    // Erst das Ergebnis festhalten, dann abmelden: das Abmelden meldet selbst sofort CLOSED (das ist dann kein Fehler)
    let settled = false;
    ch.subscribe((st, err) => {
      if (settled) return;
      if (st === 'SUBSCRIBED') { settled = true; done(true, 'verbunden'); sb.removeChannel(ch); }
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { settled = true; done(false, st + (err?.message ? ': ' + err.message : '')); sb.removeChannel(ch); }
    });
  });
  await step('Live-Kanal (Strecke)', () => tryJoin('ride:diagnose'));
  await step('Live-Kanal (lobby)', () => tryJoin('lobby'));
}
