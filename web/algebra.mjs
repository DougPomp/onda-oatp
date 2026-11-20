const utf8 = new TextEncoder();
const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
const exp = new Uint8Array(510), log = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i++) {
  exp[i] = exp[i + 255] = x;
  log[x] = i;
  x <<= 1;
  if (x & 256) x ^= 0x11d;
}
function addScaled(target, source, factor, start = 0) {
  if (!factor) return;
  const scale = log[factor];
  for (let i = start; i < source.length; i++) {
    if (source[i]) target[i] ^= exp[scale + log[source[i]]];
  }
}
async function coefficients(key, g, esi, k) {
  const fields = new Uint8Array(14), view = new DataView(fields.buffer);
  view.setUint32(0, g); view.setUint32(4, esi); view.setUint16(8, k);
  const prefix = concat(utf8.encode('OATP-COEF-v1\0'), key);
  const first = await digest(concat(prefix, fields));
  fields[13] = 1;
  const a = (k <= 32 ? first : concat(first, await digest(concat(prefix, fields)))).slice(0, k);
  if (!a.some(Boolean)) a[0] = 1;
  return a;
}
function insert(rows, row) {
  for (let p = 0; p < rows.length; p++) {
    if (rows[p]) addScaled(row, rows[p], row[p], p);
  }
  const pivot = row.subarray(0, rows.length).findIndex(Boolean);
  if (pivot < 0) {
    if (row.subarray(rows.length).some(Boolean)) throw Error('Equações inconsistentes.');
    return false;
  }
  const inverse = 255 - log[row[pivot]];
  for (let i = pivot; i < row.length; i++) if (row[i]) row[i] = exp[inverse + log[row[i]]];
  for (const old of rows) if (old) addScaled(old, row, old[pivot], pivot);
  rows[pivot] = row;
  return true;
}

export { utf8, digest, concat, addScaled, coefficients, insert };
