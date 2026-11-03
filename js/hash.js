/**
 * SHA-256 → hex. Usa Web Crypto cuando está disponible (HTTPS/localhost);
 * en HTTP plano (p. ej. probando por IP en la red local) usa una
 * implementación compacta en JavaScript.
 */
export async function sha256(texto) {
  const bytes = new TextEncoder().encode(texto);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Js(bytes);
}

/**
 * PBKDF2-HMAC-SHA256 de 256 bits. Usa Web Crypto cuando está disponible; un
 * celular que entra por la IP de la red local (HTTP) no lo tiene.
 */
export async function pbkdf2(clave, sal, iteraciones) {
  if (globalThis.crypto?.subtle) {
    const k = await crypto.subtle.importKey('raw', clave, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, k, 256));
  }
  await new Promise((ok) => setTimeout(ok)); // deja pintar «Verificando…» antes del cálculo
  return pbkdf2Js(clave, sal, iteraciones);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** Aplica un bloque (w[0..15] ya cargados; w se reescribe) sobre el estado H. */
function comprimir(H, w) {
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  for (let i = 0; i < 64; i++) {
    const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
}

function sha256Bytes(bytes) {
  const H = new Uint32Array(H0);
  const largo = bytes.length;
  const total = Math.ceil((largo + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[largo] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, largo * 8);
  dv.setUint32(total - 8, Math.floor((largo * 8) / 2 ** 32));
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    comprimir(H, w);
  }
  const salida = new Uint8Array(32);
  const dvSalida = new DataView(salida.buffer);
  H.forEach((x, i) => dvSalida.setUint32(i * 4, x));
  return salida;
}

function sha256Js(bytes) {
  return [...sha256Bytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pbkdf2Js(clave, sal, iteraciones) {
  const unir = (...partes) => {
    const r = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
    let i = 0;
    partes.forEach((p) => { r.set(p, i); i += p.length; });
    return r;
  };
  const k = new Uint8Array(64);
  k.set(clave.length > 64 ? sha256Bytes(clave) : clave);
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  const estadoDe = (pad) => {
    const H = new Uint32Array(H0);
    const w = new Uint32Array(64);
    const dv = new DataView(pad.buffer);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4);
    comprimir(H, w);
    return H;
  };
  const interno = estadoDe(ipad);
  const externo = estadoDe(opad);

  // U1 = HMAC(clave, sal ‖ INT(1)); solo hace falta el bloque 1 para 256 bits
  const u1 = sha256Bytes(unir(opad, sha256Bytes(unir(ipad, sal, new Uint8Array([0, 0, 0, 1])))));
  const dvU1 = new DataView(u1.buffer);
  const u = new Uint32Array(8);
  for (let i = 0; i < 8; i++) u[i] = dvU1.getUint32(i * 4);
  const t = u.slice();

  // Resto de iteraciones reutilizando los estados: 2 compresiones por vuelta
  const w = new Uint32Array(64);
  const H = new Uint32Array(8);
  const ronda = (base) => {
    w.set(u);
    w[8] = 0x80000000;
    w.fill(0, 9, 15);
    w[15] = (64 + 32) * 8;
    H.set(base);
    comprimir(H, w);
    u.set(H);
  };
  for (let n = 1; n < iteraciones; n++) {
    ronda(interno);
    ronda(externo);
    for (let i = 0; i < 8; i++) t[i] ^= u[i];
  }
  const salida = new Uint8Array(32);
  const dvSalida = new DataView(salida.buffer);
  t.forEach((x, i) => dvSalida.setUint32(i * 4, x));
  return salida;
}
