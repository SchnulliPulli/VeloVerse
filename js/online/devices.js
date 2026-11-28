// Geräte des Kontos aus der Abgleich-Liste entfernen und dort abmelden.
// Ablauf: Eintrag in public.device_revocations + sofortiger Hinweis über den privaten Kontokanal.
// Das betroffene Gerät prüft beim Start und bei diesem Hinweis, meldet sich ab und bekommt eine neue Geräte-ID.
import * as O from './client.js';
import { kv } from '../db.js';
import { toast } from '../util.js';

export async function revokeDevice(id) {
  const S = await import('../sync.js');
  if (!id || id === S.sync.device?.id) return false;
  // erst beim Server abmelden; nur wenn das klappt, aus der Liste nehmen (sonst verschwände ein noch angemeldetes Gerät)
  if (O.loggedIn()) {
    const sb = await O.client(); const { error } = await sb.from('device_revocations').upsert({ device_id: id, at: new Date().toISOString() });
    if (error && !/relation|does not exist|schema cache/i.test(error.message)) throw new Error(/permission denied/i.test(error.message) ? 'Abmelden nicht erlaubt – bitte das neueste Datenbankschema ausführen (fix-geraete-abmelden.sql)' : error.message);
    if (error) toast('Abmelden aus der Ferne fehlt in der Datenbank (schema.sql neu ausführen) – das Gerät wurde nur aus der Liste entfernt.', 6000);
    try { (await import('../tv.js')).broadcast('revoke', { device: id }); } catch (e) { }
  }
  // aus der Liste nehmen (auf allen Geräten, über den Abgleich)
  const rm = new Set(await kv.get('removedDevices', [])); rm.add(id); await kv.set('removedDevices', [...rm].slice(-50));
  delete S.sync.devices[id];
  S.schedulePush(500);
  return true;
}

let busy = false;
export async function checkRevoked() {
  if (busy || !O.loggedIn()) return; busy = true;
  try {
    const S = await import('../sync.js'), me = S.sync.device?.id; if (!me) return;
    const sb = await O.client(); const { data, error } = await sb.from('device_revocations').select('device_id').eq('device_id', me).limit(1);
    if (error || !data?.length) return;
    await sb.from('device_revocations').delete().eq('device_id', me);
    // neue Geräte-ID, damit eine spätere Anmeldung wieder in der Liste erscheint
    S.sync.device = { id: Math.random().toString(36).slice(2, 10), name: S.sync.device.name }; await kv.set('device', S.sync.device);
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { }
    toast('🔒 Dieses Gerät wurde von einem anderen Gerät abgemeldet.', 6000);
    setTimeout(() => { location.hash = '#/'; location.reload(); }, 1800);
  } finally { busy = false; }
}
