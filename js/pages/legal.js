// Rechtliches: Impressum, Datenschutzerklärung, Nutzungshinweise und Lizenzen.
// Die persönlichen Angaben kommen aus js/legal-config.js. Kein Ersatz für eine Rechtsberatung.
import { $, esc } from '../util.js';
import { LEGAL as L } from '../legal-config.js';

const TABS = [['impressum', 'Impressum'], ['datenschutz', 'Datenschutz'], ['nutzung', 'Nutzung und Haftung'], ['lizenzen', 'Lizenzen']];
const addr = () => `${esc(L.name)}<br>${esc(L.street)}<br>${esc(L.city)}${L.country ? '<br>' + esc(L.country) : ''}`;
const mail = () => /@/.test(L.email) ? `<a href="mailto:${esc(L.email)}">${esc(L.email)}</a>` : esc(L.email);

export async function render(el, [tab]) {
  const t = TABS.some(x => x[0] === tab) ? tab : 'impressum';
  el.innerHTML = `
  <section class="pagehead"><h1>Rechtliches</h1><span class="small muted">Stand: ${esc(L.updated)}</span></section>
  <div class="seg legaltabs">${TABS.map(([k, l]) => `<a href="#/legal/${k}" class="${k === t ? 'on' : ''}" aria-current="${k === t}">${l}</a>`).join('')}</div>
  ${document.documentElement.lang !== 'de' ? '<p class="small muted">ℹ️ Rechtliche Texte gelten in der deutschen Fassung.</p>' : ''}
  <article class="card legal" data-noi18n>${({ impressum, datenschutz, nutzung, lizenzen })[t]()}</article>`;
}

function impressum() {
  return `<h2>Impressum</h2>
  <h3>Angaben gemäß § 5 DDG</h3><p>${addr()}</p>
  <h3>Kontakt</h3><p>E-Mail: ${mail()}${L.phone ? '<br>Telefon: ' + esc(L.phone) : ''}</p>
  <h3>Verantwortlich für den Inhalt</h3><p>${esc(L.name)}, Anschrift wie oben.</p>
  <h3>Art des Angebots</h3><p>IndooRado ist ein privates, nicht kommerzielles Hobbyprojekt: eine Web-App für Indoor-Radtraining. Es gibt keine kostenpflichtigen Leistungen, keine Werbung und kein Tracking.</p>
  <h3>Verbraucherstreitbeilegung</h3><p>Ich bin weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
  <h3>Haftung für Inhalte und Links</h3><p>Die Inhalte wurden mit Sorgfalt erstellt. Für Richtigkeit, Vollständigkeit und Aktualität kann ich keine Gewähr übernehmen. Für Inhalte verlinkter externer Seiten sind ausschließlich deren Betreiber verantwortlich; bei Bekanntwerden von Rechtsverletzungen entferne ich entsprechende Links umgehend.</p>
  <h3>Urheberrecht</h3><p>Der Programmcode und die Inhalte dieser Seite unterliegen dem Urheberrecht, soweit nicht anders angegeben (siehe „Lizenzen“). Erwähnte Marken (z. B. Strava, Garmin, Wahoo) gehören ihren jeweiligen Inhabern; IndooRado steht in keiner Verbindung zu diesen Unternehmen.</p>`;
}

function datenschutz() {
  return `<h2>Datenschutzerklärung</h2>
  <p>Diese Erklärung beschreibt, welche personenbezogenen Daten bei der Nutzung von IndooRado verarbeitet werden. Kurz gesagt: <b>Ohne Anmeldung bleibt alles in deinem Browser.</b> Erst wenn du dich bei IndooRado Online anmeldest oder selbst einen Dienst (z. B. Strava oder einen Cloud-Speicher) verbindest, gehen Daten an diese Dienste.</p>

  <h3>1. Verantwortlicher</h3><p>${addr()}<br>E-Mail: ${mail()}</p>

  <h3>2. Aufruf der Website (Hosting)</h3>
  <p>Die Website wird über <b>GitHub Pages</b> bereitgestellt (GitHub Inc., 88 Colin P Kelly Jr St, San Francisco, CA 94107, USA). Beim Aufruf verarbeitet GitHub technisch notwendige Verbindungsdaten, insbesondere deine IP-Adresse, Datum und Uhrzeit, die aufgerufene Datei und Browserinformationen, um die Seite auszuliefern und vor Missbrauch zu schützen. Ich selbst erhalte diese Daten nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (sichere und stabile Bereitstellung). GitHub kann Daten in den USA verarbeiten; GitHub ist nach dem EU-US Data Privacy Framework zertifiziert, zusätzlich gelten Standardvertragsklauseln. Details: <a href="https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">Datenschutzerklärung von GitHub</a>.</p>
  <p>Schriften, Grafikbibliotheken und alle übrigen Dateien liegen auf demselben Server; es werden keine Inhalte von Drittanbietern (z. B. Google Fonts, CDNs) nachgeladen. Es gibt <b>keine Cookies, keine Analyse- und keine Werbedienste</b>.</p>

  <h3>3. Speicherung in deinem Browser</h3>
  <p>Profil, Einstellungen, Fahrten (inkl. Leistung, Herzfrequenz, Trittfrequenz, virtueller Strecke), Fotos, Fortschritt, Pläne und Workouts speichert die App <b>lokal in deinem Browser</b> (IndexedDB, localStorage). Diese Daten verlassen dein Gerät nicht, solange du keinen der unten genannten Dienste nutzt. Die lokale Speicherung ist für die von dir gewünschte Funktion unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Du kannst die Daten jederzeit in der App (Optionen › App › Daten) oder über die Browser-Einstellungen löschen.</p>
  <p><b>Bluetooth-Geräte</b> (Trainer, Pulsgurt, Sensoren) verbindet der Browser direkt mit der App; dabei werden keine Daten an mich oder Dritte übertragen.</p>

  <h3>4. IndooRado Online (nur mit Konto)</h3>
  <p>Wenn du ein Konto anlegst, nutzt IndooRado den Dienst <b>Supabase</b> (Supabase Inc.) für Anmeldung, Datenbank, Dateispeicher und Live-Funktionen. Serverregion: ${esc(L.supabaseRegion)}. Mit Supabase besteht ein Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO); soweit Daten in Drittländer gelangen können, gelten Standardvertragsklauseln. Verarbeitet werden:</p>
  <ul>
    <li><b>Konto:</b> E-Mail-Adresse, Passwort (nur als Hash), optional Zwei-Faktor-Geheimnis, Anmeldezeitpunkte sowie technische Protokolldaten (IP-Adresse, Browser). Zweck: Anmeldung und Schutz des Kontos.</li>
    <li><b>Profil:</b> Anzeigename, Avatar, Level, Sichtbarkeit, letzte Aktivität, Freischaltungsstatus. Anzeigename, Avatar und Level sehen andere angemeldete Nutzer. Deine E-Mail-Adresse sieht niemand außer dir.</li>
    <li><b>Abgleich zwischen deinen Geräten:</b> Einstellungen, Körperdaten (z. B. Gewicht, FTP), Fortschritt, Pläne, eigene Strecken und Workouts sowie Fahrten in dem Umfang, den du unter Konto › „Was online gespeichert wird“ festlegst (z. B. ohne Verlauf, ohne GPS). Fotos der Fahrten werden nie bei Supabase gespeichert, sondern nur auf deinem Gerät und, falls verbunden, in deinem eigenen NAS bzw. Cloud-Speicher. Während einer Fahrt werden außerdem alle 5 Sekunden aktuelle Werte gespeichert, damit du sie auf einem anderen Gerät live sehen kannst.</li>
    <li><b>Herzfrequenz:</b> Puls ist ein Gesundheitsdatum (Art. 9 DSGVO). Er wird nur mit deiner ausdrücklichen Einwilligung online gespeichert (Art. 9 Abs. 2 lit. a DSGVO). Du kannst die Einwilligung jederzeit unter Konto › „Was online gespeichert wird“ widerrufen.</li>
    <li><b>Bestenlisten (freiwillig):</b> je Fahrt Strecke, Titel, Datum, Distanz, Zeit, Höhenmeter, optional Leistung, TSS und XP. Andere Nutzer sehen in der Bestenliste deinen Anzeigenamen und deine Bestzeit. Abschaltbar; dann werden die Einträge gelöscht.</li>
    <li><b>Live-Funktionen:</b> In der Lobby und beim gemeinsamen Fahren werden Anzeigename, Avatar, Strecke und während der Fahrt etwa einmal pro Sekunde Position, Tempo, Leistung bzw. W/kg und Trittfrequenz an die anderen Teilnehmenden weitergeleitet (kein Puls). Diese Live-Daten werden nicht dauerhaft gespeichert. Mit „Für andere sichtbar: aus“ fährst du unsichtbar.</li>
    <li><b>Events und Teams:</b> Bei Event-Anmeldungen wird gespeichert, dass du angemeldet bist (andere sehen nur die Zahl der Anmeldungen). In einem Team sehen die anderen Mitglieder deinen Anzeigenamen (bei privatem Profil „Privates Mitglied“), dein Level und deine Kilometer der letzten 7 Tage.</li>
    <li><b>Freunde und Chat:</b> In der Namenssuche erscheinst du, solange „In der Suche auffindbar“ eingeschaltet ist (bei neuen Konten standardmäßig an, jederzeit unter Online › Freunde abschaltbar); Suchende sehen dann Anzeigename, Avatar und Level. Freunde können dich außerdem über deinen persönlichen Freundescode (jederzeit erneuerbar) oder über die Liste der gerade Online-Spieler anfragen. Zum Schutz vor dem massenhaften Abgreifen von Namen wird je Suche nur der Zeitpunkt gespeichert und nach einem Tag gelöscht. Erst wenn ihr eine Freundschaftsanfrage beide bestätigt habt, sieht dein Freund zusätzlich dein Team, deine Summen (Fahrten, Kilometer, Stunden, Höhenmeter) und – nur wenn du es unter Freunde ausdrücklich erlaubst – deine einzelnen Fahrten (Datum, Strecke, Distanz, Dauer, Höhenmeter, Ø Leistung). Gesundheitsdaten wie Puls, Gewicht oder Alter werden nie geteilt. Chat-Nachrichten (Text, Zeitpunkt, gelesen-Status) sind nur für dich und deinen Freund lesbar, auch für mich als Betreiber nicht über die App. Sie werden nach 12 Monaten automatisch gelöscht; eigene Nachrichten kannst du jederzeit löschen. Beim Löschen deines Kontos werden Freundschaften und alle Nachrichten mitgelöscht. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (von dir gewählte Funktion).</li>
  </ul>
  <p><b>Tresor-Verschlüsselung (empfohlen):</b> Auf Wunsch werden alle Abgleich-Daten (Fahrten, Einstellungen, Live-Fahrt) bereits in deinem Browser mit einem nur dir bekannten Tresor-Passwort verschlüsselt (AES-256-GCM). Supabase und ich als Betreiber können diese Daten dann nicht lesen. Nicht verschlüsselt werden können Anmeldedaten, Profil, Bestenlisten-Einträge und Live-Daten, weil der Dienst bzw. andere Nutzer sie lesen müssen.</p>
  <p><b>Rechtsgrundlagen:</b> Bereitstellung des Kontos und der von dir gewählten Funktionen: Art. 6 Abs. 1 lit. b DSGVO. Herzfrequenz: Einwilligung nach Art. 9 Abs. 2 lit. a DSGVO. Sicherheit und Missbrauchsschutz: Art. 6 Abs. 1 lit. f DSGVO.</p>
  <p><b>Admin-Zugriff:</b> Als Betreiber sehe ich Anzeigename, Rolle, Freischaltungsstatus, Level und Zeitpunkte der letzten Aktivität sowie Gesamtsummen. Einzelne Fahrten und Datenpakete anderer Nutzer kann ich nicht einsehen; Dateien eines Kontos kann ich nur im Rahmen einer Kontolöschung entfernen.</p>

  <h3>5. E-Mails</h3>
  <p>Bestätigungs-, Anmelde- und Sicherheitsmails verschickt Supabase über den Versanddienst <b>Resend</b> (resend.com) als Auftragsverarbeiter. Verarbeitet werden deine E-Mail-Adresse und der Mailinhalt. Es gibt keinen Newsletter und keine Werbung.</p>

  <h3>6. Dienste, die du selbst verbindest</h3>
  <p>Die folgenden Dienste werden nur kontaktiert, wenn du sie ausdrücklich einrichtest bzw. die Funktion auslöst. Dann gelten zusätzlich deren Datenschutzbestimmungen, und du bist gegenüber diesen Anbietern selbst Vertragspartner:</p>
  <ul>
    <li><b>Strava</b> (Strava Inc., USA): Hochladen von Fahrten und Laden von Routen mit deiner eigenen Strava-App.</li>
    <li><b>Cloud-Speicher</b> Google Drive (Google Ireland Ltd.), Microsoft OneDrive (Microsoft Ireland Operations Ltd.), Dropbox (Dropbox International Unlimited Company) oder dein eigenes NAS/WebDAV: Abgleich deiner Daten in deinen eigenen Speicher.</li>
    <li><b>Geländedaten:</b> Beim Laden von „echtem Gelände“ für eigene Strecken werden Höhendaten-Kacheln aus dem öffentlichen Datensatz „Terrain Tiles“ bei Amazon Web Services (AWS) abgerufen. Dabei wird deine IP-Adresse an AWS übermittelt.</li>
    <li><b>Echte Gebäude (OpenStreetMap):</b> Nur mit Konto und nach deiner Zustimmung. Beim Laden werden der Verlauf der Strecke (Korridor von 150 m) und technisch bedingt deine IP-Adresse an die Overpass-API (overpass-api.de, betrieben von der FOSSGIS e.V., Deutschland) übertragen. Die Gebäudedaten werden nur auf deinem Gerät gespeichert. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung, widerrufbar unter Einstellungen › App & Daten).</li>
    <li><b>Echte Straßenbilder (Mapillary):</b> Nur mit Konto, bei eigenen GPX-Strecken und nach deiner Einwilligung. Während der Fahrt fragt die App bei Mapillary (Meta Platforms Ireland Ltd., Dublin) Fotos entlang der Strecke ab; dabei werden Kartenausschnitte deiner Strecke und technisch bedingt deine IP-Adresse übertragen. Die Bilder stehen unter CC BY-SA 4.0 und werden nicht gespeichert. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung, jederzeit widerrufbar unter App &amp; Daten › Einwilligungen).</li>
    <li><b>Tour de IndooRado, Wochenliga und Bergkönig:</b> Mit Konto werden je Etappe deine Zeit sowie Anstiegs- und Sprintzeiten gespeichert, bei Bergkönig deine Bestzeit je Anstieg der eingebauten Strecken. Andere Angemeldete sehen dazu deinen Anzeigenamen (bei unsichtbarem Profil „Fahrer“). Tour-Ergebnisse werden nach 8 Wochen gelöscht. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</li>
    <li><b>Sprachsteuerung (optional, nach Einwilligung):</b> Die Spracherkennung übernimmt dein Browser. Chrome und Edge senden den Ton dafür an Google bzw. Microsoft, Safari je nach Gerät an Apple. IndooRado selbst speichert dabei nichts. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO.</li>
    <li><b>intervals.icu (optional):</b> Nur wenn du dort deinen eigenen API-Schlüssel einträgst und auf „intervals.icu“ tippst, wird die FIT-Datei der Fahrt direkt an intervals.icu (Intervals.icu Ltd.) gesendet. Der Schlüssel bleibt auf deinem Gerät.</li>
    <li><b>Erinnerungen:</b> Benachrichtigungen erzeugt die App auf deinem Gerät selbst; es werden dafür keine Daten an einen Push-Dienst geschickt.</li>
    <li><b>Zuschauer-Link:</b> Nur wenn du ihn während einer Fahrt selbst erzeugst. Wer den Link hat, sieht ohne Konto deinen Anzeigenamen, die Strecke, Tempo, Leistung, Trittfrequenz, Distanz, Höhenmeter, Zeit und das Höhenprofil, deinen Puls nur, wenn du das beim Erzeugen auswählst. Der Stand liegt in der Datenbank, bis du den Link beendest, spätestens 8 Stunden. Zuschauer können ein Emoji und optional einen Namen schicken; das wird nach 10 Minuten gelöscht. Angemeldete Freunde sehen zusätzlich einen Anruf-Knopf. Für die Anzeige auf dem Fernseher wird derselbe Link verwendet; zusätzlich sendet dein Gerät das Bild der Fahrt (3D-Welt bzw. Videofahrt, keine Kamera, kein Ton) per WebRTC direkt an höchstens zwei Fernseher, die den Link geöffnet haben – den Verbindungsaufbau vermittelt die Datenbank, Einträge werden nach 10 Minuten gelöscht; am Fernseher genügt ein Kurzcode (die ersten 8 Zeichen des Links), Abfragen dieses Codes sind begrenzt. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO, für den Puls Art. 9 Abs. 2 lit. a DSGVO (Einwilligung).</li>
    <li><b>Videoanrufe:</b> Nur mit Konto, zwischen bestätigten Freunden und nach deiner Zustimmung. Bild und Ton gehen direkt und Ende-zu-Ende-verschlüsselt von Gerät zu Gerät (WebRTC); sie laufen nicht über Supabase oder IndooRado und werden nicht aufgezeichnet. Für den Verbindungsaufbau tauschen die Geräte über Supabase technische Verbindungsdaten aus (u. a. IP-Adressen), die dein Gesprächspartner dabei sieht. Zum Ermitteln der Verbindung werden STUN-Server von Cloudflare Inc. und Nextcloud GmbH angefragt (sie erhalten technisch bedingt deine IP-Adresse). Ist keine direkte Verbindung möglich (z. B. in Gast-WLANs oder im Mobilfunk), wird der verschlüsselte Datenstrom über einen Weiterleitungsserver (TURN) von Cloudflare Inc. geleitet; Cloudflare kann Bild und Ton wegen der Ende-zu-Ende-Verschlüsselung nicht lesen, verarbeitet aber IP-Adressen und Datenmengen. Die Zugangsdaten dafür erzeugt eine Supabase-Funktion nur für die beiden Teilnehmer des Anrufs, gültig zwei Stunden. Cloudflare ist unter dem EU-US Data Privacy Framework zertifiziert. Gespeichert werden nur die Einladung (Raumname, Zeitpunkt) als private Chat-Nachricht zwischen euch beiden (gelöscht nach 12 Monaten) und für höchstens einen Tag, wer wen angerufen hat – damit nur ihr beide den Verbindungskanal nutzen könnt. Ein Sicherheitscode im Anruffenster lässt euch prüfen, dass niemand dazwischen sitzt. Bei Gruppenanrufen (höchstens 4 Personen) kann jeder Teilnehmer eigene Freunde hinzufügen; die Datenbank speichert dafür für höchstens einen Tag, wer zum Anruf gehört, und alle Teilnehmer verbinden sich direkt miteinander (sie sehen also gegenseitig IP-Adresse, Anzeigenamen sowie Bild und Ton). Optional kann ein Anruf über „↗“ in einem neuen Fenster beim Jitsi-Dienst meet.ffmuc.net (Freifunk München e.V.) geöffnet werden; dann gilt dessen Datenschutzerklärung. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung, widerrufbar).</li>
  </ul>

  <h3>7. Speicherdauer und Löschung</h3>
  <p>Online-Daten bleiben gespeichert, bis du sie löschst. Unter Konto kannst du jederzeit nur die Online-Daten löschen oder dein gesamtes Konto mit allen Daten. Technische Protokolle der Dienstleister werden nach deren Vorgaben automatisch gelöscht. Lokale Daten in deinem Browser löschst du selbst.</p>

  <h3>8. Deine Rechte</h3>
  <p>Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20; die App bietet dafür Export und Sicherungsdatei) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21). Erteilte Einwilligungen kannst du jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3). Du hast außerdem das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, z. B. bei: ${esc(L.authority)}.</p>

  <h3>9. Mindestalter</h3><p>IndooRado Online richtet sich an Personen ab 16 Jahren. Jüngere dürfen ein Konto nur mit Zustimmung der Erziehungsberechtigten anlegen.</p>

  <h3>10. Sicherheit</h3><p>Verbindungen sind verschlüsselt (HTTPS/TLS). Zugriffsregeln in der Datenbank stellen sicher, dass jede Person nur ihre eigenen Daten lesen kann. Zwei-Faktor-Anmeldung und die Tresor-Verschlüsselung sind verfügbar und empfohlen. Eine absolute Sicherheit kann bei Internetdiensten niemand garantieren.</p>

  <h3>11. Änderungen</h3><p>Ich passe diese Erklärung an, wenn sich Funktionen oder Rechtslage ändern. Es gilt die jeweils hier veröffentlichte Fassung (Stand oben).</p>`;
}

function nutzung() {
  return `<h2>Nutzungshinweise und Haftung</h2>
  <ul>
    <li><b>Experimentelles Hobbyprojekt:</b> IndooRado wird privat und unentgeltlich entwickelt. Funktionen können sich ändern, fehlerhaft sein oder eingestellt werden. Es besteht kein Anspruch auf Verfügbarkeit oder Datensicherung; erstelle regelmäßig eine Sicherung (Optionen › App › Daten).</li>
    <li><b>Training auf eigene Verantwortung:</b> IndooRado ersetzt keine ärztliche oder trainingswissenschaftliche Beratung. Kläre vor intensivem Training deine Belastbarkeit ab, achte auf Warnzeichen und höre bei Beschwerden sofort auf. Leistungs-, Puls- und Kalorienangaben sind Schätzungen.</li>
    <li><b>Geräte:</b> Die Ansteuerung von Smart-Trainern erfolgt über offene Bluetooth-Standards. Halte die Sicherheitshinweise des Herstellers ein und stelle sicher, dass Rad und Trainer fest stehen.</li>
    <li><b>Online-Funktionen:</b> Der Zugang kann nach einer Testphase von einer Freischaltung abhängen und bei Missbrauch gesperrt werden. Wähle einen Anzeigenamen, der keine Rechte Dritter verletzt und nicht beleidigend ist. Belästigung anderer Nutzer, das Fälschen von Bestenlisten oder Angriffe auf den Dienst sind untersagt.</li>
    <li><b>Haftung:</b> Ich hafte unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit. Im Übrigen ist die Haftung, soweit gesetzlich zulässig, ausgeschlossen, insbesondere für Datenverlust und für Schäden durch die Nutzung von Trainingsgeräten.</li>
    <li><b>Dienste Dritter:</b> Für Strava, Cloud-Speicher und andere selbst verbundene Dienste gelten deren Bedingungen.</li>
    <li><b>Chat und Videoanrufe:</b> Sei respektvoll. Belästigung, Bedrohung, Werbung, rechtswidrige Inhalte und das Aufzeichnen von Gesprächen ohne Einverständnis aller Beteiligten sind verboten. Du kannst andere jederzeit blockieren; bei Verstößen kann das Konto gesperrt werden.</li>
  </ul>`;
}

function lizenzen() {
  return `<h2>Verwendete Software und Lizenzen</h2>
  <ul>
    <li><b>three.js</b> (3D-Grafik), © three.js authors, MIT-Lizenz.</li>
    <li><b>supabase-js</b> (Online-Anbindung), © Supabase, MIT-Lizenz.</li>
    <li><b>Barlow</b> und <b>Barlow Condensed</b> (Schriften), © Jeremy Tribby, SIL Open Font License 1.1; lokal eingebunden.</li>
    <li><b>Höhendaten</b> für „echtes Gelände“: „Terrain Tiles“ (Mapzen/Linux Foundation, AWS Open Data) mit Daten u. a. von SRTM, GMTED, ETOPO1 und weiteren Quellen gemäß deren Lizenzen.</li>
    <li><b>Gebäudedaten</b> für „echte Gebäude“: © OpenStreetMap-Mitwirkende, verfügbar unter der Open Database License (ODbL), openstreetmap.org/copyright. Abgefragt über die Overpass-API.</li>
    <li><b>Videoanrufe</b>: WebRTC (im Browser eingebaut); Ausweichlösung Jitsi Meet (Apache-2.0-Lizenz) bei meet.ffmuc.net (Freifunk München e.V.).</li>
  </ul>
  <p>Alle Strecken, Workouts, Grafiken und Texte von IndooRado sind eigene Inhalte, soweit nicht anders angegeben.</p>`;
}
