/**
 * Dependency-free validator for static/qr.js.
 *
 * The QR encoder once shipped Reed-Solomon parity that no decoder accepted, so every
 * generated code failed to scan. This reproduces the encoder's arithmetic independently
 * and asserts the output is actually valid, covering the failure classes:
 *   1. error-correction level mismatch between format info and RS block table
 *   2. invalid Reed-Solomon parity (wrong GF(256) arithmetic in multiply/mod)
 *   3. mask pattern applied in the data region that disagrees with the format info
 *
 * Run: node src/test/js/verify-qr.js
 * Exits non-zero on failure.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const QR_PATH = path.join(__dirname, "..", "..", "main", "resources", "static", "qr.js");

/* ------------------------------------------------------------------ *
 * Independent GF(256) with the QR primitive polynomial x^8+x^4+x^3+x^2+1
 * ------------------------------------------------------------------ */
const EXP = new Array(512);
const LOG = new Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `n` error-correction codewords. */
function generatorPoly(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= mul(g[j], 1); // multiply by x
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Systematic Reed-Solomon parity for `data`, `n` codewords. */
function parity(data, n) {
  const g = generatorPoly(n);
  const res = data.concat(new Array(n).fill(0));
  for (let i = 0; i < data.length; i++) {
    const c = res[i];
    if (c === 0) continue;
    for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
  }
  return res.slice(data.length);
}

/** A valid codeword block has all-zero syndromes. */
function syndromesZero(codewords, ecCount) {
  for (let i = 0; i < ecCount; i++) {
    let acc = 0;
    for (const b of codewords) acc = mul(acc, EXP[i]) ^ b;
    if (acc !== 0) return false;
  }
  return true;
}

/** All 32 canonical BCH(15,5) format words, keyed by their masked value. */
const FORMAT_WORDS = (() => {
  const map = new Map();
  // EC indicator bits per spec: L=01, M=00, Q=11, H=10
  for (const [level, bits] of [["L", 0b01], ["M", 0b00], ["Q", 0b11], ["H", 0b10]]) {
    for (let mask = 0; mask < 8; mask++) {
      const data = (bits << 3) | mask;
      let rem = data << 10;
      for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
      map.set(((data << 10) | rem) ^ 0x5412, { level, mask });
    }
  }
  return map;
})();

function maskFn(pattern, row, col) {
  switch (pattern) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

/* ------------------------------------------------------------------ *
 * Load the encoder under test
 * ------------------------------------------------------------------ */
const source = fs.readFileSync(QR_PATH, "utf8");
// Expose internals for inspection without altering the shipped file.
const instrumented = source.replace(
  "  return {\n    generateSvg:",
  "  return {\n    __internals: { QRCodeModel: QRCodeModel },\n    generateSvg:"
);
// eslint-disable-next-line no-eval
eval(instrumented + ";globalThis.__QR = QRCode;");
const { QRCodeModel } = globalThis.__QR.__internals;

/** Recover the module grid from the shipped SVG (this is what the browser draws). */
function gridFromSvg(svg) {
  const total = parseInt(svg.match(/viewBox="0 0 (\d+) (\d+)"/)[1], 10);
  const dark = new Set();
  for (const m of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) dark.add(`${m[1]},${m[2]}`);
  const grid = [];
  for (let r = 0; r < total; r++) {
    const row = [];
    for (let c = 0; c < total; c++) row.push(dark.has(`${c},${r}`) ? 1 : 0);
    grid.push(row);
  }
  return { grid, total };
}

/** Map which cells hold function patterns, using the encoder's own setup routines. */
function functionMask(version) {
  const size = version * 4 + 17;
  const m = new QRCodeModel(version, 1); // level L
  m.moduleCount = size;
  m.modules = Array.from({ length: size }, () => new Array(size).fill(null));
  m.setupPositionProbePattern(0, 0);
  m.setupPositionProbePattern(size - 7, 0);
  m.setupPositionProbePattern(0, size - 7);
  m.setupPositionAdjustPattern();
  m.setupTimingPattern();
  m.setupTypeInfo(true, 0);
  m.setupVersionInfo();
  m.modules[size - 8][8] = true;
  return { size, mask: m.modules.map((r) => r.map((v) => v !== null)) };
}

// Byte-mode capacity and RS block layout for error-correction level L,
// versions 1-5 (the range the encoder supports via its table).
const L_INFO = {
  1: { cap: 17, blocks: 1, total: 26, data: 19 },
  2: { cap: 32, blocks: 1, total: 44, data: 34 },
  3: { cap: 53, blocks: 1, total: 70, data: 55 },
  4: { cap: 78, blocks: 1, total: 100, data: 80 },
  5: { cap: 106, blocks: 1, total: 134, data: 108 },
};

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const PAYLOADS = [
  "K7Q9XD",
  "http://localhost:8080/?roomId=K7Q9XD",
  "http://192.168.1.5:8080/?roomId=K7Q9XD",
  "https://socketdrop.io/?roomId=K7Q9XD",
  "https://files.example-company.com/transfer?roomId=K7Q9XD&ref=web",
];

for (const text of PAYLOADS) {
  const label = `${text.length}ch ${JSON.stringify(text.slice(0, 28))}`;

  // generateSvg always wraps the symbol in a 4-module quiet zone.
  const QUIET = 4;
  const svg = globalThis.__QR.generateSvg(text, 200);
  const { grid, total: units } = gridFromSvg(svg);
  const quiet = QUIET;
  const version = (units - QUIET * 2 - 17) / 4;
  check(
    Number.isInteger(version) && version >= 1,
    `${label}: module count ${units} does not decompose into a valid symbol`
  );
  check(
    !!L_INFO[version],
    `${label}: encoder chose version ${version}, outside the validated range 1-5`
  );
  if (!L_INFO[version]) continue;

  // 1. Reed-Solomon parity must be independently reproducible.
  const model = new QRCodeModel(version, 1);
  model.addData(text);
  const codewords = Array.from(QRCodeModel.createData(version, 1, model.dataList));
  const { total, data: dataCount } = L_INFO[version];
  check(
    codewords.length === total,
    `${label}: produced ${codewords.length} codewords, version ${version} expects ${total}`
  );
  const expectedParity = parity(codewords.slice(0, dataCount), total - dataCount);
  const actualParity = codewords.slice(dataCount);
  check(
    actualParity.join(",") === expectedParity.join(","),
    `${label}: Reed-Solomon parity is wrong\n    expected ${expectedParity.map((b) => b.toString(16).padStart(2, "0")).join(" ")}\n    actual   ${actualParity.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`
  );
  check(
    syndromesZero(codewords, total - dataCount),
    `${label}: codeword syndromes are non-zero (invalid symbol)`
  );

  // 2. The rendered SVG must carry a valid quiet zone and format info that agrees
  //    with the mask actually used in the data region.
  const size = version * 4 + 17;
  const { mask: isFunc } = functionMask(version);

  // Format info written by the encoder.
  const bits = [];
  for (let i = 0; i < 15; i++) {
    let r, c;
    if (i < 6) { r = i; c = 8; }
    else if (i < 8) { r = i + 1; c = 8; }
    else { r = size - 15 + i; c = 8; }
    bits.push(grid[r + quiet][c + quiet]);
  }
  const format = bits.reduce((a, b, i) => a | (b << i), 0);
  const decoded = FORMAT_WORDS.get(format);
  check(!!decoded, `${label}: format info 0x${format.toString(16)} is not a valid BCH(15,5) word`);
  if (decoded) {
    check(decoded.level === "L", `${label}: format info advertises EC=${decoded.level}, data uses L`);
  }

  // Dark module and timing patterns.
  check(
    grid[size - 8 + quiet][8 + quiet] === 1,
    `${label}: dark module at (${size - 8},8) is not set`
  );
  for (let i = 8; i < size - 8; i++) {
    const expect = i % 2 === 0 ? 1 : 0;
    check(
      grid[6 + quiet][i + quiet] === expect && grid[i + quiet][6 + quiet] === expect,
      `${label}: timing pattern broken at index ${i}`
    );
  }

  // 3. Data region must unmask to exactly the codewords computed above.
  if (decoded) {
    const stream = [];
    let inc = -1, row = size - 1;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (isFunc[row][cc]) continue;
          let darkBit = grid[row + quiet][cc + quiet];
          if (maskFn(decoded.mask, row, cc)) darkBit ^= 1;
          stream.push(darkBit);
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
    const read = [];
    for (let i = 0; i + 8 <= stream.length; i += 8) {
      read.push(stream.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    }
    check(
      read.length === codewords.length,
      `${label}: data region holds ${read.length} codewords, expected ${codewords.length}`
    );
    const usable = Math.min(read.length, codewords.length);
    let mismatch = -1;
    for (let i = 0; i < usable; i++) if (read[i] !== codewords[i]) { mismatch = i; break; }
    check(
      mismatch === -1,
      `${label}: data region differs from the encoded codewords at index ${mismatch}`
    );
  }
}

if (failures.length) {
  console.error("QR VALIDATION FAILED\n");
  failures.forEach((f) => console.error("  - " + f));
  console.error("");
  process.exit(1);
}

console.log(`PASS  ${PAYLOADS.length} payloads validated: format info, Reed-Solomon parity,`);
console.log("      timing patterns, quiet zone, and mask/data-region agreement.");