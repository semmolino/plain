"use strict";

const zlib = require("zlib");
const { stripPng, stripJpeg, stripImageMetadata } = require("../services/imageStrip");

// ── Helfer: minimale, valide Bilder mit Metadaten bauen ──────────────────────
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function buildPngWithText() {
  const ihdr = pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
  const text = pngChunk("tEXt", Buffer.from("Author\x00Geheime Person", "latin1"));
  const idat = pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, 255, 0, 0])));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([PNG_SIG, ihdr, text, idat, iend]);
}

function jpegSeg(marker, data) {
  const len = Buffer.alloc(2); len.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xFF, marker]), len, data]);
}
function buildJpegWithExif() {
  const soi = Buffer.from([0xFF, 0xD8]);
  const app1 = jpegSeg(0xE1, Buffer.concat([Buffer.from("Exif\x00\x00"), Buffer.from("GPS 51.1,7.2 geheim")]));
  const dqt = jpegSeg(0xDB, Buffer.alloc(5, 1));
  const sos = Buffer.from([0xFF, 0xDA, 0x00, 0x03, 0x01, 0x12, 0x34, 0xFF, 0xD9]);
  return Buffer.concat([soi, app1, dqt, sos]);
}

describe("imageStrip — PNG", () => {
  const png = buildPngWithText();

  test("entfernt tEXt-Metadaten", () => {
    expect(png.includes(Buffer.from("Geheime Person"))).toBe(true);
    const out = stripPng(png);
    expect(out.includes(Buffer.from("Geheime Person"))).toBe(false);
  });

  test("behält Signatur und kritische Chunks (IHDR/IDAT/IEND)", () => {
    const out = stripPng(png);
    expect(out.slice(0, 8).equals(PNG_SIG)).toBe(true);
    for (const t of ["IHDR", "IDAT", "IEND"]) expect(out.includes(Buffer.from(t))).toBe(true);
  });
});

describe("imageStrip — JPEG", () => {
  const jpg = buildJpegWithExif();

  test("entfernt EXIF/APP1-Segment", () => {
    expect(jpg.includes(Buffer.from("GPS 51.1,7.2 geheim"))).toBe(true);
    const out = stripJpeg(jpg);
    expect(out.includes(Buffer.from("GPS 51.1,7.2 geheim"))).toBe(false);
  });

  test("behält Bilddaten (DQT/SOS) und EOI", () => {
    const out = stripJpeg(jpg);
    expect(out.includes(Buffer.from([0xFF, 0xDB]))).toBe(true); // DQT
    expect(out.includes(Buffer.from([0xFF, 0xDA]))).toBe(true); // SOS
    expect(out.slice(-2).equals(Buffer.from([0xFF, 0xD9]))).toBe(true); // EOI
  });
});

describe("imageStrip — Dispatcher", () => {
  test("unbekannter Typ bleibt unverändert (No-Op)", () => {
    const buf = Buffer.from("nicht-ein-bild");
    expect(stripImageMetadata(buf, "application/pdf").equals(buf)).toBe(true);
  });
  test("wählt anhand MIME den richtigen Stripper", () => {
    const png = buildPngWithText();
    expect(stripImageMetadata(png, "image/png").includes(Buffer.from("Geheime Person"))).toBe(false);
  });
});
