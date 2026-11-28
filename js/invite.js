// Freunde zu IndooRado einladen: per E-Mail (Edge Function „invite“, Supabase-Vorlage „Invite user“) oder per Link zum
// Teilen (Messenger, soziale Netzwerke, E-Mail-Programm). Der Link trägt den eigenen Freundescode (?ref=…). Wer darüber
// kommt und sich anmeldet, schickt dem Einladenden automatisch eine Freundschaftsanfrage. Externe Seiten (WhatsApp usw.)
// werden erst beim Antippen geöffnet, vorher fließt nichts dorthin.
import { toast, bus } from './util.js';

const REF = 'vvRef';
export const inviteLink = code => location.origin + location.pathname.replace(/index\.html$/, '') + (code ? '?ref=' + encodeURIComponent(code) : '');
const msg = name => `Komm mit mir auf IndooRado – Indoor-Radtraining im Browser mit 3D-Welt, Workouts und gemeinsamen Fahrten.${name ? ' Ich bin dort als ' + name + '.' : ''}`;

// Beim Öffnen der App: Freundescode aus dem Link merken (30 Tage) und aus der Adresse entfernen
export function captureRef() {
  try {
    const u = new URL(location.href), c = (u.searchParams.get('ref') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
    if (!c) return;
    localStorage.setItem(REF, JSON.stringify({ c, t: Date.now() }));
    u.searchParams.delete('ref'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch (e) { }
}
export const pendingRef = () => { try { const r = JSON.parse(localStorage.getItem(REF) || 'null'); return r && Date.now() - r.t < 30 * 864e5 ? r.c : null; } catch (e) { return null; } };

// Angemeldet mit gemerktem Code (Link oder E-Mail-Einladung): einmal Freundschaftsanfrage an den Einladenden
export async function applyRef() {
  const O = await import('./online/client.js'); if (!O.loggedIn() || !O.access().ok) return;
  const c = pendingRef() || String(O.online.user?.user_metadata?.ref || '').toUpperCase(); if (!c) return;
  const done = 'vvRefDone:' + O.online.user.id; if (localStorage.getItem(done) === c) { localStorage.removeItem(REF); return; }
  try {
    const sb = await O.client(), mine = (await sb.rpc('my_friend_code', { p_new: false })).data;
    if (mine && String(mine).toUpperCase() === c) { localStorage.removeItem(REF); return; } // eigener Link
    const { data, error } = await sb.rpc('friend_request_code', { p_code: c });
    localStorage.setItem(done, c); localStorage.removeItem(REF);
    if (error) return;
    toast(data === 'friend' ? '🎉 Ihr seid jetzt Freunde – willkommen bei IndooRado!' : '👋 Freundschaftsanfrage an deinen Einlader gesendet', 6000);
    bus.emit('inbox');
  } catch (e) { }
}

// E-Mail-Einladung verschicken
export async function sendInvite(email) {
  const O = await import('./online/client.js');
  const { data, error } = await (await O.client()).functions.invoke('invite', { body: { email } });
  if (error) { const st = error.context?.status; throw new Error(st === 404 ? 'E-Mail-Einladungen sind noch nicht eingerichtet (Edge Function „invite“ fehlt)' : st === 400 ? 'Ungültige E-Mail-Adresse' : 'Einladung fehlgeschlagen' + (st ? ' (' + st + ')' : '')); }
  if (data?.ok) return true;
  throw new Error({ self: 'Das ist deine eigene Adresse', exists: 'Diese Person hat schon ein IndooRado-Konto – schick ihr deinen Freundescode oder suche sie unter „Freunde finden“', rate: 'Supabase verschickt gerade zu viele E-Mails, bitte später noch einmal', 'not-configured': 'E-Mail-Einladungen sind noch nicht eingerichtet', input: 'Ungültige E-Mail-Adresse' }[data?.why]
    || (data?.why === 'denied' ? (data.detail || 'Einladung nicht möglich').replace(/^.*?: /, '') : 'Einladung konnte nicht verschickt werden' + (data?.detail ? ': ' + data.detail : '')));
}

// Karte „Freunde einladen“ (Freunde-Seite): E-Mail und Teilen
export function inviteCardHtml() {
  return `<section class="card form invitecard"><h2>✉️ Freunde zu IndooRado einladen</h2>
    <p class="small muted">Wer über deine Einladung kommt und sich registriert, schickt dir automatisch eine Freundschaftsanfrage.</p>
    <div class="row invmail"><input class="inp" id="invMail" type="email" placeholder="E-Mail-Adresse" autocomplete="email" maxlength="200"><button class="btn pri" id="invSend">Einladen</button></div>
    <p class="small muted">Die Adresse geht nur an den Versanddienst für diese eine E-Mail; IndooRado speichert sie nicht (nur einen Prüfwert gegen doppelte Einladungen).</p>
    <h3 class="sub">Oder Link teilen</h3>
    <div class="row invlink"><input class="inp" id="invLink" readonly value="…"><button class="btn" id="invCopy">📋 Kopieren</button></div>
    <div class="row invshare"><button class="btn sm pri" data-sh="native" hidden>📤 Teilen …</button><button class="btn sm" data-sh="wa">WhatsApp</button><button class="btn sm" data-sh="tg">Telegram</button><button class="btn sm" data-sh="sig">Signal</button><button class="btn sm" data-sh="mail">E-Mail-Programm</button><button class="btn sm" data-sh="x">X</button><button class="btn sm" data-sh="fb">Facebook</button></div>
  </section>`;
}
export async function wireInviteCard(box) {
  const O = await import('./online/client.js'), sb = await O.client();
  const code = (await sb.rpc('my_friend_code', { p_new: false }).catch(() => ({}))).data || '', name = O.online.profile?.display_name || '';
  const link = inviteLink(code), text = msg(name); box.querySelector('#invLink').value = link;
  const nat = box.querySelector('[data-sh="native"]'); if (navigator.share) nat.hidden = false;
  const enc = encodeURIComponent, full = text + ' ' + link;
  const urls = { wa: 'https://wa.me/?text=' + enc(full), tg: 'https://t.me/share/url?url=' + enc(link) + '&text=' + enc(text), sig: 'sgnl://send?text=' + enc(full), mail: 'mailto:?subject=' + enc('Komm zu IndooRado') + '&body=' + enc(full), x: 'https://x.com/intent/post?text=' + enc(full), fb: 'https://www.facebook.com/sharer/sharer.php?u=' + enc(link) };
  box.addEventListener('click', async e => {
    if (e.target.closest('#invCopy')) { try { await navigator.clipboard.writeText(full); toast('Einladung kopiert – einfach einfügen und senden'); } catch (er) { box.querySelector('#invLink').select(); toast('Link markiert – kopieren mit Strg+C'); } return; }
    const s = e.target.closest('[data-sh]')?.dataset.sh; if (!s) return;
    if (s === 'native') { try { await navigator.share({ title: 'IndooRado', text, url: link }); } catch (er) { } return; }
    window.open(urls[s], s === 'mail' || s === 'sig' ? '_self' : '_blank', 'noopener');
  });
  const send = async () => {
    const i = box.querySelector('#invMail'), b = box.querySelector('#invSend'), v = i.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('Bitte eine gültige E-Mail-Adresse eingeben');
    b.disabled = true; b.textContent = 'Sende …';
    try { await sendInvite(v); i.value = ''; toast(`✉️ Einladung an ${v} verschickt`, 4000); } catch (er) { toast(er.message, 7000); }
    b.disabled = false; b.textContent = 'Einladen';
  };
  box.querySelector('#invSend').onclick = send; box.querySelector('#invMail').onkeydown = e => { if (e.key === 'Enter') send(); };
}
