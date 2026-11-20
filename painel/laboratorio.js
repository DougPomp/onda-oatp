// Continuous-mode symbol simulation. Frame transport and manifests are assumed reliable
// except for the configured periodic symbol losses.
const laboratorio = (() => {
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
  async function run(data, order, stride, phase, rounds, progress = () => {}) {
    const hash = await digest(data);
    const manifest = new Uint8Array(64);
    manifest.set([1,1,0,64,0,64,0,0]);
    new DataView(manifest.buffer).setBigUint64(8, BigInt(data.length));
    manifest.set(hash, 16);
    const key = await digest(concat(utf8.encode('OATP-ID-v1\0'), manifest));
    const groups = Array.from({length:Math.ceil(data.length / 4096)}, (_, g) => {
      const bytes = data.subarray(g * 4096, (g + 1) * 4096);
      const k = Math.ceil(bytes.length / 64);
      return {k, rows:Array(k), rank:0, symbols:Array.from({length:k}, (_, i) => bytes.subarray(i * 64, i * 64 + 64))};
    });
    let sent = 0, received = 0;
    const preview = [];
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < groups.length; i++) {
        let g = i;
        if (order === 'rotate') g = (i + r) % groups.length;
        if (order === 'reverse' && r % 2) g = groups.length - 1 - i;
        const keep = sent++ % stride === phase;
        if (r < 3) preview.push({r,g,keep});
        if (!keep) continue;
        received++;
        const group = groups[g], k = group.k;
        if (group.rank === k) continue;
        const a = await coefficients(key, g, k + Math.ceil(k / 2) + r, k);
        const payload = new Uint8Array(64);
        group.symbols.forEach((symbol, j) => addScaled(payload, symbol, a[j]));
        if (insert(group.rows, concat(a, payload))) group.rank++;
      }
      if ((r + 1) % 16 === 0) { progress(r + 1); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    let recovered = null;
    if (groups.every(group => group.rank === group.k)) {
      const padded = concat(...groups.flatMap(group => group.rows.map(row => row.subarray(group.k))));
      recovered = padded.slice(0, data.length);
      const actual = await digest(recovered);
      if (padded.subarray(data.length).some(Boolean) || !actual.every((v,i) => v === hash[i])
          || !recovered.every((v,i) => v === data[i])) throw Error('A verificação do objeto falhou.');
    }
    return {sent, received, preview, recovered, groups:groups.map(({rank,k}) => ({rank,k}))};
  }
  return {run};
})();
