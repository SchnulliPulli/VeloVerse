// Fahransicht: 3D-Welt, HUD, Steuerung des Trainers, Mitfahrer, Aufzeichnung, Screenshots
import { $, esc, fmtT, fmtKm, clamp, bus, toast, dialog, fitCanvas, zoneColor, ZONES, HRZONES } from '../util.js';
import { profile, sel, live, progress, saveSel, levelOf } from '../state.js';
import { setPower, setGrade, control, trainer, status, demo, click, setDemo } from '../ble.js';
import { GEARS, gearPower, integrate, steadySpeed, setSurface, setGears, gearGrade, setUpgrades, env as physEnv } from '../physics.js';
import { upgradeEffect } from '../season.js';
import { getRoute, clearRouteCache } from '../routes.js';
import { getWorkout, at as woAt, drawWorkout, total as woTotal } from '../workouts.js';
import { getPlan } from '../plans.js';
import { profileChart } from '../charts.js';
import { ICON } from '../components.js';
import { saveRide } from '../ridesave.js';
import { db } from '../db.js';
import { putLive, getLive, syncReady, sync as syncState } from '../sync.js';
// Kennung dieses Tabs: pro Konto darf nur ein Tab bzw. Gerät gleichzeitig fahren (Neuladen behält die Kennung)
const TAB = (() => { try { let t = sessionStorage.getItem('vvTab'); if (!t) { t = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('vvTab', t); } return t; } catch (e) { return 'x'; } })();
import { makeField, stepField, gapOf, rotateNames, makePaceGroup } from '../npc.js';
import { rideEggs } from '../eggs.js';
import { daily, dailyTick, bellsSetup, bellsTick, ttSetup, ttTick } from '../modes.js';
import { plusInit, plusStep, plusHud, mods, usePup, steerKey, raceSetup, raceTick, lapReset, trafficSetup, photoMode } from '../rideplus.js';
import { loggedIn, online } from '../online/client.js';
import { mpInit, mpTick, mpOnMsg, mpRideOn, mpHtml, mpEmote, EMOS } from '../multiplayer.js';
import { makeBuddy, buddyStep, buddyDraft } from '../buddy.js';
import { sound, music } from '../sound.js';
import { say, hush } from '../voice.js';
import { ghostsFor, track } from '../ghosts.js';
import { tipFor, cadRange } from '../coach.js';
import { saveProfile } from '../state.js';
import { rng, toggleFullscreen, smooth } from '../util.js';
import { applySaved, arrange, editMode, updateExtras } from '../hudlayout.js';
const layout = () => { const w = $('#rw', S?.el); if (w) { applySaved(w); arrange(w); } };

// Tageszeit und Wetter: fest gewählt oder automatisch (Uhrzeit, Wetter des Tages)
export function resolveEnv() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const time = sel.time && sel.time !== 'auto' ? sel.time : h >= 5 && h < 9 ? 'morning' : h < 17.5 && h >= 9 ? 'day' : h >= 17.5 && h < 21 ? 'evening' : 'night';
  const r = rng(Math.floor(Date.now() / 864e5) * 7919)(), weather = sel.weather && sel.weather !== 'auto' ? sel.weather : r < .5 ? 'clear' : r < .78 ? 'cloudy' : r < .9 ? 'rain' : 'fog';
  return { time, weather };
}
const ENV_L = { morning: 'Morgen', day: 'Tag', evening: 'Abend', night: 'Nacht', clear: 'klar', cloudy: 'bewölkt', rain: 'Regen', fog: 'Nebel' };

const VIEWS = { 0: 'Verfolger', 1: 'Weit', 2: 'Seite', 3: 'Vogel', 4: 'Fahrer', 6: 'Rückblick' };
const SPEED = +new URLSearchParams(location.search).get('speed') || 1; // nur zum Testen
const NPC_COUNT = { high: 14, medium: 10, low: 6 };
let S = null;

export async function render(el) {
  if (S?.parked) return unpark(el);
  el.innerHTML = `<div class="ridewrap" id="rw">
    <canvas id="gl"></canvas><video id="rideVid" class="ridevid" muted playsinline preload="auto" hidden></video>
    <div class="loading" id="load"><div class="spinner"></div><div id="loadTxt">Welt wird aufgebaut …</div></div>
    <div class="hud-top" data-drag="top">
      <div class="hud-row">
        <div class="hbox"><b id="hHr" class="num hr">--</b><span>Puls</span></div>
        <div class="hbox"><b id="hCad" class="num cad">--</b><span>U/min</span></div>
        <div class="hbox main"><b id="hPw" class="num">0</b><span><i id="hWkg">0,0</i> W/kg</span><div class="zonebar"><i id="hZone"></i></div></div>
        <div class="hbox"><b id="hSpd" class="num">0,0</b><span>km/h</span></div>
        <div class="hbox"><b id="hDist" class="num">0,0</b><span>km</span></div>
        <div class="hbox"><b id="hTime" class="num">0:00</b><span id="hTimeL">Zeit</span></div>
        <div class="hbox"><b id="hAsc" class="num">0</b><span>Hm</span></div>
      </div>
      <div class="hud-sub num small" id="hSub"></div>
    </div>
    <div class="hud-left">
      <div class="hud-wo" id="woBox" data-drag="wo" hidden>
        <div class="row between"><div style="flex:1"><div class="small muted" id="woName"></div><div class="wo-step" id="woStep"></div></div><div class="wo-left num" id="woLeft"></div></div>
        <div class="bar thin"><i id="woSegBar"></i></div>
        <div class="wo-target"><span class="num" id="woTgt">–</span><span class="small">Ziel W</span><span class="wo-cad small" id="woCad"></span><span class="wo-next small muted" id="woNext"></span></div>
        <div class="ontarget" id="onT"><i id="onTi"></i><span class="small" id="onTt"></span></div>
        <div class="cadtarget" id="cadT" hidden><span class="small">Kadenz</span><div class="cadbar"><b id="cadZone"></b><i id="cadMark"></i></div><span class="small num" id="cadTxt"></span></div>
        <div class="tip small" id="woTip" hidden></div>
        <canvas id="woChart" class="wo-chart"></canvas>
        <div class="row between small num"><span id="woTot"></span><span id="woSegN"></span></div>
        <div class="row between small"><span>Intensität <b id="woOff">100</b> % <span class="adapt" id="adapt" title="Adaptive Steuerung"></span></span><span class="row" style="gap:4px"><button class="btn xs" id="woM">−</button><button class="btn xs" id="woP">+</button><button class="btn xs" id="woSkip">Weiter</button></span></div>
      </div>
      <div class="riders" id="riders" data-drag="riders"></div>
    </div>
    <div class="hud-right" data-drag="right">
      <div class="gradebox"><b class="num" id="hGrade">0,0</b><span>% Steigung</span><div class="gradeicon" id="gIcon"></div></div>
      <div class="gearbox"><button class="gbtn" id="gUp" aria-label="Hochschalten">+</button><div class="gearval"><b class="num" id="hGear">12</b><span id="hGearSub">Gang</span></div><button class="gbtn" id="gDn" aria-label="Runterschalten">−</button></div>
      <div class="hbox small draftbox" id="draftBox" hidden><b class="num" id="hDraft">0 %</b><span>Windschatten</span></div>
      <div class="hbox small" id="pacerBox" hidden><b class="num" id="hPacer">0 m</b><span id="pacerL">zum Schrittmacher</span></div>
    </div>
    <div class="msgstack" id="msgStack" data-drag="msg">
      <div class="mpch" id="mpCh" hidden></div>
      <div class="climb" id="climbBox" hidden><div class="climb-name" id="clName"></div><div class="climb-row num"><span id="clLeft"></span><span id="clGrade"></span><span id="clTime"></span></div><div class="bar"><i id="clBar"></i></div></div>
      <div class="banner" id="banner" role="status" aria-live="polite"></div>
      <div class="xpfloat" id="xpFloat"></div>
    </div>
    <div class="xlayer"></div>
    <div class="editbar" id="editBar" hidden></div>
    <div class="hud-bottom">
      <div class="miniwrap" data-drag="mini"><canvas id="mini" class="minimap" title="Karte öffnen (K)"></canvas></div>
      <div class="elevwrap" data-drag="elev"><canvas id="elev"></canvas><div class="elevtxt small" id="elevTxt"></div></div>
    </div>
    <div class="demopad" id="demoPad" data-drag="demopad" hidden aria-label="Demo-Steuerung">
      <div class="dphead">🧪 Demo</div>
      <div class="dpline"><span>Tritt</span><button class="dpb" data-dp="cad-" aria-label="langsamer treten">−</button><b class="num" id="dpCad">88</b><button class="dpb" data-dp="cad+" aria-label="schneller treten">+</button></div>
      <div class="dpline"><span>Watt</span><button class="dpb" data-dp="w-" aria-label="weniger Watt">−</button><b class="num" id="dpW">180</b><button class="dpb" data-dp="w+" aria-label="mehr Watt">+</button></div>
      <div class="dprow"><button class="dpb brake" data-dp="brake" title="Gedrückt halten: aufhören zu treten und bremsen">🛑</button><button class="dpb" data-dp="sprint" title="8 Sekunden Vollgas">🚀</button><button class="dpb" data-dp="left" aria-label="Spur links">⬅</button><button class="dpb" data-dp="right" aria-label="Spur rechts">➡</button></div>
    </div>
    <div class="toolbar">
      <button class="tbtn" id="tPause" title="Pause (Leertaste)">${ICON.pause}<span>Pause</span></button>
      <button class="tbtn" id="tView" title="Kamera (C)">${ICON.view}<span>Kamera</span></button>
      <button class="tbtn" id="tRideOn" title="Ride On an den nächsten Fahrer (R)"><b class="ro">👍</b><span>Ride On</span></button>
      <button class="tbtn" id="tSet" title="Fahransicht und Ton einstellen, ohne die Fahrt zu verlassen"><b class="dots gear">⚙️</b><span>Optionen</span></button>
      <button class="tbtn" id="tMore" title="Weitere Funktionen" aria-expanded="false"><b class="dots">⋯</b><span>Mehr</span></button>
      <button class="tbtn stop" id="tEnd" title="Beenden">${ICON.stop}<span>Beenden</span></button>
    </div>
    <div class="tbpop" id="tbPop" hidden>
      <button class="tbtn" id="tMenu" title="Pausieren und ins Menü">${ICON.home}<span>Menü</span></button>
      <button class="tbtn" id="tShot" title="Foto (P)">${ICON.camera}<span>Foto</span></button>
      <button class="tbtn" id="tPhoto" title="Fotomodus (O)"><b class="dots">🎞️</b><span>Fotomodus</span></button>
      <button class="tbtn" id="tMode" title="Widerstand">${ICON.workout}<span id="tModeL">Gänge</span></button>
      <button class="tbtn" id="tNpc" title="Mitfahrer (N)">${ICON.ride}<span id="tNpcL">Feld an</span></button>
      <button class="tbtn" id="tMap" title="Karte und Beamen (K)">${ICON.route}<span>Karte</span></button>
      <button class="tbtn" id="tEnv" title="Tageszeit und Wetter (W)">${ICON.sun}<span>Wetter</span></button>
      <button class="tbtn" id="tSnd" title="Ton (M)">${ICON.sound}<span id="tSndL">Ton</span></button>
      <button class="tbtn" id="tLayout" title="Anzeige anordnen">${ICON.layout}<span>Anordnen</span></button>
      <button class="tbtn" id="tFull" title="Vollbild">${ICON.full}<span>Vollbild</span></button>
      <button class="tbtn" id="tCast" title="Fahrt auf dem Fernseher anzeigen (Chromecast, Fernseher mit Browser, AirPlay)"><b class="dots">📡</b><span>Auf Fernseher</span></button>
      <button class="tbtn" id="tWatch" title="Zuschauer-Link: Freunde sehen live zu und feuern an"><b class="dots">📺</b><span id="tWatchL">Zuschauer</span></button>
      <button class="tbtn" id="tVoice" title="Sprachsteuerung: Pause, schwerer, leichter, nächstes Intervall …"><b class="dots">🎙️</b><span id="tVoiceL">Sprache</span></button>
      <button class="tbtn" id="tEmo" title="Geste an deine Mitfahrer (online)"><b class="dots">🙋</b><span>Geste</span></button>
      <button class="tbtn" id="tPace" title="Pace-Partner: Gruppe mit festem Tempo zum Mitfahren"><b class="dots">🐇</b><span id="tPaceL">Pace-Partner</span></button>
      <button class="tbtn" id="tBuddy" title="Trainingsbuddy, der dich pusht"><b class="dots">🤝</b><span id="tBuddyL">Buddy</span></button>
      <button class="tbtn" id="tTour" title="Kurze Einführung in die Anzeigen"><b class="dots">🎓</b><span>Einführung</span></button>
      <button class="tbtn" id="tKeys" title="Tastenkürzel (Taste ?)"><b class="dots">⌨️</b><span>Tastenkürzel</span></button>
      <button class="tbtn" id="tMusic" title="Nächstes Musikstück (Taste T)"><b class="dots">🎵</b><span>Nächstes Stück</span></button>
      <button class="tbtn" id="tDemo" title="Demo-Geräte (simulierte Rolle, Puls und Kadenz)"><b class="dots">🧪</b><span id="tDemoL">Demo an</span></button>
    </div>
    <div class="envpanel" id="envPanel" hidden>
      <div class="small muted">Tageszeit</div>
      <div class="seg sm" id="envTime">${[['auto', 'Auto'], ['morning', 'Morgen'], ['day', 'Tag'], ['evening', 'Abend'], ['night', 'Nacht']].map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div>
      <div class="small muted">Wetter</div>
      <div class="seg sm" id="envWeather">${[['auto', 'Auto'], ['clear', 'Klar'], ['cloudy', 'Wolken'], ['rain', 'Regen'], ['fog', 'Nebel']].map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div>
      <div class="small muted" id="envNow"></div>
    </div>
    <div class="bigmap" id="bigMap" hidden>
      <div class="bigmap-card">
        <div class="row between"><b id="bmTitle">Karte</b><button class="btn sm ghost" id="bmClose">Schließen</button></div>
        <div class="bmwrap"><canvas id="bmCanvas"></canvas><div class="bmzoom"><button class="btn sm" id="bmZin" title="Hineinzoomen">+</button><button class="btn sm" id="bmZout" title="Herauszoomen">−</button><button class="btn sm" id="bmMe" title="Auf mich zentrieren">◎</button><button class="btn sm" id="bmAll" title="Ganze Strecke">⤢</button></div></div>
        <canvas id="bmProf" class="bmprof"></canvas>
        <div class="row between"><span class="small muted" id="bmInfo">Tippe auf die Strecke oder ins Höhenprofil, um ein Ziel zu wählen.</span><button class="btn pri" id="bmGo" disabled>Hierhin beamen</button></div>
        <div class="row small" id="bmQuick"></div>
      </div>
    </div>
    <div class="toprt"><button class="castbtn" id="castBtn" title="Auf Fernseher oder anderem Bildschirm anzeigen" aria-label="Auf Fernseher streamen"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg></button><button class="liveled" id="liveLed" hidden title="Live-Verbindung"><i></i><span id="liveLedN"></span></button></div>
    <div class="startcard" id="startCard"><b>Bereit</b><span>Tritt in die Pedale, die Fahrt startet automatisch.</span></div>
  </div>`;
  await start(el);
}

// Läuft mit diesem Konto schon eine Fahrt auf einem anderen Gerät oder in einem anderen Tab?
async function otherRide() {
  if (!syncReady()) return null;
  try { const L = await Promise.race([getLive(), new Promise(r => setTimeout(() => r(null), 4000))]); return L && L.state !== 'ended' && L.tab && L.tab !== TAB && Date.now() - L.ts < 20000 ? L : null; } catch (e) { return null; }
}
async function blocked(el, L) {
  const tok = window.__routeTok;
  el.innerHTML = `<div class="blkwrap"><section class="card form blkcard">
      <div class="blkico">🚴</div><h2>Auf „${esc(L.devName || 'einem anderen Gerät')}“ läuft gerade eine Fahrt</h2>
      <p class="muted">${esc(L.route || '')}${L.route ? ' · ' : ''}${fmtT(L.t || 0)} gefahren. Online kann pro Konto nur eine Fahrt gleichzeitig laufen, damit sich Live-Anzeige, Lobby und Fortschritt nicht in die Quere kommen.</p>
      <div class="blkbtns"><a class="btn pri" href="#/live">📊 Live verfolgen</a><button class="btn" id="blkOff">📴 Hier offline fahren</button><a class="btn ghost" href="#/">Zur Startseite</a></div>
      <p class="small muted">Offline fahren: Die Fahrt läuft nur auf diesem Gerät – ohne Live-Anzeige, Lobby und Online-Status. Gespeichert wird sie wie gewohnt und danach abgeglichen.</p>
      <p class="small muted" id="blkInfo">Sobald die andere Fahrt beendet ist, kannst du hier normal starten.</p></section></div>`;
  el.querySelector('#blkOff').onclick = () => { sessionStorage.setItem('offlineRide', '1'); window.__route?.(); };
  // Nachsehen, ob die andere Fahrt inzwischen beendet ist
  const iv = setInterval(async () => {
    if (tok !== window.__routeTok) return clearInterval(iv);
    if (!(await otherRide())) { clearInterval(iv); const i = el.querySelector('#blkInfo'); if (i) i.innerHTML = '✅ Die andere Fahrt ist beendet. <a class="btn sm pri" href="#/ride" id="blkGo">Jetzt hier fahren</a>'; el.querySelector('#blkGo')?.addEventListener('click', e => { e.preventDefault(); render(el); }); }
  }, 5000);
}
async function start(el) {
  const offline = sessionStorage.getItem('offlineRide') === '1'; sessionStorage.removeItem('offlineRide');
  if (!offline) { const L = await otherRide(); if (L) return blocked(el, L); }
  const route = await getRoute(sel.routeId);
  const wo = await getWorkout(sel.workoutId);
  const { World } = await import('../world.js');
  const canvas = $('#gl', el);
  let world;
  try { world = new World(canvas, route, profile); }
  catch (e) { $('#loadTxt').textContent = 'WebGL konnte nicht gestartet werden: ' + e.message; return; }
  S = {
    el, route, wo, world, state: 'ready', t: 0, dist: 0, v: 0, crank: 0, gear: clamp(sel.gear ?? 13, 0, setGears().length - 1), mode: sel.mode, ergW: sel.ergW, wOff: 0, wT: 0,
    samples: [], shots: [], kj: 0, asc: 0, lastE: null, lap: 0, startWall: null, idle: 0, curP: 0, lastSend: 0, p3: [],
    climbs: route.climbs.map(c => ({ ...c, state: 'pending' })), climbLog: [], sprints: route.sprints.map(c => ({ ...c, state: 'pending' })), sprintLog: [],
    lastShotT: 0, lastSeg: -1, woDone: false, finished: false, overtakes: 0, gates: 0, draft: 0, wheel: null, rideOnsGot: 0, rideOnsGiven: 0, lapT0: 0, nextRideOn: 60 + Math.random() * 120,
    pacer: sel.pacer === 'buddy' ? makeBuddy(profile) : sel.pacer ? { d: 0, v: 0, crank: 0, w: sel.pacer * profile.kg } : null, lastHud: 0, alive: true, offs: [],
    adapt: { on: sel.adaptive !== false, lowCad: 0, okCad: 0, cap: false, hrHigh: 0, lastAdj: -999, note: '', noteT: 0, weak: 0 },
    np: { buf: [], bs: 0, s4: 0, n: 0 }, field: [], npcOn: sel.npcs !== false, odo: 0, beamed: false, lastBeep: -1, nextDrink: (profile.drinkEvery || 15) * 60,
  };
  setSurface(route); // Belag und Schwerkraft der Strecke
  // Wind (Einstellung, nicht bei Workouts ohne Spiel-Extras, nicht im Weltall): Richtung und Stärke je Fahrt, mit Böen
  S.windOn = profile.windPhys === true && !S.gameOff && !route.theme?.gravity && !S.group;
  if (S.windOn) { S.windDir = Math.random() * Math.PI * 2; S.windSpd = 2 + Math.random() * 4; }
  // Bei Workouts standardmäßig ohne Spiel-Extras, die Tempo und Strecke verfälschen (Power-ups, Werkstatt-Teile)
  S.gameOff = !!wo && !profile.gameInWorkouts;
  setUpgrades(profile.upgradesOn !== false && !S.gameOff ? upgradeEffect() : null); // Werkstatt-Teile (bei echten Mitfahrern wieder neutral, siehe unten)
  // Gruppenfahrt: alle übernehmen die Einstellungen des Gastgebers (nur für diese Fahrt, eigene Einstellungen bleiben)
  S.group = (() => { try { return JSON.parse(sessionStorage.getItem('groupRide') || 'null'); } catch (e) { return null; } })(); sessionStorage.removeItem('groupRide');
  if (S.group) { const G = S.group.settings || {}; S.npcOn = G.npcs !== false; }
  S.env = S.group ? groupEnv(S.group) : resolveEnv(); world.setEnv(S.env);
  // Geist: beste bisherige Fahrt auf dieser Strecke (nicht gebeamt)
  if (sel.ghost !== false) {
    const cand = (await db.all('rides')).filter(r => r.routeId === route.id && !r.beamed && r.samples?.length > 120);
    const best = progress.routeBest[route.id] && cand.find(r => r.id === progress.routeBest[route.id].rideId) || cand.sort((a, b) => b.sum.avgV - a.sum.avgV)[0];
    if (best) { S.ghost = { d: Float32Array.from(best.samples, s => s.d), date: best.date }; world.setGhost(true); }
  }
  // Freunde-Geister dieser Strecke (bis zu 5)
  { const fg = (await ghostsFor(route.id)).slice(0, 5); if (fg.length) { S.fg = fg.map((g, i) => ({ g, tr: track(g), name: g.name, lat: [.9, 2.1, 3, 1.4, 2.6][i], d: 0, v: 0, crank: 0, gap: 0, lead: null })); world.setFriendGhosts(S.fg.map(f => ({ ...f.g.look, name: '👻 ' + f.name }))); } }
  world.setPacer(!!S.pacer, S.pacer?.buddy ? BUDDY_LOOK : null, S.pacer?.name);
  world.view = VIEWS[profile.camView] ? +profile.camView : 0; world.showNames = profile.npcNames !== false;
  if (profile.fsOnRide && !document.fullscreenElement) toggleFullscreen();
  if (SPEED !== 1) { window.__tw = S; window.__twHud = () => hud(); window.__twMp = () => { mpInit(S); S.live.onMp = m => mpOnMsg(S, MPH, m); }; window.__twSync = () => syncRemote(); } // Testhilfe
  const plan = wo?.planId ? getPlan(wo.planId) : null;
  if (wo?.planId && progress.planAdapt) { S.wOff = progress.planAdapt; S.planAdaptMsg = true; }
  S.planLabel = plan ? `${plan.name} · Woche ${wo.week} · Einheit ${wo.n}` : null;
  if (S.wo && !S.group && !sessionStorage.getItem('quickStart') && profile.askForm !== false) await dayForm(S);
  if (route.video) videoSetup(S, el);
  { let st = null; try { st = JSON.parse(sessionStorage.getItem('tourStage') || 'null'); } catch (e) { } sessionStorage.removeItem('tourStage');
    if (st && st.id === route.id) { S.tour = st; $('#startCard', el).innerHTML = `<b>🏆 Tour de IndooRado · Etappe ${st.n}</b><span>${esc(st.name)}${st.loop ? ' – eine volle Runde' : ' bis ins Ziel'}. Die Zeit läuft ab dem ersten Tritt.</span>`; } }
  if (loggedIn() && route.builtin && route.climbs.length) import('../stagetour.js').then(async T => { S.kom = await T.komTop(route.id); });
  if (loggedIn()) import('../tv.js').then(m => m.listenRemote()); // Handy als Fernbedienung
  // Echte Straßenbilder (Mapillary) bei GPX-Strecken: nur mit Konto, Schlüssel und Einwilligung
  import('../streetimg.js').then(async M => {
    if (!(await M.possible(route)) || !(await M.askConsent()) || !S?.alive) return;
    const box = document.createElement('div'); box.className = 'streetimg'; box.hidden = true; box.innerHTML = M.boxHtml(); document.body.appendChild(box);
    S.si = new M.StreetImages(route, box); M.mount(box, S.si); const iv = setInterval(() => { if (!S?.alive || !S.si) return clearInterval(iv); S.si.update(S.dist); }, 1000);
  }).catch(() => { });
  // Kinderfahrt: Ziel 10 Minuten, dann Lob und Bonus (weiterfahren geht)
  { const km = +sessionStorage.getItem('kidRide') || 0; sessionStorage.removeItem('kidRide'); if (km) { S.kidMin = km; $('#startCard', el).innerHTML = `<b>🧒 ${km} Minuten Abenteuer</b><span>Tritt los! Sammle Glocken und überhol die anderen.</span>`; const iv = setInterval(() => { if (!S?.alive) return clearInterval(iv); if (S.t >= km * 60) { clearInterval(iv); S.bonusXp = (S.bonusXp || 0) + 50; flash(`🎉 Super, ${km} Minuten geschafft! +50 XP`, 4000); sound.fanfare?.(); } }, 1000); } }

  $('#loadTxt').textContent = 'Gelände wird erzeugt …';
  await new Promise(r => setTimeout(r, 30));
  world.resize(); world.preload(0);
  if (S.npcOn) spawnField();
  await plusInit(S); trafficSetup(S, flash); bellsSetup(S);
  if (sessionStorage.getItem('dailyNext')) { sessionStorage.removeItem('dailyNext'); S.daily = daily(); $('#startCard', el).innerHTML = `<b>🗓️ Tagesherausforderung</b><span>${esc(S.daily.text)}. Tritt los, die Uhr startet mit dem ersten Tritt.</span>`; }
  { let ev = null; try { ev = JSON.parse(sessionStorage.getItem('eventRide') || 'null'); } catch (e) { } sessionStorage.removeItem('eventRide'); if (ev) $('#startCard', el).innerHTML = `<b>📅 Event: ${esc(ev.title)}</b><span>Alle Teilnehmer fahren auf dieser Strecke und sehen sich gegenseitig. Tritt los, wenn es losgeht!</span>`; }
  if (sessionStorage.getItem('quickStart')) { sessionStorage.removeItem('quickStart'); S.quick = true; setTimeout(() => { if (S?.alive && S.state === 'ready') begin(); }, 800); }
  if (sessionStorage.getItem('ttNext')) { sessionStorage.removeItem('ttNext'); ttSetup(S); $('#startCard', el).innerHTML = `<b>⏱️ Zeitfahren: ${fmtKm(S.tt.dist)} km</b><span>Allein gegen die Uhr, ohne Windschatten.${S.tt.best ? ' Bestzeit ' + fmtT(S.tt.best.time) + '.' : ''} Tritt los!</span>`; }
  // Rennen gegen Bots (von der Startseite oder Streckenseite gewählt)
  if (sessionStorage.getItem('raceNext')) {
    sessionStorage.removeItem('raceNext');
    if (!S.npcOn || !S.field.length) { S.npcOn = true; spawnField(); }
    raceSetup(S);
    $('#startCard', el).innerHTML = `<b>🏁 Rennen: ${fmtKm(S.race.dist)} km gegen ${S.field.length} Fahrer</b><span>Alle stehen an der Startlinie. Tritt in die Pedale, dann geht es los.</span>`;
  }
  // Online: echte Fahrer auf derselben Strecke
  const grp = S.group;
  try { S.joinRider = JSON.parse(sessionStorage.getItem('joinRider') || 'null'); } catch (e) { } sessionStorage.removeItem('joinRider');
  // Unterbrochene Fahrt fortsetzen (Absturz, Akku, Tab zu): Stand übernehmen, pausiert an der alten Stelle
  if (sessionStorage.getItem('resumeRide')) {
    sessionStorage.removeItem('resumeRide');
    const SN = await import('../ridesnap.js'), o = await SN.getSnap();
    if (o && o.routeId === route.id && !S.race && !S.group && !S.tt) {
      SN.applySnap(S, o); S.state = 'paused'; S.resumeOnPedal = true;
      $('#startCard', el).innerHTML = `<b>🔁 Fahrt wird fortgesetzt</b><span>${fmtKm(S.odo)} km · ${fmtT(S.t)} – tritt in die Pedale, dann geht es an derselben Stelle weiter.</span>`;
    }
  }
  if (S.joinRider) $('#startCard', el).innerHTML = `<b>🌐 Mitfahren bei ${esc(S.joinRider.name)}</b><span>Sobald die Verbindung steht, springst du direkt hinter ${esc(S.joinRider.name)}.</span><small class="livest" id="liveSt">Live: wird verbunden …</small>`;
  if (grp) { $('#startCard', el).innerHTML = `<b>👥 ${esc(grp.title)}</b><span>Gruppenfahrt: alle starten jetzt mit denselben Einstellungen${grp.isHost ? ' (du bist Gastgeber und bestimmst das Wetter)' : ''}.${S.wo ? ` Gemeinsames Training: <b>${esc(S.wo.name)}</b>, Ziele nach deiner FTP.` : ''} Tritt in die Pedale!</span>`; }
  // Nach einem Neuladen läuft die Anmeldung evtl. noch: kurz darauf warten, dann live beitreten
  const onlineReady = online.ready ? Promise.resolve() : new Promise(r => { const off = bus.on('online', () => { off(); r(); }); setTimeout(() => { off(); r(); }, 20000); });
  if (offline) { S.offline = true; setTimeout(() => S?.alive && flash('📴 Offline-Fahrt: ohne Live-Anzeige und Lobby', 3000), 1500); } // Offline-Fahrt: keine Lobby, kein Live-Kanal, keine Live-Anzeige
  onlineReady.then(() => S?.alive && !S.offline && loggedIn() ? import('../online/presence.js') : Promise.reject(0)).then(m => { window.__presence = m; }).then(() => import('../online/live.js')).then(({ joinRoute }) => {
    if (!S?.alive) return;
    const PRm = window.__presence; PRm?.setStatus({ where: 'ride', route: route.id, routeName: route.name });
    import('../online/sharedroute.js').then(m => m.kitOf(route.id)).then(kit => S?.alive && PRm?.setStatus({ kit })).catch(() => { }); // eigene Baukasten-Strecke zum Mitfahren teilen
    // Position immer senden (auch in Pause oder vor dem ersten Tritt), sonst verschwindet man für die anderen
    S.live = joinRoute(route.id, () => { const go = S.state === 'riding'; return { d: Math.round(S.dist * 10) / 10, v: S.state === 'paused' ? 0 : +S.v.toFixed(2), p: go ? Math.round(S.p3.at(-1) || 0) : 0, wkg: go ? +((S.p3.at(-1) || 0) / profile.kg).toFixed(1) : 0, cad: go && live.fresh && live.power >= 10 ? Math.round(live.cadence ?? 85) : 0, pause: S.state === 'paused' || (!go && S.v < .3), odo: Math.round(S.odo), env: { time: S.env.time, weather: S.env.weather }, look: PRm ? PRm.onlineLook() : { jersey: profile.jersey, bikeColor: profile.bikeColor, helmet: profile.helmet, skin: profile.skin, av: profile.av } }; });
    S.live.onChange = syncRemote; mpInit(S);
    S.live.onMp = m => mpOnMsg(S, MPH, m);
    S.live.onStatus = st => { if (st === 'on') flash('🌐 Live verbunden', 1500); else if (st === 'error' && !S.liveErrShown) { S.liveErrShown = true; flash('🌐 Live-Verbindung unterbrochen, neuer Versuch …', 2500); } };
    if (S.live.status === 'private' && S.joinRider) flash('🌐 Du bist auf „unsichtbar“ gestellt (Konto › Für andere sichtbar). Mitfahren geht nur sichtbar.', 5000);
    // Mitfahren: Wetter und Tageszeit vom gewählten Fahrer, Gruppenfahrt: vom Gastgeber
    S.envLead = S.group && !S.group.isHost ? S.group.hostSid : S.joinRider?.sid || null; S.envLeadName = S.joinRider?.name || 'Gastgeber';
    if (S.joinRider) S.joinGiveUp = performance.now() + 25e3;
    // Gruppenfahrt: Wetter und Tageszeit kommen vom Gastgeber
    S.live.onEnv = (gid, env, from) => { if (!S?.group || S.group.isHost || gid !== S.group.id || from !== S.group.hostSid) return; if (env.time === S.env.time && env.weather === S.env.weather) return; S.env = env; S.world.setEnv(env); updEnvPanel(); flash('👥 Gastgeber: ' + ENV_L[env.time] + ', ' + ENV_L[env.weather], 2500); };
    if (S.group?.isHost) setTimeout(() => S?.live?.sendEnv(S.group.id, S.env), 3000);
  }).catch(e => { if (e) console.warn('Live:', e); });
  $('#load').hidden = true;
  if (wo) { $('#woBox').hidden = false; $('#woName').textContent = S.planLabel ? S.planLabel + ' · ' + wo.name : wo.name; }
  if (S.pacer) { $('#pacerBox').hidden = false; if (S.pacer.buddy) { $('#pacerL').textContent = 'zu ' + S.pacer.name; setTimeout(() => S?.alive && flash(`🤝 ${S.pacer?.name} fährt mit dir: immer ein bisschen stärker als du. Bleib dran oder hau ab!`, 4000), 1500); } }
  updMode(); updGear(); updNpcBtn(); updSnd(); updEnvPanel();
  bindUi();
  S.ro = new ResizeObserver(() => { world.resize(); requestAnimationFrame(layout); }); S.ro.observe(canvas);
  requestAnimationFrame(layout);
  S.timer = setInterval(tick, 100);
  sound.unlock(); music.start();
  S.lastFrame = performance.now();
  const frame = now => {
    if (!S?.alive || S.parked) return;
    S.frameFn(now);
    S.raf = requestAnimationFrame(frame);
  };
  S.frameFn = now => {
    const dt = Math.min(.1, (now - S.lastFrame) / 1000); S.lastFrame = now;
    // Die Physik rechnet mit 10 Hz. Für ruckelfreie Bilder pro Frame weiterrechnen und sanft nachführen.
    const R = S.route, moving = S.state === 'riding';
    const smoothD = (o, key, d, v) => {
      if (o[key] == null) { o[key] = d; return d; }
      let x = o[key] + (moving ? v * dt * SPEED : 0); const gap = gapOf(R, d, x);
      if (Math.abs(gap) > 40) x = d; else x += gap * Math.min(1, dt * 3);
      if (R.loop) x = ((x % R.total) + R.total) % R.total; else x = clamp(x, 0, R.total);
      return (o[key] = x);
    };
    const dist = smoothD(S, 'rdist', S.dist, S.v);
    S.rcrank = (S.rcrank || 0) + (S.v > .3 || moving ? (live.cadence || 0) / 60 * Math.PI * 2 * dt : 0);
    let npcs = null;
    if (S.npcOn) npcs = S.field.map(n => { const d = smoothD(n, 'rd', n.d, n.v); n.rc = (n.rc || 0) + (moving ? n.cadence / 60 * Math.PI * 2 * dt : 0); n.rl = n.rl == null ? n.lat : n.rl + (n.lat - n.rl) * Math.min(1, dt * 5); n.rv = n.rv == null ? n.v : n.rv + (n.v - n.rv) * Math.min(1, dt * 4); return { d, lat: n.rl, v: n.rv, crank: n.rc }; });
    const pd = S.pacer ? smoothD(S.pacer, 'rd', S.pacer.d, S.pacer.v) : null;
    const ghostDist = S.ghost && S.ghostPos != null ? smoothD(S, 'rghost', S.ghostPos, S.v) : null;
    const fghosts = S.fg?.map(f => ({ d: f.d, lat: f.lat, crank: f.crank, v: f.v, show: !S.world.photo })) || null;
    if (S.videoOn) S.vsync.update(dist, S.v * SPEED, moving); // Videofahrt: 3D-Welt ruht, das Video folgt dem Tempo
    else world.update({ fghosts, dist, lat: S.lat ?? 1.5, ghostDist, v: S.v, crank: S.rcrank, pacerDist: pd, pacerV: S.pacer?.v, pacerCrank: S.pacer?.crank, npcs }, dt);
    if (now - S.lastHud > 200) { S.lastHud = now; hud(); }
  };
  S.raf = requestAnimationFrame(frame);
  lockScreen();
}
// Echte Mitfahrer in das Feld einsortieren (die Welt baut ihre Figuren dann neu)
function syncRemote() {
  if (!S?.alive || !S.live) return;
  const R = S.route, peers = S.live.peers, keep = S.field.filter(n => !n.remote || peers.has(n.id));
  let k = 0;
  for (const [id, p] of peers) if (!keep.some(n => n.id === id)) keep.push({ remote: true, id, i: 100 + k++, name: p.name, wkg: p.wkg || 0, d: p.d || 0, v: p.v || 0, lat: 2.3, latT: 2.3, crank: 0, cadence: p.cad ?? 0, gap: gapOf(R, p.d || 0, S.dist), look: { ...(p.look || {}), jersey: p.look?.jersey || '#ffffff', name: '🌐 ' + p.name, remote: true } });
  S.field = keep; if (peers.size && !S.npcOn) { S.npcOn = true; updNpcBtn(); }
  // "Mitfahren" aus "Wer ist online": einmalig direkt hinter den gewählten Fahrer beamen
  if (S.joinRider && peers.has(S.joinRider.sid)) { const p = peers.get(S.joinRider.sid), name = S.joinRider.name; S.joinRider = null; S.joinGiveUp = 0; const d = R.loop ? ((p.d - 10) % R.total + R.total) % R.total : clamp(p.d - 10, 0, R.total - 20); setTimeout(() => { beam(d).then(() => { flash('🌐 Du fährst jetzt direkt hinter ' + name + '. Tritt in die Pedale!', 3000); $('#startCard', S.el).hidden = true; }); }, 300); }
  S.world.setRiders(S.field.map(n => n.look));
  // Benachrichtigung: wer neu dazukommt oder die Strecke verlässt
  const was = S.peerNames || new Map(), now = new Map([...peers].map(([id, p]) => [id, p.name]));
  const pos = p => { const g = gapOf(R, p.d || 0, S.dist), a = Math.abs(g); return a < 30 ? 'direkt bei dir' : (a < 1000 ? Math.round(a) + ' m' : (a / 1000).toFixed(1).replace('.', ',') + ' km') + (g > 0 ? ' vor dir' : ' hinter dir'); };
  // Kurz weg und wieder da (Verbindung, gedrosselter Hintergrund-Tab): leise melden statt erneut „beigetreten“ mit Ton
  const gone = S.peerGone ||= new Map();
  setUpgrades(peers.size || profile.upgradesOn === false || S.gameOff ? null : upgradeEffect()); // mit echten Mitfahrern: gleiche Bedingungen für alle
  for (const [id, p] of peers) if (!was.has(id)) { if (performance.now() - (gone.get(id) || -1e9) < 120e3) flash(`🌐 ${p.name} ist wieder da`, 1500); else { flash(`🌐 ${p.name} ist deiner Fahrt beigetreten · ${pos(p)}`, 3500); sound.pass(); say(p.name + ' fährt jetzt mit', 'mp'); } }
  for (const [id, name] of was) if (!now.has(id)) { gone.set(id, performance.now()); flash(`👋 ${name} hat die Strecke verlassen`, 2500); }
  S.peerNames = now;
}
function spawnField() {
  const q = S.world.qKey;
  const cnt = profile.npcCount == null || profile.npcCount === 'auto' ? NPC_COUNT[q] || 10 : clamp(+profile.npcCount, 1, 24);
  S.field = makeField(S.route, profile, cnt);
  for (const n of S.field) n.gap = gapOf(S.route, n.d, S.dist);
  S.world.setRiders(S.field.map(n => n.look));
}

function bindUi() {
  $('#liveLed', S.el).onclick = e => flash('🌐 ' + e.currentTarget.title, 3500);
  const el = S.el;
  $('#gUp', el).onclick = () => shift(1); $('#gDn', el).onclick = () => shift(-1);
  $('#tPause', el).onclick = togglePause;
  $('#tView', el).onclick = () => flash('Kamera: ' + VIEWS[S.world.cycleView()]);
  $('#tShot', el).onclick = () => shot('Foto');
  $('#castBtn', el).onclick = () => $('#tCast', el).click();
  $('#tCast', el).onclick = async () => { const M = await import('../watch.js'); await M.castToTv(online?.profile?.display_name || profile.name); $('#tWatchL', el).textContent = M.W.token ? 'Zuschauer an' : 'Zuschauer'; };
  $('#tWatch', el).onclick = async () => { const M = await import('../watch.js'); await M.startWatch(online?.profile?.display_name || profile.name); $('#tWatchL', el).textContent = M.W.token ? 'Zuschauer an' : 'Zuschauer'; };
  $('#tMode', el).onclick = cycleMode;
  $('#tNpc', el).onclick = toggleNpcs;
  $('#tPace', el).onclick = choosePace;
  $('#tVoice', el).onclick = async () => { const C = await import('../comfort.js'); const on = await C.toggleVoice(c => bus.emit('remoteCmd', c), flash); $('#tVoiceL', el).textContent = on ? 'Sprache an' : 'Sprache'; $('#tVoice', el).classList.toggle('on', on); };
  $('#tEmo', el).onclick = () => {
    if (!S.mp || !S.field.some(n => n.remote)) { flash('Gesten gehen an echte Mitfahrer – gerade ist niemand online auf dieser Strecke', 2200); return; }
    let p = $('#emoPick', el); if (p) { p.remove(); return; }
    p = document.createElement('div'); p.id = 'emoPick'; p.className = 'emopick'; p.innerHTML = EMOS.map(e => `<button data-emo="${e}">${e}</button>`).join('');
    p.onclick = ev => { const b = ev.target.closest('[data-emo]'); if (!b) return; mpEmote(S, MPH, b.dataset.emo); p.remove(); };
    $('#rw', el).appendChild(p); setTimeout(() => p.isConnected && p.remove(), 6000);
  };
  $('#tFull', el).onclick = toggleFullscreen;
  $('#tEnd', el).onclick = endRide;
  $('#woM', el).onclick = () => { S.wOff = clamp(S.wOff - 2, -40, 40); };
  $('#woP', el).onclick = () => { S.wOff = clamp(S.wOff + 2, -40, 40); };
  $('#woSkip', el).onclick = () => { const w = woAt(S.wo, S.wT); if (w && !w.done) S.wT += w.left + .01; };
  $('#tSnd', el).onclick = toggleSound;
  $('#tSet', el).onclick = () => rideSettings();
  $('#tRideOn', el).onclick = giveRideOn;
  const nextTrack = () => { if (!music.playing) { flash('🎵 Musik ist aus (Fahrt-Einstellungen › Ton)', 2200); return; } music.skip(); setTimeout(() => flash('🎵 ' + (music.trackName || 'Nächstes Stück'), 2000), 60); };
  $('#tMusic', el).onclick = nextTrack;
  $('#tTour', el).onclick = () => setTimeout(() => import('../tour.js').then(m => m.startTour(el)), 200);
  if (!profile.tourDone && !profile.tourAuto) { profile.tourAuto = 1; setTimeout(() => S?.alive && !S.quick && import('../tour.js').then(m => m.startTour(el)), 2500); }
  $('#tKeys', el).onclick = () => import('../shortcuts.js').then(m => m.showShortcuts());
  // Mehr-Menü: klappt über der Knopfleiste auf, schließt nach Auswahl oder Tippen daneben
  const pop = $('#tbPop', el), more = $('#tMore', el), popSet = o => { pop.hidden = !o; more.setAttribute('aria-expanded', String(o)); more.classList.toggle('on', o); };
  more.onclick = e => { e.stopPropagation(); popSet(pop.hidden); };
  pop.addEventListener('click', e => { if (e.target.closest('.tbtn')) setTimeout(() => popSet(false), 120); });
  el.addEventListener('pointerdown', e => { if (!pop.hidden && !e.target.closest('#tbPop,#tMore')) popSet(false); const env = $('#envPanel', el); if (env && !env.hidden && !e.target.closest('#envPanel,#tEnv')) env.hidden = true; });
  el.addEventListener('click', e => { if (e.target.closest('#pupBox')) usePup(S, flash); if (e.target.closest('#tPhoto')) photoMode(S, true); });
  // Workout-Box einklappen (Kopfzeile antippen)
  $('#woBox', el).classList.toggle('collapsed', !!profile.woCollapsed);
  $('#woName', el).parentElement.parentElement.onclick = () => { profile.woCollapsed = !profile.woCollapsed; saveProfile(); $('#woBox', el).classList.toggle('collapsed', profile.woCollapsed); requestAnimationFrame(layout); };
  // Trainingsbuddy während der Fahrt dazuschalten oder wegschicken (ersetzt einen festen Schrittmacher)
  const updBuddy = () => { $('#tBuddyL', el).textContent = S.pacer?.buddy ? 'Buddy weg' : 'Buddy'; $('#tBuddy', el).classList.toggle('on', !!S.pacer?.buddy); };
  updBuddy();
  $('#tBuddy', el).onclick = () => {
    if (S.pacer?.buddy) { flash(`🤝 ${S.pacer.name}: Bis zum nächsten Mal!`, 2000); S.pacer = null; S.world.setPacer(false); $('#pacerBox', el).hidden = true; }
    else { S.pacer = makeBuddy(profile); S.pacer.d = S.route.loop ? (S.dist + 4) % S.route.total : Math.min(S.dist + 4, S.route.total); S.pacer.v = S.v; S.world.setPacer(true, BUDDY_LOOK, S.pacer.name); $('#pacerBox', el).hidden = false; $('#pacerL', el).textContent = 'zu ' + S.pacer.name; flash(`🤝 ${S.pacer.name} fährt jetzt mit dir. Bleib an seinem Hinterrad!`, 3000); }
    updBuddy();
  };
  // Demo-Geräte direkt aus der Fahrt ein- und ausschalten
  const updDemo = () => { $('#tDemoL', el).textContent = demo.on ? 'Demo aus' : 'Demo an'; $('#tDemo', el).classList.toggle('on', demo.on); $('#demoPad', el).hidden = !demo.on; };
  // Demo-Steuerung: Trittfrequenz und Watt in Stufen, Bremse halten, Sprint, Spurwechsel (Minispiel ohne echte Geräte)
  { const pad = $('#demoPad', el); let set = { cad: demo.cad || 88, w: Math.round((demo.cad || 88) * 2.1 * (demo.effort || 1)) }, braking = false, sprintT = null;
    let wTouched = false; demo.wSet = null;
    const apply = () => { if (braking) return; demo.cad = set.cad; demo.effort = set.cad > 20 ? set.w / (set.cad * 2.1) : 1; demo.wSet = wTouched ? set.w : null; val(); };
    const val = () => { const c = $('#dpCad', el), w = $('#dpW', el); if (c) c.textContent = braking ? 0 : Math.round(sprintT ? demo.cad : set.cad); if (w) w.textContent = braking ? 0 : Math.round(sprintT ? demo.wSet : wTouched ? set.w : (live.power || set.w)); };
    const valT = setInterval(() => pad.isConnected ? (!wTouched && val()) : clearInterval(valT), 1000);
    const release = () => { if (!braking) return; braking = false; S && (S.brake = false); pad.querySelector('.dpb.brake')?.classList.remove('on'); apply(); };
    let rep = null; const stopRep = () => { clearInterval(rep); clearTimeout(rep); rep = null; };
    const step = k => { if (k === 'cad-') set.cad = Math.max(40, set.cad - 5); if (k === 'cad+') set.cad = Math.min(125, set.cad + 5); if (k === 'w-' || k === 'w+') { if (!wTouched) { wTouched = true; set.w = Math.round(live.power || set.w); } set.w = Math.max(50, Math.min(1200, set.w + (k === 'w+' ? 10 : -10))); } apply(); };
    pad.addEventListener('pointerdown', e => {
      if ($('#rw', el)?.classList.contains('hudedit')) return; const b = e.target.closest('[data-dp]'); if (!b) return; e.preventDefault(); e.stopPropagation();
      const k = b.dataset.dp;
      if (k === 'brake') { braking = true; demo.cad = 0; S.brake = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (er) { } val(); return; }
      if (/[+-]$/.test(k)) { step(k); stopRep(); rep = setTimeout(() => { rep = setInterval(() => step(k), 90); }, 380); try { b.setPointerCapture(e.pointerId); } catch (er) { } return; } // gedrückt halten = schnell weiterzählen
      if (k === 'left' || k === 'right') { S.latT = clamp((S.latT ?? 1.5) + (k === 'left' ? -.6 : .6), .3, 3.2); return; }
      if (k === 'sprint') { clearTimeout(sprintT); demo.cad = 112; demo.wSet = Math.max(600, set.w * 2); flash('🚀 Sprint!', 1000); sprintT = setTimeout(() => { sprintT = null; apply(); }, 8000); val(); }
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, () => { stopRep(); release(); });
    // Tastatur im Demo-Modus: Bild auf/ab = Watt, Pos1/Ende = Trittfrequenz
    // Fernbedienung (Handy): Trittfrequenz/Watt in Doppelschritten, Bremse 2,5 s, Sprint
    S.demoRemote = k => {
      if (!demo.on) return;
      if (/[+-]$/.test(k)) { step(k); step(k); return; }
      if (k === 'brake') { braking = true; demo.cad = 0; S.brake = true; pad.querySelector('.dpb.brake')?.classList.add('on'); val(); setTimeout(release, 2500); return; }
      if (k === 'sprint') { clearTimeout(sprintT); demo.cad = 112; demo.wSet = Math.max(600, set.w * 2); flash('🚀 Sprint!', 1000); sprintT = setTimeout(() => { sprintT = null; apply(); }, 8000); val(); }
    };
    S.demoKey = e => { if (!demo.on) return false; const m = { PageUp: 'w+', PageDown: 'w-', Home: 'cad+', End: 'cad-' }[e.key]; if (!m) return false; step(m); return true; };
    val();
  }
  updDemo();
  $('#tDemo', el).onclick = () => { setDemo(!demo.on); updDemo(); flash(demo.on ? '🧪 Demo-Geräte an: diese Fahrt wird nicht gespeichert' : '🧪 Demo-Geräte aus', 2500); };
  // Meldungen und Einblendungen mit einmaligem Antippen schließen (nicht im Anordnen-Modus)
  el.addEventListener('click', e => {
    if ($('#rw', el)?.classList.contains('hudedit')) return;
    const t = e.target;
    if (t.closest('#banner')) { $('#banner', el).classList.remove('show'); clearTimeout(bannerT); return; }
    if (t.closest('#climbBox')) { S.climbDismissed = S.climbs.find(c => c.state === 'active') || S.sprints.find(c => c.state === 'active'); $('#climbBox', el).hidden = true; return; }
    if (t.closest('#xpFloat span')) { t.closest('#xpFloat span').remove(); return; }
    if (t.closest('#mpCh')) { $('#mpCh', el).hidden = true; S.mpHideUntil = performance.now() + 60e3; return; }
    if (t.closest('#startCard')) { $('#startCard', el).hidden = true; return; }
  });
  $('#tLayout', el).onclick = () => { closeMap(); $('#envPanel', el).hidden = true; editMode($('#rw', el), true, () => layout()); };
  // Lange drücken auf eine Anzeige: anheben und direkt verschieben (wie Apps auf dem Handy-Startbildschirm).
  // Loslassen legt sie ab und beendet das Anordnen wieder.
  { const rw = $('#rw', el); let lp = null;
    // Anzeigen lassen Klicks oft zur 3D-Welt durch (pointer-events: none) – darum über die Lage suchen; die kleinste Treffer-Anzeige gewinnt
    const widgetAt = (x, y) => { let best = null, ba = Infinity; for (const w of rw.querySelectorAll('[data-drag]')) { if (w.classList.contains('w-hidden') || w.hidden || !w.getClientRects().length) continue; const r = w.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width * r.height < ba) { ba = r.width * r.height; best = w; } } return best; };
    const cancel = () => { if (lp) { clearTimeout(lp.t); lp.w?.classList.remove('pressing'); lp = null; } };
    el.addEventListener('pointerdown', e => {
      cancel(); if (rw.classList.contains('hudedit') || e.button > 0 || e.target.closest('button,a,input,select,.toolbar,.demopad,.callwin,#bigMap:not([hidden])')) return;
      const w = widgetAt(e.clientX, e.clientY); if (!w) return;
      lp = { w, x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
      w.classList.add('pressing');
      lp.t = setTimeout(() => {
        const L = lp; if (!L) return; lp = null; L.w.classList.remove('pressing');
        try { navigator.vibrate?.(25); } catch (er) { }
        closeMap(); $('#envPanel', el).hidden = true;
        editMode(rw, true, () => layout()); rw.classList.add('lpdrag'); L.w.classList.add('lifted');
        // Den Griff an die Anordnen-Logik übergeben: gleicher Finger, gleiche Stelle
        L.w.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: L.id, pointerType: L.type, clientX: L.x, clientY: L.y, isPrimary: true, button: 0, buttons: 1 }));
        const done = () => { removeEventListener('pointerup', done, true); removeEventListener('pointercancel', done, true);
          setTimeout(() => { L.w.classList.remove('lifted'); rw.classList.remove('lpdrag'); if (rw.classList.contains('hudedit')) { editMode(rw, false); layout(); } }, 250); };
        addEventListener('pointerup', done, true); addEventListener('pointercancel', done, true); // Browser darf nicht mehr übernehmen (touch-action: none), daher kommt pointercancel nur bei echtem Abbruch
      }, e.pointerType === 'mouse' ? 600 : 800); // bewusst lang halten, damit normales Antippen nichts auslöst
    }, true);
    el.addEventListener('pointermove', e => { if (lp && e.pointerId === lp.id && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancel(); }, true);
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, e => { if (lp && e.pointerId === lp.id) cancel(); }, true);
    el.addEventListener('contextmenu', e => { if (widgetAt(e.clientX, e.clientY)) e.preventDefault(); }); // kein Kontextmenü beim langen Drücken
    el.addEventListener('touchmove', e => { if (lp || rw.classList.contains('lpdrag')) e.preventDefault(); }, { passive: false });
  }
  $('#rw', el).addEventListener('hudresize', () => { S.miniCache = null; hud(); });
  $('#tMenu', el).onclick = () => { if (!S.samples.length) { leave(); location.hash = '#/'; return; } location.hash = '#/'; };
  $('#tEnv', el).onclick = () => { $('#envPanel', el).hidden = !$('#envPanel', el).hidden; };
  $('#envTime', el).onclick = e => { const b = e.target.closest('[data-v]'); if (b && groupLocked()) return; if (b) { sel.time = b.dataset.v; saveSel(); applyEnv(); } };
  $('#envWeather', el).onclick = e => { const b = e.target.closest('[data-v]'); if (b && groupLocked()) return; if (b) { sel.weather = b.dataset.v; saveSel(); applyEnv(); } };
  $('#tMap', el).onclick = openMap; $('#mini', el).onclick = openMap; $('#mini', el).style.pointerEvents = 'auto';
  $('#bmClose', el).onclick = closeMap;
  $('#bigMap', el).onclick = e => { if (e.target.id === 'bigMap') closeMap(); };
  $('#bmGo', el).onclick = () => { if (S.mapPick != null) beam(S.mapPick); };
  bindMapZoom($('#bmCanvas', el));
  $('#bmZin', el).onclick = () => zoomMap(1.6); $('#bmZout', el).onclick = () => zoomMap(1 / 1.6);
  $('#bmMe', el).onclick = () => { S.mz = Math.max(S.mz || 1, 4); S.mc = [S.route.xAt(S.dist), S.route.zAt(S.dist)]; drawBigMap(); };
  $('#bmAll', el).onclick = () => { S.mz = 1; S.mc = null; drawBigMap(); };
  $('#bmCanvas', el).onclick = e => { if (S.mapDragged) { S.mapDragged = false; return; } mapClick(e, 'map'); }; $('#bmProf', el).onclick = e => mapClick(e, 'prof');
  $('#bmQuick', el).onclick = e => { const b = e.target.closest('[data-d]'); if (b) { S.mapPick = +b.dataset.d; drawBigMap(); } };
  $('#adapt', el).onclick =() => { S.adapt.on = !S.adapt.on; sel.adaptive = S.adapt.on; saveSel(); S.adapt.cap = false; flash('Adaptive Steuerung ' + (S.adapt.on ? 'an' : 'aus')); };
  S.key = e => {
    if ((e.key === 'o' || e.key === 'O') && !e.target.closest?.('input,textarea')) { photoMode(S, !S.world.photo); return; }
    if ((e.key === 'v' || e.key === 'V') && S.videoToggle && !e.target.closest?.('input,textarea')) { S.videoToggle(); return; }
    const sk = steerKey(S, e); if (sk === 'pup') { usePup(S, flash); return; } if (sk) { e.preventDefault(); return; }
    if (e.target.matches?.('input,select,textarea')) return; // Fernbedienung: Ziel ist das Dokument
    if (S.demoKey?.(e)) { e.preventDefault(); return; }
    if (e.key === 'ArrowUp' || e.key === '+') { shift(1); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === '-') { shift(-1); e.preventDefault(); }
    else if (e.key === ' ') { togglePause(); e.preventDefault(); }
    else if (e.key === 'c' || e.key === 'C') $('#tView').click();
    else if (e.key === 'p' || e.key === 'P') shot('Foto');
    else if (e.key === 'n' || e.key === 'N') toggleNpcs();
    else if (e.key === 'r' || e.key === 'R') giveRideOn();
    else if (e.key === 'm' || e.key === 'M') toggleSound();
    else if (e.key === 't' || e.key === 'T') nextTrack();
    else if (e.key === 'k' || e.key === 'K') { if ($('#bigMap').hidden) openMap(); else closeMap(); }
    else if (e.key === 'w' || e.key === 'W') $('#tEnv').click();
    else if (e.key === 'Escape') { closeMap(); $('#envPanel').hidden = true; }
    else if (e.key >= '1' && e.key <= '6') { S.world.view = e.key === '6' ? 6 : +e.key - 1; S.world.camInit = false; flash('Kamera: ' + VIEWS[S.world.view]); }
  };
  document.addEventListener('keydown', S.key);
  S.offs.push(bus.on('shift', d => shift(d)));
  // Handy als Fernbedienung: Workout-Steuerung und Beenden
  S.offs.push(bus.on('remoteCmd', c => {
    if (!S?.alive) return;
    const wi = S.wo ? woAt(S.wo, S.wT) : null;
    if (c === 'next') { if (wi && !wi.done) { S.wT += wi.left + .01; flash('⏭ Nächstes Intervall', 1400); } else flash('Kein Workout aktiv', 1200); }
    else if (c === 'prev' || c === 'restart') { if (!wi || wi.done) { flash('Kein Workout aktiv', 1200); return; } if (c === 'prev' && S.wT - wi.start < 5 && wi.start > 0) { const p = woAt(S.wo, wi.start - .5); S.wT = p.start + .01; flash('⏮ Vorheriges Intervall', 1400); } else { S.wT = wi.start + .01; flash('↺ Intervall von vorn', 1400); } }
    else if (c === 'harder' || c === 'easier') { S.wOff = clamp(S.wOff + (c === 'harder' ? 2 : -2), -40, 40); flash(`Intensität ${100 + S.wOff} %`, 1200); }
    else if (c.startsWith('demo:')) S.demoRemote?.(c.slice(5));
    else if (c === 'pause') togglePause();
    else if (c === 'up' || c === 'down') shift(c === 'up' ? 1 : -1);
    else if (c === 'left' || c === 'right') S.latT = clamp((S.latT ?? 1.5) + (c === 'right' ? .6 : -.6), .3, 3.2);
    else if (c === 'cam') $('#tView', S.el)?.click();
    else if (c === 'photo') shot('Foto');
    else if (c === 'rideon') giveRideOn();
    else if (c === 'music') nextTrack();
    else if (c === 'map') { if ($('#bigMap').hidden) openMap(); else closeMap(); }
    else if (c === 'pup') usePup(S, flash);
    else if (c === 'end') endRide();
    else if (c === 'endsave') { document.querySelector('.modal.on .enddlg')?.closest('.modal')?.remove(); endRide(false, 'save'); }
  }));
  // Lenkertasten: drei schnelle Klicks auf dieselbe Taste überspringen das Intervall, einzelne Klicks schalten
  S.offs.push(bus.on('clickpress', id => {
    const now = performance.now(), P = S.presses = (S.presses || []).filter(p => now - p.t < 900 && p.id === id);
    P.push({ id, t: now });
    if (P.length < 3 || profile.tripleSkip === false || !S.wo) return;
    const wi = woAt(S.wo, S.wT); if (!wi || wi.done) return;
    // die drei Schaltvorgänge zurücknehmen
    for (const s of (S.shiftLog || []).filter(s => now - s.t < 1000).slice(-3)) {
      if (s.k === 'woff') S.wOff = clamp(S.wOff - s.dir * 2, -40, 40);
      else if (s.k === 'erg') { S.ergW = clamp(S.ergW - s.dir * 10, 30, profile.maxW); sel.ergW = S.ergW; }
      else if (s.k === 'gear') { S.gear = clamp(S.gear - s.dir, 0, GEARS.length - 1); sel.gear = S.gear; }
    }
    S.shiftLog = []; S.presses = []; updGear();
    // Plus-Taste: nächstes Intervall. Minus-Taste: Intervall neu starten, in den ersten 10 s eins zurück.
    if (click.map?.[id] === 'down') {
      const into = wi.g.dur - wi.left;
      if (into > 10 || wi.i === 0) { S.wT = wi.start + .01; flash('⏮ Intervall ' + (wi.i + 1) + ' von vorn', 1500); }
      else { const prev = woAt(S.wo, wi.start - .5); S.wT = prev.start + .01; flash('⏮ Zurück zu Intervall ' + wi.i, 1500); }
      S.lastSeg = -2; S.gateFor = null; S.world.setGate(null);
    } else { S.wT += wi.left + .01; flash('⏭ Intervall übersprungen', 1500); }
    sound.whoosh();
  }));
}

/* ---------- Steuerung ---------- */
function shift(dir) {
  const w = S.wo && S.state !== 'ready' ? woAt(S.wo, S.wT) : null, log = k => { (S.shiftLog = (S.shiftLog || []).slice(-5)).push({ t: performance.now(), dir, k }); };
  if (w && !w.done && w.target != null) { S.wOff = clamp(S.wOff + dir * 2, -40, 40); log('woff'); flash(`Intensität ${100 + S.wOff} %`, 700); return; }
  if (S.mode === 'erg') { S.ergW = clamp(S.ergW + dir * 10, 30, profile.maxW); sel.ergW = S.ergW; saveSel(); log('erg'); flash(S.ergW + ' W', 700); return; }
  if (S.mode === 'hr') { sel.hrTarget = clamp((sel.hrTarget || 140) + dir * 2, 80, profile.hrMax - 5); saveSel(); updGear(); flash('Zielpuls ' + sel.hrTarget, 700); return; }
  if (S.mode === 'sim') { flash('Im Steigungsmodus gibt es keine virtuellen Gänge', 1200); return; }
  const g0 = S.gear; S.gear = clamp(S.gear + dir, 0, GEARS.length - 1); if (S.gear !== g0) log('gear'); sel.gear = S.gear; updGear(); sound.shift(dir > 0);
  flash((dir > 0 ? '▲ ' : '▼ ') + 'Gang ' + (S.gear + 1), 600);
}
function updGear() {
  const el = S.el;
  if (S.mode === 'erg') { $('#hGear', el).textContent = S.ergW; $('#hGearSub', el).textContent = 'W fix'; }
  else if (S.mode === 'sim') { $('#hGear', el).textContent = '–'; $('#hGearSub', el).textContent = 'Steigung'; }
  else if (S.mode === 'hr') { $('#hGear', el).textContent = sel.hrTarget || 140; $('#hGearSub', el).textContent = 'Zielpuls · ' + Math.round(S.hrW || 0) + ' W'; }
  else { $('#hGear', el).textContent = S.gear + 1; $('#hGearSub', el).textContent = 'Gang · ' + GEARS[S.gear].toFixed(2).replace('.', ','); }
}
const MODES = { gear: 'Gänge', sim: 'Steigung', erg: 'ERG', hr: 'Puls' };
function cycleMode() { const k = Object.keys(MODES); S.mode = k[(k.indexOf(S.mode) + 1) % k.length]; sel.mode = S.mode; saveSel(); updMode(); trainer.last = ''; flash('Widerstand: ' + { gear: 'virtuelle Gänge', sim: 'Steigung an Trainer', erg: 'feste Wattzahl', hr: 'Zielpuls, der Trainer regelt die Watt' }[S.mode]); }
function updMode() { $('#tModeL', S.el).textContent = MODES[S.mode]; updGear(); }
function emoFly(e) { const f = document.createElement('div'); f.className = 'cheerfly'; f.textContent = e; f.style.left = (30 + Math.random() * 40) + '%'; S?.el.querySelector('.ridewrap')?.appendChild(f); setTimeout(() => f.remove(), 2600); }
/* ---------- Pace-Partner ---------- */
async function choosePace() {
  if (S.group) { flash('👥 In der Gruppenfahrt nicht verfügbar', 1800); return; }
  const base = profile.ftp / profile.kg, opts = [2, 2.5, 3, 3.5, 4].filter(x => x <= Math.max(2.5, base * 1.15));
  const v = await dialog({ title: '🐇 Pace-Partner', html: `<p class="small muted">Eine Gruppe, die gleichmäßig mit festen Watt pro Kilogramm fährt. Häng dich in den Windschatten und lass dich ziehen. Deine FTP: ${base.toFixed(1).replace('.', ',')} W/kg – Grundlage liegt bei etwa ${(base * .65).toFixed(1).replace('.', ',')} W/kg.</p>`,
    buttons: [{ label: S.pace ? 'Gruppe auflösen' : 'Abbrechen', value: S.pace ? 'off' : null }, ...opts.map(x => ({ label: String(x.toFixed(1)).replace('.', ',') + ' W/kg', value: String(x), cls: Math.abs(x - base * .65) < .3 ? 'pri' : '' }))] });
  if (!v) return;
  S.field = S.field.filter(n => !n.pace);
  if (v === 'off') { S.pace = null; $('#tPaceL', S.el).textContent = 'Pace-Partner'; }
  else { S.pace = +v; if (!S.npcOn) { S.npcOn = true; updNpcBtn(); } S.field.push(...makePaceGroup(S.route, profile, S.pace, S.dist)); $('#tPaceL', S.el).textContent = 'Pace ' + v.replace('.', ','); flash(`🐇 Pace-Gruppe ${v.replace('.', ',')} W/kg vor dir – häng dich ran!`, 2600); }
  for (const n of S.field) n.gap = gapOf(S.route, n.d, S.dist);
  S.world.setRiders(S.field.map(n => n.look));
}
// Hinweis, wenn man in der Gruppe ist oder sie verliert
function paceTick() {
  if (!S.pace) return; const L = S.field.find(n => n.leader); if (!L) return;
  const gap = gapOf(S.route, L.d, S.dist), inG = gap > -8 && gap < 18;
  if (inG !== S.paceIn) { S.paceIn = inG; flash(inG ? `🐇 In der Pace-Gruppe – Windschatten nutzen!` : `🐇 Pace-Gruppe ${gap > 0 ? Math.round(gap) + ' m vor dir' : 'hinter dir'}`, 1800); }
}
function toggleNpcs() {
  if (S.group) { flash('👥 In der Gruppenfahrt gilt die Einstellung der Lobby (Mitfahrer ' + (S.group.settings?.npcs !== false ? 'an' : 'aus') + ')', 2200); return; }
  S.npcOn = !S.npcOn; sel.npcs = S.npcOn; saveSel();
  if (S.npcOn && !S.field.length) spawnField();
  if (!S.npcOn) { S.world.npcs.forEach(n => n.rider.root.visible = false); S.draft = 0; }
  updNpcBtn(); flash(S.npcOn ? 'Mitfahrer an' : 'Mitfahrer aus');
}
// Einstellungen „Fahransicht“ und „Ton“ als Fenster über der Fahrt (die Fahrt läuft weiter, Änderungen gelten sofort)
async function rideSettings(sec = 'view') {
  document.querySelector('.rsdlgw')?.remove();
  const w = document.createElement('div'); w.className = 'modal on rsdlgw';
  w.innerHTML = `<div class="card dlg rsdlg" role="dialog" aria-modal="true" aria-label="Einstellungen"><div class="row between rshead"><div class="seg sm"><button data-sec="view">👁 Fahransicht</button><button data-sec="sound">🔊 Ton</button></div><button class="btn sm ghost" data-x aria-label="Schließen">✕</button></div><div class="rsbody"></div></div>`;
  document.body.appendChild(w);
  const mod = await import('./ridesettings.js'), body = w.querySelector('.rsbody');
  const show = async k => { w.querySelectorAll('[data-sec]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sec === k))); try { mod.leave?.(); } catch (e) { } await mod.render(body, [k]); body.scrollTop = 0; };
  const close = () => { try { mod.leave?.(); } catch (e) { } w.remove(); document.removeEventListener('keydown', escK, true); if (S?.el) updSnd(); };
  const escK = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', escK, true);
  w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-x]')) return close(); const b = e.target.closest('[data-sec]'); if (b) show(b.dataset.sec); if (e.target.closest('a[href="#/ride"]')) { e.preventDefault(); close(); } });
  show(sec);
}
// Ride On: Daumen hoch zwischen Fahrern (gibt etwas XP)
function gotRideOn(name) { S.rideOnsGot++; flash('👍 Ride On von ' + name, 1800); say('Ride On von ' + name, 'mp'); xpPop('+2 XP Ride On'); sound.pass(); }
function giveRideOn() {
  if (!S.npcOn || !S.field.length) { flash('Kein Fahrer in der Nähe', 1000); return; }
  // Echte Mitspieler bis 300 m haben Vorrang: der Ride On kommt bei ihnen wirklich an
  const real = S.field.filter(x => x.remote && Math.abs(gapOf(S.route, x.d, S.dist)) < 300).sort((a, b) => Math.abs(gapOf(S.route, a.d, S.dist)) - Math.abs(gapOf(S.route, b.d, S.dist)))[0];
  if (real && S.mp) { if (S.t - (S.lastGive || -99) < 5) return; S.lastGive = S.t; S.rideOnsGiven++; mpRideOn(S, MPH, real); return; }
  const pool = S.field.filter(x => !x.remote); if (!pool.length) { flash('Kein Fahrer in der Nähe', 1000); return; }
  const n = pool.reduce((a, b) => Math.abs(gapOf(S.route, b.d, S.dist)) < Math.abs(gapOf(S.route, a.d, S.dist)) ? b : a);
  if (Math.abs(gapOf(S.route, n.d, S.dist)) > 150) { flash('Kein Fahrer in der Nähe', 1000); return; }
  if (S.t - (S.lastGive || -99) < 5) return;
  S.lastGive = S.t; S.rideOnsGiven++; flash('👍 Ride On an ' + n.name, 1400); xpPop('+1 XP');
  if (Math.random() < .6) setTimeout(() => S && gotRideOn(n.name), 1500 + Math.random() * 2500);
}
function toggleSound() { sound.unlock(); const on = sound.toggle(); saveProfile(); updSnd(); flash(on ? '🔊 Ton an' : '🔇 Ton aus', 900); }
function updSnd() { const on = profile.soundOn !== false; $('#tSnd', S.el).innerHTML = (on ? ICON.sound : ICON.mute) + `<span>${on ? 'Ton' : 'Stumm'}</span>`; if (!on) sound.silence(); }
function applyEnv() { S.env = resolveEnv(); S.world.setEnv(S.env); S.envNextAt = performance.now() + envGap(); updEnvPanel(); if (S.group?.isHost) S.live?.sendEnv(S.group.id, S.env); }
// Gruppenfahrt: Start-Wetter für alle gleich (Auto-Wetter aus der Lobby-ID abgeleitet)
function groupEnv(g) {
  const G = g.settings || {}, h = [...String(g.id)].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7) / 4294967296;
  return { time: G.time && G.time !== 'auto' ? G.time : resolveEnv().time, weather: G.weather && G.weather !== 'auto' ? G.weather : h < .55 ? 'clear' : h < .8 ? 'cloudy' : h < .92 ? 'rain' : 'fog' };
}
const groupLocked = () => { if (S.envLead && !S.group) { flash('🌦️ Eigenes Wetter: folgt ' + S.envLeadName + ' nicht mehr', 2200); S.envLead = null; return false; } if (S.group && !S.group.isHost) { flash('👥 In der Gruppenfahrt bestimmt der Gastgeber Tageszeit und Wetter', 2200); return true; } if (S.group?.isHost) setTimeout(() => S?.live?.sendEnv(S.group.id, S.env), 50); return false; };
// Auto: Tageszeit und Wetter wechseln während der Fahrt alle 10 bis 15 Minuten
const envGap = () => (10 + Math.random() * 5) * 60e3;
const TIMES = ['morning', 'day', 'evening', 'night'];
// Aussehen des Trainingsbuddys
const BUDDY_LOOK = { jersey: '#7b4fd6', bikeColor: '#f2f4f6', helmet: '#ffffff', skin: '#e3b18c', av: { pattern: 'stripes', jersey2: '#ffd23f', helmetStyle: 'aero', glasses: 'sport', bike: 'road' } };
// Hilfen für das Multiplayer-Modul
const MPH = { emoFly: e => emoFly(e), flash: (t, ms) => flash(t, ms), say: (t, k) => say(t, k), xpPop: t => xpPop(t), sound: { pass: () => sound.pass(), fanfare: () => sound.fanfare() } };
// Live-Status auf der Startkarte beim Mitfahren (zeigt, ob Verbindung steht und Daten fließen)
function liveStatus() {
  if (performance.now() - (S.lsT || 0) < 1000) return; S.lsT = performance.now();
  const e = S.el.querySelector('#liveSt'), L = S.live, st = !L ? 'wird vorbereitet …' : { off: 'wird vorbereitet …', connecting: 'wird verbunden …', on: 'verbunden', error: 'Verbindung gestört, neuer Versuch …', nologin: 'nicht angemeldet oder kein Online-Zugang', private: 'du bist auf „unsichtbar“ gestellt (Konto › Für andere sichtbar)' }[L.status] || L.status;
  // LED oben rechts: grün verbunden, gelb verbindet, rot gestört (nur wenn online angemeldet)
  const led = S.el.querySelector('#liveLed');
  if (led) {
    const show = !!L && L.status !== 'nologin'; led.hidden = !show;
    if (show) { led.dataset.st = L.status === 'on' ? 'on' : L.status === 'error' || L.status === 'private' ? 'bad' : 'wait'; S.el.querySelector('#liveLedN').textContent = L.status === 'on' && L.peers.size ? L.peers.size : ''; led.title = 'Live: ' + st + (L.status === 'on' ? ` · ${L.peers.size} echte Fahrer auf der Strecke · gesendet ${L.sent} · empfangen ${L.recv}` : ''); }
  }
  if (!e) return;
  e.textContent = 'Live: ' + st + (L?.status === 'on' ? ` · gesendet ${L.sent} · empfangen ${L.recv} · ${L.peers.size} ${L.peers.size === 1 ? 'Fahrer' : 'Fahrer'} auf der Strecke` : '');
}
// Wetter folgt dem Gastgeber oder dem Fahrer, bei dem man mitfährt (steckt in jeder Positionsmeldung)
function followEnv() {
  const p = S.envLead && S.live?.peers.get(S.envLead); if (!p?.env) return;
  if (p.env.time === S.env.time && p.env.weather === S.env.weather) return;
  const first = !S.envSynced; S.envSynced = true;
  S.env = { ...p.env }; S.world.setEnv(S.env); updEnvPanel();
  flash((first ? '🌦️ Wetter wie bei ' : '🌦️ ') + S.envLeadName + ': ' + ENV_L[S.env.time] + ', ' + ENV_L[S.env.weather], 2500);
}
function envCycle() {
  if (S?.envLead) return; // folgt einem anderen Fahrer
  const G = S?.group?.settings, autoT = ((G ? G.time : sel.time) || 'auto') === 'auto', autoW = ((G ? G.weather : sel.weather) || 'auto') === 'auto';
  if (S?.group && !S.group.isHost) return; // Gruppenfahrt: nur der Gastgeber wechselt, die anderen folgen per Nachricht
  if (!S || (!autoT && !autoW) || S.route.theme.moon || S.route.theme.underwater || performance.now() < (S.envNextAt ??= performance.now() + envGap())) return;
  S.envNextAt = performance.now() + envGap();
  const env = { ...S.env };
  if (autoT) env.time = TIMES[(TIMES.indexOf(env.time) + 1) % 4];
  if (autoW) { const opts = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain', 'fog'].filter(w => w !== env.weather); env.weather = opts[Math.floor(Math.random() * opts.length)]; }
  S.env = env; S.world.setEnv(env); updEnvPanel(); if (S.group?.isHost) S.live?.sendEnv(S.group.id, env);
  flash({ morning: '🌅 Der Morgen bricht an', day: '☀️ Es wird Tag', evening: '🌇 Abendstimmung', night: '🌙 Die Nacht bricht herein' }[env.time] + (autoW ? ' · ' + { clear: 'klarer Himmel', cloudy: 'Wolken ziehen auf', rain: 'es fängt an zu regnen', fog: 'Nebel zieht auf' }[env.weather] : ''), 3000);
}
function updEnvPanel() {
  const el = S.el;
  for (const b of $('#envTime', el).children) b.setAttribute('aria-pressed', String(b.dataset.v === (sel.time || 'auto')));
  for (const b of $('#envWeather', el).children) b.setAttribute('aria-pressed', String(b.dataset.v === (sel.weather || 'auto')));
  $('#envNow', el).textContent = `Jetzt: ${ENV_L[S.env.time]}, ${ENV_L[S.env.weather]}${(sel.time || 'auto') === 'auto' || (sel.weather || 'auto') === 'auto' ? ' · Auto wechselt alle 10 bis 15 Minuten' : ''}`;
}

/* ---------- Große Karte und Beamen ---------- */
function openMap() { const m = $('#bigMap', S.el); m.hidden = false; S.mapPick = null; $('#bmGo', S.el).disabled = true; $('#bmTitle', S.el).textContent = S.route.name + (S.route.loop ? ' · Rundkurs' : '');
  const R = S.route, q = [['Start', 0], ...R.climbs.map(c => ['⛰ ' + c.name, c.from - 50]), ...R.sprints.map(c => ['🏁 ' + c.name, c.from - 50]), ...R.towns.map(t => ['🏘 ' + t.name, t.from]), ...R.tunnels.map((t, i) => ['Tunnel ' + (i + 1), t.from - 80])].filter(x => x[1] >= 0 && x[1] < R.total - 20);
  // Echte Mitspieler zuerst: zu ihnen beamen (8 m dahinter, direkt im Windschatten)
  const mp = S.field.filter(n => n.remote).map(n => [n.name.replace(/^🌐 /, ''), R.loop ? ((n.d - 8) % R.total + R.total) % R.total : clamp(n.d - 8, 0, R.total - 20)]);
  $('#bmQuick', S.el).innerHTML = mp.map(([l, d]) => `<button class="chipb mp" data-d="${Math.round(d)}">🌐 zu ${esc(l)}</button>`).join('') + q.map(([l, d]) => `<button class="chipb" data-d="${Math.round(d)}">${esc(l)}</button>`).join('');
  requestAnimationFrame(drawBigMap); }
function closeMap() { const m = $('#bigMap', S?.el); if (m) m.hidden = true; }
function mapGeo(cv) {
  const R = S.route, { w, h, d } = fitCanvas(cv);
  if (!S.bounds) { let a = Infinity, b = -Infinity, c = Infinity, e = -Infinity; for (let i = 0; i <= R.N; i += 4) { a = Math.min(a, R.x[i]); b = Math.max(b, R.x[i]); c = Math.min(c, R.z[i]); e = Math.max(e, R.z[i]); } S.bounds = [a, b, c, e]; }
  const [a, b, c, e] = S.bounds;
  // Große Karte: zoombar (S.mz) und verschiebbar (S.mc = Mittelpunkt in Weltkoordinaten)
  const big = cv.id === 'bmCanvas', z = big ? S.mz || 1 : 1;
  const pad = 18 * d, s = Math.min((w - 2 * pad) / (b - a || 1), (h - 2 * pad) / (e - c || 1)) * z;
  const cx = big && S.mc ? S.mc[0] : (a + b) / 2, cz = big && S.mc ? S.mc[1] : (c + e) / 2;
  return { w, h, d, s, cx, cz, X: x => w / 2 + (x - cx) * s, Y: q => h / 2 + (q - cz) * s, inv: (px, py) => [cx + (px - w / 2) / s, cz + (py - h / 2) / s] };
}
function drawRouteMap(cv, big, layer = 'all') {
  const R = S.route, G = mapGeo(cv), c = cv.getContext('2d'), d = G.d;
  if (layer !== 'dynamic') c.clearRect(0, 0, G.w, G.h);
  c.lineJoin = c.lineCap = 'round';
  if (layer !== 'dynamic') drawStatic(R, G, c, d, big);
  if (layer === 'static') return G;
  dynamicLayer(R, G, c, d, big);
  return G;
}
function drawStatic(R, G, c, d, big) {
  const path = (from, to, color, wd) => { c.strokeStyle = color; c.lineWidth = wd * d; c.beginPath(); for (let i = Math.max(0, Math.floor(from / R.step)); i <= Math.min(R.N, to / R.step); i += 2) { const x = G.X(R.x[i]), y = G.Y(R.z[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); };
  path(0, R.total, 'rgba(0,0,0,.5)', big ? 7 : 5); path(0, R.total, '#e6ebf0', big ? 4 : 2.6);
  for (const t of R.tunnels) path(t.from, t.to, '#56606a', big ? 4 : 2.6);
  for (const cl of R.climbs) path(cl.from, cl.to, '#ef4458', big ? 4 : 2.6);
  for (const s of R.sprints) path(s.from, s.to, '#4fd18b', big ? 4 : 2.6);
  for (const t of R.towns) { const m = (t.from + t.to) / 2, x = G.X(R.xAt(m)), y = G.Y(R.zAt(m)); c.fillStyle = '#ffd23f'; c.fillRect(x - 3 * d, y - 3 * d, 6 * d, 6 * d); if (big) { c.font = `600 ${12 * d}px Barlow, sans-serif`; c.fillText(t.name, x + 6 * d, y + 4 * d); } }
  if (big) for (const cl of R.climbs) { const x = G.X(R.xAt(cl.to)), y = G.Y(R.zAt(cl.to)); c.fillStyle = '#ff8b97'; c.font = `600 ${12 * d}px Barlow, sans-serif`; c.fillText('▲ ' + cl.name, x + 6 * d, y - 4 * d); }
  if (!R.loop) { c.fillStyle = '#fff'; const sx = G.X(R.x[0]), sy = G.Y(R.z[0]); c.beginPath(); c.arc(sx, sy, 4 * d, 0, 7); c.fill(); const ex = G.X(R.x[R.N]), ey = G.Y(R.z[R.N]); c.fillStyle = '#111'; c.fillRect(ex - 4 * d, ey - 4 * d, 8 * d, 8 * d); }
}
function dynamicLayer(R, G, c, d, big) {
  if (S.npcOn) for (const n of S.field) { if (n.remote) continue; c.fillStyle = n.look.jersey; c.beginPath(); c.arc(G.X(R.xAt(n.d)), G.Y(R.zAt(n.d)), (big ? 3.5 : 2.2) * d, 0, 7); c.fill(); }
  // Echte Mitspieler hervorgehoben: großer Punkt mit weißem Ring und Name
  for (const n of S.field) if (n.remote) { const x = G.X(R.xAt(n.d)), y = G.Y(R.zAt(n.d)); c.fillStyle = n.look.jersey; c.strokeStyle = '#fff'; c.lineWidth = 2.5 * d; c.beginPath(); c.arc(x, y, (big ? 7 : 4.5) * d, 0, 7); c.fill(); c.stroke(); if (big) { c.font = `700 ${12 * d}px Barlow, sans-serif`; c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 3 * d; const t = n.name.replace(/^🌐 /, ''); c.strokeText(t, x + 9 * d, y - 8 * d); c.fillText(t, x + 9 * d, y - 8 * d); } }
  if (S.pacer) { c.fillStyle = '#b06cf0'; c.beginPath(); c.arc(G.X(R.xAt(S.pacer.d)), G.Y(R.zAt(S.pacer.d)), 3.5 * d, 0, 7); c.fill(); }
  // eigene Position mit Blickrichtung
  const px = G.X(R.xAt(S.dist)), py = G.Y(R.zAt(S.dist)), hd = R.headAt(S.dist);
  c.save(); c.translate(px, py); c.rotate(hd); c.fillStyle = '#ff6a3d'; c.strokeStyle = '#fff'; c.lineWidth = 1.5 * d; const k = big ? 1.4 : 1;
  c.beginPath(); c.moveTo(0, -9 * d * k); c.lineTo(6 * d * k, 6 * d * k); c.lineTo(-6 * d * k, 6 * d * k); c.closePath(); c.fill(); c.stroke(); c.restore();
  if (big && S.mapPick != null) { const x = G.X(R.xAt(S.mapPick)), y = G.Y(R.zAt(S.mapPick)); c.strokeStyle = '#3fa7f5'; c.lineWidth = 3 * d; c.beginPath(); c.arc(x, y, 9 * d, 0, 7); c.stroke(); c.fillStyle = '#3fa7f5'; c.beginPath(); c.arc(x, y, 3 * d, 0, 7); c.fill(); }
}
function drawBigMap() {
  if (!S || $('#bigMap', S.el).hidden) return;
  drawRouteMap($('#bmCanvas', S.el), true);
  const R = S.route, n = 300, dist = [], ele = []; for (let i = 0; i <= n; i++) { const d = R.total * i / n; dist.push(d); ele.push(R.eleAt(d)); }
  profileChart($('#bmProf', S.el), dist, ele, { pos: S.dist, ghost: S.mapPick, climbs: R.climbs });
  if (S.mapPick != null) { const d = S.mapPick; $('#bmInfo', S.el).textContent = `Ziel: km ${fmtKm(d)} · ${Math.round(R.eleAt(d))} m ü. NN · ${R.gradeAt(d).toFixed(1).replace('.', ',')} %${R.townAt(d) ? ' · ' + R.townAt(d).name : ''}`; $('#bmGo', S.el).disabled = false; }
}
// Zoomen um einen Punkt (Pixel in Canvas-Koordinaten), Standard: Mitte
function zoomMap(f, px, py) {
  const cv = $('#bmCanvas', S.el), G = mapGeo(cv); px ??= G.w / 2; py ??= G.h / 2;
  const [wx, wz] = G.inv(px, py), nz = clamp((S.mz || 1) * f, 1, 40);
  if (nz === 1) { S.mz = 1; S.mc = null; drawBigMap(); return; }
  const k = (S.mz || 1) / nz; // Punkt unter dem Finger bleibt stehen
  S.mc = [wx + (G.cx - wx) * k, wz + (G.cz - wz) * k]; S.mz = nz; drawBigMap();
}
function bindMapZoom(cv) {
  const pts = new Map(); let last = null, pinch = 0, moved = 0;
  const pos = e => { const r = cv.getBoundingClientRect(), k = cv.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
  cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = pos(e); zoomMap(Math.exp(-e.deltaY * .0015), x, y); }, { passive: false });
  cv.addEventListener('pointerdown', e => { pts.set(e.pointerId, pos(e)); last = pos(e); moved = 0; S.mapDragged = false; if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = Math.hypot(p[0] - q[0], p[1] - q[1]); } });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; const p = pos(e); pts.set(e.pointerId, p);
    if (pts.size === 2) { const [a, b] = [...pts.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomMap(dd / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = dd; S.mapDragged = true; return; }
    if ((S.mz || 1) <= 1) return;
    const G = mapGeo(cv), dx = p[0] - last[0], dy = p[1] - last[1]; moved += Math.abs(dx) + Math.abs(dy); last = p;
    if (moved > 8 * G.d) { cv.setPointerCapture?.(e.pointerId); S.mapDragged = true; S.mc = [G.cx - dx / G.s, G.cz - dy / G.s]; drawBigMap(); }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.style.touchAction = 'none';
}
function mapClick(e, kind) {
  const R = S.route, cv = e.currentTarget, rect = cv.getBoundingClientRect(), dpr = cv.width / rect.width, mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
  if (kind === 'prof') S.mapPick = clamp(mx / cv.width, 0, 1) * R.total;
  else { const G = mapGeo(cv); let best = -1, bd = Infinity; for (let i = 0; i <= R.N; i++) { const dd = (G.X(R.x[i]) - mx) ** 2 + (G.Y(R.z[i]) - my) ** 2; if (dd < bd) { bd = dd; best = i; } } if (Math.sqrt(bd) > 40 * G.d) return; S.mapPick = best * R.step; }
  S.mapPick = clamp(S.mapPick, 0, R.total - 30); drawBigMap();
}
// Beamen: an eine andere Stelle springen. Gefahrene Distanz zählt weiter, Bestzeiten dieser Fahrt werden nicht gewertet.
async function beam(d) {
  const R = S.route; closeMap(); sound.whoosh();
  $('#load', S.el).hidden = false; $('#loadTxt', S.el).textContent = 'Beamen …';
  await new Promise(r => setTimeout(r, 30));
  S.dist = d; S.lastE = null; S.beamed = true; S.gateFor = null; S.world.setGate(null);
  for (const c of [...S.climbs, ...S.sprints]) c.state = d > c.from ? 'done' : 'pending';
  if (S.pacer) S.pacer.d = d;
  if (S.npcOn) { for (const n of S.field) { if (n.remote) continue; const off = (n.i % 2 ? 1 : -1) * (20 + (n.i * 37) % 300); n.d = R.loop ? ((d + off) % R.total + R.total) % R.total : clamp(d + off, 0, R.total - 10); n.v = S.v; n.gap = gapOf(R, n.d, d); } }
  S.world.clearTraffic?.(); S.world.camInit = false; S.world.preload(d); setTimeout(() => S?.live?.sendNow(), 50);
  $('#load', S.el).hidden = true; flash('Gebeamt nach km ' + fmtKm(d), 1800);
}
function updNpcBtn() { $('#tNpcL', S.el).textContent = S.npcOn ? 'Feld an' : 'Feld aus'; $('#riders', S.el).hidden = !S.npcOn && !S.fg?.length; }
function togglePause() {
  if (S.state === 'riding' || S.state === 'auto') { S.state = 'paused'; flash('Pause'); }
  else if (S.state === 'paused') { S.state = 'riding'; flash('Weiter'); }
  else if (S.state === 'ready') { begin(); }
  $('#tPause', S.el).innerHTML = (S.state === 'paused' ? ICON.play + '<span>Weiter</span>' : ICON.pause + '<span>Pause</span>');
  endHint(S.state === 'paused');
}
// Beim Stehenbleiben den Beenden-Knopf hervorheben und fokussieren (Enter oder Leertaste beendet dann)
function endHint(on) {
  const b = S && $('#tEnd', S.el); if (!b) return;
  b.classList.toggle('pulse', on);
  if (on) { try { b.focus({ preventScroll: true }); } catch (e) { } } else if (document.activeElement === b) b.blur();
}
/* ---------- Zuschauer-Link: Stand senden, Anfeuerungen zeigen ---------- */
async function watchPush(p3) {
  const M = window.__watchMod ||= await import('../watch.js');
  // Fernseher-Bild: solange der Link aktiv ist, auf Fernseher warten und ihnen das Bild der Fahrt senden
  if (M.W.token !== S.tvTok) { S.tvTok = M.W.token; const T = await import('../tvstream.js'); if (M.W.token) T.startSender(M.W.token, () => { const v = $('#rideVid', S.el); if (S.videoOn && v?.captureStream) return v.captureStream(); return $('#gl', S.el)?.captureStream?.(24); }); else T.stopSender(); }
  if (!M.W.token) return;
  const R = S.route; if (!R.prof) { R.prof = []; for (let i = 0; i <= 80; i++) R.prof.push(Math.round(R.eleAt(R.total * i / 80))); }
  const cheers = await M.pushWatch({ state: S.finished ? 'ended' : S.state, route: R.name, total: Math.round(R.total), loop: !!R.loop, d: Math.round(S.dist), odo: Math.round(S.odo), t: Math.round(S.t), p: Math.round(p3), v: +(S.v * 3.6).toFixed(1), asc: Math.round(S.asc), grade: +R.gradeAt(S.dist).toFixed(1), hr: live.heart ?? null, cad: live.cadence != null ? Math.round(live.cadence) : null, prof: R.prof, wo: S.wo ? S.wo.name : null,
    iv: S.wo && S.wi && !S.wi.done ? { i: S.wi.i + 1, n: S.wo.segs.length, left: Math.round(S.wi.left), tg: S.target ? Math.round(S.target) : null, txt: S.wo.segs[S.wi.i]?.text || '' } : null, ftp: profile.ftp });
  for (const [i, c] of cheers.entries()) setTimeout(() => { if (!S?.alive) return; flash(`${c.e} ${c.n ? c.n + ' feuert dich an!' : 'Anfeuerung!'}`, 2200); const f = document.createElement('div'); f.className = 'cheerfly'; f.textContent = c.e; f.style.left = (20 + Math.random() * 60) + '%'; S.el.querySelector('.ridewrap')?.appendChild(f); setTimeout(() => f.remove(), 2600); }, i * 900);
}
/* ---------- Videofahrt: eigenes Video statt 3D-Welt ---------- */
async function videoSetup(S, el) {
  const V = await import('../video.js'), R = S.route, vid = $('#rideVid', el), box = document.createElement('div');
  box.className = 'vidload card'; document.body.appendChild(box); S.vbox = box; // außerhalb der HUD-Anordnung
  const show = async file => {
    if (!file) return;
    if (R.video.size && file.size !== R.video.size && !(await dialog({ title: 'Anderes Video?', html: `<p class="muted">Die gewählte Datei (${esc(file.name)}) ist nicht die gespeicherte (${esc(R.video.name)}). Trotzdem verwenden?</p>`, buttons: [{ label: 'Nein', value: false }, { label: 'Verwenden', value: true, cls: 'pri' }] }))) return;
    if (S.vurl) URL.revokeObjectURL(S.vurl);
    S.vurl = URL.createObjectURL(file); vid.src = S.vurl;
    vid.onloadedmetadata = () => {
      S.vsync = new V.VideoSync(vid, R.vraw, R.total, R.video); vid.hidden = false; S.videoOn = true; S.el.querySelector('.ridewrap')?.classList.add('vmode'); box.remove();
      vid.currentTime = Math.max(0, R.video.offset || 0); flash('🎬 Video bereit · Taste V: Video/3D', 2200);
    };
    vid.onerror = () => toast('Video lässt sich nicht abspielen', 5000);
  };
  const remembered = await V.hasRemembered(R.id);
  box.innerHTML = `<b>🎬 Videofahrt</b><span class="small muted">${esc(R.video.name)} · ${Math.round(R.video.dur / 60)} min</span><div class="row"><button class="btn sm pri" id="vLoad">${remembered ? 'Video laden' : 'Video auswählen'}</button><button class="btn sm ghost" id="v3d">Ohne Video (3D)</button></div>`;
  box.querySelector('#vLoad').onclick = async () => { const f = (remembered && await V.openRemembered(R.id)) || (await V.pickVideo())?.file; await show(f); };
  box.querySelector('#v3d').onclick = () => box.remove();
  S.videoToggle = () => { if (!S.vsync) return; S.videoOn = !S.videoOn; vid.hidden = !S.videoOn; if (!S.videoOn) vid.pause(); S.el.querySelector('.ridewrap')?.classList.toggle('vmode', S.videoOn); flash(S.videoOn ? '🎬 Video' : '🌍 3D-Welt', 1000); };
}
/* ---------- Tagesform vor dem Workout: passt Intensität und Dauer an ---------- */
const FORMS = [['top', '💪', 'Top fit', 3], ['ok', '🙂', 'Normal', 0], ['tired', '😴', 'Müde', -7], ['legs', '🦵', 'Beine schwer', -10], ['short', '⏱️', 'Wenig Zeit', 0]];
const FORM_TXT = { top: 'Ausgeruht und motiviert', ok: 'Ganz normal', tired: 'Wenig Schlaf, etwas schlapp', legs: 'Muskelkater oder schwere Beine', short: 'Heute nur kurz Zeit' };
// Kleines Profil des Workouts (Balken je Abschnitt, Farbe nach Zone)
function woProfile(wo, off = 0) {
  const segs = wo.segs || [], tot = segs.reduce((a, g) => a + g.dur, 0) || 1, W = 300, H = 46; let x = 0;
  return `<svg class="fdprof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${segs.map(g => {
    const w = g.dur / tot * W, a = g.a == null ? .55 : g.a * (1 + off / 100), b = g.b == null ? a : g.b * (1 + off / 100), y1 = H - Math.min(1.6, a) / 1.6 * H, y2 = H - Math.min(1.6, b) / 1.6 * H;
    const out = `<polygon points="${x},${H} ${x},${y1} ${x + w},${y2} ${x + w},${H}" fill="${g.a == null ? '#56606a' : zoneColor((a + b) / 2)}"/>`; x += w; return out; }).join('')}</svg>`;
}
async function dayForm(S) {
  const tot = woTotal(S.wo), mins = [20, 30, 45, 60].filter(m => m * 60 < tot - 120);
  const wrap = document.createElement('div'); wrap.className = 'modal on';
  wrap.innerHTML = `<div class="card dlg formdlg" role="dialog" aria-modal="true" aria-labelledby="formT">
    <div class="fdhead"><h2 id="formT">Wie fühlst du dich heute?</h2><p class="small muted">Das Workout passt sich deiner Tagesform an.</p></div>
    <div class="fdwo"><div class="row between"><b>${esc(S.wo.name)}</b><span class="small muted num">${Math.round(tot / 60)} min</span></div><div id="fdProf">${woProfile(S.wo)}</div><div class="small fdeff" id="fdEff">wie geplant</div></div>
    <div class="formgrid" role="radiogroup">${FORMS.filter(f => f[0] !== 'short' || mins.length).map(([k, i, l, d]) => `<button class="formbtn ${k === 'ok' ? 'on' : ''}" role="radio" aria-checked="${k === 'ok'}" data-form="${k}"><span class="fdi" aria-hidden="true">${i}</span><span class="fdl"><b>${l}</b><small>${FORM_TXT[k]}</small></span><em class="fdchip ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${k === 'short' ? 'kürzer' : k === 'legs' ? d + ' %, ohne Spitzen' : d ? (d > 0 ? '+' : '') + d + ' %' : 'wie geplant'}</em></button>`).join('')}</div>
    <div class="formmins" id="formMins" hidden><span class="small muted">Wie viel Zeit hast du?</span><div class="row">${mins.map(m => `<button class="btn sm" data-min="${m}">${m} min</button>`).join('')}</div></div>
    <div class="fdfoot"><label class="chk small"><input type="checkbox" id="fdNever"> Nicht mehr fragen <span class="muted">(Einstellungen › Fahrt &amp; Ton)</span></label>
      <div class="row end"><button class="btn ghost" data-form="skip">Überspringen</button><button class="btn pri" data-go>Los geht’s</button></div></div></div>`;
  document.body.appendChild(wrap);
  let cur = 'ok', curMin = null;
  const sel_ = k => {
    cur = k; wrap.querySelectorAll('.formbtn').forEach(x => { const on = x.dataset.form === k; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    wrap.querySelector('#formMins').hidden = k !== 'short';
    const f = FORMS.find(x => x[0] === k), eff = wrap.querySelector('#fdEff');
    let wo = S.wo; if (k === 'legs') wo = { ...wo, segs: wo.segs.map(g => g.a == null ? g : { ...g, a: Math.min(g.a, 1.05), b: Math.min(g.b, 1.05) }) };
    if (k === 'short' && curMin) wo = shortenWorkout(S.wo, curMin * 60);
    wrap.querySelector('#fdProf').innerHTML = woProfile(wo, f[3]);
    eff.textContent = k === 'short' ? (curMin ? `auf ${curMin} min gekürzt` : 'Zeit wählen') : f[3] ? `Intensität ${f[3] > 0 ? '+' : ''}${f[3]} %${k === 'legs' ? ', keine Spitzen über 105 % FTP' : ''}` : 'wie geplant';
    wrap.querySelector('[data-go]').disabled = k === 'short' && !curMin;
  };
  wrap.querySelector('[data-go]').focus();
  return new Promise(res => {
    const done = k => { if (wrap.querySelector('#fdNever').checked) { profile.askForm = false; saveProfile(); toast('Tagesform-Abfrage aus – wieder einschalten unter Einstellungen › Fahrt & Ton', 4000); } wrap.remove(); removeEventListener('keydown', key); if (k && k !== 'skip' && k !== 'ok') applyForm(S, k, curMin); res(); };
    const key = e => { if (e.key === 'Escape') done(null); else if (e.key === 'Enter' && !e.target.closest('button,input')) { e.preventDefault(); done(cur); } }; addEventListener('keydown', key);
    wrap.onclick = e => {
      const m = e.target.closest('[data-min]'); if (m) { curMin = +m.dataset.min; wrap.querySelectorAll('[data-min]').forEach(x => x.classList.toggle('pri', x === m)); sel_('short'); return; }
      if (e.target.closest('[data-go]')) return done(cur);
      const b = e.target.closest('[data-form]'); if (!b) return;
      if (b.dataset.form === 'skip') return done('skip');
      sel_(b.dataset.form); if (e.detail === 2 && b.dataset.form !== 'short') done(cur);
    };
  });
}
function applyForm(S, k, min) {
  const f = FORMS.find(x => x[0] === k); if (!f) return;
  S.wOff = clamp(S.wOff + f[3], -40, 40);
  if (k === 'legs') S.wo = { ...S.wo, segs: S.wo.segs.map(g => g.a == null ? g : { ...g, a: Math.min(g.a, 1.05), b: Math.min(g.b, 1.05) }) }; // keine Spitzen über 105 % FTP
  if (k === 'short' && min) S.wo = shortenWorkout(S.wo, min * 60);
  S.formMsg = `${f[1]} ${f[2]}${f[3] ? ': Intensität ' + (f[3] > 0 ? '+' : '') + f[3] + ' %' : ''}${k === 'short' && min ? ': auf ' + min + ' min gekürzt' : ''}${k === 'legs' ? ', keine Spitzen über 105 %' : ''}`;
}
// Ein-/Ausfahren bleiben, der Hauptteil wird gleichmäßig gestaucht (Intervalle bleiben erkennbar, mind. 15 s)
export function shortenWorkout(w, target) {
  const segs = w.segs.map(g => ({ ...g })), tot = segs.reduce((a, g) => a + g.dur, 0); if (tot <= target) return w;
  const edge = segs.length > 2 ? [0, segs.length - 1] : [], keep = edge.reduce((a, i) => a + Math.min(segs[i].dur, 600), 0);
  edge.forEach(i => segs[i].dur = Math.min(segs[i].dur, 600));
  const mid = segs.filter((_, i) => !edge.includes(i)), midTot = mid.reduce((a, g) => a + g.dur, 0), k = Math.max(.1, (target - keep) / midTot);
  for (const g of mid) g.dur = Math.max(15, Math.round(g.dur * k));
  return { ...w, segs, name: w.name + ' (kurz)' };
}
function begin() { S.state = 'riding'; S.startWall = Date.now(); $('#startCard', S.el).hidden = true; flash(S.race ? '🏁 Rennen läuft!' : S.formMsg ? S.formMsg : S.planAdaptMsg ? `Plan angepasst: Intensität ${100 + S.wOff} %` : 'Los geht’s!', 1800); }

let bannerT = 0;
function flash(txt, ms = 1600) { const b = $('#banner', S?.el); if (!b) return; b.textContent = txt; b.classList.add('show'); requestAnimationFrame(layout); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), ms); }
function xpPop(txt) { if (profile.xpPops === false) return; const f = $('#xpFloat', S.el); if (!f) return; const s = document.createElement('span'); s.textContent = txt; f.appendChild(s); setTimeout(() => s.remove(), 1600); }
function note(txt) { S.adapt.note = txt; S.adapt.noteT = performance.now(); if (/gesenkt|hoch|nicht/.test(txt)) sound.warn(); }

/* ---------- Simulation (10 Hz, auch im Hintergrund) ---------- */
// Live-Fahrt für die Companion-Ansicht (läuft im Simulationstakt, also auch bei verdecktem Fenster)
function liveShare() {
  if (S?.offline) return;
  // jede Sekunde an die eigenen anderen Geräte (Echtzeitkanal), alle 5 s auch in den Speicher (Rückfall)
  const nowP = performance.now(); if (nowP - (S.liveT || 0) < 1000) return;
  S.liveT = nowP; const store = nowP - (S.liveStoreT || 0) >= 5000; if (store) S.liveStoreT = nowP;
  const me = { dev: syncState.device?.id, devName: syncState.device?.name, tab: TAB };
  // Verlauf für die Live-Ansicht: alle 15 s ein Punkt, höchstens eine Stunde
  const H = S.liveHist ||= []; if (S.state === 'riding' && (!H.length || S.t - H.at(-1)[0] >= 15)) { const p3n = S.p3.length ? S.p3.reduce((a, b) => a + b, 0) / S.p3.length : 0; H.push([Math.round(S.t), Math.round(p3n), live.heart ?? null, live.cadence != null ? Math.round(live.cadence) : null, +(S.v * 3.6).toFixed(1)]); if (H.length > 240) H.shift(); }
  // Ohne Teilen nur die Belegung melden (Sperre für andere Geräte), keine Werte
  if (profile.liveShare === false) { if (store) putLive({ state: S.state, route: S.route.name, t: Math.round(S.t), ...me }); return; }
  const R = S.route, wi = S.wi, p3 = S.p3.length ? S.p3.reduce((a, b) => a + b, 0) / S.p3.length : 0, np = S.np.n ? Math.pow(S.np.s4 / S.np.n, .25) : p3;
  putLive({ state: S.state, route: R.name, routeId: R.id, total: R.total, loop: R.loop, pos: S.dist, odo: Math.round(S.odo), t: Math.round(S.t), p: Math.round(p3), hr: live.heart, cad: live.cadence != null ? Math.round(live.cadence) : null, v: +(S.v * 3.6).toFixed(1), asc: Math.round(S.asc), kj: Math.round(S.kj), np: Math.round(np), grade: +R.gradeAt(S.dist).toFixed(1),
    wo: S.wo ? { name: S.wo.name, i: wi && !wi.done ? wi.i + 1 : null, n: S.wo.segs.length, left: wi && !wi.done ? Math.round(wi.left) : 0, target: S.target ? Math.round(S.target) : null, done: Math.round(S.wT), total: woTotal(S.wo) } : null,
    ghost: S.ghost ? Math.round(S.ghostGap) : null, place: S.npcOn ? S.field.filter(n => gapOf(R, n.d, S.dist) > 0).length + 1 : null, hist: S.liveHist, demo: demo.on ? { cad: Math.round(live.cadence ?? demo.cad ?? 0), w: Math.round(live.power ?? 0) } : null, ...me }, { store });
  watchPush(p3);
  // Alle 20 s prüfen, ob trotzdem woanders eine Fahrt läuft (beide fast gleichzeitig gestartet)
  if (!S.dupCheckAt || performance.now() > S.dupCheckAt) { S.dupCheckAt = performance.now() + 20000; setTimeout(async () => { const L = await getLive().catch(() => null); if (S?.alive && L && L.tab && L.tab !== TAB && L.state !== 'ended' && Date.now() - L.ts < 4000 && !S.dupWarned) { S.dupWarned = true; flash(`⚠️ Auf „${L.devName || 'einem anderen Gerät'}“ läuft ebenfalls eine Fahrt mit deinem Konto. Bitte eine davon beenden.`, 6000); } }, 2500); }
}
function tick() {
  if (!S?.alive) return;
  if (S.state === 'riding') envCycle();
  followEnv();
  liveStatus();
  if (S.mp) { mpTick(S, MPH, .1); if ((S.mpN = (S.mpN || 0) + 1) % 5 === 0) { const b = $('#mpCh', S.el), h = performance.now() < (S.mpHideUntil || 0) ? '' : mpHtml(S); b.hidden = !h; if (h && b.innerHTML !== h) b.innerHTML = h; } }
  if (S.joinRider && S.joinGiveUp && performance.now() > S.joinGiveUp) { S.joinGiveUp = 0; flash(S.live?.status === 'on' ? '🌐 ' + S.joinRider.name + ' ist gerade nicht live auf der Strecke (Fahrt beendet?). Sobald die Fahrt weitergeht, springst du hinterher.' : '🌐 Noch keine Live-Verbindung, es wird weiter versucht …', 4000); }
  if (S.group?.isHost && performance.now() > (S.envBeat ??= performance.now() + 30e3)) { S.envBeat = performance.now() + 30e3; S.live?.sendEnv(S.group.id, S.env); }
  // Alle ~45 s: Mitfahrer außer Sicht (und neu eingesetzte) bekommen neue Namen
  if (S.npcOn && S.field.length && performance.now() > (S.nameAt ??= performance.now() + 45e3)) { S.nameAt = performance.now() + 45e3; for (const i of rotateNames(S.route, S.field, S.dist)) S.world.relabel(i, S.field[i].name, S.field[i].look.jersey); }
  liveShare();
  // Im Hintergrund drosselt der Browser Timer stark, deshalb die verstrichene Zeit in kleinen Schritten nachrechnen
  const now = performance.now(); let rest = Math.min(300, (now - (S.lastTick || now)) / 1000) * SPEED; S.lastTick = now;
  let first = true;
  while (rest > 1e-6) { const h = Math.min(.2, rest); rest -= h; step(h, first); first = false; }
}

// Adaptive Steuerung: Ziel an Kadenz, Puls und Trainer anpassen
function adaptTarget(target, wi, dt, cad, running) {
  const A = S.adapt, ftp = profile.ftp;
  if (!A.on || target == null || !running) return target;
  // Kadenz bricht ein (Todesspirale im ERG): Widerstand senken, bis wieder rund getreten wird
  if (target > ftp * .7 && cad != null) {
    if (cad < 50) { A.lowCad += dt; A.okCad = 0; } else { A.lowCad = Math.max(0, A.lowCad - dt); if (cad > 70) A.okCad += dt; }
    if (!A.cap && A.lowCad > 3) { A.cap = true; note('Kadenz zu niedrig, Widerstand gesenkt'); flash('Kadenz hoch! Widerstand kurz gesenkt', 2200); }
    if (A.cap && A.okCad > 2) { A.cap = false; A.lowCad = 0; note('Kadenz wieder gut, Ziel zurück'); }
  } else { A.cap = false; A.lowCad = 0; }
  if (A.cap) target = Math.min(target, ftp * .55);
  // Puls dauerhaft am Anschlag: Intensität in kleinen Schritten senken
  const hr = live.heart;
  if (hr && wi.g.dur > 120 && hr > profile.hrMax * .95) A.hrHigh += dt; else A.hrHigh = Math.max(0, A.hrHigh - dt * 2);
  if (A.hrHigh > 25 && S.t - A.lastAdj > 60 && S.wOff > -15) { S.wOff -= 3; A.lastAdj = S.t; A.hrHigh = 0; note('Puls sehr hoch, Intensität −3 %'); flash('Puls sehr hoch: Intensität −3 %', 2200); }
  // Trainer schafft das Ziel nicht (z. B. Maximalleistung erreicht)
  if (live.fresh && cad > 60 && live.power < target * .8 && !A.cap) A.weak += dt; else A.weak = Math.max(0, A.weak - dt);
  if (A.weak > 20) { A.weak = 0; note('Trainer erreicht das Ziel nicht, Max-Leistung im Profil prüfen'); }
  return Math.min(target, profile.maxW);
}

function step(dt, first) {
  const now = performance.now();
  if (S.startWall) S.wall = (S.wall || 0) + dt;
  const R = S.route, grade = R.gradeAt(S.dist), cad = live.cadence;
  const pw = live.fresh ? live.power : 0;
  if (S.parked) return; // im Menü: Fahrt steht
  // Nach der Rückkehr aus dem Menü: Treten setzt die Fahrt fort
  if (S.resumeOnPedal && S.state === 'paused' && !(S.hiddenPause && document.hidden) && (pw > 10 || (cad || 0) > 20)) { S.resumeOnPedal = false; S.state = 'riding'; flash('Weiter'); $('#tPause', S.el).innerHTML = ICON.pause + '<span>Pause</span>'; }
  // Start und automatische Pause
  if (S.state === 'ready' && (pw > 10 || (cad || 0) > 20)) begin();
  if (S.state === 'riding' && profile.autoPause && pw < 5 && (cad || 0) < 5 && S.v < .3) { S.idle += dt; if (S.idle > 3) { S.state = 'auto'; flash('Automatische Pause'); endHint(true); } } else S.idle = 0;
  if (S.state === 'auto' && (pw > 10 || (cad || 0) > 20)) { S.state = 'riding'; flash('Weiter'); endHint(false); }
  const running = S.state === 'riding';
  if (running && demo.on && !S.demoUsed) { S.demoUsed = true; flash(profile.saveDemo ? 'Demo-Geräte: die Fahrt wird trotzdem gespeichert (App-Einstellungen)' : 'Demo-Modus: diese Fahrt wird nicht gespeichert', 3500); }
  // Ziel bestimmen
  let target = null, wi = null;
  if (S.wo && S.state !== 'ready') {
    wi = woAt(S.wo, S.wT);
    if (wi && !wi.done && wi.target != null) {
      target = wi.target * profile.ftp * (1 + S.wOff / 100); target = adaptTarget(target, wi, dt, cad, running);
      // Sanfter ERG-Einstieg: große Sprünge nach oben über 5 s hochfahren, damit die Beine nicht "stehen bleiben"
      if (S.softSeg !== wi.i) { S.softSeg = wi.i; S.softFrom = S.lastTarget ?? null; }
      const into = S.wT - wi.start;
      if (profile.ergSoft !== false && S.softFrom != null && target - S.softFrom > profile.ftp * .15 && into < 5) target = S.softFrom + (target - S.softFrom) * smooth(0, 5, into);
    }
  }
  let gearMode = false;
  if (target == null && S.mode === 'erg') target = S.ergW;
  // Puls-Modus: Watt langsam so nachregeln, dass der Zielpuls gehalten wird
  if (target == null && S.mode === 'hr') {
    S.hrW ??= profile.ftp * .6; S.hrAcc = (S.hrAcc || 0) + dt;
    const hr = live.heart;
    if (hr && S.hrAcc >= 5 && running) { S.hrAcc = 0; S.hrW = clamp(S.hrW + clamp(((sel.hrTarget || 140) - hr) * .7, -12, 12), 40, Math.min(profile.maxW, profile.ftp * 1.1)); }
    target = S.hrW;
  }
  if (target == null && S.mode === 'gear') { gearMode = true; const gp = gearPower(cad, S.gear, gearGrade(grade) * profile.gearDiff / 100) * (1 - S.draft * .8); S.curP += (gp - S.curP) * Math.min(1, dt * 2.5); target = S.curP; 
    // Hinweise, wenn der Widerstand nicht ankommt: Grenze aus dem Profil oder der Trainer schafft es nicht
    if (gp > profile.maxW && !S.maxWHint) { S.maxWHint = true; flash(`Virtuelle Gänge: begrenzt auf deine Max. Trainerleistung von ${profile.maxW} W (Profil › Gerät)`, 4500); }
    if (first && live.fresh && (cad || 0) > 60 && target > 150 && live.power < target * .8) S.gearWeak = (S.gearWeak || 0) + dt; else S.gearWeak = Math.max(0, (S.gearWeak || 0) - dt);
    if (S.gearWeak > 15 && !S.gearWeakHint) { S.gearWeakHint = true; flash(`Der Trainer erreicht ${Math.round(target)} W gerade nicht (nur ${Math.round(live.power)} W). Etwas höhere Trittfrequenz hilft vielen Trainern.`, 5000); }
  }
  S.target = target; S.wi = wi; if (target != null) S.lastTarget = target;
  // an Trainer senden (oder Demo)
  if (first && now - S.lastSend > 500 && S.state !== 'paused') {
    S.lastSend = now;
    if (target != null) { if (!gearMode || Math.abs((control.target ?? -99) - target) >= 3) setPower(target); }
    else setGrade(grade * profile.simDiff / 100 * (1 - S.draft * .5));
  }
  S.crank += (cad || 0) / 60 * Math.PI * 2 * dt;
  S.p3.push(pw); if (S.p3.length > 30) S.p3.shift();
  if (S.pacer?.buddy && running) S.buddyGap = buddyStep(S, S.pacer, pw, profile.ftp, dt, t => flash(t, 2600));
  if (S.pacer && running) { const p = S.pacer, g = R.gradeAt(p.d); p.v += (steadySpeed(p.w, g) - p.v) * Math.min(1, dt * .8); p.d += p.v * dt; p.crank += 88 / 60 * Math.PI * 2 * dt; if (R.loop) p.d %= R.total; else p.d = Math.min(p.d, R.total); }
  // Mitfahrer
  if (S.live?.peers.size) for (const n of S.field) if (n.remote) { const p = S.live.peers.get(n.id); if (p && p.t !== n.pt) {
    // Großer Sprung = der andere hat sich gebeamt: Hinweis, wenn er jetzt in der Nähe ist
    if (n.pt && Math.abs(gapOf(S.route, p.d, n.d)) > 60) { const g = gapOf(S.route, p.d, S.dist); if (Math.abs(g) < 80) flash(`🌐 ${n.name} ist ${g < 0 ? 'direkt hinter dir' : 'direkt vor dir'} aufgetaucht`, 2500); }
    n.trend = (n.trend || 0) * .6 + (p.v - (n.vLast ?? p.v)) * .4; n.vLast = p.v; n.pause = p.pause;
    n.pt = p.t; n.d = p.d; n.v = p.v; n.wkg = p.wkg; n.cadence = p.cad ?? 0; } }
  if (S.npcOn && S.field.length) {
    const r = stepField(R, S.field, { d: S.dist, lat: S.lat ?? 1.5, v: S.v, kg: profile.kg, race: S.race }, dt, running);
    S.draft = r.draft; S.wheel = r.wheel;
    if (r.overtook) { S.overtakes += r.overtook; if (first) { xpPop('+' + r.overtook + ' XP Überholt'); sound.pass(); } }
    if (running && first && S.t > S.nextRideOn) { S.nextRideOn = S.t + 90 + Math.random() * 240; const near = S.field.filter(n => Math.abs(gapOf(R, n.d, S.dist)) < 80); if (near.length) gotRideOn(near[Math.floor(Math.random() * near.length)].name); }
  } else S.draft = 0;
  if (S.pacer?.buddy) S.draft = Math.max(S.draft, buddyDraft(S.buddyGap ?? 99)); // Windschatten hinter dem Buddy
  if (!running) { S.v *= Math.pow(.25, dt); return; }
  // Bewegung
  const md = mods(S, grade, S.draft);
  S.v = integrate(S.v, pw * md.power, grade, dt, md.draft);
  if (S.brake) S.v = Math.max(0, S.v - 3.5 * dt); // Demo-Bremse
  const prev = S.dist;
  S.dist += S.v * dt; S.odo += S.v * dt; S.t += dt; S.kj += pw * dt / 1000;
  if (S.fg && running) for (const f of S.fg) {
    const T = f.tr, n = T.length; if (!n) continue;
    const i = Math.min(n - 1, Math.floor(S.t)), j = Math.min(n - 1, i + 1), gd = T[i] + (T[j] - T[i]) * (S.t - Math.floor(S.t));
    f.v = i < n - 1 ? T[j] - T[i] : 0; f.crank += f.v > .5 ? 88 / 60 * Math.PI * 2 * dt : 0;
    f.gap = gd - S.odo; f.d = R.loop ? gd % R.total : Math.min(gd, R.total);
    if (S.t > 20) { const ahead = f.gap < -3, behind = f.gap > 3;
      if (ahead && f.lead !== 'me') { if (f.lead) { flash(`👻 Du hast ${f.name} überholt!`, 1800); say(`Du hast ${f.name} überholt`, 'mp'); } f.lead = 'me'; }
      else if (behind && f.lead !== 'them') { if (f.lead) flash(`👻 ${f.name} zieht vorbei`, 1800); f.lead = 'them'; } }
    if (!f.fin && i >= n - 1 && S.t > 5) { f.fin = true; flash(`👻 ${f.name} ist fertig: ${fmtKm(f.g.dist)} km in ${fmtT(f.g.dur)}`, 2600); }
  }
  if (S.ghost) {
    const G = S.ghost.d, i = Math.min(G.length - 1, Math.floor(S.t)), j = Math.min(G.length - 1, i + 1), gd = G[i] + (G[j] - G[i]) * (S.t - Math.floor(S.t));
    S.ghostGap = gd - S.odo; S.ghostPos = R.loop ? gd % R.total : Math.min(gd, R.total);
    if (!S.ghostLead && S.ghostGap < -5 && S.t > 30) { S.ghostLead = true; flash('👻 Du liegst vor deiner Bestfahrt!', 2000); }
    else if (S.ghostLead && S.ghostGap > 5) S.ghostLead = false;
  }
  if (first && !S.demoUsed && (S.eggT = (S.eggT || 0) + 1) % 10 === 0) rideEggs(S, flash);
  if (S.pace && (S.paceT = (S.paceT || 0) + 1) % 20 === 0) paceTick();
  if (S.windOn) { const gust = 1 + .25 * Math.sin(S.t / 7) + .1 * Math.sin(S.t / 2.3), w = S.windSpd * gust * Math.cos(S.route.headAt(S.dist) - S.windDir); physEnv.wind = w; S.windHead = w; }
  if (S.tour && !S.tourSent && !S.beamed && (S.finished || S.lap >= 1) && (S.tourSent = true)) import('../stagetour.js').then(async T => { const t = S.t; if (await T.submitStage(S)) flash(`🏆 Etappe ${S.tour.n} geschafft: ${fmtT(t)} – Wertung unter Online › Events`, 4500); });
  if (profile.drinkTips !== false && S.t > S.nextDrink) { S.nextDrink += (profile.drinkEvery || 15) * 60; flash('💧 Kurz trinken', 2000); }
  // Ernährung: ab 45 min alle 25 min an Kohlenhydrate erinnern (bei harten Fahrten mehr)
  if (profile.fuelTips !== false && S.t > (S.nextFuel ??= 45 * 60)) { S.nextFuel += 25 * 60; const IF = S.np.n ? Math.pow(S.np.s4 / S.np.n, .25) / profile.ftp : .6; flash(`🍌 Zeit für Kohlenhydrate: ${IF > .75 ? '20–30 g (Gel, Riegel)' : '15–20 g (Banane, Riegel, Saftschorle)'}`, 3000); }
  if (S.wo) S.wT += dt;
  if (S.dist >= R.total) {
    if (R.loop) { S.dist -= R.total; S.lap++; flash('Runde ' + (S.lap + 1) + ' · letzte Runde ' + fmtT(S.t - S.lapT0), 2500); say(`Runde ${S.lap + 1}. Letzte Runde in ${fmtT(S.t - S.lapT0)}`, 'lap'); S.lapT0 = S.t; lapReset(S); S.climbs.forEach(c => c.state = 'pending'); S.sprints.forEach(c => c.state = 'pending'); }
    else if (S.wo && !S.woDone && !S.race && !S.tt) { // Workout läuft noch: Strecke von vorn, Zielzeit zählt trotzdem
      if (S.routeDoneT == null) { S.routeDoneT = S.t; sound.fanfare(); }
      S.dist -= R.total; S.lap++; S.lastE = null; S.lapT0 = S.t; lapReset(S); S.climbs.forEach(c => c.state = 'pending'); S.sprints.forEach(c => c.state = 'pending'); flash(`🏁 Ziel in ${fmtT(S.routeDoneT)} – dein Workout läuft weiter, Strecke von vorn`, 3500);
    }
    else { S.dist = R.total; if (!S.finished) { S.finished = true; S.state = 'paused'; flash('Ziel erreicht!', 3000); say(`Ziel erreicht! ${fmtKm(S.odo)} km in ${fmtT(S.t)}`, 'lap', { urgent: true }); sound.fanfare(); shot('Ziel'); setTimeout(() => endRide(true), 2500); } }
  }
  const e = R.eleAt(S.dist); if (S.lastE != null && e > S.lastE) S.asc += e - S.lastE; S.lastE = e;
  segTick(S.climbs, S.climbLog, prev, 'climb');
  segTick(S.sprints, S.sprintLog, prev, 'sprint');
  plusStep(S, dt, prev, first, flash); raceTick(S, dt, flash); bellsTick(S, prev, flash); dailyTick(S, flash); ttTick(S, flash);
  // Workout-Ereignisse und Zieltor
  if (wi && !wi.done && wi.i !== S.lastSeg) {
    if (S.lastSeg >= 0 && S.gateFor === S.lastSeg) { S.gates++; cine(2.6, 5); xpPop('+5 XP Intervall'); S.gateHide = S.t + 3; sound.gate(); }
    else if (S.lastSeg >= 0) sound.beep(true);
    S.lastSeg = wi.i; S.lastBeep = -1; const g = wi.g;
    const wmsg = g.text ? g.text : g.a == null ? 'Frei fahren' : `${Math.round((g.a + g.b) / 2 * profile.ftp * (1 + S.wOff / 100))} W für ${fmtT(g.dur)}`;
    flash(wmsg, 2200); say((wi.next ? '' : 'Letztes Intervall: ') + wmsg + (wi.next && S.wT > 5 && !g.text ? `. Danach ${wi.next.a == null ? 'frei fahren' : Math.round((wi.next.a + wi.next.b) / 2 * profile.ftp * (1 + S.wOff / 100)) + ' W'}` : ''), 'workout', { urgent: true });
  }
  // Countdown 3-2-1 vor dem Intervallwechsel
  if (wi && !wi.done && wi.g.dur >= 20 && wi.next) { const s = Math.ceil(wi.left); if (s <= 3 && s >= 1 && s !== S.lastBeep) { S.lastBeep = s; if (profile.countdown !== false) sound.beep(false); } }
  if (wi?.done && !S.woDone) { S.woDone = true; if (S.gateFor != null) { S.gates++; cine(3.5, 5); S.gateHide = S.t + 4; } sound.fanfare(); flash('Workout geschafft! 🎉', 3000); shot('Workout geschafft'); }
  if (first) gateTick(wi, dt);
  // Sekundenwerte
  S.acc = (S.acc || 0) + dt;
  while (S.acc >= 1) {
    S.acc -= 1;
    const totD = S.odo;
    const vk = +profile.voiceKm || 0;
    if (vk && profile.voiceOn && Math.floor(totD / (vk * 1000)) > (S.vkLast ?? 0)) {
      S.vkLast = Math.floor(totD / (vk * 1000)); const ps = S.samples.filter(x => x.p != null), ap = ps.length ? ps.reduce((a, x) => a + x.p, 0) / ps.length : 0;
      say(`Kilometer ${S.vkLast * vk}. Zeit ${fmtT(S.t)}, Schnitt ${Math.round(ap)} W und ${(totD / Math.max(1, S.t) * 3.6).toFixed(1).replace('.', ',')} km/h${live.heart ? ', Puls ' + live.heart : ''}`, 'km');
    }
    S.samples.push({ ts: Math.round(S.wall), p: Math.round(pw), hr: live.heart, cad: cad != null ? Math.round(cad) : null, v: +S.v.toFixed(2), d: +totD.toFixed(1), e: +e.toFixed(1), la: +R.latAt(S.dist).toFixed(6), lo: +R.lonAt(S.dist).toFixed(6), g: S.mode === 'gear' ? S.gear : null, tg: target != null ? Math.round(target) : null, wt: S.wo ? Math.round(S.wT) : null, gr: +grade.toFixed(1), rd: Math.round(S.dist) }); snapTick(); window.__rideSpeed = S.state === 'riding' ? S.v : 0;
    const N = S.np; N.buf.push(pw); N.bs += pw; if (N.buf.length > 30) N.bs -= N.buf.shift(); if (N.buf.length === 30) { N.s4 += (N.bs / 30) ** 4; N.n++; }
    if (profile.autoShots) {
      const n = S.samples.length;
      if (n === 90 || (n > 90 && n - S.lastShotT >= profile.shotEvery * 60)) shot('Unterwegs');
    }
  }
}
// Zieltor: erscheint, wenn ein Intervall (ab 30 s) in weniger als 30 s endet, an der vorausberechneten Stelle
// Kameraschwenk am Zieltor (abschaltbar)
function cine(sec, view) { if (profile.gateCam !== false) S.world.cinematic(sec, view); }
function gateTick(wi, dt) {
  if (profile.gates === false) { if (S.gateFor != null || S.world.gate?.visible) { S.world.setGate(null); S.gateFor = null; } return; }
  const R = S.route;
  if (S.gateHide && S.t > S.gateHide) { S.gateHide = 0; S.world.setGate(null); S.gateFor = null; }
  if (!wi || wi.done || wi.g.dur < 30 || wi.left > 30 || S.v < 1 || S.state !== 'riding') return;
  let pred = S.dist + S.v * wi.left;
  if (S.gateFor !== wi.i) { S.gateFor = wi.i; S.gateD = pred; S.gateHide = 0; }
  else S.gateD += (pred - S.gateD) * Math.min(1, dt * 2 * .25);
  let d = S.gateD; if (R.loop) d = ((d % R.total) + R.total) % R.total; else d = Math.min(d, R.total - 2);
  const last = !wi.next, g = wi.g, z = g.a == null ? '#94a1ad' : zoneColor((g.a + g.b) / 2);
  S.world.setGate(d, last ? 'WORKOUT ZIEL' : `INTERVALL ${wi.i + 1} ENDE`, last ? '#ffffff' : z);
}
function segTick(list, log, prev, kind) {
  for (const c of list) {
    if (c.state === 'pending' && prev < c.from + 1 && S.dist >= c.from) { c.state = 'active'; c.t0 = S.t; const K = kind === 'climb' && S.kom?.[c.id]; flash((kind === 'climb' ? 'Anstieg: ' : '') + c.name + (K ? ` · 👑 ${K.me ? 'Du bist Bergkönig' : K.name} ${fmtT(K.time)}` : ''), 2600); say(kind === 'climb' ? `Anstieg ${c.name}: ${(c.len / 1000).toFixed(1).replace('.', ',')} km mit ${Math.round(c.avg * 10) / 10} %` : c.name.replace(/^Sprint/, 'Sprint') + ', los!', 'climb'); if (kind === 'sprint' && profile.sprintCam !== false) S.world.cinematic(3, 5); }
    if (c.state === 'active' && S.dist >= c.to) {
      c.state = 'done'; const time = S.t - c.t0, key = S.route.id + ':' + c.id, bestMap = kind === 'climb' ? progress.climbBest : (progress.sprintBest || {}), best = bestMap[key];
      const pr = !best || time < best.time;
      log.push({ name: c.name, id: c.id, len: c.len, gain: c.gain, avg: c.avg, time, best: best?.time ?? null, pr });
      // Platzierung im Feld: wer war schon durch?
      const ahead = S.npcOn ? S.field.filter(n => gapOf(S.route, n.d, S.dist) > 0 && gapOf(S.route, n.d, S.dist) < c.len + 200).length : 0;
      const place = S.npcOn ? ` · Platz ${ahead + 1}` : '';
      flash(`${kind === 'climb' ? 'Gipfel' : 'Sprint'} ${c.name.replace(/^Sprint /, '')}: ${fmtT(time)}${place}${pr ? ' · Bestzeit!' : best ? ' · Bestzeit ' + fmtT(best.time) : ''}`, 3500);
      xpPop(kind === 'climb' ? '+25 XP Gipfel' : '+20 XP Sprint'); sound.fanfare();
      say(`${kind === 'climb' ? 'Gipfel erreicht' : 'Sprint geschafft'} in ${fmtT(time)}${place ? ', Platz ' + (ahead + 1) : ''}${pr ? '. Neue Bestzeit!' : ''}`, 'climb');
      setTimeout(() => shot((kind === 'climb' ? 'Gipfel ' : '') + c.name), 400);
      if (kind === 'climb' && S.route.builtin && !S.beamed && !S.pupUsed && !S.demoUsed && loggedIn()) import('../stagetour.js').then(async T => { const won = await T.submitKom(S.route.id, [{ id: c.id, time }]); if (won.includes(String(c.id)) && S?.alive) { flash(`👑 Neuer Bergkönig am ${c.name}!`, 4000); S.kom = { ...S.kom, [c.id]: { name: 'Du', time, me: true } }; } });
    }
  }
}

/* ---------- Anzeige ---------- */
function hud() {
  const el = S.el, R = S.route, f = (v, d = 1) => v.toFixed(d).replace('.', ',');
  const p3 = S.p3.length ? S.p3.slice(-30).reduce((a, b) => a + b, 0) / S.p3.slice(-30).length : 0;
  $('#hPw', el).textContent = Math.round(p3); $('#hWkg', el).textContent = f(p3 / profile.kg);
  const zc = zoneColor(p3 / profile.ftp); $('#hPw', el).style.color = zc;
  const zi = $('#hZone', el); zi.style.width = clamp(p3 / profile.ftp / 1.5 * 100, 0, 100) + '%'; zi.style.background = zc;
  $('#hHr', el).textContent = live.heart ?? '--'; $('#hCad', el).textContent = live.cadence != null ? Math.round(live.cadence) : '--';
  $('#hSpd', el).textContent = f(S.v * 3.6); $('#hDist', el).textContent = f(S.odo / 1000, 1);
  sound.update({ v: S.v, cad: live.cadence, hr: live.heart, power: p3, ftp: profile.ftp, theme: R.themeKey, tunnel: !!R.tunnelAt(S.dist, 15), surface: R.surface, cows: S.world.cows && S.world.cows.some(c => Math.abs(c - S.dist) < 40), riding: S.state === 'riding', weather: S.env.weather, night: S.env.time === 'night' });
  $('#hTime', el).textContent = fmtT(S.t); $('#hTimeL', el).textContent = S.state === 'paused' ? 'Pause' : S.state === 'auto' ? 'Auto-Pause' : 'Zeit';
  $('#hAsc', el).textContent = Math.round(S.asc);
  // Zweite Zeile: Schnitt, NP, Arbeit, Kalorien, XP
  const n = S.samples.length, avg = n ? S.samples.reduce((a, s) => a + s.p, 0) / n : 0, np = S.np.n ? Math.pow(S.np.s4 / S.np.n, .25) : avg;
  const xp = Math.round(S.odo / 1000 * 20 + S.t / 60 * 2 + S.asc * .5 + S.overtakes + S.climbLog.length * 25 + S.sprintLog.length * 20 + S.gates * 5);
  const L = levelOf(progress.xp + xp);
  $('#hSub', el).hidden = profile.hudSub === false;
  $('#hSub', el).innerHTML = `${S.windOn ? `<span>${S.windHead > .8 ? '💨 Gegenwind' : S.windHead < -.8 ? '🍃 Rückenwind' : '〰️ Seitenwind'} ${Math.round(Math.abs(S.windHead) * 3.6)} km/h</span>` : ''}<span>Ø ${Math.round(avg)} W</span><span>NP ${Math.round(np)} W</span><span>${Math.round(S.kj)} kJ</span><span>${Math.round(S.kj / .24 / 4.184)} kcal</span>${S.overtakes ? `<span>${S.overtakes} überholt</span>` : ''}<span class="xp">+${xp} XP · Lv ${L.lv}<i style="width:${(L.frac * 100).toFixed(0)}%"></i></span>`;
  const g = R.gradeAt(S.dist); $('#hGrade', el).textContent = f(g); $('.gradebox', el).dataset.g = g > 8 ? 4 : g > 5 ? 3 : g > 2.5 ? 2 : g < -2 ? 0 : 1;
  $('#gIcon', el).style.transform = `rotate(${-clamp(g * 2.2, -35, 35)}deg)`;
  if (S.mode !== 'gear') updGear();


  $('#draftBox', el).hidden = !(S.draft > .03);
  if (S.draft > .03) $('#hDraft', el).textContent = '−' + Math.round(S.draft * 100) + ' % Luft';
  // Workout
  if (S.wo) woHud(el, f);
  // Anstieg oder Sprint
  const c = S.climbs.find(c => c.state === 'active') || S.sprints.find(c => c.state === 'active');
  $('#climbBox', el).hidden = !c || S.climbDismissed === c; // per Antippen ausgeblendet: bis zum nächsten Anstieg
  if (c) {
    const isSprint = !c.gain, left = c.to - S.dist, frac = clamp((S.dist - c.from) / c.len, 0, 1), best = (isSprint ? progress.sprintBest || {} : progress.climbBest)[R.id + ':' + c.id];
    $('#climbBox', el).classList.toggle('sprint', isSprint);
    $('#clName', el).textContent = c.name; $('#clLeft', el).textContent = (left >= 1000 ? f(left / 1000) + ' km' : Math.round(left) + ' m') + (isSprint ? ' bis zur Wertung' : ' bis zum Gipfel');
    $('#clGrade', el).textContent = isSprint ? f(S.v * 3.6) + ' km/h' : 'Ø ' + f(c.avg) + ' %'; $('#clTime', el).textContent = fmtT(S.t - c.t0) + (best ? ' · Bestzeit ' + fmtT(best.time) : '');
    $('#clBar', el).style.width = (frac * 100).toFixed(1) + '%';
  }
  plusHud(S, p3, c);
  if (S.pacer) { const gap = S.pacer.buddy ? gapOf(S.route, S.pacer.d, S.dist) : (S.pacer.d - S.dist); $('#hPacer', el).textContent = (gap >= 0 ? '+' : '−') + Math.abs(Math.round(gap)) + ' m' + (S.pacer.buddy ? ' · ' + Math.round(S.pacer.w) + ' W' : ''); }
  if ((S.npcOn || S.fg) && (S.rlN = (S.rlN || 0) + 1) % 3 === 0) riderList(el);
  if ((S.lyN = (S.lyN || 0) + 1) % 5 === 0) arrange($('#rw', el));
  // Zusatz-Widgets
  if ($('.xlayer', el).childElementCount) {
    const wi = S.wi, tgt = S.target, ftp = profile.ftp, hrv = live.heart;
    const pz = Math.max(0, ZONES.findIndex(z => p3 / ftp < z.max)), hz = hrv ? HRZONES.findIndex(z => hrv / (profile.hrMax * .93) < z.max) : -1;
    const tss = S.np.n ? Math.round(S.t * (np / ftp) ** 2 / 36) : 0, tot = S.wo ? woTotal(S.wo) : 0;
    const gg = S.ghost ? S.ghostGap : null;
    const vals = {
      p3: [Math.round(p3) + ' W', zoneColor(p3 / ftp)], wkg: [f(p3 / profile.kg)], hr: [hrv ?? '–'], cad: [live.cadence != null ? Math.round(live.cadence) : '–'],
      spd: [f(S.v * 3.6) + ' km/h'], dist: [f(S.odo / 1000, 2) + ' km'], time: [fmtT(S.t)], asc: [Math.round(S.asc) + ' m'], avg: [Math.round(avg) + ' W'], np: [Math.round(np) + ' W'],
      kj: [Math.round(S.kj)], kcal: [Math.round(S.kj / .24 / 4.184)], grade: [f(g) + ' %'], target: [tgt != null && S.wo ? Math.round(tgt) + ' W' : '–', tgt ? zoneColor(tgt / ftp) : ''],
      left: [wi && !wi.done ? fmtT(wi.left) : '–'], woLeft: [S.wo ? fmtT(Math.max(0, tot - S.wT)) : '–'], xp: ['+' + xp], clock: [new Date().toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' })],
      ...(() => { const X = live.extra || {}, fresh = o => o && performance.now() - o.t < 5000, cu = Object.values(X).find(o => o.label && Object.keys(X).find(k => k.startsWith('x:') && X[k] === o));
        return { xspeed: [fresh(X.speed) ? f(X.speed.v) + ' km/h' : '–'], xtemp: [fresh(X.temp) ? f(X.temp.v) + ' °C' : '–'], xhrv: [X.hrv && performance.now() - X.hrv.t < 15000 ? Math.round(X.hrv.v) + ' ms' : '–'], xbal: [fresh(X.bal) ? Math.round(X.bal.v) + ' / ' + Math.round(100 - X.bal.v) : '–'], xcore: [X.core && performance.now() - X.core.t < 60000 ? f(X.core.v) + ' °C' : '–', X.core?.v >= 39 ? '#ff8b97' : ''], xroom: [X.room && performance.now() - X.room.t < 120000 ? f(X.room.v) + ' °C' + (X.hum && performance.now() - X.hum.t < 120000 ? ' · ' + Math.round(X.hum.v) + ' %' : '') : '–'], xcustom: [fresh(cu) ? (Math.abs(cu.v) < 100 ? f(cu.v) : Math.round(cu.v)) + ' ' + cu.label : '–'] }; })(),
      lap: [fmtT(S.t - S.lapT0)], place: [S.npcOn ? (S.field.filter(n => gapOf(R, n.d, S.dist) > 0).length + 1) + ' / ' + (S.field.length + 1) : '–'],
      tss: [tss], ghost: [gg == null ? 'kein Geist' : (gg >= 0 ? '−' : '+') + Math.abs(Math.round(gg)) + ' m', gg == null ? '' : gg > 0 ? '#ff8b97' : '#4fd18b'],
      hrz: [hz >= 0 ? HRZONES[hz].n : '–', hz >= 0 ? HRZONES[hz].c : ''], pz: [ZONES[pz].n.split(' ')[0], ZONES[pz].c],
    };
    const tail = (k, n) => S.samples.slice(-n).map(s => s[k]);
    updateExtras($('#rw', el), vals, { gp: tail('p', 120), gh: tail('hr', 300), gc: tail('cad', 120) });
  }
  drawElevStrip($('#elev', el));
  drawMini($('#mini', el));
}
function woHud(el, f) {
  const wo = S.wo, wi = S.wi || woAt(wo, S.wT), tot = woTotal(wo), ftp = profile.ftp, k = 1 + S.wOff / 100;
  $('#woOff', el).textContent = 100 + S.wOff;
  const A = S.adapt, ad = $('#adapt', el);
  ad.textContent = A.on ? (A.cap ? '⚠ angepasst' : 'adaptiv') : 'fix'; ad.dataset.on = A.on; ad.title = A.note && performance.now() - A.noteT < 15000 ? A.note : 'Ziele passen sich an Kadenz, Puls und Trainer an. Klicken zum Umschalten.';
  $('#woTot', el).textContent = `${fmtT(Math.min(S.wT, tot))} / ${fmtT(tot)} · noch ${fmtT(Math.max(0, tot - S.wT))}`;
  if (wi && !wi.done) {
    const g = wi.g, tgt = wi.target == null ? null : Math.round(Math.min(wi.target * ftp * k, A.cap ? ftp * .55 : 1e9));
    $('#woStep', el).textContent = g.text || (wi.target == null ? 'Frei fahren' : ZONES[Math.max(0, ZONES.findIndex(z => wi.target < z.max))].n);
    $('#woSegN', el).textContent = `Intervall ${wi.i + 1} / ${wo.segs.length}`;
    $('#woLeft', el).textContent = fmtT(wi.left);
    $('#woSegBar', el).style.width = ((1 - wi.left / g.dur) * 100).toFixed(1) + '%';
    const tg = $('#woTgt', el); tg.textContent = tgt == null ? 'frei' : tgt; tg.style.color = tgt == null ? '#c3ccd5' : zoneColor(wi.target);
    $('#woCad', el).textContent = g.cad ? `◎ ${g.cad} U/min` : '';
    // Kadenz-Ziel und Tipp
    const cr = cadRange(g), cadNow = live.cadence, ct = $('#cadT', el);
    ct.hidden = !cr || S.state !== 'riding';
    if (cr) {
      const lo = 50, hi = 130, P = v => clamp((v - lo) / (hi - lo) * 100, 0, 100);
      $('#cadZone', el).style.left = P(cr[0]) + '%'; $('#cadZone', el).style.width = (P(cr[1]) - P(cr[0])) + '%';
      $('#cadMark', el).style.left = P(cadNow ?? lo) + '%';
      const inR = cadNow != null && cadNow >= cr[0] && cadNow <= cr[1];
      ct.dataset.s = cadNow == null ? '' : inR ? 'ok' : 'off';
      $('#cadTxt', el).textContent = `${cr[0]}–${cr[1]}`;
    }
    const tip = $('#woTip', el);
    tip.hidden = profile.tips === false;
    if (profile.tips !== false && S.tipSeg !== wi.i) { S.tipSeg = wi.i; tip.textContent = '💡 ' + tipFor(g, wi.i, wo.segs[wi.i - 1]); }
    const nx = wi.next; $('#woNext', el).textContent = nx ? 'danach ' + (nx.a == null ? 'frei' : Math.round((nx.a + nx.b) / 2 * ftp * k) + ' W') + ' · ' + fmtT(nx.dur) : 'letztes Intervall';
    // Liegt die Leistung im Ziel?
    const p3 = S.p3.length ? S.p3.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, S.p3.length) : 0;
    const box = $('#onT', el);
    if (tgt && S.state === 'riding') {
      const dev = (p3 - tgt) / tgt; box.hidden = false;
      const st = Math.abs(dev) < .05 ? 'ok' : dev < 0 ? 'low' : 'high';
      box.dataset.s = st; $('#onTi', el).style.left = clamp(50 + dev * 250, 2, 98) + '%';
      $('#onTt', el).textContent = st === 'ok' ? 'Im Ziel' : (dev < 0 ? '−' : '+') + Math.abs(Math.round(p3 - tgt)) + ' W';
    } else box.hidden = true;
  } else {
    $('#cadT', el).hidden = true; $('#woTip', el).hidden = true;
    $('#woStep', el).textContent = 'Workout beendet'; $('#woLeft', el).textContent = ''; $('#woTgt', el).textContent = '–'; $('#woNext', el).textContent = 'Frei weiterfahren'; $('#woSegN', el).textContent = ''; $('#woCad', el).textContent = ''; $('#onT', el).hidden = true; $('#woSegBar', el).style.width = '100%';
  }
  const act = []; for (const s of S.samples) if (s.wt != null) act.push([s.wt, s.p]);
  drawWorkout($('#woChart', el), wo, { pos: S.wT, actual: act.length > 600 ? act.filter((_, i) => i % 3 === 0) : act, ftp });
}
function riderList(el) {
  const R = S.route;
  const rows = (S.npcOn ? S.field : []).map(n => ({ n, name: n.name, remote: !!n.remote, gap: gapOf(R, n.d, S.dist), wkg: n.remote ? n.wkg : n.wkg * clamp(1 + R.gradeAt(n.d) * .025, .55, 1.25), c: n.look.jersey, v: n.v }));
  const p3 = S.p3.length ? S.p3.reduce((a, b) => a + b, 0) / S.p3.length : 0;
  rows.push({ me: true, name: profile.name, gap: 0, wkg: p3 / profile.kg, c: profile.jersey });
  for (const f of S.fg || []) rows.push({ fg: true, name: '👻 ' + f.name, gap: f.gap, v: f.v, c: '#8b6cf0' });
  if (S.pacer?.buddy) rows.push({ name: '🤝 ' + S.pacer.name, gap: gapOf(R, S.pacer.d, S.dist), wkg: S.pacer.w / profile.kg, c: '#7b4fd6' });
  rows.sort((a, b) => b.gap - a.gap);
  const mi = rows.findIndex(r => r.me), from = clamp(mi - 3, 0, Math.max(0, rows.length - 7));
  // Echte Mitspieler immer anzeigen, auch wenn sie weit weg sind (unten angehängt)
  const shown = rows.slice(from, from + 7), extra = rows.filter(r => r.remote && !shown.includes(r));
  const gapTxt = r => r.me ? '' : Math.abs(r.gap) < 1 ? '0 m' : Math.abs(r.gap) < 1000 ? (r.gap > 0 ? '+' : '−') + Math.abs(Math.round(r.gap)) + ' m' : (r.gap > 0 ? '+' : '−') + (Math.abs(r.gap) / 1000).toFixed(1).replace('.', ',') + ' km';
  // Status echter Fahrer: steht, rollt (tritt nicht), tritt; dazu schneller/langsamer
  const st = n => n.pause || n.v < .3 ? ['⏸', 'steht'] : (n.cadence || 0) < 5 ? ['🛞', 'rollt ohne zu treten'] : ['🚴', 'tritt'];
  const tr = n => (n.trend || 0) > .25 ? '<b class="up" title="wird schneller">▲</b>' : (n.trend || 0) < -.25 ? '<b class="dn" title="wird langsamer">▼</b>' : '';
  const row = r => {
    if (r.remote) { const [ic, t] = st(r.n); return `<div class="rrow remote" title="Echter Fahrer · ${t} · ${Math.round(r.v * 3.6)} km/h"><i style="background:${r.c}"></i><span class="nm">🌐 ${esc(r.name)} <span class="rst">${ic}${tr(r.n)}</span></span><span class="num">${Math.round(r.v * 3.6)}<small> km/h</small></span><span class="num gap">${gapTxt(r)}</span></div>`; }
    if (r.fg) return `<div class="rrow fg" title="Geist von ${esc(r.name)}"><i style="background:${r.c}"></i><span class="nm">${esc(r.name)}</span><span class="num">${Math.round(r.v * 3.6)}<small> km/h</small></span><span class="num gap">${gapTxt(r)}</span></div>`;
    return `<div class="rrow ${r.me ? 'me' : ''} ${S.wheel && r.name === S.wheel.name ? 'wheel' : ''}"><i style="background:${r.c}"></i><span class="nm">${esc(r.name)}</span><span class="num">${r.wkg.toFixed(1).replace('.', ',')}</span><span class="num gap">${gapTxt(r)}</span></div>`;
  };
  $('#riders', el).innerHTML = shown.map(row).join('') + (extra.length ? '<div class="rsep"></div>' + extra.map(row).join('') : '');
}
function drawElevStrip(cv) {
  const R = S.route, span = Math.min(R.total, 6000), back = Math.min(1000, span * .15);
  let from = S.dist - back, to = from + span;
  if (!R.loop) { from = clamp(from, 0, Math.max(0, R.total - span)); to = from + span; }
  const n = 200, dist = [], ele = [];
  for (let i = 0; i <= n; i++) { const d = from + (to - from) * i / n; dist.push(d - from); ele.push(R.eleAt(d)); }
  const res = profileChart(cv, dist, ele, { pos: S.dist - from, ghost: S.pacer ? clamp(S.pacer.d - from, 0, span) : null, top: clamp(cv.clientHeight * .24, 14, 40) }); // Platz für die mitwachsende Beschriftung
  // Tunnel, Orte und Mitfahrer im Profil markieren
  if (res) {
    const { w, h, d: dpr } = fitCanvas(cv), c = cv.getContext('2d'), X = v => v / span * w;
    const mark = (a, b, color) => { const x0 = X(a - from), x1 = X(b - from); if (x1 < 0 || x0 > w) return; c.fillStyle = color; c.fillRect(x0, h - 4 * dpr, x1 - x0, 4 * dpr); };
    for (const t of R.tunnels) mark(t.from, t.to, '#1b1e22');
    for (const t of R.towns) mark(t.from, t.to, '#ffd23f');
    if (S.npcOn) for (const nn of S.field) { let dd = nn.d; if (R.loop && dd < from) dd += R.total; if (dd < from || dd > to) continue; const i = Math.round((dd - from) / span * n), y = h - 4 * dpr - (ele[i] - res.mn) / (res.mx - res.mn) * (h - 22 * dpr); c.fillStyle = nn.look.jersey; c.beginPath(); c.arc(X(dd - from), y, 3 * dpr, 0, 7); c.fill(); }
  }
  const left = R.loop ? null : R.total - S.dist, tw = R.townAt(S.dist), tn = R.tunnelAt(S.dist);
  $('#elevTxt', S.el).textContent = `${Math.round(R.eleAt(S.dist))} m ü. NN${left != null ? ' · noch ' + fmtKm(left) + ' km' : ' · Runde ' + (S.lap + 1)}${tw ? ' · ' + tw.name : ''}${tn ? ' · Tunnel' : ''}`;
}
// Minikarte: ganze Strecke mit aktueller Position, Antippen öffnet die große Karte
function drawMini(cv) {
  const { w, h } = fitCanvas(cv), c = cv.getContext('2d');
  // Statische Strecke einmal vorzeichnen, danach nur Punkte darüber
  let M = S.miniCache;
  if (!M || M.w !== w || M.h !== h) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const oc = off.getContext('2d'); oc.fillStyle = 'rgba(16,20,24,.62)'; oc.beginPath(); oc.roundRect ? oc.roundRect(0, 0, w, h, 14) : oc.rect(0, 0, w, h); oc.fill();
    drawStatic(S.route, mapGeo(cv), oc, w / (cv.getBoundingClientRect().width || w), false);
    M = S.miniCache = { w, h, off };
  }
  c.clearRect(0, 0, w, h); c.drawImage(M.off, 0, 0);
  dynamicLayer(S.route, mapGeo(cv), c, w / (cv.getBoundingClientRect().width || w), false);
  if (!$('#bigMap', S.el).hidden) drawBigMap();
}
function drawMiniOld(cv) {
  const R = S.route, { w, h, d } = fitCanvas(cv), c = cv.getContext('2d'); c.clearRect(0, 0, w, h);
  // Ausschnitt um den Fahrer, nach Fahrtrichtung gedreht
  const sc = Math.min(w, h) / 1600, cx = w / 2, cy = h * .62, px = R.xAt(S.dist), pz = R.zAt(S.dist), hd = R.headAt(S.dist);
  c.save(); c.beginPath(); c.arc(cx, h / 2, Math.min(w, h) / 2 - 2 * d, 0, 7); c.fillStyle = 'rgba(16,20,24,.6)'; c.fill(); c.clip();
  c.translate(cx, cy); c.rotate(-hd);
  c.lineJoin = c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4 * d; c.beginPath();
  const step = 4; for (let i = 0; i <= R.N; i += step) { const x = (R.x[i] - px) * sc, y = (R.z[i] - pz) * sc; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.stroke();
  const seg = (a, b, color) => { c.strokeStyle = color; c.beginPath(); for (let i = Math.floor(a / R.step); i <= b / R.step; i += step) { const x = (R.x[i] - px) * sc, y = (R.z[i] - pz) * sc; c.lineTo(x, y); } c.stroke(); };
  for (const cl of R.climbs) seg(cl.from, cl.to, '#ef4458');
  for (const s of R.sprints) seg(s.from, s.to, '#4fd18b');
  for (const t of R.towns) { const x = (R.xAt((t.from + t.to) / 2) - px) * sc, y = (R.zAt((t.from + t.to) / 2) - pz) * sc; c.fillStyle = '#ffd23f'; c.fillRect(x - 3 * d, y - 3 * d, 6 * d, 6 * d); }
  if (S.npcOn) for (const n of S.field) { if (n.remote) continue; const qx = (R.xAt(n.d) - px) * sc, qy = (R.zAt(n.d) - pz) * sc; c.fillStyle = n.look.jersey; c.beginPath(); c.arc(qx, qy, 2.6 * d, 0, 7); c.fill(); }
  for (const n of S.field) if (n.remote) { const qx = (R.xAt(n.d) - px) * sc, qy = (R.zAt(n.d) - pz) * sc; c.fillStyle = n.look.jersey; c.strokeStyle = '#fff'; c.lineWidth = 2 * d; c.beginPath(); c.arc(qx, qy, 5 * d, 0, 7); c.fill(); c.stroke(); }
  if (S.pacer) { const qx = (R.xAt(S.pacer.d) - px) * sc, qy = (R.zAt(S.pacer.d) - pz) * sc; c.fillStyle = '#b06cf0'; c.beginPath(); c.arc(qx, qy, 4 * d, 0, 7); c.fill(); }
  c.restore();
  c.fillStyle = '#ff6a3d'; c.beginPath(); c.moveTo(cx, cy - 8 * d); c.lineTo(cx + 6 * d, cy + 6 * d); c.lineTo(cx - 6 * d, cy + 6 * d); c.fill();
}

/* ---------- Screenshots ---------- */
function shot(caption) {
  if (!S?.world || S.shots.length >= 40) return;
  S.lastShotT = S.samples.length;
  const c = S.world.capture(1280), x = c.getContext('2d'), w = c.width, h = c.height;
  // Datenleiste wie ein Foto-Overlay
  const g = x.createLinearGradient(0, h - 150, 0, h); g.addColorStop(0, 'rgba(10,12,16,0)'); g.addColorStop(1, 'rgba(10,12,16,.85)'); x.fillStyle = g; x.fillRect(0, h - 150, w, 150);
  x.fillStyle = '#fff'; x.font = '700 30px Barlow, Arial'; x.fillText(S.route.name, 28, h - 74);
  x.font = '500 18px Barlow, Arial'; x.fillStyle = '#c9d2da'; x.fillText(caption + ' · ' + new Date().toLocaleString(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }), 28, h - 46);
  const p3 = S.p3.length ? Math.round(S.p3.reduce((a, b) => a + b, 0) / S.p3.length) : 0;
  const items = [[p3 + ' W', 'Leistung'], [(live.heart ?? '–') + '', 'Puls'], [(S.v * 3.6).toFixed(1).replace('.', ',') + ' km/h', 'Tempo'], [fmtKm(S.odo) + ' km', 'Distanz'], [Math.round(S.asc) + ' m', 'Höhe'], [fmtT(S.t), 'Zeit']];
  let xx = w - 28; x.textAlign = 'right';
  for (let i = items.length - 1; i >= 0; i--) { x.fillStyle = '#fff'; x.font = '700 30px Barlow, Arial'; x.fillText(items[i][0], xx, h - 52); x.fillStyle = '#9aa7b3'; x.font = '500 15px Barlow, Arial'; x.fillText(items[i][1], xx, h - 30); xx -= Math.max(x.measureText(items[i][0]).width, 90) + 34; }
  x.textAlign = 'left'; x.fillStyle = '#ff6a3d'; x.font = '700 20px Barlow, Arial'; x.fillText('INDOORADO', 28, 40);
  c.toBlob(b => { if (b && S) { S.shots.push({ blob: b, caption, t: Math.round(S.t), d: Math.round(S.odo) }); if (caption === 'Foto') flash('📷 Foto gespeichert', 900); } }, 'image/jpeg', .86);
  const fl = document.createElement('div'); fl.className = 'shotflash'; S.el.querySelector('.ridewrap').appendChild(fl); setTimeout(() => fl.remove(), 500);
}

/* ---------- Ende ---------- */
async function endRide(auto = false, forced = null) {
  if (!S) return;
  auto = auto === true; // als Klick-Handler kommt hier ein Event an
  const prevState = S.state; if (S.state === 'riding') S.state = 'paused';
  const resume = () => { if (S && !S.finished) S.state = prevState === 'auto' ? 'riding' : prevState; };
  // Kennzahlen als Kacheln
  const ps = S.samples.filter(x => x.p != null), avg = ps.length ? ps.reduce((a, x) => a + x.p, 0) / ps.length : 0;
  const tiles = S.samples.length ? `<div class="endtiles">${[['🛣️', fmtKm(S.odo) + ' km', 'Strecke'], ['⏱️', fmtT(S.t), 'Zeit'], ['⚡', Math.round(avg) + ' W', 'Ø Leistung'], ['⛰️', Math.round(S.asc) + ' m', 'Höhenmeter']].map(([i, v, l]) => `<div class="endtile"><span>${i}</span><b class="num">${v}</b><small>${l}</small></div>`).join('')}</div>` : '';
  const demo = S.demoUsed && !profile.saveDemo, empty = !S.samples.length;
  const note = demo ? '🧪 Diese Fahrt lief mit Demo-Geräten und wird nicht gespeichert – sie zählt nicht für Level, Missionen, Rekorde oder Strava.'
    : empty ? 'Es wurde noch nichts aufgezeichnet.' : 'Gespeicherte Fahrten zählen für Level, Saison, Missionen, Trainingsplan und Rekorde.';
  const buttons = demo || empty
    ? [{ label: '⏹ Beenden', value: 'quit', cls: 'pri big' }, { label: '▶ Weiterfahren', value: 'back' }, { label: '🏠 Zum Menü – Fahrt bleibt pausiert', value: 'menu', cls: 'ghost' }]
    : [{ label: '💾 Speichern und Auswertung', value: 'save', cls: 'pri big' }, { label: '▶ Weiterfahren', value: 'back' }, { label: '🏠 Zum Menü – Fahrt bleibt pausiert', value: 'menu' }, { label: '🗑 Verwerfen', value: 'drop', cls: 'ghost danger' }];
  if (forced && (demo || empty) && forced === 'save') forced = 'quit';
  const v = forced || await dialog({ title: auto ? '🏁 Ziel erreicht!' : 'Fahrt beenden?', html: `${tiles}<p class="small muted endnote">${note}</p>`, buttons, cls: 'enddlg' });
  // Ins Menü, ohne zu beenden: Fahrt wird pausiert geparkt und lässt sich über „Zurück zur Fahrt“ fortsetzen
  if (v === 'menu') { if (S) S.state = 'paused'; location.hash = '#/'; return; }
  if (v === 'quit') { leave(); location.hash = '#/'; return; }
  if (v === 'drop') {
    const ok = await dialog({ title: 'Wirklich verwerfen?', html: '<p class="muted">Die Fahrt und ihre Fotos gehen verloren.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Verwerfen', value: true, cls: 'danger' }] });
    if (ok) { leave(); location.hash = '#/'; } else resume(); return;
  }
  if (v !== 'save') { resume(); return; }
  $('#load', S.el).hidden = false; $('#loadTxt', S.el).textContent = 'Fahrt wird gespeichert …';
  const id = await saveRide(S);
  leave();
  location.hash = '#/summary/' + id + '?neu';
}

let wake = null;
async function lockScreen() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { } }
// Handy/Tablet gesperrt, Bildschirm aus oder App verlassen: Fahrt pausieren und alles verstummen lassen
// (am Computer läuft die Fahrt im Hintergrund weiter, nur ein minimiertes Fenster schaltet den Ton nicht ab)
const isMobile = () => matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Laufende Fahrt regelmäßig lokal sichern, damit sie einen Absturz oder leeren Akku übersteht (ridesnap.js)
let snapAt = 0;
function snapTick(force = false) {
  if (!S?.alive || !S.startWall || (S.demoUsed && !profile.saveDemo)) return;
  if (!force && Date.now() - snapAt < 15000) return; snapAt = Date.now();
  import('../ridesnap.js').then(m => m.saveSnap(S)).catch(() => { });
}
addEventListener('pagehide', () => snapTick(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) snapTick(true); });
function goneAway() {
  if (!S?.alive || !isMobile()) return;
  if (S.state === 'riding' || S.state === 'auto' || S.state === 'ready') {
    if (S.state !== 'ready') { S.state = 'paused'; S.v = 0; S.resumeOnPedal = true; const b = $('#tPause', S.el); if (b) b.innerHTML = ICON.play + '<span>Weiter</span>'; }
    S.hiddenPause = true;
  }
  $('#rideVid', S.el)?.pause();
  import('../sound.js').then(m => m.pauseAll());
}
function cameBack() {
  if (!S?.alive) return;
  lockScreen();
  import('../sound.js').then(m => m.resumeAll());
  if (S.hiddenPause) { S.hiddenPause = false; if (S.state === 'paused') { flash('⏸ Pausiert, weil die App im Hintergrund war · treten oder „Weiter“', 3500); endHint(true); } }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? goneAway() : cameBack());
addEventListener('pagehide', goneAway);
addEventListener('pageshow', () => { if (document.visibilityState === 'visible') cameBack(); });

export function leave() {
  if (!S) return;
  import('../ridesnap.js').then(m => m.clearSnap()).catch(() => { }); // Fahrt ist beendet, gespeichert oder verworfen
  if (window.__watchMod?.W.token) { const M = window.__watchMod; M.W.lastPush = 0; M.pushWatch({ state: 'ended', route: S.route.name, total: Math.round(S.route.total), d: Math.round(S.dist), odo: Math.round(S.odo), t: Math.round(S.t), asc: Math.round(S.asc), p: 0, v: 0, prof: S.route.prof }); }
  if (S.tvTok) import('../tvstream.js').then(T => T.stopSender());
  physEnv.wind = 0; import('../comfort.js').then(C => C.stopVoice()); S.alive = false; S.vbox?.remove(); S.si?.destroy(); S.si = null; if (S.vurl) { const v = $('#rideVid', S.el); v?.pause(); URL.revokeObjectURL(S.vurl); } setTimeout(() => bus.emit('rideEnded'), 1500); S.live?.leave(); window.__presence?.setStatus({ where: 'menu', route: null, routeName: null, kit: null }); sound.silence(); music.stop(); hush(); putLive({ state: 'ended', t: Math.round(S.t), odo: Math.round(S.odo), route: S.route.name }); clearInterval(S.timer); cancelAnimationFrame(S.raf); S.ro?.disconnect();
  document.removeEventListener('keydown', S.key); S.offs.forEach(f => f());
  try { S.world.dispose(); } catch (e) { }
  // Speicher freigeben: Streckendaten, Caches der Karte, Testverweis
  S.miniCache = null; S.field = []; S.samples = []; S.shots = []; delete window.__tw;
  clearRouteCache();
  if (status.trainer === 'on' || demo.on) setPower(Math.min(100, profile.ftp * .4));
  control.target = null;
  if (wake) { wake.release().catch(() => { }); wake = null; }
  
  S = null;
}
export const isRiding = () => !!S && !S.parked && S.state !== 'ready' && S.samples.length > 0;

/* ---------- Pausieren und ins Menü (Fahrt bleibt im Speicher) ---------- */
export function park() {
  if (!S || S.parked) return;
  S.parked = true; S.state = 'paused'; S.v = 0;
  cancelAnimationFrame(S.raf); sound.silence(); music.stop(); hush(); closeMap();
  S.wrap = $('#rw', S.el); document.getElementById('parkHold')?.remove();
  const hold = document.createElement('div'); hold.id = 'parkHold'; hold.hidden = true; hold.appendChild(S.wrap); document.body.appendChild(hold);
  if (status.trainer === 'on' || demo.on) setPower(Math.min(100, profile.ftp * .4));
  document.removeEventListener('keydown', S.key);
}
export const parkedInfo = () => S?.parked ? `${S.route.name} · ${fmtKm(S.odo)} km · ${fmtT(S.t)}` : null;
function unpark(el) {
  S.parked = false; S.el = el; el.innerHTML = ''; el.appendChild(S.wrap); document.getElementById('parkHold')?.remove();
  document.addEventListener('keydown', S.key);
  $('#tPause', el).innerHTML = ICON.play + '<span>Weiter</span>';
  S.world.resize(); S.world.camInit = false; S.lastFrame = performance.now(); S.lastTick = performance.now();
  const frame = now => {
    if (!S?.alive || S.parked) return;
    S.frameFn(now); S.raf = requestAnimationFrame(frame);
  };
  S.raf = requestAnimationFrame(frame); music.start();
  flash('Pausiert · Tritt los oder „Weiter“ drücken', 2500); S.state = 'paused'; S.resumeOnPedal = true;
  if (sessionStorage.getItem('endAfterResume')) { sessionStorage.removeItem('endAfterResume'); setTimeout(() => endRide(), 200); }
}
