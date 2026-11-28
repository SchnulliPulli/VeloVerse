// Anleitung: durchsuchbar, nach Themen gegliedert, Abschnitte zum Auf- und Zuklappen
import { RIDE } from '../shortcuts.js';
const T = [
  ['nav', '🧭', 'Wo finde ich was?', `<ul class="tips">
    <li><b>Start</b>: Begrüßung, Empfehlung für heute, Strecke, Trainingsplan, Missionen, Geräte, Fahrt einrichten, Woche und letzte Fahrten. Mit <b>✏️ Startseite anpassen</b> (ganz unten) blendest du Felder aus und änderst die Reihenfolge.</li>
    <li><b>Training</b>: Workouts, Trainingspläne und <b>Strecken</b> (inkl. Baukasten, GPX- und Videofahrten).</li>
    <li><b>Fahrten</b>: Verlauf aller Fahrten, Fortschritt &amp; Saison, Wochen- und Monatsberichte.</li>
    <li><b>Online</b>: Lobby, Freunde und Chat, Events &amp; Teams (mit Konto).</li>
    <li><b>Geräte</b> und <b>Einstellungen</b>: am Computer links im Menü, am Handy unter <b>⋯ Mehr</b>. Einstellungen: Profil · Fahrt &amp; Ton · Benachrichtigungen &amp; Privatsphäre · App &amp; Daten · Konto · Hilfe. Oben auf jeder Einstellungsseite gibt es eine <b>Suche</b>.</li>
    <li>Oben rechts: Geräte-Status, Nachrichten, dein <b>Konto-Menü</b> (Konten wechseln, Abmelden) und <b>⚡ Schnellstart</b>.</li>
    <li>In der Fahrt: unten die Knopfleiste, <b>⚙️ Optionen</b> öffnet Fahransicht und Ton ohne die Fahrt zu verlassen, <b>⋯</b> zeigt „Häufig“ und aufklappbar „Weitere“.</li></ul>`],
  ['start', '🚀', 'Erste Schritte', `<ol class="tips">
    <li><b>Profil</b> (Einstellungen › Profil): Name, <b>FTP</b> und Gewicht eintragen. Alle Workout-Watt und Zonen hängen an der FTP. FTP unbekannt? Fahr ein paar Mal – die App schätzt sie und schlägt sie auf der Startseite vor.</li>
    <li><b>Geräte</b> verbinden: Smart-Trainer, Pulsgurt, Trittfrequenz-Sensor, Lenkertasten. Ohne Geräte probierst du alles mit den <b>Demo-Geräten</b> aus.</li>
    <li>Oben rechts <b>⚡ Schnellstart</b> (letzte Strecke, sofort los) oder auf der Startseite Strecke und Workout wählen und „Fahren“. Die Fahrt startet, sobald du trittst.</li>
    <li>Am Ende <b>Beenden › Speichern</b>. Nur gespeicherte Fahrten zählen für Level, Saison, Missionen, Plan und Bestzeiten.</li>
  </ol><p class="small muted">Bluetooth gibt es in Chrome und Edge (Windows, macOS, Android, ChromeOS), nicht in Safari und nicht auf dem iPhone. Bei der ersten Fahrt erklärt eine kurze <b>Einführung</b> die Anzeigen (später wieder über Mehr › Einführung).</p>`],
  ['geraete', '📡', 'Geräte', `<ul class="tips">
    <li><b>Smart-Trainer</b> (FTMS): liefert Leistung und Kadenz und wird gesteuert – feste Watt (ERG), Steigung oder virtuelle Gänge.</li>
    <li><b>Pulsgurt</b>: Pulsanzeige, Pulszonen, Puls-Ziel-Modus, Musik nach Puls und adaptive Workouts.</li>
    <li><b>Lenkertasten</b> und Fernbedienungen: Tasten unter Geräte anlernen. Einmal klicken schaltet, dreimal schnell Plus springt im Workout vor, dreimal Minus zurück.</li>
    <li>Bekannte Geräte verbindet die App beim Start selbst. <b>Demo-Geräte</b> lassen sich auch während der Fahrt über Mehr › Demo an- und ausschalten; solche Fahrten werden nur gespeichert, wenn du das unter Einstellungen › App erlaubst.</li>
    <li><b>Demo-Modus als Minispiel</b>: Mit Demo-Geräten erscheint links in der Fahrt eine Steuerung – Trittfrequenz und Watt mit − / + (gedrückt halten zählt schnell), 🛑 Bremse halten, 🚀 Sprint, Spur ⬅ ➡. Tastatur: Bild ↑/↓ = Watt, Pos1/Ende = Trittfrequenz.</li></ul>`],
  ['fahren', '🚴', 'Fahren', `<ul class="tips">
    <li><b>Widerstand</b>: virtuelle Gänge (Gang × Kadenz × Steigung ergibt die Leistung, Schaltbereich unter Fahransicht), Steigung, ERG fix oder Puls-Ziel. Umschalten über den Modus-Knopf.</li>
    <li><b>Anzeigen</b>: Watt mit Zonenfarbe und FTP-Ring, Tempo, Strecke, Zeit, Höhenmeter, Puls, Kadenz, Höhenprofil, Karte, Mitfahrerliste. Eine Anzeige <b>lange gedrückt halten</b> hebt sie an – direkt an die neue Stelle ziehen und loslassen (wie Apps auf dem Handy). Mit <b>Anordnen</b> verschiebst, vergrößerst, versteckst und ergänzt du Anzeigen – getrennt für Computer, Handy hochkant und Handy quer.</li>
    <li><b>Karte</b> (Taste K oder Minikarte antippen): zoomen, verschieben und an jede Stelle <b>beamen</b>. Gebeamte Fahrten zählen nicht als Streckenbestzeit.</li>
    <li><b>Kamera</b> (Tasten 1–6, C; 6 = Rückblick nach hinten aufs Feld), <b>Fotomodus</b> (O), Fotos (P) und automatische Fotos an Gipfeln und im Ziel.</li>
    <li><b>Wetter und Tageszeit</b> (W): Morgen bis Nacht, klar bis Regen, oder automatisch.</li>
    <li><b>Mehr</b> (⋯): Kamera, Wetter, Musik, Trainingsbuddy, Demo-Geräte, Anordnen, Einführung, Tastenkürzel, Vollbild.</li>
    <li><b>Zum Menü</b> parkt die Fahrt pausiert, „Zurück zur Fahrt“ oder Treten setzt sie fort. Meldungen schließt du mit einmal Antippen.</li></ul>`],
  ['spielen', '🎮', 'Mitfahrer, Rennen und Spielmodi', `<ul class="tips">
    <li><b>Mitfahrer</b> (Taste N) geben Windschatten (bis 33 % weniger Luftwiderstand) und zählen beim Überholen. Anzahl und Stärke unter Fahransicht.</li>
    <li><b>Rennen gegen Bots</b>, <b>Zeitfahren</b> (allein gegen die Uhr) und die <b>Tagesherausforderung</b> (für alle gleich, Serie zählt) startest du auf der Startseite oder bei der Strecke.</li>
    <li><b>Sprints und Gipfel</b> mit Bestzeiten, <b>Zieltore</b> am Ende jedes Intervalls, <b>Power-ups</b> (Taste U) und <b>Sammelglocken</b> für Extra-XP.</li>
    <li><b>Geist</b>: deine Bestfahrt auf dieser Strecke als durchsichtiger Fahrer.</li>
    <li><b>Freunde-Geister</b>: in der Auswertung „👻 Als Geist“ teilt eine Fahrt als Datei oder Code. Freunde öffnen sie unter Fahrten › Importieren › Geist und fahren dann gegen dich (bis zu fünf Geister gleichzeitig, ohne Puls und Watt).</li>
    <li><b>Trainingsbuddy</b> (Mehr › Buddy): fährt locker neben dir her und plaudert ein wenig.</li>    <li><b>🐇 Pace-Partner</b> (⋯ in der Fahrt): eine Gruppe mit festem W/kg zum Mitfahren. <b>🏆 Tour de IndooRado</b> (Online › Events): fünf Etappen pro Woche mit gelbem, rotem und grünem Trikot. <b>👑 Bergkönig:</b> Bestzeit je Anstieg, angezeigt am Fuß des Anstiegs.</li>
    <li><b>🙋 Gesten</b> an echte Mitfahrer, <b>Wind</b> mit Böen (Fahrt &amp; Ton), <b>🎙️ Sprachsteuerung</b> (⋯ › Weitere › Sprache): Die App hört zu, solange der Knopf leuchtet. Du sprichst einfach einen Befehl, ohne Aktivierungswort: „Pause“ bzw. „weiter“, „schwerer“/„leichter“ (Gang bzw. Intensität), „nächstes Intervall“, „Intervall zurück“, „Foto“, „Kamera“, „Ride On“, „Musik“, „links“/„rechts“. Oben erscheint, was erkannt wurde, oder „nicht verstanden“. Die Erkennung macht der Browser (Chrome/Edge am besten, braucht Internet; Chrome schickt den Ton dazu an Google). In der eingestellten App-Sprache klappt es auch auf Englisch, Spanisch, Französisch, Italienisch und Niederländisch. Tipp: kurze, deutliche Befehle, laute Musik oder Lüfter direkt am Mikrofon stören.</li>
</ul>`],
  ['training', '🏋️', 'Workouts, Pläne und FTP', `<ul class="tips">
    <li>Workout-Ziele sind Prozent deiner FTP – ändert sich die FTP, passt sich alles an. Jedes Intervall zeigt Kadenz-Ziel und Tipp, ein Countdown piept vor dem Wechsel.</li>
    <li><b>Adaptiv</b>: bricht die Kadenz ein, sinkt der Widerstand kurz; ist der Puls lange am Anschlag, sinkt die Intensität. Mit + und − änderst du die Intensität in 2-%-Schritten.</li>
    <li><b>Workout-Editor</b> und <b>Plan-Editor</b>: eigene Workouts aus Bausteinen, eigene Pläne Woche für Woche. Import von .zwo, .erg, .mrc und Plänen als Text.</li>
    <li><b>Trainingspläne</b> führen Woche für Woche, passen die Intensität an deine Leistung an und zeigen die nächste Einheit auf der Startseite.</li>
    <li><b>FTP-Schätzung</b>: aus deinen besten 20, 10 oder 5 Minuten der letzten 90 Tage. Weicht sie deutlich ab, schlägt die Startseite die neue FTP vor. Genauer ist ein FTP-Test (unter Workouts).</li>
    <li><b>Empfehlung für heute</b> nach deiner Frische (TSB) und dem Plan.</li>    <li><b>Tagesform</b>: Vor einem Workout fragt die App „Wie fühlst du dich heute?“ – Müde oder Beine schwer senkt die Intensität, Wenig Zeit kürzt das Workout auf 20–60 Minuten (abschaltbar unter Fahrt &amp; Ton).</li>
    <li><b>Export für den Radcomputer</b>: Workout › Export › .fit (Garmin, Wahoo, Hammerhead; Leistung in % FTP). Ganze Pläne als ZIP mit einer FIT-Datei je Einheit.</li>
    <li><b>⏱️ Nach Zeit suchen</b>: Unter Training › Workouts oben deine verfügbare Zeit wählen (20 bis 120 min oder frei). Passende Workouts stehen vorn, andere werden angepasst: ganze Intervall-Wiederholungen fallen weg oder kommen dazu, Ein- und Ausfahren bleiben. Mit „💾 Behalten“ wird die angepasste Fassung ein eigenes Workout.</li>
    <li><b>🎯 Plan für mein Ziel</b> (Training › Pläne): Ziel, Datum, Stunden pro Woche und Schwerpunkt angeben – die App baut den Plan rückwärts mit Grundlage, Aufbau, Spitze, Erholungswochen und lockerer Woche vor dem Ziel.</li>
    <li><b>Wie hart war's?</b> Nach jeder Workout-Fahrt kurz einschätzen – der Plan passt die nächsten Einheiten an. <b>🧬 Fahrertyp</b> unter Fortschritt zeigt Stärken und Schwächen. <b>🍌 Ernährung:</b> Erinnerungen bei langen Fahrten, Verbrauch in der Auswertung.</li>
    <li><b>Spiel-Extras bei Workouts</b> (Power-ups, Werkstatt-Teile, Wind) sind standardmäßig aus, damit Tempo und Strava-Daten echt bleiben. Einschalten unter Fahrt &amp; Ton.</li>
</ul>`],
  ['strecken', '🗺️', 'Strecken und Baukasten', `<ul class="tips">
    <li>Fast 30 eingebaute Welten von Hügelland bis Weltall, Tiefsee, Lava-Insel, Wolken und Zuckerland. Jede Strecke zeigt ein Vorschaubild.</li>
    <li><b>🧱 Strecken-Baukasten</b> (Training › Strecken › Baukasten): Bausteine antippen – Geraden, Kurven, Spitzkehren, Serpentinen, Anstiege, Steilwände, Abfahrten, Achterbahn, Korkenzieher und mehr. Jeden Baustein in Länge, Steilheit und Richtung anpassen, Landschaft und Belag wählen, als Rundkurs schließen, speichern und fahren. Vorlagen und 🎲 Zufall helfen beim Start.</li>
    <li><b>🏙️ Echte Gebäude</b> (bei importierten echten Strecken, mit Anmeldung): Häuser, Kirchen und Hallen entlang der Strecke aus OpenStreetMap, in echter Form und Höhe. Laden auf der Seite der Strecke.</li>
    <li><b>GPX und Strava-Routen</b> importieren; auf Wunsch mit <b>echtem Gelände</b> aus einem frei verfügbaren Höhenmodell.</li>
    <li>Einmal die ganze Strecke fahren bringt das <b>Routen-Abzeichen</b> 🏅 (+100 XP).</li>    <li><b>🎬 Videofahrt</b>: Eigene Aufnahme (GoPro, Handy) plus GPX der Ausfahrt laden. Das Video läuft so schnell, wie du trittst, der Widerstand folgt dem Anstieg. Das Video bleibt auf deinem Gerät. Taste V wechselt zwischen Video und 3D-Welt.</li>
    <li><b>Echte Straßenbilder</b>: Bei eigenen GPX-Strecken zeigt die App Fotos der echten Straße (Mapillary), mit Konto und Einwilligung. Schlüssel unter App &amp; Daten.</li>
</ul>`],
  ['fortschritt', '🏆', 'Level, Saison und Werkstatt', `<ul class="tips">
    <li><b>XP</b> gibt es für Kilometer, Zeit, Höhenmeter, Gipfel, Sprints, Zieltore, Überholen, Bestwerte, Missionen, Plan-Einheiten und Multiplayer. Level schalten Trikotfarben, Räder, Tiere und Extras im <b>Avatar</b> frei.</li>
    <li><b>Wochenmissionen</b> und <b>Serien</b> (mehrere Tage in Folge geben Bonus-XP).</li>
    <li><b>Saison</b> (Fahrten › Fortschritt & Saison): jedes Quartal ein Belohnungspfad mit 25 Stufen – Saisonfarben für den Avatar, Titel, XP und am Ende ein Pokal mit Gold-Lack.</li>
    <li><b>Werkstatt</b>: jede dritte Saisonstufe bringt einen Teile-Gutschein 🔧 für bessere Laufräder, Rahmen, Reifen und Bekleidung. Sie machen dich ein wenig schneller; sobald echte Mitfahrer auf der Strecke sind, gelten für alle gleiche Bedingungen.</li>    <li><b>🏆 Wochenliga</b> (mit Konto, freiwillig): 20 Fahrer auf deiner Stufe sammeln eine Woche lang Erfahrungspunkte. Die besten 5 steigen auf (Bronze bis Diamant), wer nicht fährt, steigt ab.</li>
    <li><b>🧊 Serien-Schutz</b>: Für jede Woche mit 3 Fahrtagen gibt es einen (höchstens 2). Er überbrückt automatisch einen fehlenden Tag, damit deine Serie und der XP-Bonus bleiben.</li>
</ul>`],
  ['online', '🌐', 'Online: Mitfahren, Events und Teams', `<ul class="tips">
    <li><b>Konto</b> (Einstellungen › Konto): Anmeldung mit Passwort oder <b>Code per E-Mail</b>, empfohlen mit <b>Zwei-Faktor</b> (Authenticator-App) – richte am besten eine zweite App als Ersatz ein. Ist alles verloren, kann der Admin die 2FA zurücksetzen. Mehrere Konten lassen sich über das Avatar-Menü oben wechseln.</li>
    <li><b>Freunde</b> (Online › Freunde): Spieler suchen, Anfrage schicken – erst wenn beide zustimmen, seht ihr Level, Wochen- und Gesamtstatistik und könnt <b>chatten</b>. Einzelne Fahrten sieht ein Freund nur, wenn du es erlaubst. Puls, Gewicht oder Alter sieht nie jemand. Freundschaft beenden und Blockieren geht jederzeit.</li>
    <li><b>📹 Videoanruf</b> (im Chat eines Freundes „Anrufen“): Vor jedem Anruf wählst du: Bild und Ton, nur Ton oder nur Bild – der Browser fragt nur das jeweils Nötige ab. Bild und Ton gehen direkt und verschlüsselt zwischen euren Geräten. Dein Freund bekommt einen Klingel-Hinweis oder findet die Einladung im Chat und auf seiner Startseite. Das Anruffenster lässt sich verschieben (am Kopf ziehen) und in der Größe ändern (Ecke unten rechts), Mikrofon und Kamera einzeln aus, und bleibt auch während der Fahrt offen. Mit „👥“ lädst du deinen Gesprächspartner zu einer gemeinsamen Fahrt ein. Klappt die direkte Verbindung in einem sehr strengen Netzwerk nicht, öffnet „↗“ den Anruf über Jitsi in einem neuen Fenster.</li>
    <li><b>💬 Nachrichten</b>: Der Knopf oben in der Kopfleiste und auf der Startseite zeigt, wie viel Neues da ist, und öffnet ein Fenster mit der neuesten Nachricht je Freund, Freundschaftsanfragen zum direkten Annehmen und Anruf-Einladungen. Antippen öffnet den Chat.</li>
    <li><b>Wer gerade online ist</b> (unten in der Lobby): sieh, wer fährt, schick direkt eine Freundschaftsanfrage, <b>fahr mit</b> (du landest direkt hinter dem anderen) oder <b>lade ein</b>. Echte Spieler haben einen Pfeil und ein Leuchten über dem Kopf.</li>
    <li><b>Eigene Strecken teilen</b>: Fährst du eine Baukasten-Strecke, können andere einfach mitfahren – die Strecke wird bei ihnen automatisch nachgebaut. Das klappt auch in Gruppenfahrten und Events. Importierte GPX-Strecken lassen sich (noch) nicht teilen.</li>
    <li><b>Lobby</b>: Gruppenfahrten und Rennen mit gemeinsamem Start, gleichem Wetter und optional einem gemeinsamen Workout oder Plan.</li>
    <li><b>📅 Events</b> (Online › Events & Teams): geplante Gruppenfahrten. Anmelden, zur Startzeit „Jetzt beitreten“. Die Startseite erinnert dich.</li>
    <li><b>🛡️ Teams</b>: gründen oder beitreten (ein Team pro Person) und gemeinsam Kilometer sammeln, gewertet über die letzten 7 Tage.</li>
    <li>Ride Ons gehen auch an echte Mitspieler; beim gemeinsamen Fahren zählt die gemeinsame Zeit, es gibt Duelle und Gruppenbonus.</li>    <li><b>📺 Zuschauer-Link</b>: In der Fahrt unter ⋯ › Zuschauer. Freunde und Familie sehen dich live im Browser – auch ohne Konto – und feuern mit Emojis an.</li>
    <li><b>Gruppenanruf</b>: Im Anruffenster mit ➕ weitere Freunde dazuholen, bis zu 4 Personen.</li>
</ul>`],
  ['ton', '🎵', 'Ton, Musik und Sprachansagen', `<ul class="tips">
    <li><b>Geräusche</b> (Einstellungen › Fahrt & Ton): Fahrtwind, Reifen, Kette, Natur, Countdown, Fanfaren – jedes mit eigenem Regler. Taste M schaltet alles stumm.</li>
    <li><b>Musik</b>: zehn Stile (Chill, Lo-Fi, Ambient, Synthwave, House, Drive, Techno, Rock, Drum & Bass, 8-Bit) mit mehreren Stücken. Tempo nach Stil, fest oder <b>im Takt deiner Trittfrequenz</b>. Wird mit Leistung oder Puls intensiver. Nächstes Stück: Taste T oder Mehr › Nächstes Stück. Oder eigene Musikdateien.</li>
    <li><b>Sprachansagen</b>: eine Stimme sagt Intervalle, Anstiege, Gipfelzeiten, Bestleistungen, Runden und Zwischenstände (alle 1, 5 oder 10 km) an – ideal, wenn du nicht auf den Bildschirm schaust. Themen, Stimme und Tempo einstellbar.</li></ul>`],
  ['tasten', '⌨️', 'Tastenkürzel und Barrierefreiheit', `<table class="tbl keys"><tr><th>Taste</th><th>In der Fahrt</th></tr>${RIDE.map(([k, l]) => `<tr><td>${k.split(' / ').map(x => `<kbd>${x}</kbd>`).join(' / ')}</td><td>${l}</td></tr>`).join('')}</table>
    <ul class="tips"><li>Die Taste <kbd>?</kbd> zeigt die Übersicht überall in der App.</li>
    <li><b>Barrierefreiheit</b> (Einstellungen › App & Daten): Schriftgröße bis 130 %, hoher Kontrast, weniger Bewegung (keine Kamerafahrten und Animationen). Alles ist per Tastatur bedienbar, Dialoge schließen mit Esc, Meldungen werden Bildschirmlesern vorgelesen.</li></ul>`],
  ['daten', '🔒', 'Daten, Tresor und Strava', `<ul class="tips">
    <li>Ohne Konto bleibt <b>alles im Browser</b> dieses Geräts; die App sendet dann nichts ins Internet. Unter Profil gibt es eine Sicherungsdatei zum Herunterladen und Einspielen.</li>
    <li><b>Online-Abgleich</b>: Mit Konto werden Einstellungen und Fahrten zwischen deinen Geräten abgeglichen (verschlüsselt übertragen über HTTPS). Fotos der Fahrten landen nie im Konto, nur in deinem verbundenen NAS oder Cloud-Speicher; die App zeigt Fahrt und Fotos zusammen an.</li>
    <li><b>🔐 Tresor</b> (Konto › Tresor, empfohlen): verschlüsselt deine Online-Daten schon im Browser mit einem eigenen Tresor-Passwort (AES-256). Dann kann sie auch der Server-Betreiber nicht lesen. Passwort gut aufheben – ohne es sind die Online-Daten nicht wiederherstellbar.</li>
    <li>Alternativ Abgleich über <b>NAS (Synology)</b>, OneDrive, Google Drive oder Dropbox (Einstellungen › App & Daten).</li>
    <li><b>Strava</b>: „Zu Strava“ in der Auswertung speichert FIT-Datei und Bild und öffnet die Upload-Seite. Mit eigener Strava-API-App (braucht ein Strava-Abo) geht der Upload automatisch. Bisherige Fahrten übernimmst du unter Fahrten › Importieren (FIT, ZIP-Export oder Strava).</li>
    <li><b>Teilen</b>: „📤 Teilen“ erstellt ein schickes Bild mit Karte und Kennzahlen für soziale Netzwerke.</li></ul>`],
  ['handy', '📱', 'Handy und Tablet', `<ul class="tips">
    <li>Auf dem Handy wählt die App automatisch eine kompakte Ansicht. Die Fahrtanzeige passt sich hochkant und quer an, jede Lage hat ihre eigene Anordnung.</li>
    <li><b>Wischen</b>: Seitlich über die Seite wischen springt zum nächsten bzw. vorherigen Reiter (z. B. Profil → Avatar → Fahrt & Ton).</li>
    <li>Als App installieren: im Browser-Menü „Zum Startbildschirm hinzufügen“.</li>
    <li><b>Live-Ansicht</b>: Läuft auf einem anderen Gerät deines Kontos eine Fahrt, siehst du sie live auf der Startseite. Pro Konto läuft immer nur eine Fahrt gleichzeitig.</li>    <li><b>👨‍👩‍👧 Familienprofile</b>: Unter Einstellungen › Profil mehrere Personen anlegen, jede mit eigenen Fahrten und Fortschritt. Kinderprofile haben sanften Widerstand, kurze bunte Fahrten und keinen Online-Bereich.</li>
    <li><b>📺 Fernseher-Modus</b> (App &amp; Daten): große Schrift, Bedienung mit Pfeiltasten der Fernbedienung. Gamepads gehen immer. Das Handy wird mit demselben Konto in der Handy-Ansicht zur Fernbedienung: Pause, Gänge, Kamera, Ride On, Foto, Musik sowie Workout (Intervall zurück/neu/weiter, Intensität ±2 %) und Beenden mit Speichern.</li>
    <li><b>📡 Auf Fernseher</b> (in der Fahrt unter ⋯, mit Konto): Android und Chrome am PC streamen die große Fahrtanzeige auf Chromecast/Google TV. Fernseher mit Browser (Fire TV, Android TV, Smart-TV): <code>indoorado.de/tv</code> öffnen und den angezeigten Code eingeben. iPhone/iPad: Kontrollzentrum › Bildschirmsynchronisierung zum Apple TV. Der Fernseher zeigt links das Live-Bild deiner Fahrt (3D-Welt bzw. Videofahrt) und rechts die großen Werte; das Bild geht direkt vom Fahrgerät zum Fernseher, am besten im selben WLAN.</li>
    <li><b>🔔 Erinnerungen</b> (App &amp; Daten): Training des Tages, Serie in Gefahr, Freund fährt los. <b>📅 Kalender:</b> beim aktiven Plan unter Pläne. <b>📲 Als App installieren:</b> Hinweis auf der Startseite oder unter App &amp; Daten.</li>
</ul>`],
  ['probleme', '🛠️', 'Wenn etwas nicht klappt', `<ul class="tips">
    <li><b>Ruckelt die Fahrt?</b> Die App senkt die Auflösung selbst. Zusätzlich hilft Einstellungen › App & Daten › Grafik „Mittel“ oder „Niedrig“.</li>
    <li><b>Gerät wird nicht gefunden?</b> Chrome oder Edge verwenden, Bluetooth am Gerät einschalten, andere Apps (z. B. auf dem Handy) vom Trainer trennen.</li>
    <li><b>Online-Probleme?</b> Einstellungen › Konto › Verbindung prüft Schritt für Schritt Anmeldung, Datenbank und Live-Verbindung. Das <b>Verbindungsprotokoll</b> darunter hält jeden Abriss fest (auch während der Fahrt); der Langzeittest prüft bis zu 2 Stunden lang alle 10 Sekunden.</li>
    <li><b>Neue Version?</b> Die App aktualisiert sich beim nächsten Öffnen. Die Versionsnummer steht unten links im Menü.</li></ul>`],
];
export async function render(el) {
  el.innerHTML = `
  <section class="pagehead"><h1>Anleitung</h1><span class="small muted">Tippe auf ein Thema oder suche nach einem Stichwort</span></section>
  ${document.documentElement.lang !== 'de' ? '<p class="small muted">ℹ️ Die ausführliche Anleitung gibt es derzeit nur auf Deutsch. Einzelne Teile sind übersetzt.</p>' : ''}
  <div class="helpsearch"><input class="inp" id="hQ" type="search" placeholder="🔍 z. B. Geist, Tresor, Schalten, Musik …" aria-label="Anleitung durchsuchen"></div>
  <nav class="helptiles">${T.map(([id, i, t]) => `<a href="#" data-go="${id}"><span>${i}</span>${t}</a>`).join('')}</nav>
  <div class="helpbody">${T.map(([id, i, t, b], n) => `<details class="card help" id="h-${id}" ${n === 0 ? 'open' : ''}><summary><span>${i}</span> ${t}</summary><div class="helpin">${b}</div></details>`).join('')}</div>
  <section class="card"><h2>⚖️ Rechtliches</h2><p class="small"><a href="#/legal/impressum">Impressum</a> · <a href="#/legal/datenschutz">Datenschutzerklärung</a> · <a href="#/legal/nutzung">Nutzungsbedingungen</a> · <a href="#/legal/lizenzen">Lizenzen</a></p></section>
  <p class="small muted" id="hNone" hidden>Nichts gefunden. Probier ein anderes Wort.</p>`;
  el.querySelector('.helptiles').onclick = e => { const a = e.target.closest('[data-go]'); if (!a) return; e.preventDefault(); const d = el.querySelector('#h-' + a.dataset.go); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // Suche: passende Abschnitte öffnen, andere ausblenden, Treffer markieren
  const q = el.querySelector('#hQ');
  q.oninput = () => {
    const w = q.value.trim().toLowerCase(); let any = false;
    for (const d of el.querySelectorAll('details.help')) {
      d.querySelectorAll('mark').forEach(m => m.replaceWith(m.textContent)); d.normalize();
      const hit = !w || d.textContent.toLowerCase().includes(w); d.hidden = !hit; any ||= hit;
      if (w && hit) { d.open = true; const walk = document.createTreeWalker(d.querySelector('.helpin'), NodeFilter.SHOW_TEXT), nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
        for (const n of nodes) { const i = n.data.toLowerCase().indexOf(w); if (i < 0) continue; const r = n.splitText(i); r.splitText(w.length); const m = document.createElement('mark'); m.textContent = r.data; r.replaceWith(m); } }
    }
    el.querySelector('#hNone').hidden = any;
  };
}
