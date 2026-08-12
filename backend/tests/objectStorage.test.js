"use strict";

// Prueft den lokalen Treiber und die Schluesselpruefung. Der S3-Treiber wird
// hier bewusst NICHT getestet: dafuer braeuchte es entweder ein Netzwerkziel
// oder einen nachgebauten SDK-Client, und beides prueft dann vor allem die
// Attrappe. Was hier zaehlt, ist der Vertrag, auf den sich die neun
// Aufrufstellen verlassen — vor allem: fehlende Objekte liefern null, sie
// werfen nicht.

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "plain-storage-"));
process.env.LOCAL_STORAGE_ROOT = TMP;
delete process.env.STORAGE_DRIVER; // Standard = local

const storage = require("../services/objectStorage");

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("assertSafeKey", () => {
  // Die Schluessel kommen aus der Datenbank. Beim lokalen Treiber wird daraus
  // ein Dateipfad — ein ".." darin liesse den Zugriff aus dem Verzeichnis
  // herauslaufen. Die Pruefung haelt das an einer Stelle statt an neun.
  it.each([
    ["Verzeichniswechsel", "../../etc/passwd"],
    ["versteckter Wechsel", "4/../../etc/passwd"],
    ["absoluter Unix-Pfad", "/etc/passwd"],
    ["absoluter Windows-Pfad", "C:\\Windows\\win.ini"],
    ["leer", ""],
    ["null", null],
  ])("weist %s ab", (_name, key) => {
    expect(() => storage.assertSafeKey(key)).toThrow();
  });

  it("normalisiert Backslashes zu Schraegstrichen", () => {
    expect(storage.assertSafeKey("4\\generated\\a.pdf")).toBe("4/generated/a.pdf");
  });

  it("laesst einen gewoehnlichen Schluessel unveraendert", () => {
    expect(storage.assertSafeKey("4/generated/a.pdf")).toBe("4/generated/a.pdf");
  });
});

describe("lokaler Treiber", () => {
  const KEY = "7/generated/beispiel.pdf";
  const INHALT = Buffer.from("%PDF-1.4 Testinhalt");

  it("meldet local als Treiber", () => {
    expect(storage.driverName()).toBe("local");
  });

  it("legt ab und liest zurueck, inklusive fehlender Zwischenverzeichnisse", async () => {
    await storage.put(KEY, INHALT, { contentType: "application/pdf" });
    expect(await storage.exists(KEY)).toBe(true);
    expect(await storage.getBuffer(KEY)).toEqual(INHALT);
  });

  it("liefert einen lesbaren Strom mit Groessenangabe", async () => {
    const obj = await storage.getStream(KEY);
    expect(obj).not.toBeNull();
    expect(obj.contentLength).toBe(INHALT.length);

    const teile = [];
    for await (const t of obj.stream) teile.push(t);
    expect(Buffer.concat(teile)).toEqual(INHALT);
  });

  it("ueberschreibt beim erneuten Ablegen unter demselben Schluessel", async () => {
    await storage.put(KEY, Buffer.from("neu"), { contentType: "application/pdf" });
    expect(await storage.getBuffer(KEY)).toEqual(Buffer.from("neu"));
  });

  // Der wichtigste Teil: die Aufrufer pruefen auf null, so wie sie vorher auf
  // fs.existsSync geprueft haben. Wuerde hier geworfen, antwortete jeder
  // betroffene Endpunkt mit 500 statt mit 404.
  it("liefert null statt einer Ausnahme, wenn das Objekt fehlt", async () => {
    expect(await storage.getBuffer("7/gibtesnicht.pdf")).toBeNull();
    expect(await storage.getStream("7/gibtesnicht.pdf")).toBeNull();
    expect(await storage.exists("7/gibtesnicht.pdf")).toBe(false);
  });

  it("loescht und ist dabei wiederholbar", async () => {
    await storage.remove(KEY);
    expect(await storage.exists(KEY)).toBe(false);
    await expect(storage.remove(KEY)).resolves.toBeUndefined(); // zweiter Aufruf bricht nicht
  });

  it("verweigert das Ablegen unter einem unsicheren Schluessel", async () => {
    await expect(storage.put("../ausbruch.txt", Buffer.from("x"))).rejects.toThrow();
    expect(fs.existsSync(path.join(TMP, "..", "ausbruch.txt"))).toBe(false);
  });
});

describe("assertConfigured", () => {
  it("ist beim lokalen Treiber immer zufrieden", () => {
    expect(() => storage.assertConfigured()).not.toThrow();
  });

  // Ohne diese Pruefung faellt eine vergessene Variable erst beim ersten
  // Upload auf — im Zweifel Tage nach dem Deploy und beim Kunden.
  it("benennt bei STORAGE_DRIVER=s3 die fehlenden Variablen", () => {
    jest.resetModules();
    const alt = { ...process.env };
    process.env.STORAGE_DRIVER = "s3";
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    process.env.S3_ACCESS_KEY_ID = "x";
    process.env.S3_SECRET_ACCESS_KEY = "y";

    const frisch = require("../services/objectStorage");
    expect(() => frisch.assertConfigured()).toThrow(/S3_ENDPOINT.*S3_BUCKET/);

    process.env = alt;
    jest.resetModules();
  });

  // Beim Einrichten wurden die spitzen Klammern aus der Beispielzeile
  // mituebernommen. Die Variablen galten damit als gesetzt, die App startete,
  // und erst der erste Upload scheiterte — mit einer Meldung ueber ungueltige
  // Hostnamen, die den Zusammenhang nicht erkennen liess.
  it("erkennt uebernommene Platzhalter statt echter Werte", () => {
    jest.resetModules();
    const alt = { ...process.env };
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://<region>.storage.impossibleapi.net";
    process.env.S3_REGION = "<region>";
    process.env.S3_BUCKET = "<dein-bucket>";
    process.env.S3_ACCESS_KEY_ID = "…";
    process.env.S3_SECRET_ACCESS_KEY = "…";

    const frisch = require("../services/objectStorage");
    expect(() => frisch.assertConfigured()).toThrow(/Platzhalter/);

    process.env = alt;
    jest.resetModules();
  });
});
