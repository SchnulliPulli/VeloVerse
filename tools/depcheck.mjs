// Prüft die eingebauten Fremd-Bibliotheken (vendor/versions.json) gegen die öffentliche Sicherheitslücken-Datenbank OSV
// (osv.dev, enthält die GitHub Security Advisories). Meldet nur Lücken, die genau die eingebaute Version betreffen und als
// KRITISCH oder HOCH eingestuft sind, mit der Version, die sie behebt. Ausgabe: report.md, Exit-Code 2 wenn etwas gefunden wurde.
// Lokal: node tools/depcheck.mjs  (ALLE=1 zeigt auch mittlere/niedrige Einstufungen)
import { readFileSync, writeFileSync } from 'node:fs';

const LEVELS = process.env.ALLE ? ['CRITICAL', 'HIGH', 'MODERATE', 'MEDIUM', 'LOW'] : ['CRITICAL', 'HIGH'];
const { packages } = JSON.parse(readFileSync(new URL('../vendor/versions.json', import.meta.url)));
const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };

// Einstufung: GitHub-Angabe (database_specific.severity), sonst grob aus dem CVSS-Vektor nicht ableitbar → „UNBEKANNT“ (wird gemeldet)
const level = v => String(v.database_specific?.severity || v.affected?.find(a => a.database_specific?.severity)?.database_specific?.severity || 'UNBEKANNT').toUpperCase();
// Behebende Version für dieses Paket
const fixedIn = (v, name) => { const out = new Set(); for (const a of v.affected || []) if (a.package?.name === name) for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) out.add(e.fixed); return [...out].join(', ') || 'noch keine'; };

const res = await post('https://api.osv.dev/v1/querybatch', { queries: packages.map(p => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) });
const found = [];
for (let i = 0; i < packages.length; i++) {
  const p = packages[i];
  for (const { id } of res.results?.[i]?.vulns || []) {
    const v = await get('https://api.osv.dev/v1/vulns/' + encodeURIComponent(id));
    if (v.withdrawn) continue;
    const lv = level(v); if (lv !== 'UNBEKANNT' && !LEVELS.includes(lv)) continue;
    found.push({ p, id, lv, sum: v.summary || v.details?.slice(0, 160) || '', fix: fixedIn(v, p.name), alias: (v.aliases || []).filter(a => a.startsWith('CVE')).join(', ') });
  }
}
// Neueste Versionen nur als Zusatzinfo (kein Alarm)
const latest = {}; for (const n of new Set(packages.map(p => p.name))) try { latest[n] = (await get('https://registry.npmjs.org/' + n.replace('/', '%2F') + '/latest')).version; } catch (e) { latest[n] = '?'; }

const L = [];
if (found.length) {
  L.push(`## ⚠️ ${found.length} wichtige Sicherheitslücke(n) in eingebauten Bibliotheken`, '', 'Diese Lücken betreffen genau die Version, die IndooRado gerade einbaut. Bitte aktualisieren.', '');
  for (const f of found) L.push(`### ${f.lv === 'CRITICAL' ? '🔴 KRITISCH' : f.lv === 'HIGH' ? '🟠 HOCH' : f.lv} · ${f.p.name} ${f.p.version}`, `- ${f.sum}`, `- Kennung: [${f.id}](https://osv.dev/vulnerability/${f.id})${f.alias ? ' · ' + f.alias : ''}`, `- Behoben in: **${f.fix}** (neueste Version: ${latest[f.p.name]})`, `- Eingebaut in: ${f.p.where}`, '');
} else L.push('## ✅ Keine kritischen oder hohen Sicherheitslücken in den eingebauten Bibliotheken', '');
L.push('### Übersicht', '', '| Bibliothek | eingebaut | neueste | wo |', '|---|---|---|---|', ...packages.map(p => `| ${p.name} | ${p.version} | ${latest[p.name]} | ${p.where} |`), '', `Geprüft am ${new Date().toISOString().slice(0, 10)} gegen osv.dev.`);
writeFileSync('report.md', L.join('\n') + '\n');
console.log(L.join('\n'));
process.exit(found.length ? 2 : 0);
