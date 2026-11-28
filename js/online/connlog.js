// Verbindungsprotokoll: hält Abrisse und Wiederverbindungen fest (nur lokal auf diesem Gerät, die letzten 400 Einträge).
// Quellen: Supabase-Realtime (Verbindung, Herzschlag, Kanäle), Internet an/aus, Tab sichtbar/verborgen, Fahrt-Kanal, Langzeittest.
const KEY = 'vvConnLog', MAX = 400;
let buf = null, saveT = null, hbOk = 0;
const load = () => { if (buf) return buf; try { buf = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { buf = []; } return buf; };
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(buf.slice(-MAX))); } catch (e) { } }, 500); };
const listeners = new Set();
// Eintrag: lvl = ok | info | warn | bad
// Im Hintergrund trennt das Handy die Verbindung meist nach wenigen Sekunden (Code 1006), und die Wiederholversuche der
// Bibliothek scheitern, bis die App wieder sichtbar ist. Das ist erwartet: als Info vermerken, gleiche Meldungen nur einmal.
let hiddenAt = 0, lastKey = '', lastT = 0;
export function log(lvl, src, msg) {
  const bg = typeof document !== 'undefined' && document.hidden && hiddenAt && Date.now() - hiddenAt > 1500;
  if (bg && (lvl === 'bad' || lvl === 'warn') && src !== 'Internet' && src !== 'Test') { lvl = 'info'; msg = String(msg) + ' · App im Hintergrund (normal)'; }
  const k = lvl + src + msg; if (k === lastKey && Date.now() - lastT < 3000) return; lastKey = k; lastT = Date.now();
  load(); buf.push({ t: Date.now(), lvl, src, msg: String(msg).replace(/\?[^ ]*/g, '').slice(0, 160) }); if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  save(); listeners.forEach(f => { try { f(); } catch (e) { } });
}
export const entries = () => load().slice();
export const clear = () => { buf = []; save(); listeners.forEach(f => f()); };
export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
export const heartbeatsOk = () => hbOk;
// Für createClient: Supabase-Realtime-Protokoll filtern (nur Zustandswechsel, keine einzelnen Nachrichten)
export function rtLogger(kind, msg, data) {
  const m = String(msg || '');
  if (kind === 'transport') {
    if (/^connected to/.test(m)) return log('ok', 'Server', 'Verbindung aufgebaut');
    if (m === 'close') return log('bad', 'Server', `Verbindung geschlossen${data?.code ? ' (Code ' + data.code + (data.reason ? ', ' + data.reason : '') + ')' : ''}`);
    if (/heartbeat timeout/.test(m)) return log('bad', 'Server', 'Keine Antwort auf Herzschlag – baue neu auf');
    if (/error|Error/.test(m) && !/^push/.test(m)) return log('warn', 'Server', m);
    return;
  }
  if (kind === 'channel') {
    const top = (m.match(/realtime:(\S+)/) || [])[1] || ''; const name = top === 'lobby' ? 'Lobby' : top.startsWith('ride:') ? 'Fahrt' : top;
    if (/^close/.test(m)) return log('info', name, 'Kanal geschlossen');
    if (/^error/.test(m)) return log('bad', name, 'Kanal gestört – Bibliothek verbindet neu');
    if (/^timeout/.test(m)) return log('warn', name, 'Beitritt dauert zu lange');
    return;
  }
  if (kind === 'worker' && /error/.test(m)) log('warn', 'Herzschlag', 'Worker-Fehler: ' + m);
}
export function rtHeartbeat(status) {
  if (status === 'ok') { hbOk++; return; }
  if (status === 'sent') return;
  log(status === 'timeout' ? 'bad' : 'warn', 'Herzschlag', { timeout: 'Zeitüberschreitung', error: 'Fehler', disconnected: 'nicht verbunden' }[status] || status);
}
if (typeof window !== 'undefined') {
  addEventListener('offline', () => log('bad', 'Internet', 'Gerät ist offline'));
  addEventListener('online', () => log('ok', 'Internet', 'Gerät wieder online'));
  document.addEventListener('visibilitychange', () => { hiddenAt = document.hidden ? Date.now() : 0; log('info', 'Tab', document.hidden ? 'im Hintergrund' : 'wieder sichtbar'); });
}

/* ---------- Langzeittest: alle 10 s eine kleine Datenbank-Anfrage, Antwortzeit messen ---------- */
export const test = { on: false, until: 0, n: 0, fail: 0, sum: 0, max: 0, timer: null };
export function startTest(minutes, client) {
  stopTest(); Object.assign(test, { on: true, until: Date.now() + minutes * 60e3, n: 0, fail: 0, sum: 0, max: 0 });
  log('info', 'Test', `Langzeittest gestartet (${minutes} min)`);
  const tick = async () => {
    if (Date.now() > test.until) { stopTest(true); return; }
    const t0 = performance.now(); let ok = false, err = '';
    try { const sb = await client(); const r = await Promise.race([sb.rpc('ping'), new Promise((_, j) => setTimeout(() => j(new Error('keine Antwort nach 8 s')), 8000))]); ok = !r.error; if (r.error) err = r.error.message; } catch (e) { err = e.message; }
    const ms = Math.round(performance.now() - t0); test.n++;
    if (ok) { test.sum += ms; test.max = Math.max(test.max, ms); if (ms > 2000) log('warn', 'Test', `langsame Antwort: ${ms} ms`); }
    else { test.fail++; log('bad', 'Test', 'Anfrage fehlgeschlagen: ' + (err || 'unbekannt')); }
    listeners.forEach(f => f());
  };
  tick(); test.timer = setInterval(tick, 10000);
}
export function stopTest(done = false) {
  if (!test.on) return; clearInterval(test.timer); test.on = false;
  const avg = test.n - test.fail ? Math.round(test.sum / (test.n - test.fail)) : 0;
  log(test.fail ? 'warn' : 'ok', 'Test', `${done ? 'Beendet' : 'Abgebrochen'}: ${test.n} Anfragen, ${test.fail} fehlgeschlagen, Ø ${avg} ms, max ${test.max} ms, ${hbOk} Herzschläge ok`);
}
