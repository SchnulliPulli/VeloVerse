// Meldung für ein anderes, auf diesem Gerät angemeldetes Konto, während die App offen ist: statt Gerätemeldung ein Hinweis
// in der App („für <Konto>“) mit denselben Aktionen wie die Gerätemeldung. Die Aktion wechselt erst ins richtige Konto.
import { esc, bus } from './util.js';

// Mehrere Hinweise gleichzeitig (z. B. Nachricht und Anruf): übereinander statt aufeinander
export function restack() { let y = innerWidth <= 520 ? 76 : 90; for (const e of document.querySelectorAll('.invcard.msgpop, .invcard.callring')) { e.style.bottom = y + 'px'; y += e.offsetHeight + 10; } }
const ICON = { msg: '💬', call: '📹', missed: '📵', friendreq: '👋', invite: '🚴' };
export function showOther(d, open) {
  const key = (d.kind === 'call' || d.kind === 'missed' ? 'call-' + d.room : d.kind + '-' + d.from) + '@' + d.acct;
  if (d.kind === 'callstop') { document.querySelectorAll(`.otherpop.callring[data-k^="${CSS.escape('call-' + d.room)}"]`).forEach(x => x.remove()); return; }
  if (d.ring && document.querySelector(`.otherpop[data-k="${CSS.escape(key)}"]`)) return; // Anruf klingelt schon
  document.querySelector(`.otherpop[data-k="${CSS.escape(key)}"]`)?.remove();
  const call = d.kind === 'call', A = d.acts || {};
  const btns = call ? [['no', '📵 Ablehnen', 'ghost'], ['join', '📞 Annehmen', 'pri']]
    : d.kind === 'msg' ? [['open', 'Lesen', 'ghost'], ['open', 'Antworten', 'pri']]
    : d.kind === 'missed' ? [['open', 'Chat öffnen', 'pri']]
    : d.kind === 'friendreq' ? [['open', 'Ansehen', 'ghost'], ['acc', 'Annehmen', 'pri']]
    : d.kind === 'invite' ? [['open', 'Ansehen', 'ghost'], ['join', 'Beitreten', 'pri']] : [['open', 'Öffnen', 'pri']];
  const c = document.createElement('div'); c.className = 'invcard msgpop otherpop' + (call ? ' callring' : ''); c.dataset.k = key; c.setAttribute('role', call ? 'alertdialog' : 'status');
  c.innerHTML = `<button class="mpx" data-x aria-label="Schließen">✕</button><div class="mpt"><div class="small opacct">👤 für <b data-noi18n>${esc(d.who || 'anderes Konto')}</b></div><b>${esc(d.title || 'IndooRado')}</b><div class="small mpbody">${esc(d.body || '')}</div></div>
    <div class="row end">${btns.map(([a, l, cl]) => `<button class="btn sm ${cl}" data-a="${a}"${call ? (a === "no" ? " data-no" : " data-ok") : ""}>${l}</button>`).join('')}</div>`;
  document.body.appendChild(c); restack();
  let stopRing = null; if (call) import('./call.js').then(C => { if (c.isConnected) stopRing = C.ringTone?.(); }).catch(() => { }); else import('./sound.js').then(m => m.sound.beep(false)).catch(() => { });
  const t = setTimeout(() => c.remove(), call ? 45e3 : d.kind === 'invite' || d.kind === 'friendreq' ? 30e3 : 15e3);
  const obs = new MutationObserver(() => { if (!c.isConnected) { stopRing?.(); obs.disconnect(); clearTimeout(t); restack(); } }); obs.observe(document.body, { childList: true });
  c.onclick = e => {
    if (e.target.closest('[data-x]')) return c.remove();
    const b = e.target.closest('[data-a]'); if (!b) return;
    c.remove();
    // Ablehnen ohne Kontowechsel: direkt mit der gespeicherten Anmeldung des anderen Kontos
    if (b.dataset.a === 'no') { import('./online/client.js').then(O => O.withAccount(d.acct, sb => sb.rpc('call_state', { p_room: d.room, p_ev: 'decline' }))).catch(() => { }); return; }
    const href = b.dataset.a === 'open' ? d.url : A[b.dataset.a]; if (href) open(href);
  };
  import('./notilog.js').then(N => N.addNote({ icon: ICON[d.kind] || '🔔', title: `${d.title || ''} · für ${d.who || 'anderes Konto'}`, body: d.body, ...(d.url ? { act: { t: 'href', href: d.url }, ttl: d.kind === 'call' ? 60e3 : 864e5 } : {}) })).catch(() => { });
  bus.emit('inbox');
}
