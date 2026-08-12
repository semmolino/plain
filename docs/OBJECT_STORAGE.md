# Dateiablage — Objektspeicher

Stand: 2026-08-12 · Adapter gebaut, alle Aufrufstellen umgestellt · Anbieterkonto und Bestandsumzug offen

Gehört zu [SCALINGO_MIGRATION.md](SCALINGO_MIGRATION.md), Baustelle A.

---

## Warum

Bis hierher schrieben neun Stellen direkt mit `fs.*` nach `backend/uploads/`. Auf
Railway ging das gut — der Container hat ein dauerhaftes Dateisystem. **Scalingo
hat keins:** nach jedem Deploy, jedem Neustart und jeder Skalierung ist das
Verzeichnis leer, und es gibt kein Volume-Addon, das man dazukaufen könnte.

Bei Logos wäre das ärgerlich. Bei **erzeugten Rechnungs-PDFs** ist es ein
Aufbewahrungsproblem: `services/invoices.js`, `services/finalInvoices.js` und
`services/partialPayments.js` legen dort Belege ab, die Jahre abrufbar bleiben
müssen.

---

## Anbieter: Impossible Cloud

Gewählt am 12.08.2026. Hamburg, S3-kompatibel, 7,99 €/TB im Monat ohne
Egress- und API-Gebühren.

**Ausschlaggebend war nicht der Preis.** Bei den zu erwartenden Mengen — einige
Gigabyte — liegt das gesamte Anbieterfeld zwischen 0 und 8 € im Monat.
Entscheidend war, dass Impossible Cloud **keinen US-Subprozessor** in der Kette
führt. Das ist die einzige Eigenschaft aus dem Vergleich, die in der
Datenschutzfolgenabschätzung einen Unterschied macht; alles andere hätte man
auch mit Hetzner, Scaleway oder IONOS bekommen.

Bewusst nicht gewählt: AWS S3, Cloudflare R2, Wasabi, Backblaze — technisch
tadellos, aber US-Eigentum und damit CLOUD-Act-behaftet, auch bei
EU-Rechenzentrum.

Die Wahl ist keine Einbahnstraße, siehe „Anbieterwechsel" unten.

---

## Aufbau

```
   9 Aufrufstellen
        │
        ▼
   services/objectStorage.js      put · getBuffer · getStream · exists · remove
        │
        ├── Treiber "local"   backend/uploads/        (Standard, Entwicklung)
        └── Treiber "s3"      @aws-sdk/client-s3      (Betrieb)
```

**Der Schlüssel ist der Dreh- und Angelpunkt.** Angesprochen wird über denselben
`STORAGE_KEY`, der schon vorher in `ASSET` und den Anhang-Tabellen stand — etwa
`4/generated/8f3c….pdf`. Der Wert war immer ein relativer, plattformunabhängiger
Pfad und ist damit ohne Umrechnung als Objektschlüssel verwendbar.

Daraus folgt das Angenehmste an dieser Umstellung: **es braucht keine
Datenbankmigration.** Dieselben Zeilen zeigen vorher auf eine Datei und nachher
auf ein Objekt.

### Was dabei zusammengeführt wurde

`streamPdfAsset`, `streamXmlAsset`, `storeGeneratedPdfAsAsset`,
`storeGeneratedXmlAsAsset` und `bestEffortDeleteAsset` standen **dreifach** im
Baum — in `invoices.js`, `finalInvoices.js` und `partialPayments.js`,
zeichengleich bis auf eine Abweichung, die schon Folgen hatte: `streamXmlAsset`
setzte in `partialPayments.js` keine No-Cache-Header, in `invoices.js` schon.
Derselbe Name, dasselbe erwartete Verhalten, unterschiedliches Ergebnis.

Sie liegen jetzt einmal in `services/generatedAssets.js` (323 Zeilen weniger).
Die drei Services exportieren die Namen unverändert weiter — die Controller
merken davon nichts.

---

## Konfiguration

| Variable | Bedeutung |
|---|---|
| `STORAGE_DRIVER` | `local` (Standard) oder `s3` |
| `S3_ENDPOINT` | Endpunkt-URL aus der Impossible-Cloud-Konsole |
| `S3_REGION` | Regionsname des Anbieters (Standard `eu-central-1`) |
| `S3_BUCKET` | Bucket-Name |
| `S3_ACCESS_KEY_ID` | Zugangsschlüssel |
| `S3_SECRET_ACCESS_KEY` | Geheimnis |
| `S3_FORCE_PATH_STYLE` | `true` (Standard) — Pfad- statt Host-Adressierung |
| `LOCAL_STORAGE_ROOT` | nur für Tests und das Umzugsskript; normalerweise leer |

`server.js` prüft die Vollständigkeit beim Start und **verweigert den Start**,
wenn bei `STORAGE_DRIVER=s3` etwas fehlt. Ohne diese Prüfung fiele eine
vergessene Variable erst beim ersten Datei-Upload auf — im Zweifel Tage nach
dem Deploy und beim Kunden.

Im Log steht dann eine Zeile `📦 Dateiablage: s3` bzw. `local`.

---

## Befund vom 12.08.: auch Railway hatte nie ein Volume

Nachgesehen im laufenden Container:

```
du -sh backend/uploads   →  4.0K   (leeres Verzeichnis)
Dateien: 0
Container laeuft seit    →  Tue Aug 11 18:16:52 2026
```

**Das flüchtige Dateisystem ist kein Scalingo-Thema, sondern der Ist-Zustand.**
`backend/uploads/` wird auf Railway bei jedem Deploy geleert; es hängt dort kein
Volume. Die Umstellung behebt also einen laufenden Fehler, statt einen künftigen
zu verhindern.

Aufgefallen ist es nie, weil Logos, Signaturen und Profilfotos **zusätzlich** als
base64 in der Datenbank liegen — `TENANT_SETTINGS.logo_data_uri`,
`co_<id>_sig_data_uri`, `EMPLOYEE.AVATAR_DATA_URI`. Der Kommentar in
`controllers/stammdaten.js` sagt den Grund: *„so it survives server redeploys"*.
Diese Umgehung deckt genau die sichtbaren Dinge ab. Was sie nicht abdeckt —
Rechnungs-PDFs, XRechnungs-XML, Beleganhänge, Login-Hero-Bilder — verschwand
still.

Zum Zeitpunkt des Befunds standen 180 `ASSET`-Zeilen (~31 MB) auf Dateien, die es
nicht mehr gab. **Alles davon Testdaten — das Produkt ist noch nicht live.** Es
gab deshalb nichts zu retten und Schritt 2 unten war ein Leerlauf. Nach dem
Umschalten stellt sich die Frage nicht mehr.

---

## Umschalten — Reihenfolge

Die Reihenfolge ist nicht beliebig. Schritt 2 **vor** Schritt 4, sonst zeigen
alle Bestandsverweise ins Leere.

0. **Konto betriebsfähig machen** — beides *vor* Schritt 3, nicht danach:
   - **Zahlungsart hinterlegen.** Impossible Cloud startet mit einem
     30-Tage-Testzeitraum und weist ausdrücklich darauf hin, dass die Daten
     danach ohne Zahlungsart nicht erhalten bleiben. Ein Testkonto als Ziel für
     Rechnungs-PDFs wäre genau der Fehler, den dieses Dokument verhindern soll.
   - **MFA einschalten** (Profile Settings). Das Konto enthält nach der
     Umstellung sämtliche Kundendateien — Belege, Anhänge, Profilfotos.
1. **Bucket anlegen** und auf **privat** lassen — er wird nie direkt aus dem
   Browser gelesen, die Rechteprüfung hängt am Backend (`findAssetForTenant`).
   **Zugangsschlüssel auf diesen einen Bucket beschränken** (IAM → Policies →
   Keys): `GetObject`, `PutObject`, `DeleteObject`, `ListBucket` genügen. Der
   Schlüssel liegt später in Railway- und Scalingo-Variablen; geht er verloren,
   soll er nicht das ganze Konto öffnen.
   **AVV anfordern** — nicht in der Storage-Konsole, sondern über den Help
   Center: DPA nach Art. 28, Unterauftragsverarbeiter, TOM, Speicherorte. Die
   Subprozessoren-Liste ist der Grund für die Anbieterwahl und gehört zur DSFA.
   Blockiert die technischen Schritte nicht, nur das produktive Umschalten.
2. **Bestandsdateien übertragen** — beim Erstumzug entfallen (siehe Befund oben:
   es lag nichts vor). Das Skript bleibt für den **Anbieterwechsel**, wo es dann
   echte Arbeit hat. Es läuft dort, wo die Dateien liegen — im Container per
   `railway ssh` bzw. `scalingo run`, nicht auf dem eigenen Rechner; dann müssen
   Kundendateien nicht über den Laptop wandern.
   ```bash
   node backend/scripts/migration/06_uploads_to_objectstorage.js --dry-run
   node backend/scripts/migration/06_uploads_to_objectstorage.js
   ```
   Wiederholbar: vorhandene Objekte werden übersprungen, ein abgebrochener Lauf
   einfach neu gestartet. Bei Fehlern endet es mit Code 1 — dann **nicht**
   umschalten.
3. **Variablen setzen:**
   ```bash
   scalingo --app planandsimple env-set \
     STORAGE_DRIVER=s3 \
     S3_ENDPOINT="…" S3_REGION="…" S3_BUCKET="…" \
     S3_ACCESS_KEY_ID="…" S3_SECRET_ACCESS_KEY="…"
   ```
4. **Neu starten** und die Abnahme unten durchgehen.

---

## Abnahme

### Zuerst: der Selbsttest

```bash
scalingo --app planandsimple run "node backend/scripts/storage-selftest.js"
# oder im Railway-Container:  node backend/scripts/storage-selftest.js
```

Schreibt ein Testobjekt, liest es als Puffer **und** als Strom zurück, vergleicht
byteweise, löscht es wieder.

**Warum das nicht der Startprüfung überlassen bleibt:** die sieht nur nach, ob die
Variablen gesetzt und frei von Platzhaltern sind. Ob Endpunkt, Bucket und
Zugangsdaten *zusammen* funktionieren, zeigt erst ein echter Schreibzugriff.
Beim Einrichten auf Scalingo hat genau dieser Test zwei Fehler nacheinander
gefunden, die der Start jeweils nicht bemerkt hatte — eine Region, die wörtlich
`<region>` hieß, und danach Zugangsdaten, die aus einem Auslassungszeichen
bestanden. Beide Male lief die App scheinbar sauber.

Nach jeder Änderung an den Speichervariablen einmal ausführen.

### Dann: durch die Anwendung

Der eine Test, der zählt, ist der **nach einem Neustart** — vorher beweist
nichts, dass die Datei den Container überlebt.

1. Datei hochladen (Anhang oder Logo) → erscheint in der Oberfläche
2. `scalingo --app planandsimple restart`
3. Dieselbe Datei erneut abrufen → **muss noch da sein**
4. Rechnung erzeugen → PDF öffnet sich
5. Neustart, dasselbe PDF erneut öffnen → muss noch da sein
6. Anhang löschen → verschwindet aus Liste und Bucket
7. Im Log: `📦 Dateiablage: s3`

---

## Anbieterwechsel

Der Adapter hat genau deshalb vier Methoden und kein anbieterspezifisches
Verhalten. Ein Wechsel ist:

1. Bucket beim neuen Anbieter anlegen
2. `06_uploads_to_objectstorage.js` erneut laufen lassen — gegen die neuen
   Variablen, mit dem alten Bucket als Quelle
3. `S3_ENDPOINT` / `S3_BUCKET` / Schlüssel umstellen, neu starten

Kein Codeeingriff, keine Datenbankänderung. Ein Nachmittag, kein Projekt.

---

## Offene Punkte

1. **Versionierung im Bucket einschalten.** Objektspeicher ist kein Backup — ein
   versehentliches `remove` ist genauso weg wie auf einer Festplatte. Bei diesen
   Datenmengen kostet Versionierung praktisch nichts.
2. **Bestandsumzug ist noch nicht gelaufen** — er braucht die Dateien von
   Railway und die Zugangsdaten.
3. **Signierte URLs** statt Durchreichen durch das Backend wären später eine
   Entlastung. Heute streamt das Backend jede Datei selbst, weil daran die
   Mandanten- und Rechteprüfung hängt (`findAssetForTenant`). Das ist die
   sichere Variante und bleibt vorerst so — bei Bildern in Listen könnte es
   irgendwann spürbar werden.
4. **Speicherlimit je Mandant** (`checkStorageLimit`) zählt weiterhin über die
   `FILE_SIZE`-Spalten, nicht über den Bucket. Das bleibt richtig, solange jede
   Datei eine Zeile hat — verwaiste Objekte werden beim Anlegen bereits
   aufgeräumt.
