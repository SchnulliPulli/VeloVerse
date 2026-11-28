// Konto: IndooRado Online (Supabase). Registrierung Schritt für Schritt, Anmelden, Passwort zurücksetzen, 2FA,
// welche Daten online landen, Abgleich zwischen Geräten, Sicherheit und Konto löschen.
import { $, esc, toast, dialog, bus } from '../util.js';
import { avatarSvg } from '../components.js';
import { profile, progress, levelOf, saveProfile } from '../state.js';
import * as O from '../online/client.js';

const PROV = { google: 'Google', github: 'GitHub', gitlab: 'GitLab', apple: 'Apple', discord: 'Discord', azure: 'Microsoft' };
// Hinweis zu Datenschutz und Eigenverantwortung (bei Registrierung zu bestätigen, im Konto jederzeit nachlesbar)
export const NOTICE = `<div class="notice small">
  <p><b>⚠️ Experimentelles Hobbyprojekt.</b> IndooRado Online befindet sich im Aufbau und wird privat und ohne Gewinnabsicht betrieben. Die Nutzung erfolgt freiwillig und auf eigene Verantwortung, ohne Gewähr für Verfügbarkeit, Fehlerfreiheit oder dauerhaften Erhalt der Daten. Funktionen können sich jederzeit ändern oder eingestellt werden.</p>
  <p><b>Welche Daten?</b> Für das Konto: E-Mail-Adresse, Passwort (nur als verschlüsselter Hash), Anzeigename, Zeitpunkt der letzten Anmeldung. Nur wenn du den Abgleich nutzt: deine App-Daten (Einstellungen, Fahrten, Trainingspläne). Welche Fahrtwerte (z. B. Herzfrequenz, Leistung, GPS-Spur) hochgeladen werden, legst du im Konto selbst fest. Fotos der Fahrten werden nie im Konto gespeichert. Herzfrequenz ist ein Gesundheitswert: lade sie nur hoch, wenn du das möchtest.</p>
  <p><b>Wo?</b> Bei Supabase (Datenbank und Login) im Rechenzentrum der Projektregion; die Website liegt bei GitHub Pages. Deine Abgleichsdaten sind privat, auch der Betreiber sieht sie in der App nicht. Andere sehen nur deinen Anzeigenamen, bei Live-Fahrten Position, Tempo, W/kg und Avatar, in Bestenlisten Strecke und Zeit (abschaltbar).</p>
  <p><b>Deine Rechte.</b> Du kannst jederzeit festlegen, was hochgeladen wird, deine Online-Daten löschen und das Konto vollständig löschen (unten im Konto). Sichere wichtige Daten zusätzlich selbst (Einstellungen › App › Sicherung herunterladen).</p>
</div>`;

let off = null;
// Zustand, nach dem die Seite neu aufgebaut werden muss (nicht bei jedem Supabase-Ereignis)
const stateKey = () => [O.loggedIn(), O.needsMfa(), !!O.online.recovery, O.online.profile?.role, O.online.aal?.currentLevel].join('|');
const loading = (el, txt = 'Konto wird geladen …') => { if (!el.querySelector('.acc-loading')) el.innerHTML = `<div class="pageload acc-loading"><div class="spinner"></div><div class="small muted">${txt}</div></div>`; };
let lastKey = '';
export async function render(el) {
  off?.(); off = null;
  const tok = window.__routeTok, gone = () => tok !== window.__routeTok;
  if (!el.firstElementChild || el.querySelector('.pageload')) loading(el);
  await O.loadSiteConfig(); if (gone()) return;
  if (!O.configured()) return renderSetup(el);
  try { if (!O.online.ready) { loading(el, 'Verbinde …'); await O.initOnline(); } } catch (e) { el.innerHTML = `<section class="card"><h2>Verbindung fehlgeschlagen</h2><p class="muted">${esc(e.message)}</p></section>`; return; }
  if (gone()) return;
  lastKey = stateKey();
  off = bus.on('online', () => { if (document.body.contains(el) && stateKey() !== lastKey) render(el); });
  if (O.online.recovery && O.loggedIn()) return renderNewPassword(el);
  if (!O.loggedIn()) return renderAuth(el);
  if (O.needsMfa()) return renderMfaChallenge(el);
  return renderAccount(el);
}
export function leave() { off?.(); off = null; }

function renderSetup(el) {
  el.innerHTML = `
  <section class="pagehead"><h1>Konto</h1></section>
  <section class="card form"><h2>IndooRado Online einrichten</h2>
    <p class="muted">Mit einem Konto liegen deine Daten zusätzlich online, du fährst live mit anderen und erscheinst in Bestenlisten. Ohne Konto funktioniert alles wie bisher, nur lokal.</p>
    <p class="small muted">Für den Betreiber: Supabase-Projekt anlegen, das Datenbankschema ausführen, dann <code>online.json</code> neben die App legen oder hier eintragen.</p>
    <label class="f">Projekt-URL<input class="inp" id="cfgUrl" placeholder="https://xxxx.supabase.co"></label>
    <label class="f">Publishable bzw. anon Key<input class="inp" id="cfgKey" placeholder="sb_publishable_…"></label>
    <div class="row"><button class="btn pri" id="cfgSave">Speichern und verbinden</button></div>
  </section>`;
  $('#cfgSave', el).onclick = () => {
    const u = $('#cfgUrl', el).value, k = $('#cfgKey', el).value;
    if (!/^https:\/\/.+/.test(u.trim()) || k.trim().length < 20) return toast('Bitte URL (https://…) und Schlüssel eintragen', 3000);
    O.setConfig(u, k); O.online.ready = false; render(el);
  };
}

/* ---------- Passwort-Hilfen ---------- */
const RULES = [
  ['len', 'Mindestens 10 Zeichen', p => p.length >= 10],
  ['case', 'Groß- und Kleinbuchstaben', p => /[a-zäöü]/.test(p) && /[A-ZÄÖÜ]/.test(p)],
  ['num', 'Eine Zahl', p => /\d/.test(p)],
  ['sym', 'Ein Sonderzeichen', p => /[^A-Za-z0-9äöüÄÖÜß]/.test(p)],
];
const COMMON = /^(passwort|password|12345|qwertz|qwerty|indoorado|fahrrad|radfahren)/i;
function strength(p, mail = '') {
  let s = RULES.filter(r => r[2](p)).length + (p.length >= 14 ? 1 : 0);
  const local = (mail || '').split('@')[0].toLowerCase();
  if (COMMON.test(p) || (local.length > 2 && p.toLowerCase().includes(local))) s = Math.min(s, 1);
  return s; // 0..5
}
const pwField = (id, label, auto) => `<label class="f">${label}<span class="pwwrap"><input class="inp" id="${id}" type="password" autocomplete="${auto}"><button type="button" class="pweye" data-eye="${id}" aria-label="Passwort anzeigen">👁</button></span><small class="capswarn" data-caps="${id}" hidden>⇪ Feststelltaste ist an</small></label>`;
function wirePw(el) {
  el.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye, el); i.type = i.type === 'password' ? 'text' : 'password'; b.classList.toggle('on', i.type === 'text'); });
  el.querySelectorAll('input[type=password]').forEach(i => i.onkeyup = e => { const w = el.querySelector(`[data-caps="${i.id}"]`); if (w && e.getModifierState) w.hidden = !e.getModifierState('CapsLock'); });
}
const meter = () => `<div class="pwmeter"><i id="pwBar"></i></div><ul class="pwrules small">${RULES.map(([k, l]) => `<li data-r="${k}">${l}</li>`).join('')}</ul>`;
function updMeter(el, p, mail) {
  const s = strength(p, mail), cols = ['#ef4458', '#ef4458', '#ff8a3d', '#f5c542', '#4fd18b', '#4fd18b'], lbl = ['Sehr schwach', 'Schwach', 'Geht so', 'Gut', 'Stark', 'Sehr stark'];
  const bar = $('#pwBar', el); bar.style.width = (p ? 8 + s * 18.4 : 0) + '%'; bar.style.background = cols[s]; bar.title = lbl[s];
  for (const [k, , f] of RULES) el.querySelector(`[data-r="${k}"]`)?.classList.toggle('ok', f(p));
  return s;
}
const mailOk = m => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m);
const errText = e => { const m = e?.message || String(e); return /Invalid login credentials/.test(m) ? 'E-Mail oder Passwort falsch' : /Email not confirmed/.test(m) ? 'Bitte zuerst die E-Mail bestätigen (Link im Postfach)' : /rate limit|too many/i.test(m) ? 'Zu viele Versuche, bitte kurz warten' : /already registered|already been registered/i.test(m) ? 'Diese E-Mail hat schon ein Konto. Bitte anmelden.' : /weak|pwned|leaked/i.test(m) ? 'Dieses Passwort ist zu unsicher oder schon in Datenlecks aufgetaucht' : m; };

/* ---------- Anmelden / Registrieren ---------- */
function renderAuth(el, mode = 'in') {
  const provs = (O.config().providers || []).filter(p => PROV[p]);
  el.innerHTML = `
  <section class="pagehead"><h1>Konto</h1></section>
  <section class="authwrap">
    <div class="card form authcard">
      <div class="tabs2" id="aTabs"><button class="${mode === 'in' ? 'on' : ''}" data-t="in">Anmelden</button><button class="${mode === 'up' ? 'on' : ''}" data-t="up">Registrieren</button></div>
      <div id="aBody" class="form"></div>
    </div>
    <div class="card authinfo"><h2>Warum ein Konto?</h2><ul class="tips small">
      <li>☁️ Fahrten, Einstellungen und Fortschritt auf allen Geräten, ohne Konflikte zusammengeführt</li>
      <li>🌐 Live mit anderen auf derselben Strecke fahren</li>
      <li>🏆 Bestenlisten je Strecke</li>
      <li>🔐 Du bestimmst, was hochgeladen wird (z. B. ohne Puls)</li></ul>
      <p class="small muted">Ohne Konto bleibt alles wie bisher lokal in diesem Browser.</p>
      <details class="small"><summary>Hinweis zu Datenschutz und Nutzung</summary>${NOTICE}</details></div>
  </section>`;
  $('#aTabs', el).onclick = e => { const b = e.target.closest('[data-t]'); if (b) renderAuth(el, b.dataset.t); };
  const body = $('#aBody', el), oauthHtml = provs.length ? `<div class="oauth">${provs.map(p => `<button class="btn" data-oauth="${p}">Mit ${PROV[p]}</button>`).join('')}</div><div class="orline"><span>oder mit E-Mail</span></div>` : '';
  const keepHtml = `<label class="switch"><input type="checkbox" id="aKeep" ${O.remember() ? 'checked' : ''}><span></span> <div class="swt">Angemeldet bleiben<small class="muted">Auf diesem Gerät gespeichert, bis du dich abmeldest. Ohne Haken endet die Anmeldung beim Schließen des Browsers.</small></div></label>`;
  const keep = () => { const on = $('#aKeep', el)?.checked ?? true; O.setRemember(on); const m = $('#aMail', el)?.value.trim(); if (on && m) localStorage.setItem('vvLastEmail', m); else if (!on) localStorage.removeItem('vvLastEmail'); };
  const wireOauth = () => el.querySelectorAll('[data-oauth]').forEach(b => b.onclick = () => { keep(); if (mode === 'up') localStorage.setItem('vvWant2fa', '1'); O.oauth(b.dataset.oauth).catch(e => toast(errText(e), 5000)); });
  const err = e => toast(errText(e), 5000);

  if (mode === 'in') {
    body.innerHTML = `${oauthHtml}
      <label class="f">E-Mail<input class="inp" id="aMail" type="email" autocomplete="username email" value="${esc(localStorage.getItem('vvLastEmail') || '')}"></label>
      ${keepHtml}
      <div class="row"><button class="btn pri" id="aCode">✉️ Anmeldecode per E-Mail</button></div>
      <p class="small muted">Ohne Passwort: Du bekommst einen 6-stelligen Code, den du hier eingibst. Das klappt auch, wenn du die Mail auf dem Handy liest.</p>
      <details class="pwlogin" id="aPwBox"><summary>Lieber mit Passwort anmelden</summary>
        ${pwField('aPass', 'Passwort', 'current-password')}
        <div class="row"><button class="btn" id="aGo">Mit Passwort anmelden</button><button class="linkbtn small" id="aForgot">Passwort vergessen?</button></div>
      </details>`;
    wirePw(el); wireOauth();
    const mail = () => $('#aMail', el).value.trim();
    const go = async () => { const pass = $('#aPass', el).value; if (!mailOk(mail()) || !pass) return toast('E-Mail und Passwort eingeben', 2500); keep(); $('#aGo', el).disabled = true; try { await O.signIn(mail(), pass); toast('Angemeldet ✅', 1500); window.__loginUpd?.(); render(el); } catch (e) { err(e); $('#aGo', el).disabled = false; } };
    $('#aGo', el).onclick = go; $('#aPass', el).onkeydown = e => { if (e.key === 'Enter') go(); };
    $('#aCode', el).onclick = async e => {
      if (!mailOk(mail())) return toast('Erst eine gültige E-Mail eintragen', 2500); keep(); const b = e.target; b.disabled = true; b.innerHTML = '<span class="spinner sm"></span> Sende …';
      try { await O.withTimeout(O.emailCode(mail()), 25000, 'Mailversand'); codeEntry(el, mail()); }
      catch (er) { b.disabled = false; b.textContent = '✉️ Anmeldecode per E-Mail'; if (/Zeitüberschreitung/.test(er.message)) codeEntry(el, mail(), true); else toast(/signups not allowed|user not found|not.*registered/i.test(er.message) ? 'Zu dieser E-Mail gibt es noch kein Konto. Bitte zuerst registrieren.' : errText(er), 6000); }
    };
    $('#aMail', el).onkeydown = e => { if (e.key === 'Enter' && !$('#aPwBox', el).open) $('#aCode', el).click(); };
    $('#aForgot', el).onclick = async () => { if (!mailOk(mail())) return toast('Erst die E-Mail oben eintragen', 2500); try { await O.resetPassword(mail()); sent(el, mail(), 'Ein Link zum Zurücksetzen'); } catch (e) { err(e); } };
    $('#aMail', el).focus();
    return;
  }
  // Registrieren in drei Schritten
  const st = { step: 1, mail: '', name: profile.name && profile.name !== 'Fahrer' ? profile.name : '' };
  const steps = () => `<ol class="steps">${['Konto', 'Passwort', 'Bestätigen'].map((l, i) => `<li class="${st.step > i + 1 ? 'done' : st.step === i + 1 ? 'on' : ''}"><b>${st.step > i + 1 ? '✓' : i + 1}</b>${l}</li>`).join('')}</ol>`;
  const draw = () => {
    if (st.step === 1) {
      body.innerHTML = `${steps()}${oauthHtml}
        <label class="f">E-Mail<input class="inp" id="aMail" type="email" autocomplete="email" value="${esc(st.mail)}"><small class="fieldhint" id="mailHint"></small></label>
        <label class="f">Anzeigename <span class="muted small">(für andere sichtbar, nicht deine E-Mail)</span><input class="inp" id="aName" maxlength="30" autocomplete="nickname" value="${esc(st.name)}" placeholder="z. B. Alex R."></label>
        <div class="row end"><button class="btn pri" id="aNext" disabled>Weiter</button></div>`;
      wireOauth();
      const chk = () => { const m = $('#aMail', el).value.trim(), ok = mailOk(m); $('#mailHint', el).textContent = !m ? '' : ok ? '✓' : 'Bitte eine gültige E-Mail-Adresse'; $('#mailHint', el).className = 'fieldhint ' + (ok ? 'ok' : m ? 'bad' : ''); $('#aNext', el).disabled = !ok || !$('#aName', el).value.trim(); };
      $('#aMail', el).oninput = chk; $('#aName', el).oninput = chk; chk(); $('#aMail', el).focus();
      const next = () => { if ($('#aNext', el).disabled) return; st.mail = $('#aMail', el).value.trim(); st.name = $('#aName', el).value.trim(); st.step = 2; draw(); };
      $('#aNext', el).onclick = next; $('#aName', el).onkeydown = e => { if (e.key === 'Enter') next(); };
    } else if (st.step === 2) {
      body.innerHTML = `${steps()}
        <p class="small muted">Konto für <b>${esc(st.mail)}</b> · <button class="linkbtn" id="aBack">ändern</button></p>
        ${pwField('aPass', 'Passwort', 'new-password')}${meter()}
        ${pwField('aPass2', 'Passwort wiederholen', 'new-password')}<small class="fieldhint" id="matchHint"></small>
        <details class="small"><summary>Hinweis zu Datenschutz und Nutzung lesen</summary>${NOTICE}<p><a href="#/legal/datenschutz" target="_blank">Vollständige Datenschutzerklärung</a> · <a href="#/legal/nutzung" target="_blank">Nutzungshinweise</a></p></details>
        <label class="switch"><input type="checkbox" id="aOk"><span></span> <div class="swt">Ich habe den Hinweis gelesen und nutze IndooRado Online freiwillig und auf eigene Verantwortung</div></label>
        <label class="switch"><input type="checkbox" id="aHr"><span></span> <div class="swt">Ich willige ein, dass meine Herzfrequenz mit meinen Fahrten in meinem Konto gespeichert wird <small class="muted">Puls zählt als Gesundheitsdatum (Art. 9 DSGVO). Freiwillig und jederzeit unter Konto › Was online gespeichert wird widerrufbar. Ohne Einwilligung bleibt der Puls nur auf deinen Geräten. Tipp: Mit der Tresor-Verschlüsselung kann auch Supabase ihn nicht lesen.</small></div></label>
        <label class="switch"><input type="checkbox" id="a2fa" checked><span></span> <div class="swt"><i style="font-style:normal">Zwei-Faktor-Anmeldung (2FA) einrichten <b class="prtag">empfohlen</b></i><small class="muted">Schützt dein Konto, auch wenn jemand dein Passwort kennt. Direkt nach der ersten Anmeldung verbindest du eine Authenticator-App (z. B. Google/Microsoft Authenticator, 1Password, Aegis). Dauert etwa eine Minute.</small></div></label>
        ${keepHtml}
        <div class="row end createrow"><small class="fieldhint" id="createHint"></small><button class="btn pri" id="aCreate" disabled>Konto anlegen</button></div>`;
      wirePw(el);
      let busy = false;
      const chk = () => { const p = $('#aPass', el).value, p2 = $('#aPass2', el).value, s = updMeter(el, p, st.mail), m = p2 && p === p2; $('#matchHint', el).textContent = p2 ? (m ? '✓ stimmt überein' : 'stimmt noch nicht überein') : ''; $('#matchHint', el).className = 'fieldhint ' + (p2 ? (m ? 'ok' : 'bad') : ''); const ok = $('#aOk', el).checked, pwOk = p.length >= 10 && s >= 3;
        $('#aCreate', el).disabled = !(pwOk && m && ok) || busy;
        // Zeigen, was noch fehlt (der Knopf geht erst, wenn alles passt, auch der Hinweis bestätigt ist)
        $('#createHint', el).textContent = busy ? '' : !pwOk ? 'Passwort noch zu schwach' : !m ? 'Passwörter stimmen nicht überein' : !ok ? 'Bitte erst den Hinweis bestätigen' : '';
        $('#aOk', el).closest('.switch').classList.toggle('need', pwOk && m && !ok); };
      for (const id of ['aPass', 'aPass2']) $('#' + id, el).addEventListener('input', chk); $('#aOk', el).onchange = chk; chk(); $('#aPass', el).focus();
      $('#aBack', el).onclick = () => { st.step = 1; draw(); };
      $('#aCreate', el).onclick = async () => {
        if (!$('#aOk', el).checked || busy) return;
        keep(); busy = true; const b = $('#aCreate', el); b.disabled = true; b.innerHTML = '<span class="spinner sm"></span> Konto wird angelegt …';
        for (const id of ['aPass', 'aPass2', 'aOk', 'aBack']) { const x = $('#' + id, el); if (x) x.disabled = true; }
        localStorage.setItem('vvHrConsent', $('#aHr', el).checked ? new Date().toISOString() : '0');
        if ($('#a2fa', el).checked) localStorage.setItem('vvWant2fa', '1'); else localStorage.removeItem('vvWant2fa');
        const done = () => { localStorage.setItem('vvLastEmail', st.mail); localStorage.setItem('vvNoticeOk', new Date().toISOString()); st.step = 3; draw(); };
        try {
          // Der Server wartet, bis die Bestätigungsmail verschickt ist; das kann dauern. Spätestens nach 25 s geht es weiter.
          await O.withTimeout(O.signUp(st.mail, $('#aPass', el).value, st.name), 25000, 'Registrierung');
          done();
        } catch (e) {
          if (/Zeitüberschreitung/.test(e.message)) { st.slow = true; done(); return; }
          busy = false; b.textContent = 'Konto anlegen'; for (const id of ['aPass', 'aPass2', 'aOk', 'aBack']) { const x = $('#' + id, el); if (x) x.disabled = false; }
          err(e); chk();
        }
      };
    } else {
      body.innerHTML = `${steps()}<div class="sentbox"><div class="big">📬</div><h2>Fast geschafft!</h2><p>Wir haben dir an <b>${esc(st.mail)}</b> einen Bestätigungslink geschickt. Öffne ihn auf diesem Gerät, dann bist du angemeldet.</p>${localStorage.getItem('vvWant2fa') === '1' ? '<p class="small muted">🔐 Danach richten wir gleich die Zwei-Faktor-Anmeldung ein – halte eine Authenticator-App bereit.</p>' : ''}${st.slow ? '<p class="small" style="color:var(--warn)">Der Server hat sehr lange gebraucht. Das Konto ist wahrscheinlich trotzdem angelegt: Schau in dein Postfach. Kommt nichts an, in einer Minute erneut senden.</p>' : ''}<p class="small muted">Nichts angekommen? Spam-Ordner prüfen oder in einer Minute erneut senden.</p>
        <div class="row" style="justify-content:center"><button class="btn" id="aResend" disabled>Erneut senden (60)</button><button class="btn ghost" id="aToLogin">Zur Anmeldung</button></div></div>`;
      cooldown($('#aResend', el), 60, 'Erneut senden');
      $('#aResend', el).onclick = async e => { try { await O.resendSignup(st.mail); toast('Erneut gesendet'); cooldown(e.target, 60, 'Erneut senden'); } catch (er) { err(er); } };
      $('#aToLogin', el).onclick = () => renderAuth(el, 'in');
    }
  };
  draw();
}
// Code aus der Mail eingeben (6 Ziffern; Einfügen und Autofill des Geräts funktionieren)
function codeEntry(el, mail, slow = false) {
  $('#aBody', el).innerHTML = `<div class="sentbox"><div class="big">✉️</div><h2>Code eingeben</h2>
    <p>Wir haben einen Anmeldecode an <b>${esc(mail)}</b> geschickt.${slow ? ' <span class="small" style="color:var(--warn)">(Der Versand dauerte ungewöhnlich lange, die Mail kommt vermutlich trotzdem.)</span>' : ''}</p>
    <input class="inp codeinp" id="cCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="${'•'.repeat(+localStorage.getItem('vvOtpLen') || 8)}" aria-label="Anmeldecode">
    <div class="row" style="justify-content:center"><button class="btn pri" id="cGo" disabled>Anmelden</button></div>
    <p class="small muted">Der Code gilt etwa eine Stunde. Alternativ den Link in der Mail auf diesem Gerät öffnen. Nichts angekommen? Spam-Ordner prüfen.</p>
    <div class="row" style="justify-content:center"><button class="btn sm" id="cResend" disabled>Neuen Code senden (60)</button><button class="btn sm ghost" id="cBack">Andere E-Mail</button></div></div>`;
  const inp = $('#cCode', el), go = $('#cGo', el);
  cooldown($('#cResend', el), 60, 'Neuen Code senden');
  const verify = async () => {
    const code = inp.value.replace(/\D/g, ''); if (code.length < 6) return;
    go.disabled = true; inp.disabled = true; go.innerHTML = '<span class="spinner sm"></span> Prüfe …';
    try { await O.verifyCode(mail, code); localStorage.setItem('vvLastEmail', mail); localStorage.setItem('vvOtpLen', String(code.length)); toast('Angemeldet ✅', 1500); window.__loginUpd?.(); render(el); }
    catch (e) { inp.disabled = false; go.textContent = 'Anmelden'; go.disabled = false; inp.select(); toast(/expired|invalid|token/i.test(e.message) ? 'Code falsch oder abgelaufen' : errText(e), 5000); }
  };
  // Automatisch prüfen erst bei voller Länge (E-Mail-Codes haben bei Supabase meist 8 Ziffern; gelernt aus der letzten Anmeldung)
  const want = +localStorage.getItem('vvOtpLen') || 8;
  inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 10); go.disabled = inp.value.length < 6; if (inp.value.length === want) verify(); };
  inp.onkeydown = e => { if (e.key === 'Enter') verify(); };
  go.onclick = verify;
  $('#cResend', el).onclick = async e => { try { await O.emailCode(mail); toast('Neuer Code gesendet'); cooldown(e.target, 60, 'Neuen Code senden'); } catch (er) { toast(errText(er), 5000); } };
  $('#cBack', el).onclick = () => renderAuth(el, 'in');
  inp.focus();
}
function cooldown(b, s, label) { b.disabled = true; const t = setInterval(() => { s--; b.textContent = `${label} (${s})`; if (s <= 0) { clearInterval(t); b.disabled = false; b.textContent = label; } }, 1000); }
function sent(el, mail, what) {
  $('#aBody', el).innerHTML = `<div class="sentbox"><div class="big">📬</div><h2>Schau ins Postfach</h2><p>${what} an <b>${esc(mail)}</b> ist unterwegs. Öffne ihn auf diesem Gerät.</p><div class="row" style="justify-content:center"><button class="btn ghost" id="aToLogin">Zurück</button></div></div>`;
  $('#aToLogin', el).onclick = () => renderAuth(el, 'in');
}

/* ---------- Nach "Passwort vergessen": neues Passwort setzen ---------- */
function renderNewPassword(el) {
  el.innerHTML = `<section class="pagehead"><h1>Neues Passwort</h1></section>
  <section class="card form authcard"><p class="muted">Du kommst über den Link zum Zurücksetzen. Lege jetzt ein neues Passwort fest.</p>
    ${pwField('nPass', 'Neues Passwort', 'new-password')}${meter()}${pwField('nPass2', 'Wiederholen', 'new-password')}
    <div class="row end"><button class="btn pri" id="nGo" disabled>Passwort speichern</button></div></section>`;
  wirePw(el);
  const chk = () => { const p = $('#nPass', el).value, s = updMeter(el, p, O.online.user?.email); $('#nGo', el).disabled = !(p.length >= 10 && s >= 3 && p === $('#nPass2', el).value); };
  $('#nPass', el).oninput = chk; $('#nPass2', el).oninput = chk;
  $('#nGo', el).onclick = async () => { try { if (await changePw($('#nPass', el).value)) { toast('Passwort geändert ✅'); render(el); } } catch (e) { toast(errText(e), 5000); } };
}
// Passwort ändern, bei Bedarf mit Code per E-Mail (Supabase "Secure password change")
async function changePw(pw) {
  let r = await O.updatePassword(pw);
  if (r === 'reauth') {
    await O.reauthenticate();
    let code = ''; const p = dialog({ title: 'Code aus der E-Mail', html: '<p class="muted small">Zur Sicherheit haben wir dir einen Bestätigungscode geschickt.</p><input class="inp otp" id="rCode" inputmode="numeric" maxlength="8" placeholder="123456">', buttons: [{ label: 'Abbrechen', value: null }, { label: 'Bestätigen', value: 'ok', cls: 'pri' }] });
    const i = document.getElementById('rCode'); i.focus(); i.oninput = () => code = i.value.trim();
    if (await p !== 'ok' || !code) return false;
    r = await O.updatePassword(pw, code);
  }
  return r === 'ok';
}

async function renderMfaChallenge(el) {
  const f = (await O.mfaFactors()).find(x => x.status === 'verified');
  el.innerHTML = `<section class="pagehead"><h1>Konto</h1></section>
  <section class="card form authcard"><h2>Zweiter Faktor</h2><p class="muted">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
    <input class="inp otp" id="mCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456">
    <div class="row"><button class="btn pri" id="mGo">Bestätigen</button><button class="btn ghost" id="mOut">Abmelden</button></div></section>`;
  $('#mCode', el).focus();
  let busy = false;
  const go = async () => { if (busy) return; busy = true; try { await O.mfaVerify(f.id, $('#mCode', el).value); toast('Angemeldet ✅'); render(el); } catch (e) { toast('Code ungültig', 3000); } busy = false; };
  $('#mGo', el).onclick = go; $('#mCode', el).onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#mCode', el).oninput = e => { if (e.target.value.replace(/\D/g, '').length === 6) go(); };
  $('#mOut', el).onclick = async () => { await O.signOut(); render(el); };
}

/* ---------- Angemeldet ---------- */
async function renderAccount(el) {
  const tok = window.__routeTok;
  loading(el);
  // alles parallel laden, die 2FA-Liste kurz zwischenspeichern
  const [factors, S, OS] = await Promise.all([O.mfaFactorsCached().catch(() => []), import('../sync.js'), import('../online/sync.js'), O.refreshProfile().catch(() => { })]);
  if (tok !== window.__routeTok) return;
  document.body.classList.toggle('is-admin', O.isAdmin() && !O.needsMfa());
  const u = O.online.user, p = O.online.profile || {}, verified = factors.filter(f => f.status === 'verified'), stale = factors.filter(f => f.status !== 'verified');
  // Einwilligung aus der Registrierung übernehmen (einmalig nach der ersten Anmeldung)
  { const c = localStorage.getItem('vvHrConsent'); if (c != null) { await OS.setPrefs({ hr: c !== '0', hrConsentAt: c !== '0' ? c : null }).catch(() => { }); localStorage.removeItem('vvHrConsent'); } }
  const P = await OS.prefs(), lv = levelOf(progress.xp).lv;
  const devs = Object.entries(S.sync.devices || {}).sort((a, b) => (b[1].last || '').localeCompare(a[1].last || ''));
  const aal2 = O.online.aal?.currentLevel === 'aal2';
  const opt = (k, l, hint) => `<label class="switch"><input type="checkbox" data-pref="${k}" ${P[k] ? 'checked' : ''}><span></span> <div class="swt">${l}${hint ? `<small class="muted">${hint}</small>` : ''}</div></label>`;
  el.innerHTML = `
  <section class="pagehead"><h1>Konto</h1></section>
  <section class="card acchero">
    <div class="acchead">${avatarSvg(profile, 64)}<div class="accwho"><b>${esc(p.display_name || profile.name || 'Fahrer')}</b><small class="muted">${esc(u.email || u.id)}</small>
      <div class="accchips">${p.role === 'admin' ? '<span class="prtag">Admin</span>' : ''}<span class="accchip ${verified.length ? 'ok' : 'warn'}">${verified.length ? '🔐 2FA an' : '⚠️ 2FA aus'}</span><span class="accchip" id="accVaultChip">🔒 Tresor …</span><span class="accchip ${S.sync.error ? 'warn' : 'ok'}">${S.sync.error ? '⚠️ Abgleich gestört' : '↻ ' + (S.sync.last ? new Date(S.sync.last).toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie abgeglichen')}</span></div></div></div>
    <div class="row accact">${O.isAdmin() ? '<a class="btn sm" href="#/admin">🛠️ Admin-Konsole</a>' : ''}<button class="btn sm ghost" id="aOut">↩︎ Abmelden</button></div>
  </section>
  <nav class="accnav" aria-label="Bereiche des Kontos">${[['accProfile', '👤 Profil'], ['accData', '☁️ Daten & Tresor'], ['accSec', '🛡️ Sicherheit'], ['accDiag', '📶 Verbindung'], ['accDel', '🗑️ Löschen']].map(([id, l]) => `<button class="accnavb" data-acc="${id}">${l}</button>`).join('')}</nav>
  ${(() => { const A = O.access(); if (A.banned) return '<section class="card accbox bad"><b>⛔ Dein Online-Zugang ist gesperrt.</b><p class="small muted">Abgleich und Live-Fahrten sind aus. Deine Daten auf diesem Gerät bleiben unberührt. Du kannst dein Konto unten löschen.</p></section>';
    if (A.trial && A.ok) return `<section class="card accbox"><b>🧪 Testphase: noch ${A.daysLeft} ${A.daysLeft === 1 ? 'Tag' : 'Tage'}</b> <span class="small muted">(bis ${new Date(A.until).toLocaleDateString(document.documentElement.lang)})</span><p class="small muted">Alles funktioniert schon. Damit dein Online-Zugang danach bestehen bleibt, muss ein Admin dein Konto freischalten. Deine Daten auf diesem Gerät bleiben in jedem Fall erhalten.</p></section>`;
    if (A.trial && !A.ok) return '<section class="card accbox bad"><b>⏳ Testphase abgelaufen, Freischaltung ausstehend.</b><p class="small muted">Bis ein Admin dein Konto freischaltet, sind Online-Abgleich und Live-Fahrten pausiert. Die App funktioniert lokal ganz normal weiter, und nichts geht verloren.</p></section>';
    return ''; })()}
  <h2 class="accsec" id="accProfile">👤 Profil</h2>
  <section class="grid2">
    <div class="card form"><h2>Wie andere dich sehen</h2>
      <label class="f">Anzeigename (für andere sichtbar)<input class="inp" id="pName" maxlength="30" value="${esc(p.display_name || profile.name)}"></label>
      <label class="switch"><input type="checkbox" id="pPub" ${p.public_profile !== false ? 'checked' : ''}><span></span> <div class="swt">Für andere sichtbar<small class="muted">In Bestenlisten und als Live-Mitfahrer. Aus = du fährst unsichtbar.</small></div></label>
      <label class="f">Avatar für andere<select class="inp" id="pAvMode"><option value="random" ${profile.onlineAvatar !== 'own' ? 'selected' : ''}>Zufällig zusammengestellt (neu je Sitzung)</option><option value="own" ${profile.onlineAvatar === 'own' ? 'selected' : ''}>Mein eigener Avatar</option></select></label>
      <div class="row"><button class="btn sm pri" id="pSave">Speichern</button><a class="btn sm ghost" href="#/avatar">🎨 Avatar gestalten</a></div>
    </div>
    <div class="card form"><h2>Freunde & Erreichbarkeit</h2>
      <p class="small muted">Wer dich finden, anrufen und dir schreiben darf und ob Freunde deine Fahrten sehen, stellst du bei den Freunden ein.</p>
      <div class="row"><a class="btn sm" href="#/notify">🔔 Benachrichtigungen & Privatsphäre</a></div>
    </div>
  </section>
  <h2 class="accsec" id="accData">☁️ Daten & Tresor</h2>
  <section class="grid2">
    <div class="card form"><h2>Abgleich zwischen Geräten</h2>
      <p class="small muted">Solange du angemeldet bist, gleicht die App automatisch über dein Konto ab${S.nasPaused() ? ' und der Abgleich mit ' + esc(S.providerName(S.sync.cfg.mode)) + ' pausiert (bis auf die Fotos)' : ''}. Einstellungen: die neuere Änderung gewinnt. Fahrten: werden nur ergänzt. Gelöschtes verschwindet überall.</p>
      <p class="small">📷 Fotos der Fahrten: ${S.photoTarget() ? `werden nur in <b>${esc(S.photoTarget())}</b> gespeichert und zu den Fahrten aus dem Konto nachgeladen${S.sync.extError ? ` · <span style="color:var(--hr)">${esc(S.sync.extError)}</span>` : S.sync.extNeedLogin ? ' · <span style="color:var(--hr)">Anmeldung dort nötig (Einstellungen › App &amp; Daten)</span>' : ''}` : 'bleiben nur auf diesem Gerät. Sie werden nie im Konto gespeichert. Verbinde unter Einstellungen › App &amp; Daten ein NAS, OneDrive, Google Drive oder Dropbox, damit sie auf deinen anderen Geräten erscheinen.'}</p>
      <p class="small">Zuletzt: <b>${S.sync.last ? new Date(S.sync.last).toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie'}</b>${S.sync.error ? ` · <span style="color:var(--hr)">${esc(S.sync.error)}</span>` : ''}</p>
      ${devs.length ? `<div class="small devlist">${devs.map(([id, d]) => `<div class="row between"><span>${id === S.sync.device?.id ? '📍 ' : '💻 '}${esc(d.name)}${id === S.sync.device?.id ? ' <span class="muted">(dieses Gerät)</span>' : ''}</span><span class="row" style="gap:8px"><span class="muted">${d.last ? new Date(d.last).toLocaleDateString(document.documentElement.lang) : ''}</span>${id === S.sync.device?.id ? '' : `<button class="btn xs ghost danger" data-devrm="${esc(id)}" data-devname="${esc(d.name)}" title="Gerät entfernen und dort abmelden">✕</button>`}</span></div>`).join('')}</div>` : ''}
      <div class="row"><button class="btn sm pri" id="sNow">↻ Jetzt abgleichen</button><button class="btn sm ghost" id="sPull" title="Bei Abweichungen gewinnt der Stand im Konto">Alles aus dem Konto übernehmen</button></div>
    </div>
    <section class="card form vaultcard" id="vaultCard"><h2>🔐 Tresor-Verschlüsselung <span class="prtag">empfohlen</span></h2><div id="vaultBody"><div class="small muted">Wird geprüft …</div></div></section>
  </section>
  <section class="card form"><h2>Was online gespeichert wird</h2>
    <p class="small muted">Dein Speicher im Konto ist privat: Nur du kommst an diese Daten, auch Admins nicht. Für Bestenlisten wird nur eine Zusammenfassung geteilt (Name, Strecke, Zeit).</p>
    <div class="grid2 tight">
      <label class="f">Fahrten<select class="inp" id="prRides">${[['full', 'Vollständig mit Verlauf'], ['summary', 'Nur Zusammenfassung (ohne Verlauf)'], ['none', 'Gar nicht hochladen']].map(([v, l]) => `<option value="${v}" ${P.rides === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="form">${opt('hr', 'Herzfrequenz (Einwilligung)', 'Puls ist ein Gesundheitsdatum. Ein = du willigst in die Speicherung im Konto ein, Aus = Widerruf, bereits hochgeladene Pulsdaten bleiben bis zum Löschen der Online-Daten.')}${opt('cad', 'Trittfrequenz')}${opt('power', 'Leistung')}${opt('gps', 'Virtuelle GPS-Spur')}<p class="small muted">Fotos der Fahrten werden nie online gespeichert, nur auf dem Gerät und in deinem eigenen Speicher (NAS/Cloud).</p></div>
    </div>
    ${opt('leaderboard', 'An Bestenlisten teilnehmen', 'Zusammenfassung je Fahrt: Strecke, Distanz, Zeit, Höhenmeter' + (P.power ? ', Ø Watt' : '') + '. Aus = vorhandene Einträge werden entfernt.')}
    <p class="small muted">Gilt ab jetzt für neu hochgeladene Fahrten. Bereits hochgeladene bleiben, bis du unten die Online-Daten löschst.</p>
  </section>
  <h2 class="accsec" id="accSec">🛡️ Sicherheit</h2>
  <section class="card form"><h2>Anmeldung</h2>
    <div class="secgrid">
      <div class="form"><h3 class="sub">Passwort ändern</h3><p class="small muted">Altes Passwort vergessen? <button class="linkbtn" id="cMail">Link zum Zurücksetzen an ${esc(u.email || '')} senden</button></p>${pwField('cOld', 'Aktuelles Passwort', 'current-password')}${pwField('cNew', 'Neues Passwort', 'new-password')}${meter()}<div class="row"><button class="btn sm" id="cGo" disabled>Passwort ändern</button></div></div>
      <div class="form"><h3 class="sub">E-Mail ändern</h3><label class="f">Neue E-Mail<input class="inp" id="eNew" type="email" autocomplete="email"></label><div class="row"><button class="btn sm" id="eGo">Ändern</button></div><p class="small muted">Wird erst nach Bestätigung per Link wirksam.</p>
        <h3 class="sub">Sitzungen</h3><div class="row"><button class="btn sm ghost" id="soOthers">Andere Geräte abmelden</button><button class="btn sm ghost" id="soAll">Überall abmelden</button></div></div>
    </div>
    <h3 class="sub">Zwei-Faktor-Anmeldung (2FA)</h3>
    ${verified.length ? `<div class="small factorlist">${verified.map(f => `<div class="row between"><span>🔐 ${esc(f.friendly_name || 'Authenticator-App')} <span class="muted">seit ${new Date(f.created_at).toLocaleDateString(document.documentElement.lang)}</span></span><button class="btn xs ghost danger" data-unenroll="${esc(f.id)}">Entfernen</button></div>`).join('')}</div>${aal2 ? '' : '<p class="small muted">Zum Entfernen erst mit dem Code bestätigen.</p>'}` : `<p class="small muted">Noch nicht eingerichtet.${O.isAdmin() ? ' <b>Für die Admin-Konsole Pflicht.</b>' : ''} Empfohlen: Google Authenticator, Microsoft Authenticator, 1Password oder Aegis.</p>`}
    ${verified.length === 1 ? '<p class="small warn">💡 Ersatz einrichten: Füge einen zweiten Authenticator hinzu (z. B. auf einem Tablet oder in einem Passwortmanager). Geht das Handy verloren, kommst du damit weiter ins Konto. Sonst hilft nur noch der Admin.</p>' : ''}
    <div class="row"><button class="btn sm ${verified.length ? 'ghost' : 'pri'}" id="mOn">${verified.length ? '+ Weitere App hinzufügen' : '2FA einrichten'}</button></div><div id="mWant"></div><div id="mBox"></div>
  </section>
  <h2 class="accsec" id="accDiag">📶 Verbindung</h2>
  <section class="card form"><div class="row between"><h2>Verbindungstest</h2><button class="btn sm" id="dgGo">Test starten</button></div><p class="small muted">Prüft Schritt für Schritt Anmeldung, Profil, Zugang, Admin, Speicher und Live-Kanäle mit Dauer und genauer Fehlermeldung.</p><div id="dgOut" class="dglist small"></div></section>
  <section class="card form" id="clCard"><div class="row between"><h2>📶 Verbindungsprotokoll</h2><span class="row"><select class="inp sm" id="clMin"><option value="10">10 min</option><option value="30" selected>30 min</option><option value="60">60 min</option><option value="120">2 h</option></select><button class="btn sm pri" id="clGo">Langzeittest starten</button></span></div>
    <p class="small muted">Läuft immer im Hintergrund mit (auch während der Fahrt) und hält jeden Abriss mit Uhrzeit und Grund fest. Der Langzeittest fragt zusätzlich alle 10 Sekunden beim Server an und misst die Antwortzeit. Alles bleibt nur auf diesem Gerät.</p>
    <div class="kpis" id="clKpi"></div><div class="cllog" id="clLog"></div>
    <div class="row"><button class="btn sm" id="clCopy">📋 Protokoll kopieren</button><button class="btn sm ghost" id="clClear">Leeren</button></div></section>
  <h2 class="accsec" id="accDel">🗑️ Datenschutz & Löschen</h2>
  <section class="card"><details><summary><b>Hinweis zu Datenschutz und Nutzung</b></summary>${NOTICE}</details></section>
  <section class="card form dangerzone"><h2>Daten und Konto löschen</h2>
    <div class="row"><button class="btn sm ghost danger" id="dData">Online-Daten löschen</button><button class="btn sm danger" id="dAcc">Konto löschen</button></div>
    <p class="small muted">„Online-Daten löschen“ entfernt alles im Konto, die Daten auf diesem Gerät bleiben. „Konto löschen“ entfernt zusätzlich Login und Profil endgültig.</p>
  </section>`;
  wirePw(el);
  // Sprungleiste: zum Abschnitt scrollen
  el.querySelector('.accnav').onclick = e => { const b = e.target.closest('[data-acc]'); if (b) el.querySelector('#' + b.dataset.acc)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#aOut', el).onclick = async () => { await O.signOut(); window.__loginUpd?.(); render(el); };
  $('#pSave', el).onclick = async () => { try { await O.updateProfile({ display_name: $('#pName', el).value.trim().slice(0, 30) || 'Fahrer', public_profile: $('#pPub', el).checked, avatar: { jersey: profile.jersey, helmet: profile.helmet, bikeColor: profile.bikeColor, skin: profile.skin, av: profile.av }, level: lv }); toast('Gespeichert'); window.__loginUpd?.(); } catch (e) { toast(e.message, 4000); } };
  vaultUi(el, S);
  $('#sNow', el).onclick = async e => { e.target.disabled = true; await S.pushNow(); await OS.pushRides().catch(() => { }); toast(S.sync.error ? 'Fehler: ' + S.sync.error : 'Abgeglichen ✅', 3000); render(el); };
  $('#sPull', el).onclick = async () => { if (!(await dialog({ title: 'Stand aus dem Konto übernehmen?', html: '<p class="muted">Bei Abweichungen gewinnt der Stand im Konto. Fahrten dieses Geräts bleiben erhalten.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', value: true, cls: 'pri' }] }))) return; await S.pullNow(); if (S.sync.error) return toast(S.sync.error, 5000); toast('Übernommen, App lädt neu'); setTimeout(() => location.reload(), 1000); };
  el.querySelectorAll('[data-pref]').forEach(c => c.onchange = async () => { await OS.setPrefs({ [c.dataset.pref]: c.checked, ...(c.dataset.pref === 'hr' ? { hrConsentAt: c.checked ? new Date().toISOString() : null } : {}) }); if (c.dataset.pref === 'leaderboard') OS.pushRides().catch(() => { }); toast('Gespeichert', 900); });
  $('#prRides', el).onchange = async e => { await OS.setPrefs({ rides: e.target.value }); toast('Gespeichert', 900); };
  // Passwort
  const chk = () => { const s = updMeter(el, $('#cNew', el).value, u.email); $('#cGo', el).disabled = !($('#cOld', el).value && $('#cNew', el).value.length >= 10 && s >= 3); };
  $('#cOld', el).addEventListener('input', chk); $('#cNew', el).addEventListener('input', chk);
  $('#cGo', el).onclick = async () => { try { await O.verifyPassword($('#cOld', el).value); if (await changePw($('#cNew', el).value)) { toast('Passwort geändert ✅'); $('#cOld', el).value = $('#cNew', el).value = ''; chk(); } } catch (e) { toast(errText(e), 5000); } };
  $('#pAvMode', el).onchange = async e => { profile.onlineAvatar = e.target.value; saveProfile(); (await import('../online/presence.js')).setStatus({}); toast('Gespeichert', 900); };
  // Verbindungsprotokoll
  { const CL = await import('../online/connlog.js'), fmt = t => new Date(t).toLocaleString(document.documentElement.lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ico = { ok: '🟢', info: '⚪', warn: '🟠', bad: '🔴' };
    const draw = () => {
      if (!el.isConnected || !$('#clLog', el)) { off(); return; }
      const all = CL.entries(), day = all.filter(x => x.t > Date.now() - 864e5), drops = day.filter(x => x.lvl === 'bad').length, T = CL.test;
      $('#clKpi', el).innerHTML = [[drops, 'Störungen (24 h)'], [day.filter(x => x.src === 'Server' && x.lvl === 'ok').length, 'Neuverbindungen (24 h)'], [CL.heartbeatsOk(), 'Herzschläge ok (seit Start)'], ...(T.on || T.n ? [[`${T.n - T.fail}/${T.n}`, T.on ? `Test läuft · noch ${Math.max(0, Math.ceil((T.until - Date.now()) / 60e3))} min` : 'letzter Test ok'], [T.n - T.fail ? Math.round(T.sum / (T.n - T.fail)) + ' ms' : '–', 'Ø Antwortzeit']] : [])].map(([v, l]) => `<div class="kpi"><b class="num">${v}</b><span>${l}</span></div>`).join('');
      $('#clLog', el).innerHTML = all.slice(-80).reverse().map(x => `<div class="clrow ${x.lvl}"><span>${ico[x.lvl] || '⚪'}</span><span class="num">${fmt(x.t)}</span><b>${esc(x.src)}</b><span>${esc(x.msg)}</span></div>`).join('') || '<p class="muted small">Noch keine Einträge.</p>';
      $('#clGo', el).textContent = T.on ? 'Test stoppen' : 'Langzeittest starten';
    };
    const off = CL.onChange(draw); const iv = setInterval(() => el.isConnected ? draw() : clearInterval(iv), 15000); draw();
    $('#clGo', el).onclick = () => { if (CL.test.on) CL.stopTest(); else CL.startTest(+$('#clMin', el).value, O.client); draw(); };
    $('#clClear', el).onclick = () => CL.clear();
    $('#clCopy', el).onclick = async () => { const txt = CL.entries().map(x => `${fmt(x.t)}\t${x.lvl}\t${x.src}\t${x.msg}`).join('\n'); try { await navigator.clipboard.writeText(txt); toast('Protokoll kopiert – du kannst es mir einfach schicken'); } catch (e) { toast('Kopieren nicht möglich'); } };
  }
  $('#dgGo', el).onclick = async e => {
    const out = $('#dgOut', el); out.innerHTML = ''; e.target.disabled = true;
    await O.diagnose(r => { out.insertAdjacentHTML('beforeend', `<div class="row between dgrow ${r.ok ? 'ok' : 'bad'}"><span>${r.ok ? '✅' : '❌'} ${esc(r.name)}</span><span class="muted">${esc(String(r.info ?? ''))} · ${r.ms} ms</span></div>`); });
    e.target.disabled = false;
  };
  $('#cMail', el).onclick = async e => { try { await O.resetPassword(u.email); toast('Link ist unterwegs. Öffne ihn auf diesem Gerät, dann kannst du ein neues Passwort setzen.', 6000); e.target.disabled = true; } catch (err) { toast(errText(err), 5000); } };
  $('#eGo', el).onclick = async () => { const m = $('#eNew', el).value.trim(); if (!mailOk(m)) return toast('Bitte eine gültige E-Mail', 2500); try { await O.updateEmail(m); toast('Bestätigungslink verschickt, die Änderung gilt nach dem Klick darauf', 5000); } catch (e) { toast(errText(e), 5000); } };
  $('#soOthers', el).onclick = async () => { try { await O.signOut('others'); toast('Andere Geräte abgemeldet'); } catch (e) { toast(e.message, 4000); } };
  $('#soAll', el).onclick = async () => { await O.signOut('global'); window.__loginUpd?.(); toast('Überall abgemeldet'); render(el); };
  // 2FA
  el.querySelectorAll('[data-unenroll]').forEach(b => b.onclick = async () => {
    if (!aal2) { const f = verified[0]; let code = ''; const pr = dialog({ title: 'Mit Code bestätigen', html: '<input class="inp otp" id="uCode" inputmode="numeric" maxlength="7" placeholder="123 456">', buttons: [{ label: 'Abbrechen', value: null }, { label: 'Bestätigen', value: 'ok', cls: 'pri' }] }); const i = document.getElementById('uCode'); i.focus(); i.oninput = () => code = i.value; if (await pr !== 'ok') return; try { await O.mfaVerify(f.id, code); } catch (e) { return toast('Code ungültig', 3000); } }
    if (!(await dialog({ title: '2FA entfernen?', html: `<p class="muted">${verified.length > 1 ? 'Diese App kann sich danach nicht mehr bestätigen.' : 'Dein Konto ist danach nur noch mit dem Passwort geschützt.'}</p>`, buttons: [{ label: 'Abbrechen', value: false }, { label: 'Entfernen', value: true, cls: 'danger' }] }))) return;
    try { await O.mfaRemove(b.dataset.unenroll); toast('Entfernt'); render(el); } catch (e) { toast(e.message, 5000); }
  });
  // Bei der Registrierung gewählt: 2FA gleich nach der ersten Anmeldung einrichten
  if (verified.length) localStorage.removeItem('vvWant2fa');
  else if (localStorage.getItem('vvWant2fa') === '1') setTimeout(() => {
    const w = $('#mWant', el); if (!w) return;
    w.innerHTML = '<div class="card accbox"><b>🔐 Fast fertig: Zwei-Faktor-Anmeldung einrichten</b><p class="small muted">Wie bei der Registrierung gewählt. Scanne den QR-Code mit deiner Authenticator-App und gib den Code ein.</p><button class="linkbtn small" id="mLater">Später einrichten</button></div>';
    $('#mLater', el).onclick = () => { localStorage.removeItem('vvWant2fa'); w.innerHTML = ''; $('#mBox', el).innerHTML = ''; toast('Du findest die 2FA jederzeit hier unter Konto › Sicherheit', 4000); };
    $('#mOn', el).click(); w.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
  el.querySelectorAll('[data-devrm]').forEach(b => b.onclick = async () => {
    const ok = await dialog({ title: `„${b.dataset.devname}“ entfernen?`, html: '<p class="muted">Das Gerät verschwindet aus der Liste und wird dort von deinem Konto abgemeldet: sofort, wenn es gerade online ist, sonst beim nächsten Öffnen der App. Die Daten auf dem Gerät selbst bleiben erhalten.</p><p class="small muted">Sofort überall abmelden (auch ohne App-Start): unten „Überall abmelden“.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Entfernen und abmelden', value: true, cls: 'danger' }] });
    if (!ok) return;
    try { await (await import('../online/devices.js')).revokeDevice(b.dataset.devrm); toast('Gerät entfernt und abgemeldet'); render(el); } catch (e) { toast(e.message, 5000); }
  });
  $('#mOn', el).onclick = async () => {
    try {
      for (const f of stale) await O.mfaRemove(f.id).catch(() => { }); // halb eingerichtete Versuche aufräumen
      const d = await O.mfaEnroll();
      $('#mBox', el).innerHTML = `<div class="mfabox"><img id="mQr" alt="QR-Code für die Authenticator-App" width="180" height="180"><div class="form"><p class="small">1. QR-Code mit der Authenticator-App scannen.<br>Oder Schlüssel eintippen: <code>${esc(d.totp.secret)}</code></p><p class="small">2. Angezeigten 6-stelligen Code eingeben:</p><input class="inp otp" id="mCode" inputmode="numeric" maxlength="7" placeholder="123 456"><div class="row"><button class="btn pri" id="mVer">Aktivieren</button></div></div></div>`;
      $('#mQr', el).src = O.qrSrc(d.totp.qr_code); // per DOM setzen, nicht über HTML-Text
      let busy = false;
      const ver = async () => { if (busy) return; busy = true; try { await O.mfaVerify(d.id, $('#mCode', el).value); toast('2FA aktiv 🔐'); render(el); } catch (e) { toast('Code ungültig', 3000); } busy = false; };
      $('#mVer', el).onclick = ver; $('#mCode', el).oninput = e => { if (e.target.value.replace(/\D/g, '').length === 6) ver(); }; $('#mCode', el).focus();
    } catch (e) { toast(e.message, 5000); }
  };
  // Löschen
  $('#dData', el).onclick = async () => { if (!(await dialog({ title: 'Online-Daten löschen?', html: '<p class="muted">Alles im Konto wird entfernt (Abgleich, Fahrten, Bestenlisten-Einträge). Die Daten auf diesem Gerät bleiben. Solange du angemeldet bist, lädt der nächste Abgleich sie wieder hoch: vorher abmelden, wenn du das nicht willst.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, cls: 'danger' }] }))) return; try { const n = await OS.deleteOnlineData(); toast(`Gelöscht (${n} Dateien)`); render(el); } catch (e) { toast(e.message, 5000); } };
  $('#dAcc', el).onclick = async () => {
    let t = ''; const pr = dialog({ title: 'Konto endgültig löschen?', html: '<p class="muted">Login, Profil und alle Online-Daten werden gelöscht. Das lässt sich nicht rückgängig machen. Die Daten auf diesem Gerät bleiben.</p><p class="small">Zum Bestätigen <b>LÖSCHEN</b> eintippen:</p><input class="inp" id="dConf" autocomplete="off">', buttons: [{ label: 'Abbrechen', value: null }, { label: 'Konto löschen', value: 'ok', cls: 'danger' }] });
    const i = document.getElementById('dConf'); i.focus(); i.oninput = () => t = i.value.trim();
    if (await pr !== 'ok' || t !== 'LÖSCHEN') { if (t) toast('Abgebrochen', 2000); return; }
    try { await OS.deleteAccount(); toast('Konto gelöscht'); setTimeout(() => { location.hash = '#/'; location.reload(); }, 800); } catch (e) { toast(e.message, 6000); }
  };
}

/* ---------- Tresor-Verschlüsselung ---------- */
async function vaultUi(el, S) {
  const box = $('#vaultBody', el); if (!box) return;
  let info; try { info = await S.vaultInfo(); } catch (e) { box.innerHTML = `<p class="small" style="color:var(--hr)">Status nicht abrufbar: ${esc(e.message)}</p>`; return; }
  if (!document.body.contains(box)) return;
  { const c = $('#accVaultChip', el); if (c) { c.textContent = { on: '🔒 Tresor an', locked: '🔐 Tresor gesperrt', off: '🔓 Tresor aus' }[info.status] || '🔒 Tresor'; c.className = 'accchip ' + (info.status === 'on' ? 'ok' : 'warn'); } }
  const intro = '<p class="small muted">Verschlüsselt alles, was dein Konto zum Abgleich speichert (Fahrten mit Puls und Leistung, Einstellungen, Pläne, Live-Fahrt), schon in deinem Browser. Supabase sieht nur unlesbare Daten. Nicht verschlüsselt werden können: E-Mail und Login, dein Anzeigename und Avatar, Bestenlisten-Einträge (abschaltbar) und das Live-Fahren mit anderen.</p>';
  const prog = (n, t) => { const p = $('#vProg', el); if (p) p.textContent = `${n} von ${t} Dateien …`; };
  if (info.status === 'off') {
    box.innerHTML = `${intro}
      <div class="accbox"><b>Wähle ein eigenes Tresor-Passwort</b> <span class="small muted">(nicht dein Login-Passwort). Ohne dieses Passwort lassen sich die Online-Daten nicht mehr lesen, auch nicht von einem Admin. Die Daten auf deinen Geräten bleiben aber immer erhalten.</span></div>
      ${pwField('vPass', 'Tresor-Passwort', 'new-password')}${pwField('vPass2', 'Tresor-Passwort wiederholen', 'new-password')}
      <label class="switch"><input type="checkbox" id="vOk"><span></span> <div class="swt">Ich habe das Tresor-Passwort sicher notiert (z. B. im Passwort-Manager)</div></label>
      <div class="row"><button class="btn pri" id="vOn" disabled>Verschlüsselung einschalten</button><span class="small muted" id="vProg"></span></div>`;
    wirePw(el);
    const chk = () => { const a = $('#vPass', el).value, b = $('#vPass2', el).value; $('#vOn', el).disabled = !(a.length >= 10 && a === b && $('#vOk', el).checked); };
    for (const id of ['vPass', 'vPass2']) $('#' + id, el).addEventListener('input', chk); $('#vOk', el).onchange = chk;
    $('#vOn', el).onclick = async e => {
      e.target.disabled = true; e.target.innerHTML = '<span class="spinner sm"></span> Verschlüssele …';
      try { const n = await S.vaultEnable($('#vPass', el).value, prog); toast(`🔐 Tresor eingeschaltet, ${n} Dateien verschlüsselt`, 4000); vaultUi(el, S); }
      catch (er) { toast('Tresor: ' + er.message, 6000); e.target.textContent = 'Verschlüsselung einschalten'; chk(); }
    };
  } else if (info.status === 'locked') {
    box.innerHTML = `<div class="accbox bad"><b>🔒 Auf diesem Gerät gesperrt</b><p class="small muted">Deine Online-Daten sind verschlüsselt. Gib einmal das Tresor-Passwort ein, dann gleicht dieses Gerät wieder ab. Bis dahin wird nichts hoch- oder heruntergeladen.</p></div>
      ${pwField('vPass', 'Tresor-Passwort', 'current-password')}
      <div class="row"><button class="btn pri" id="vUnlock">Entsperren</button></div>`;
    wirePw(el);
    const go = async () => { const b = $('#vUnlock', el); b.disabled = true; b.innerHTML = '<span class="spinner sm"></span> Prüfe …'; try { await S.vaultUnlock($('#vPass', el).value); toast('🔓 Entsperrt, der Abgleich läuft wieder'); S.pushNow?.(); vaultUi(el, S); } catch (er) { toast(er.message, 5000); b.disabled = false; b.textContent = 'Entsperren'; } };
    $('#vUnlock', el).onclick = go; $('#vPass', el).onkeydown = e => { if (e.key === 'Enter') go(); };
  } else {
    box.innerHTML = `<div class="accbox"><b>✅ Eingeschaltet</b> <span class="small muted">seit ${new Date(info.meta.created).toLocaleDateString(document.documentElement.lang)} · ${esc(info.meta.alg)} · Schlüssel auf diesem Gerät gespeichert</span></div>${intro}
      <div class="row"><button class="btn sm ghost" id="vLock" title="Der Schlüssel wird auf diesem Gerät gelöscht; danach ist das Tresor-Passwort erneut nötig">Auf diesem Gerät sperren</button><button class="btn sm ghost danger" id="vOff">Verschlüsselung ausschalten</button><span class="small muted" id="vProg"></span></div>`;
    $('#vLock', el).onclick = async () => { const { forgetLocalKey } = await import('../vault.js'); await forgetLocalKey(); toast('Auf diesem Gerät gesperrt'); vaultUi(el, S); };
    $('#vOff', el).onclick = async e => {
      if (!(await dialog({ title: 'Verschlüsselung ausschalten?', html: '<p class="muted">Alle Online-Daten werden wieder unverschlüsselt gespeichert. Supabase kann sie dann grundsätzlich einsehen.</p>', buttons: [{ label: 'Abbrechen', value: false }, { label: 'Ausschalten', value: true, cls: 'danger' }] }))) return;
      e.target.disabled = true; e.target.innerHTML = '<span class="spinner sm"></span> Entschlüssele …';
      try { const n = await S.vaultDisable(prog); toast(`Tresor ausgeschaltet, ${n} Dateien entschlüsselt`); vaultUi(el, S); } catch (er) { toast('Tresor: ' + er.message, 6000); e.target.disabled = false; e.target.textContent = 'Verschlüsselung ausschalten'; }
    };
  }
}
