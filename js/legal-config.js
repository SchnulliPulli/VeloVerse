// Angaben für Impressum und Datenschutzerklärung. BITTE AUSFÜLLEN, bevor die Seite öffentlich beworben wird.
// Pflicht für ein Impressum nach § 5 DDG: vollständiger Name und eine ladungsfähige Anschrift (kein Postfach),
// dazu eine Möglichkeit zur schnellen elektronischen Kontaktaufnahme (E-Mail).
export const LEGAL = {
  name: 'Max Mustermann',      // Platzhalter, später durch die echten Angaben ersetzen
  street: 'Musterstraße 1',
  city: '99999 Musterhausen',
  country: 'Deutschland',
  email: 'info@indoorado.de',
  phone: '',                                   // optional
  // Datenschutz-Aufsichtsbehörde deines Bundeslandes (z. B. „Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)“)
  authority: '[zuständige Datenschutz-Aufsichtsbehörde]',
  // Region deines Supabase-Projekts (Supabase-Dashboard › Project Settings › General), z. B. „EU (Frankfurt)“
  supabaseRegion: '[Region des Supabase-Projekts]',
  // Stand der Texte
  updated: '27.11.2026',
};
export const legalIncomplete = () => Object.values(LEGAL).some(v => typeof v === 'string' && /^\[.*\]$/.test(v));
