// Independent batch codec for the interoperability fixtures. Node.js, no packages.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function hash(...parts) {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
}

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
    }
  }
  return (~crc) >>> 0;
}

// Logarithm tables using x as the generator modulo 0x11d.
const exp = new Uint8Array(510);
const log = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i++) {
  exp[i] = exp[i + 255] = x;
  log[x] = i;
  x <<= 1;
  if (x & 256) x ^= 0x11d;
}
function mul(a, b) {
  return a && b ? exp[log[a] + log[b]] : 0;
}

const params = Buffer.from('0101004000400000', 'hex');
function describe(raw) {
  assert(raw.subarray(0, 8).equals(params));
  const length = raw.readBigUInt64BE(8);
  assert(length <= 67108864n);
  const symbols = Math.ceil(Number(length) / 64);
  const sizes = Array.from({ length: Math.ceil(symbols / 64) },
    (_, g) => Math.min(64, symbols - 64 * g));
  return { raw, length: Number(length), sizes, key: hash('OATP-ID-v1\0', raw) };
}

function coefficients(m, g, esi) {
  const k = m.sizes[g];
  const a = Buffer.alloc(k);
  if (esi < k) {
    a[esi] = 1;
    return a;
  }
  const fields = Buffer.alloc(14);
  fields.writeUInt32BE(g);
  fields.writeUInt32BE(esi, 4);
  fields.writeUInt16BE(k, 8);
  for (let offset = 0; offset < k; offset += 32) {
    fields.writeUInt32BE(offset / 32, 10);
    hash('OATP-COEF-v1\0', m.key, fields).copy(a, offset);
  }
  if (!a.some(Boolean)) a[0] = 1;
  return a;
}

function frame(m, kind, g, esi, payload) {
  const f = Buffer.alloc(100);
  f.write('OATP');
  f[5] = 1;
  f[6] = kind;
  m.key.copy(f, 8, 0, 16);
  f.writeUInt32BE(g, 24);
  f.writeUInt32BE(esi, 28);
  payload.copy(f, 32);
  f.writeUInt32BE(crc32c(f.subarray(0, 96)), 96);
  return f;
}

function symbol(data, m, g, esi) {
  const payload = Buffer.alloc(64);
  for (const [i, factor] of coefficients(m, g, esi).entries()) {
    if (!factor) continue;
    const start = g * 4096 + i * 64;
    for (let j = 0; j < 64 && start + j < data.length; j++) {
      payload[j] ^= mul(factor, data[start + j]);
    }
  }
  return frame(m, 2, g, esi, payload);
}

function encode(data, rounds = 0, mode = 'continuous') {
  const raw = Buffer.alloc(64);
  params.copy(raw);
  raw.writeBigUInt64BE(BigInt(data.length), 8);
  hash(data).copy(raw, 16);
  const m = describe(raw);
  const announcement = frame(m, 1, 0xffffffff, 0, raw);
  const frames = [announcement];
  const limits = m.sizes.map(k => k + Math.ceil(k / 2));
  let count = 0;
  if (rounds > 0) {
    for (let round = 0; round < rounds; round++) {
      for (let position = 0; position < limits.length; position++) {
        let g = position;
        if (mode === 'continuous-rotating') g = (round + position) % limits.length;
        if (mode === 'continuous-alternating' && round % 2) g = limits.length - 1 - position;
        frames.push(symbol(data, m, g, limits[g] + round));
        if (++count % 8 === 0) frames.push(announcement);
      }
    }
    return Buffer.concat(frames);
  }
  for (let esi = 0; esi < Math.max(0, ...limits); esi++) {
    for (const [g, limit] of limits.entries()) {
      if (esi >= limit) continue;
      frames.push(symbol(data, m, g, esi));
      if (++count % 8 === 0) frames.push(announcement);
    }
  }
  if (count % 8) frames.push(announcement);
  return Buffer.concat(frames);
}

// Batch Gaussian elimination on augmented rows, including redundant equations.
function solve(rows, k) {
  let rank = 0;
  for (let col = 0; col < k; col++) {
    const pivot = rows.findIndex((r, i) => i >= rank && r[col]);
    if (pivot < 0) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const p = rows[rank++];
    const inverse = exp[255 - log[p[col]]];
    for (let j = col; j < p.length; j++) p[j] = mul(p[j], inverse);
    for (const r of rows) {
      if (r === p || !r[col]) continue;
      const factor = r[col];
      for (let j = col; j < r.length; j++) r[j] ^= mul(factor, p[j]);
    }
  }
  assert(rows.slice(rank).every(r => !r.some(Boolean)), 'inconsistent generation');
  const data = rank === k ? Buffer.concat(rows.slice(0, k).map(r => r.subarray(k))) : null;
  return { rank, data };
}

function decode(stream, report = false) {
  assert.equal(stream.length % 100, 0);
  let m, groups;
  for (let pos = 0; pos < stream.length; pos += 100) {
    const f = stream.subarray(pos, pos + 100);
    assert.equal(f.readUInt32BE(96), crc32c(f.subarray(0, 96)));
    assert(f.subarray(0, 6).equals(Buffer.from('4f4154500001', 'hex')));
    assert.equal(f[7], 0);
    const g = f.readUInt32BE(24), esi = f.readUInt32BE(28);
    const body = f.subarray(32, 96);
    if (f[6] === 1) {
      assert.equal(g, 0xffffffff);
      assert.equal(esi, 0);
      if (m) assert(body.equals(m.raw));
      else {
        m = describe(body);
        groups = m.sizes.map(() => []);
      }
    }
    assert(m && f.subarray(8, 24).equals(m.key.subarray(0, 16)));
    if (f[6] === 1) continue;
    assert.equal(f[6], 2);
    assert(g < groups.length);
    groups[g].push(Buffer.concat([coefficients(m, g, esi), body]));
  }
  assert(m);
  const results = groups.map((rows, g) => solve(rows, m.sizes[g]));
  const ranks = results.map(result => result.rank);
  if (results.some(result => result.data === null)) {
    assert(report, 'incomplete generation');
    return JSON.stringify({ ranks, delivered: false });
  }
  const padded = Buffer.concat(results.map(result => result.data));
  const data = padded.subarray(0, m.length);
  assert(!padded.subarray(m.length).some(Boolean));
  assert(hash(data).equals(m.raw.subarray(16, 48)));
  return report ? JSON.stringify({ ranks, delivered: true }) : data;
}

const [mode, input, output, argument] = process.argv.slice(2);
const source = readFileSync(input);
let result;
if (['continuous', 'continuous-alternating', 'continuous-rotating'].includes(mode)) {
  const rounds = Number(argument);
  assert(Number.isSafeInteger(rounds) && rounds > 0);
  result = encode(source, rounds, mode);
} else if (mode === 'encode') {
  result = encode(source);
} else {
  assert(['decode', 'progress'].includes(mode));
  result = decode(source, mode === 'progress');
}
writeFileSync(output, result);
