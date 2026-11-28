// Rauchtest im echten Browser: alle Seiten öffnen, eine Demo-Fahrt starten, Baukasten, Saison, Geister.
// Start: Webserver im Repo-Ordner auf Port 8765, dann `node tests/smoke.mjs`. Bricht mit Exit-Code 1 ab, wenn etwas schiefgeht.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // lokal oder global installiert
const BASE = process.env.BASE || 'http://localhost:8765/';
const PAGES = ['', 'report/week/0', 'report/month/0', 'workouts', 'plans', 'routes', 'builder', 'history', 'progress', 'devices', 'lobby', 'friends', 'community', 'profile', 'avatar', 'ridesettings', 'appsettings', 'help', 'legal/impressum', 'legal/datenschutz'];
const fails = [];
const check = (ok, what) => { console.log((ok ? '✓ ' : '✗ ') + what); if (!ok) fails.push(what); };
const b = await chromium.launch();
for (const vp of [{ width: 1280, height: 800, n: 'Desktop' }, { width: 390, height: 844, n: 'Handy' }]) {
  const p = await b.newPage({ viewport: vp }), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { if (!localStorage.getItem('vvLang')) localStorage.setItem('vvLang', 'de'); } catch (e) { } }); // Sprachauswahl beim ersten Öffnen überspringen
  await p.route(/supabase\.co|strava\.com/, r => r.abort()); // keine echten Online-Dienste im Test
  await p.goto(BASE + '#/'); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
  for (const k of PAGES) {
    await p.goto(BASE + '#/' + k);
    // Warten, bis die Seite Inhalt hat (auf langsamen Test-Rechnern dauert das Laden länger)
    // (kein waitForFunction: das wertet Code als Text aus, was die Sicherheitsrichtlinie der App zu Recht verbietet)
    for (let i = 0; i < 40; i++) { const ok = await p.evaluate(() => (document.querySelector('#view')?.textContent || '').trim().length > 20 && !document.querySelector('#view .pageload')).catch(() => false); if (ok) break; await p.waitForTimeout(250); }
    const txt = (await p.textContent('#view')).trim();
    check(txt.length > 20, `${vp.n}: Seite #/${k} zeigt Inhalt`);
  }
  // Demo-Fahrt: Geräte simulieren, 6 s fahren, Strecke muss vorankommen
  await p.evaluate(async () => { const { setDemo } = await import('./js/ble.js'); setDemo(true); });
  await p.goto(BASE + '#/ride'); await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('.modal,.tour').forEach(m => m.remove()));
  await p.waitForTimeout(6000);
  const km = await p.textContent('#hDist').catch(() => '');
  const watt = await p.textContent('#hPw').catch(() => '');
  check(+watt > 0, `${vp.n}: Fahrt zeigt Leistung (${watt} W)`);
  check(!!km, `${vp.n}: Fahrt zeigt Strecke (${km} km)`);
  // Baukasten: Vorlage + Baustein → Statistik
  await p.goto(BASE + '#/builder'); await p.waitForTimeout(600);
  await p.click('[data-preset="Alpenpass"]'); await p.click('[data-add="wall"]'); await p.waitForTimeout(300);
  check(/km/.test(await p.textContent('#kitStats')), `${vp.n}: Baukasten berechnet die Strecke`);
  // Saison und Geister (Logik)
  const r = await p.evaluate(async () => {
    const S = await import('./js/season.js'), G = await import('./js/ghosts.js');
    const got = S.seasonAdd(700).length, samples = Array.from({ length: 300 }, (_, i) => ({ d: i * 8 }));
    const g = G.makeGhost({ id: 't', routeId: 'b-hills', samples, sum: { dur: 300, dist: 2400 } }, 'Test');
    const back = await G.fromCode(await G.ghostCode(g));
    return { got, ghost: back.d.length === g.d.length && G.track(back).at(-1) > 2300 };
  });
  check(r.got >= 3, `${vp.n}: Saison vergibt Stufen`);
  check(r.ghost, `${vp.n}: Geist übersteht Code-Export und -Import`);
  // Alle Module tatsächlich laden (findet Fehler, die erst beim Ausführen auffallen, z. B. in nachgeladenen Modulen)
  const bad = await p.evaluate(async () => { const out = []; for (const m of ['tv', 'league', 'family', 'watch', 'video', 'streetimg', 'call', 'inbox', 'fileio', 'export', 'workouts', 'sync', 'pages/live', 'pages/companion', 'pages/watch', 'tvstream', 'livemap', 'stagetour', 'comfort', 'planbuilder', 'intervals', 'online/devices', 'i18n', 'ridesnap', 'urlimport', 'pages/report', 'push', 'setsearch', 'sensors', 'msgpop', 'notilog', 'otherpop', 'invite', 'pages/friends', 'pages/account']) { try { await import('./js/' + m + '.js'); } catch (e) { out.push(m + ': ' + e.message); } } return out; });
  check(!bad.length, `${vp.n}: alle Module laden${bad.length ? ': ' + bad.join(' | ') : ''}`);
  check(!errs.length, `${vp.n}: keine JavaScript-Fehler${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await p.close();
}
await b.close();
if (fails.length) { console.error(`\n${fails.length} Test(s) fehlgeschlagen`); process.exit(1); }
console.log('\nALLE BROWSER-TESTS OK');
