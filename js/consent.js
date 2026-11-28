// Zustimmung vor der ersten Nutzung einer Funktion, die Daten an einen fremden Dienst schickt (Version gemerkt; neue Version = neu fragen)
import { dialog, esc } from './util.js';
import { profile, saveProfile } from './state.js';
// once: einmal „Abbrechen“ wird gemerkt, dann fragt die App nicht mehr von selbst (zustimmen geht später unter Einstellungen › App & Daten › Einwilligungen)
// force: aus den Einstellungen heraus trotzdem fragen
export async function consent(key, version, { title, html, ok = 'Zustimmen und fortfahren', once = false, force = false }) {
  if (profile.consents?.[key] === version) return true;
  if (once && !force && profile.consentsNo?.[key] === version) return false;
  let checked = false; const onCh = e => { if (e.target.id === 'cnsOk') checked = e.target.checked; };
  document.addEventListener('change', onCh);
  const v = await dialog({ title, html: `${html}<label class="switch" style="margin-top:10px"><input type="checkbox" id="cnsOk"><span></span> <div class="swt">Ich habe das gelesen und stimme zu.<small class="muted">Jederzeit widerrufbar unter Einstellungen › App & Daten.</small></div></label>`, buttons: [{ label: 'Abbrechen', value: 0 }, { label: ok, value: 1, cls: 'pri' }] });
  document.removeEventListener('change', onCh);
  if (!v || !checked) { if (once) { profile.consentsNo = { ...(profile.consentsNo || {}), [key]: version }; saveProfile(); } return false; }
  profile.consents = { ...(profile.consents || {}), [key]: version }; if (profile.consentsNo?.[key]) { const n = { ...profile.consentsNo }; delete n[key]; profile.consentsNo = n; } saveProfile(); return true;
}
export const revoke = key => { if (profile.consents?.[key]) { const c = { ...profile.consents }; delete c[key]; profile.consents = c; saveProfile(); } };
export const NAMES = { osm: 'Echte Gebäude (OpenStreetMap)', call: 'Videoanrufe (WebRTC, TURN)', mly: 'Echte Straßenbilder (Mapillary)', voice: 'Sprachsteuerung (Spracherkennung des Browsers)' };
export { esc };
