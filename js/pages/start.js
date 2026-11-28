// Startseite: Geräte, Fahrt einrichten, Fortschritt
import { $, esc, fmtKm, fmtDur, bus, clamp } from '../util.js';
import { profile, sel, saveSel, progress, levelOf } from '../state.js';
import { deviceCards, levelBar, rideRow, statTiles, ICON } from '../components.js';
import { listRoutes, quickStats, THEMES } from '../routes.js';
import { listWorkouts, stats as wStats, drawWorkout, getWorkout } from '../workouts.js';
import { db } from '../db.js';
import { totals, fitness, estimateFtp } from '../analysis.js';
import { saveProfile } from '../state.js';
import { seasonOf, seasonState, tokensFree } from '../season.js';
import { missionState, streakBonus } from '../game.js';
import { planProgress } from '../plans.js';
import { daily, dailyState, dailyStreak } from '../modes.js';

// Tagesempfehlung nach Form (Frische TSB) und Plan, wie bei TrainerRoad oder Wahoo
function todayCard(rides) {
  const f = fitness(rides, 60).at(-1) || { tsb: 0, ctl: 0 }, tsb = Math.round(f.tsb), last = rides[0] ? (Date.now() - +new Date(rides[0].date)) / 864e5 : 99;
  const pr = planProgress(), nx = pr?.next;
  let head, text, pick;
  if (tsb < -25) { head = 'Heute lieber erholen'; text = `Deine Frische liegt bei ${tsb}. Eine lockere Runde hilft mehr als harte Intervalle.`; pick = 'w-easy'; }
  else if (tsb < -10) { head = 'Ruhige Grundlage'; text = `Etwas Müdigkeit im System (Frische ${tsb}). Gleichmäßig in Zone 2 ist heute ideal.`; pick = 'w-endu90'; }
  else if (tsb > 10 || last > 3) { head = 'Frisch: Zeit für Intensität'; text = last > 3 ? `Deine letzte Fahrt ist ${Math.floor(last)} Tage her. Die Beine sind ausgeruht.` : `Frische ${tsb}: gute Voraussetzungen für eine harte Einheit.`; pick = 'w-vo5'; }
  else { head = 'Solide Trainingseinheit'; text = `Form im Gleichgewicht (Frische ${tsb}). Sweet Spot bringt viel für wenig Ermüdung.`; pick = 'w-ss3'; }
  if (nx) { pick = nx.id; text += tsb < -25 ? ` Die nächste Plan-Einheit „${esc(nx.name)}“ am besten mit 90 % Intensität fahren oder verschieben.` : ` Passend dazu als Nächstes im Plan: „${esc(nx.name)}“.`; }
  return `<section class="card today"><div class="row between"><div><div class="small muted">Empfehlung für heute</div><h2 style="margin:2px 0">${head}</h2><p class="small muted" style="margin:0">${text}</p></div><button class="btn pri" data-plango="${pick}">Jetzt fahren</button></div></section>`;
}
function planOpts() {
  const pr = planProgress(); if (!pr) return '';
  const list = pr.p.all.filter(w => w.id === sel.workoutId || w.id === pr.next?.id);
  return `<optgroup label="Trainingsplan ${esc(pr.p.name)}">${list.map(w => `<option value="${esc(w.id)}" ${w.id === sel.workoutId ? 'selected' : ''}>W${w.week}/${w.n} ${esc(w.name)} · ${fmtDur(wStats(w).dur)}</option>`).join('')}</optgroup>`;
}
function planCard() {
  const pr = planProgress();
  if (!pr) return '<p class="muted">Kein Plan aktiv. Ein Plan führt dich Woche für Woche durch passende Workouts, zum Beispiel zur Vorbereitung auf einen Gran Fondo.</p><a class="btn sm pri" href="#/plans">Plan auswählen</a>';
  const n = pr.next;
  return `<div class="row between"><b style="color:${pr.p.color}">${esc(pr.p.name)}</b><span class="small muted num">${pr.done}/${pr.total} · Woche ${pr.week}/${pr.p.weeks.length}</span></div><div class="bar"><i style="width:${(pr.frac * 100).toFixed(1)}%"></i></div>
    ${n ? `<canvas id="planNext" class="plannext"></canvas><p class="small" style="margin:10px 0 6px">Als Nächstes: <b>${esc(n.name)}</b> <span class="muted num">· ${fmtDur(wStats(n).dur)} · TSS ${wStats(n).tss}</span></p><div class="row end"><button class="btn sm" data-plansel="${n.id}">Auswählen</button><button class="btn sm pri" data-plango="${n.id}">Jetzt fahren</button></div>` : '<p>Plan abgeschlossen 🎉</p>'}`;
}

export function routeSvg(raw, w = 300, h = 54) {
  const p = raw.pts, n = 80; let mn = Infinity, mx = -Infinity;
  for (const q of p) { mn = Math.min(mn, q[2]); mx = Math.max(mx, q[2]); }
  if (mx - mn < 40) mx = mn + 40;
  let s = '';
  for (let k = 0; k <= n; k++) { const q = p[Math.floor(k / n * (p.length - 1))]; s += (k ? 'L' : 'M') + (k / n * w).toFixed(1) + ',' + (h - 2 - (q[2] - mn) / (mx - mn) * (h - 6)).toFixed(1); }
  return `<svg class="prof" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${s}L${w},${h}L0,${h}Z" fill="#ff6a3d33" stroke="#ff6a3d" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
export function routeMapSvg(raw, size = 64) {
  const p = raw.pts; let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
  for (const q of p) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); }
  const k = Math.cos(a * Math.PI / 180), sx = (d - c) * k || 1e-6, sy = (b - a) || 1e-6, s = (size - 8) / Math.max(sx, sy);
  const ox = (size - sx * s) / 2, oy = (size - sy * s) / 2;
  const step = Math.max(1, Math.floor(p.length / 160));
  let path = ''; for (let i = 0; i < p.length; i += step) path += (i ? 'L' : 'M') + (ox + (p[i][1] - c) * k * s).toFixed(1) + ',' + (size - oy - (p[i][0] - a) * s).toFixed(1);
  return `<svg class="rmap" viewBox="0 0 ${size} ${size}"><path d="${path}" fill="none" stroke="#eef2f5" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

// Große Karte der gewählten Strecke: Landschaftsfarben, Kartenlinie, Profil, Abzeichen, Bestzeit, Fahren oder Rennen
function featuredRoute(r) {
  const th = THEMES[r.theme] || THEMES.meadow, st = quickStats(r), best = progress.routeBest?.[r.id], badge = progress.routeBadges?.[r.id];
  return `<section class="card featroute" style="--sky0:${th.sky[0]};--sky1:${th.sky[1]};--g0:${th.grass[0]};--g1:${th.grass[2]}">
    <div class="fr-map">${routeMapSvg(r, 150)}</div>
    <div class="fr-main"><div class="small fr-kicker">${r.loop ? 'Rundkurs' : 'Einzelstrecke'}${badge ? ' · 🏅 Abzeichen' : ''}</div><h2>${esc(r.name)}</h2>
      <p class="small fr-desc">${esc(r.desc || '')}</p>
      <div class="fr-stats num"><span><b>${fmtKm(st.dist)}</b> km</span><span><b>${Math.round(st.asc)}</b> hm</span>${best ? `<span>Bestzeit <b>${fmtDur(best.time)}</b></span>` : ''}</div>
      <div class="fr-prof">${routeSvg(r, 600, 60)}</div>
      <div class="row"><a class="btn pri" href="#/ride">${ICON.ride} Fahren</a><button class="btn" data-race>🏁 Rennen gegen Bots</button><button class="btn" data-tt>⏱️ Zeitfahren</button></div></div>
  </section>`;
}
// Woche als Kalender: Balken = Trainingsbelastung (TSS) je Tag
function weekCal(rides) {
  const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(+mon + i * 864e5), k = d.toDateString(), rs = rides.filter(r => new Date(r.date).toDateString() === k); return { d, tss: rs.reduce((a, r) => a + (r.sum.tss || 0), 0), km: rs.reduce((a, r) => a + r.sum.dist, 0) / 1000, n: rs.length }; });
  const mx = Math.max(100, ...days.map(d => d.tss)), today = new Date().toDateString();
  return `<div class="weekcal">${days.map(d => `<div class="wc ${d.d.toDateString() === today ? 'today' : ''} ${d.d > new Date() ? 'future' : ''}" title="${d.n} Fahrt(en), ${Math.round(d.km)} km, TSS ${Math.round(d.tss)}"><div class="wcbar"><i style="height:${(d.tss / mx * 100).toFixed(0)}%"></i></div><b class="num">${d.tss ? Math.round(d.tss) : ''}</b><span>${d.d.toLocaleDateString(document.documentElement.lang, { weekday: 'short' }).slice(0, 2)}</span></div>`).join('')}</div>`;
}
// Missionen als Fortschrittsringe
function missionRings(ms) {
  const R = 30, C = 2 * Math.PI * R;
  return `<div class="mrings">${ms.map(m => `<div class="mring ${m.done ? 'done' : ''}" title="${esc(m.text)}: ${Math.round(m.v)} / ${m.goal}"><svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="${R}" class="trk"/><circle cx="38" cy="38" r="${R}" class="val" stroke-dasharray="${(C * m.frac).toFixed(1)} ${C.toFixed(1)}"/></svg><span class="mi">${m.done ? '✅' : m.icon}</span><b class="small">${esc(m.text)}</b><small class="muted num">${Math.min(m.goal, Math.round(m.v))} / ${m.goal} · +${m.xp} XP</small></div>`).join('')}</div>`;
}

let off = [];
export async function render(el) {
  const routes = await listRoutes(), wos = await listWorkouts(), rides = (await db.all('rides')).sort((a, b) => b.date.localeCompare(a.date));
  const LG = await import('../league.js'), frz = LG.maintainStreak(rides);
  const t = totals(rides), wk = Date.now() - 7 * 864e5, week = rides.filter(r => +new Date(r.date) > wk);
  const wkSum = week.reduce((a, r) => ({ d: a.d + r.sum.dist, t: a.t + r.sum.dur, tss: a.tss + r.sum.tss }), { d: 0, t: 0, tss: 0 });
  if (!routes.find(r => r.id === sel.routeId)) sel.routeId = 'b-hills';
  const cats = [...new Set(wos.map(w => w.cat))];
  el.innerHTML = `${profile.kid ? `<section class="card kidcard"><h2>🧒 Los geht's, ${esc(profile.name)}!</h2><p class="small muted">Kurze Fahrten durch bunte Welten. Sammle Glocken, überhole die anderen und hol dir Abzeichen.</p>
    <div class="kidgrid">${[['b-candy', '🍭', 'Zuckerland'], ['b-dino', '🦖', 'Dino-Tal'], ['b-weltall', '🚀', 'Weltall'], ['b-hills', '🌳', 'Hügel']].map(([id, i, l]) => `<button class="btn kidbtn" data-kid="${id}"><b>${i}</b>${l}<small class="muted">10 Minuten</small></button>`).join('')}</div></section>` : ''}
  <section class="hero">
    <div><h1>Hallo ${esc(profile.name)}${profile.title ? ` <span class="prtag">🏷️ ${esc(profile.title)}</span>` : ''}</h1><p class="muted">FTP ${profile.ftp} W · ${String(profile.kg).replace('.', ',')} kg · ${(profile.ftp / profile.kg).toFixed(2).replace('.', ',')} W/kg</p></div>
    <div class="hero-lv">${levelBar()}<a class="small seasonlink" href="#/season">${(() => { const z = seasonOf(), st = seasonState(z); return `${z.emoji} ${esc(z.name)} · Stufe ${st.tier}/25${tokensFree() > 0 ? ` · 🔧 ${tokensFree()} Gutschein${tokensFree() === 1 ? '' : 'e'} frei` : ''}`; })()}</a></div>
  </section>
  ${(() => { const e = estimateFtp(rides); if (!e || Math.abs(e.ftp - profile.ftp) < Math.max(8, profile.ftp * .04) || profile.ftpHintOff === e.ftp) return ''; const up = e.ftp > profile.ftp;
    return `<section class="card ftphint ${up ? 'up' : 'down'}" role="status"><div><b>${up ? '📈 Du bist stärker geworden!' : '📉 Deine FTP ist vielleicht zu hoch'}</b><div class="small muted">Geschätzte FTP <b>${e.ftp} W</b> statt ${profile.ftp} W · ${e.from} (${new Date(e.date).toLocaleDateString(document.documentElement.lang)})${e.sure ? '' : ' · ohne 20-min-Wert etwas ungenauer'}. Die FTP bestimmt deine Trainingszonen und Workout-Watt.</div></div>
      <div class="row"><button class="btn sm pri" data-ftpset="${e.ftp}">Auf ${e.ftp} W setzen</button><button class="btn sm" data-ftpno="${e.ftp}">Nein danke</button></div></section>`; })()}
  <div class="homegrid" id="homeGrid">
  <div class="hblk" data-blk="today">${todayCard(rides)}</div>
  <div class="hblk" data-blk="daily">${(() => { const c = daily(), st = dailyState(), n = dailyStreak(); return `<section class="card dailycard ${st?.ok ? 'done' : ''}"><div class="row between"><div><div class="small muted">🗓️ Tagesherausforderung · für alle gleich, morgen neu${n ? ' · 🔥 ' + n + ' Tage in Folge' : ''}</div><h2 style="margin:2px 0">${esc(c.text)}</h2><p class="small muted" style="margin:0">${st?.ok ? '✅ Geschafft in ' + fmtDur(st.time) + '. Schneller geht immer!' : st ? 'Versucht: ' + fmtDur(st.time) + '. Noch ein Anlauf?' : '+150 XP beim ersten Erfolg des Tages'}</p></div><button class="btn ${st?.ok ? '' : 'pri'}" data-daily>${st?.ok ? 'Nochmal' : 'Annehmen'}</button></div></section>`; })()}
</div>
  <div class="hblk" data-blk="route"><div id="featR">${featuredRoute(routes.find(r => r.id === sel.routeId) || routes[0])}</div></div>
    <div class="hblk half" data-blk="plan"><div class="card"><div class="row between"><h2>Trainingsplan</h2><a href="#/plans" class="small">Alle Pläne</a></div>${planCard()}</div></div>
    <div class="hblk half" data-blk="missions"><div class="card"><div class="row between"><h2>Wochenmissionen</h2><span class="small muted">${t.streak ? '🔥 ' + t.streak + ' Tage Serie' + (streakBonus(t.streak) ? ' · +' + Math.round(streakBonus(t.streak) * 100) + ' % XP' : '') : 'Heute fahren startet eine Serie'}${frz ? ` · <span title="Serien-Schutz: überbrückt automatisch einen fehlenden Tag. Neu für jede Woche mit 3 Fahrtagen, höchstens 2.">🧊 ${frz}</span>` : ''}</span></div>${missionRings(missionState(rides))}</div>
  </div>
  <div class="hblk" data-blk="devices"><section class="card"><div class="row between"><h2>Geräte</h2><a href="#/devices" class="small">Details und Tasten anlernen</a></div><div id="devs"></div></section></div>
  <div class="hblk" data-blk="setup"><section class="card">
    <h2>Fahrt einrichten</h2>
    <h3 class="sub">Strecke</h3>
    <div class="routepick scroll" id="routePick">${routes.map(r => { const s = quickStats(r); return `
      <button class="rcard ${r.id === sel.routeId ? 'on' : ''}" data-rid="${esc(r.id)}" style="--sky:${(THEMES[r.theme] || THEMES.meadow).sky[0]}">
        <div class="row between">${routeMapSvg(r, 56)}<div class="rc-meta num">${fmtKm(s.dist)} km<br>${Math.round(s.asc)} hm</div></div>
        <div class="t">${esc(r.name)}</div><div class="small muted">${r.loop ? 'Rundkurs' : 'Einzelstrecke'}${r.builtin ? '' : ' · eigene'}</div>${routeSvg(r)}
      </button>`; }).join('')}</div>
    <div class="setup">
      <div>
        <h3 class="sub">Workout</h3>
        <select id="woSel" class="inp"><option value="">Kein Workout, freie Fahrt</option>${planOpts()}${cats.map(c => `<optgroup label="${esc(c)}">${wos.filter(w => w.cat === c).map(w => `<option value="${esc(w.id)}" ${w.id === sel.workoutId ? 'selected' : ''}>${esc(w.name)} · ${fmtDur(wStats(w).dur)}</option>`).join('')}</optgroup>`).join('')}</select>
        <div class="wprev"><canvas id="woPrev"></canvas><div class="small muted" id="woInfo"></div></div>
        <div class="form" style="margin-top:14px">
          <label class="switch"><input type="checkbox" id="optNpc" ${sel.npcs !== false ? 'checked' : ''}><span></span> Mitfahrer auf der Strecke (Windschatten, Überholen)</label>
          <label class="switch"><input type="checkbox" id="optGhost" ${sel.ghost !== false ? 'checked' : ''}><span></span> Gegen meine Bestfahrt auf dieser Strecke fahren (Geist)</label>
          <label class="switch"><input type="checkbox" id="optAdapt" ${sel.adaptive !== false ? 'checked' : ''}><span></span> Workouts adaptiv an Kadenz, Puls und Trainer anpassen</label>
        </div>
      </div>
      <div>
        <h3 class="sub">Widerstand bei freier Fahrt</h3>
        <div class="seg" id="modeSeg">${[['gear', 'Virtuelle Gänge'], ['sim', 'Steigung'], ['erg', 'ERG fix'], ['hr', 'Puls-Ziel']].map(([k, l]) => `<button data-m="${k}" aria-pressed="${sel.mode === k}">${l}</button>`).join('')}</div>
        <p class="small muted" id="modeTxt"></p>
        <label class="f small" id="hrBox" ${sel.mode === 'hr' ? '' : 'hidden'}>Zielpuls (bpm)<input class="inp sm" id="hrT" type="number" min="80" max="200" value="${sel.hrTarget || Math.round(profile.hrMax * .72)}"></label>
        <h3 class="sub">Schrittmacher</h3>
        <div class="seg" id="pacerSeg">${[0, 'buddy', 2, 2.5, 3, 3.5, 4].map(v => `<button data-p="${v}" aria-pressed="${sel.pacer === v}" ${v === 'buddy' ? 'title="Fährt immer ein bisschen stärker als du, wartet und kontert wie ein echter Trainingspartner"' : ''}>${v === 'buddy' ? '🤝 Buddy' : v ? String(v).replace('.', ',') + ' W/kg' : 'Aus'}</button>`).join('')}</div>
      </div>
    </div>
    <div class="row end" style="margin-top:14px"><a class="btn pri big" href="#/ride">${ICON.ride} Fahrt starten</a></div>
  </section></div>
    <div class="hblk half" data-blk="week"><div class="card"><div class="row between"><h2>Diese Woche</h2><a href="#/progress" class="small">Fortschritt</a></div>
      ${weekCal(rides)}
      ${statTiles([[fmtKm(wkSum.d), 'km'], [fmtDur(wkSum.t), 'Fahrzeit'], [wkSum.tss, 'TSS'], [week.length, 'Fahrten'], [t.streak, 'Tage am Stück'], [Object.keys(progress.badges).length, 'Abzeichen']])}
    </div></div>
    <div class="hblk half" data-blk="recent"><div class="card"><div class="row between"><h2>Letzte Fahrten</h2><a href="#/history" class="small">Alle</a></div>
      ${rides.length ? rides.slice(0, 4).map(rideRow).join('') : '<p class="muted">Noch keine Fahrten gespeichert. Die erste Fahrt wartet.</p>'}
    </div></div>
  </div>
  <div class="row center homeedit"><button class="btn sm ghost" id="homeEdit">✏️ Startseite anpassen</button></div>`;
  applyHome(el);
  off.push(deviceCards($('#devs', el)));
  // Einmaliger Hinweis: als App installieren (Vollbild, eigenes Symbol)
  import('../comfort.js').then(C => {
    let off = false; try { off = localStorage.getItem('vvInstHide') === '1'; } catch (e) { }
    if (off || !C.canInstall() || el.querySelector('.instcard')) return;
    const c = document.createElement('section'); c.className = 'card instcard row between';
    c.innerHTML = '<div><b>📲 IndooRado als App</b><div class="small muted">Startet im Vollbild mit eigenem Symbol – wie eine richtige App.</div></div><div class="row"><button class="btn sm pri" data-inst>Installieren</button><button class="btn sm ghost" data-insthide aria-label="Ausblenden">✕</button></div>';
    c.onclick = async e => { if (e.target.closest('[data-insthide]')) { try { localStorage.setItem('vvInstHide', '1'); } catch (er) { } c.remove(); } if (e.target.closest('[data-inst]')) { if (await C.install()) c.remove(); } };
    el.prepend(c);
  });
  el.onclick = (e => {
    if (e.target.closest('[data-quick]')) { sessionStorage.setItem('quickStart', '1'); location.hash = '#/ride'; return; }
    const kd = e.target.closest('[data-kid]'); if (kd) { sel.routeId = kd.dataset.kid; sel.workoutId = null; sel.npcs = true; saveSel(); sessionStorage.setItem('kidRide', '10'); location.hash = '#/ride'; return; }
    const fs = e.target.closest('[data-ftpset]'); if (fs) { profile.ftp = +fs.dataset.ftpset; saveProfile(); bus.emit('toast', 'FTP auf ' + profile.ftp + ' W gesetzt'); render(el); return; }
    const fn = e.target.closest('[data-ftpno]'); if (fn) { profile.ftpHintOff = +fn.dataset.ftpno; saveProfile(); render(el); return; }
    if (e.target.closest('[data-race]')) { sessionStorage.setItem('raceNext', '1'); location.hash = '#/ride'; return; }
    if (e.target.closest('[data-daily]')) { sel.routeId = daily().routeId; saveSel(); sessionStorage.setItem('dailyNext', '1'); location.hash = '#/ride'; return; }
    if (e.target.closest('[data-tt]')) { sessionStorage.setItem('ttNext', '1'); location.hash = '#/ride'; return; }
    const b = e.target.closest('[data-plansel],[data-plango]'); if (!b) return;
    sel.workoutId = b.dataset.plansel || b.dataset.plango; saveSel();
    if (b.dataset.plango) location.hash = '#/ride'; else render(el);
  });
  $('#routePick', el).onclick = e => { const b = e.target.closest('[data-rid]'); if (!b) return; sel.routeId = b.dataset.rid; saveSel(); for (const x of el.querySelectorAll('.rcard')) x.classList.toggle('on', x === b); $('#featR', el).innerHTML = featuredRoute(routes.find(r => r.id === sel.routeId)); };
  const modeTxt = { gear: 'Wie draußen schalten: Trittfrequenz, Gang, Steigung und Gewicht bestimmen die Leistung, der Trainer stellt sie im ERG-Modus ein. Ideal mit Trainern ohne Schaltung und Lenkertasten.', sim: 'Die Steigung geht direkt an den Trainer (beim D100 bis etwa 6 %). Schalten nur mit echter Kassette.', erg: 'Feste Wattzahl, mit + und − in 10-W-Schritten verstellbar.', hr: 'Du gibst einen Zielpuls vor, der Trainer regelt die Watt alle 5 Sekunden nach. Ideal für ruhige Grundlagenfahrten. Braucht einen Pulsgurt.' };
  const updMode = () => { for (const b of $('#modeSeg', el).children) b.setAttribute('aria-pressed', String(b.dataset.m === sel.mode)); $('#modeTxt', el).textContent = modeTxt[sel.mode]; $('#hrBox', el).hidden = sel.mode !== 'hr'; };
  $('#hrT', el).onchange = e => { sel.hrTarget = clamp(+e.target.value || 140, 80, 200); saveSel(); };
  updMode();
  $('#modeSeg', el).onclick = e => { const b = e.target.closest('[data-m]'); if (b) { sel.mode = b.dataset.m; saveSel(); updMode(); } };
  $('#pacerSeg', el).onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; sel.pacer = b.dataset.p === 'buddy' ? 'buddy' : +b.dataset.p; saveSel(); for (const x of $('#pacerSeg', el).children) x.setAttribute('aria-pressed', String(x === b)); };
  const updWo = async () => {
    const w = await getWorkout(sel.workoutId);
    const cv = $('#woPrev', el); cv.parentElement.hidden = !w;
    if (w) { drawWorkout(cv, w); const s = wStats(w); $('#woInfo', el).textContent = `${fmtDur(s.dur)} · TSS ${s.tss} · IF ${s.IF.toFixed(2).replace('.', ',')} · ${w.desc || ''}`; }
  };
  $('#optNpc', el).onchange = e => { sel.npcs = e.target.checked; saveSel(); };
  $('#optGhost', el).onchange = e => { sel.ghost = e.target.checked; saveSel(); };
  $('#optAdapt', el).onchange =e => { sel.adaptive = e.target.checked; saveSel(); };
  $('#woSel', el).onchange =e => { sel.workoutId = e.target.value || null; saveSel(); updWo(); };
  updWo();
  // Nächste Plan-Einheit als Mini-Diagramm
  const pn = planProgress()?.next, pc = $('#planNext', el); if (pn && pc) { const w = await getWorkout(pn.id); if (w) drawWorkout(pc, w); }
}
export function leave() { off.forEach(f => f()); off = []; }

/* ---------- Startseite anpassen: Felder ein-/ausblenden und Reihenfolge (Begrüßung, Hinweise und „Fahrt einrichten“ bleiben) ---------- */
const BLOCKS = [['today', '💡 Empfehlung für heute'], ['daily', '🗓️ Tagesherausforderung'], ['route', '🗺️ Gewählte Strecke'], ['plan', '📅 Trainingsplan'], ['missions', '🎯 Wochenmissionen'], ['devices', '🔌 Geräte'], ['setup', '🚴 Fahrt einrichten'], ['week', '📊 Diese Woche'], ['recent', '🕘 Letzte Fahrten']];
const FIXED = ['setup']; // lässt sich verschieben, aber nicht ausblenden
const homeCfg = () => { const c = profile.homeLayout || {}, known = BLOCKS.map(b => b[0]); const order = [...(c.order || []).filter(k => known.includes(k)), ...known.filter(k => !(c.order || []).includes(k))]; return { order, hidden: (c.hidden || []).filter(k => !FIXED.includes(k)) }; };
function applyHome(el) {
  const g = el.querySelector('#homeGrid'); if (!g) return; const c = homeCfg();
  for (const k of c.order) { const b = g.querySelector(`[data-blk="${k}"]`); if (b) { g.append(b); b.hidden = c.hidden.includes(k); } }
  // halbe Kacheln ohne Partner über die volle Breite ziehen
  const vis = [...g.children].filter(b => !b.hidden); vis.forEach(b => b.classList.remove('solo'));
  for (let i = 0; i < vis.length; i++) if (vis[i].classList.contains('half')) { if (vis[i + 1]?.classList.contains('half')) i++; else vis[i].classList.add('solo'); }
  const eb = el.querySelector('#homeEdit'); if (eb) eb.onclick = () => editHome(el);
}
async function editHome(el) {
  const c = homeCfg(); let order = [...c.order]; const hidden = new Set(c.hidden);
  const w = document.createElement('div'); w.className = 'modal on';
  const draw = () => { w.innerHTML = `<div class="card dlg homedlg" role="dialog" aria-modal="true" aria-label="Startseite anpassen"><h2>✏️ Startseite anpassen</h2><p class="small muted">Häkchen: anzeigen. Pfeile: Reihenfolge. Begrüßung und wichtige Hinweise bleiben immer oben.</p>
    <div class="hlist">${order.map((k, i) => { const l = BLOCKS.find(b => b[0] === k)[1], fx = FIXED.includes(k); return `<div class="hrow"><label class="chk"><input type="checkbox" data-k="${k}" ${hidden.has(k) ? '' : 'checked'} ${fx ? 'disabled' : ''}><span>${l}${fx ? ' <small class="muted">(immer sichtbar)</small>' : ''}</span></label><span class="row"><button class="btn xs ghost" data-up="${i}" ${i ? '' : 'disabled'} aria-label="nach oben">▲</button><button class="btn xs ghost" data-dn="${i}" ${i < order.length - 1 ? '' : 'disabled'} aria-label="nach unten">▼</button></span></div>`; }).join('')}</div>
    <div class="row between"><button class="btn ghost sm" data-reset>Standard</button><span class="row"><button class="btn ghost" data-x>Abbrechen</button><button class="btn pri" data-save>Speichern</button></span></div></div>`; };
  draw(); document.body.appendChild(w);
  w.addEventListener('change', e => { const k = e.target.dataset.k; if (k) e.target.checked ? hidden.delete(k) : hidden.add(k); });
  w.addEventListener('click', e => {
    const u = e.target.closest('[data-up]'), d = e.target.closest('[data-dn]');
    if (u) { const i = +u.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); return; }
    if (d) { const i = +d.dataset.dn; [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); return; }
    if (e.target.closest('[data-reset]')) { order = BLOCKS.map(b => b[0]); hidden.clear(); draw(); return; }
    if (e.target === w || e.target.closest('[data-x]')) { w.remove(); return; }
    if (e.target.closest('[data-save]')) { profile.homeLayout = { order, hidden: [...hidden] }; saveProfile(); w.remove(); applyHome(el); }
  });
}
