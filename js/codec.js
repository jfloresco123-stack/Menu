/**
 * ============================================================
 *  MOTOR DE CÓDIGO DE PEDIDO (compresión + Base64 + checksum)
 * ============================================================
 *  Formato final (va al final del mensaje de WhatsApp):
 *
 *     [#MESA05-A7B9X2:zq1YjWQ...:k3f9]      (mesa del salón)
 *     [#D987654321-A7B9X2:zq1YjWQ...:k3f9]  (delivery: celular del cliente)
 *      └── id legible ┘ └ datos ┘ └ control
 *     …:k3f9:a1b2c3d4]  ← firma con el código del día (ver jornada.js)
 *
 *  - datos: JSON compacto → UTF-8 → deflate-raw (si el navegador lo
 *    soporta; prefijo "z") o sin comprimir (prefijo "j") → Base64.
 *  - El alfabeto Base64 evita "_", "*", "~" y "`" porque WhatsApp los
 *    convierte en formato (cursiva, negrita…) y romperían el código.
 *  - control: CRC32 en base 36 que detecta códigos cortados o editados
 *    por accidente. NO es una firma: cualquiera puede recalcularlo.
 *  - firma: SHA-256(códigoDelDía | id:datos), 8 caracteres base 36. Solo
 *    quien conoce el código del día puede producirla; el panel del mozo
 *    rechaza pedidos sin firma válida.
 *
 *  Estructura de los datos (array para ocupar poco):
 *    [versión, mesa, mozoId, fechaBase36, [[id, cant, precioCent, nombre, nota?], ...], entrega?]
 *  mesa: número (salón) o "D987654321" (delivery). En delivery, entrega =
 *  [nombre, dirección, referencia, ubicación] (textos, pueden ir vacíos).
 *  Se incluyen nombre y precio para que el mozo lea el pedido tal como
 *  lo vio el cliente, aunque su carta local tenga otros valores.
 *
 *  Módulo sin dependencias del DOM: funciona también en Node ≥ 18.
 */
import { sha256 } from './hash.js';

const VERSION = 1;
const PATRON = /\[(#(?:MESA(\d{2})|D(\d{9}))-([A-Z0-9]{6})):([zj][A-Za-z0-9!-]+):([a-z0-9]{4})(?::([a-z0-9]{8}))?\]/;
const PREFIJO_PAIS = '51';
const MAX_TEXTO_ENTREGA = 120;
const MAX_LINEAS = 60;
const MAX_CANTIDAD = 99;
const MAX_PRECIO_CENT = 1000000; // S/ 10 000 por unidad

/* ---------- Delivery: la "mesa" es el celular del cliente ---------- */
/** "D987654321" → true (pedido delivery). */
export const esDelivery = (mesa) => typeof mesa === 'string' && /^D\d{9}$/.test(mesa);

/** Celular peruano en cualquier formato ("+51 987 654 321", "987654321") → "987654321" o null. */
export function normalizarCelular(texto = '') {
  let d = String(texto).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith(PREFIJO_PAIS)) d = d.slice(2);
  return /^9\d{8}$/.test(d) ? d : null;
}

/** "987654321" → "987 654 321". */
export const formatoCelular = (n = '') => String(n).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');

/**
 * Enlace de mapa SEGURO a partir de una ubicación recibida en un pedido:
 * solo se aceptan coordenadas, y el enlace se reconstruye siempre hacia
 * Google Maps (nunca se abre una URL arbitraria que venga en el código).
 */
export function mapaDesdeUbicacion(texto = '') {
  const m = String(texto).match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return '';
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return '';
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/* ---------- Firma con el código del día ---------- */
async function firmar(codigoDia, contenido) {
  const hex = await sha256(`${codigoDia}|${contenido}`);
  // 41 bits → 8 caracteres base 36
  return ((parseInt(hex.slice(0, 8), 16) * 512) + (parseInt(hex.slice(8, 12), 16) >>> 7)).toString(36).padStart(8, '0').slice(-8);
}

/** ¿El pedido decodificado fue firmado con este código del día? */
export async function firmaValida(pedido, codigoDia) {
  if (!pedido?.firma || !codigoDia) return false;
  return (await firmar(codigoDia, pedido.contenido)) === pedido.firma;
}

/** Error con mensaje listo para mostrar al mozo. */
export class CodigoError extends Error {}

/* ---------- CRC32 (tabla precalculada) ---------- */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(texto) {
  let crc = 0xffffffff;
  for (const b of new TextEncoder().encode(texto)) crc = TABLA_CRC[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const base36 = (n, largo) => n.toString(36).padStart(7, '0').slice(-largo);

/* ---------- Base64 "segura para WhatsApp" ---------- */
function aBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '!').replace(/=+$/, '');
}

function deBase64(texto) {
  let s = texto.replace(/-/g, '+').replace(/!/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---------- Compresión nativa (CompressionStream) ---------- */
async function transformar(bytes, Stream) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

async function comprimir(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return await transformar(bytes, CompressionStream); } catch { return null; }
}

/**
 * Genera el código de un pedido.
 * @param {{mesa:number|string, mozoId:number, items:Array<{id,nombre,precio,qty,nota?}>, fecha?:Date,
 *          entrega?:{nombre?,direccion?,referencia?,ubicacion?}}} pedido
 * @returns {Promise<{codigo:string, id:string}>}
 */
export async function codificarPedido({ mesa, mozoId, items, fecha = new Date(), entrega = null, codigoDia = '' }) {
  const filas = items.map((i) => {
    const fila = [i.id, i.qty, Math.round(i.precio * 100), i.nombre];
    if (i.nota) fila.push(i.nota);
    return fila;
  });
  const datos = [VERSION, mesa, mozoId, Math.floor(fecha.getTime() / 1000).toString(36), filas];
  if (esDelivery(mesa)) {
    const e = entrega || {};
    datos.push([e.nombre || '', e.direccion || '', e.referencia || '', e.ubicacion || '']);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(datos));

  // Solo se usa la versión comprimida si realmente ocupa menos
  const comprimido = await comprimir(bytes);
  const carga = comprimido && comprimido.length < bytes.length
    ? 'z' + aBase64(comprimido)
    : 'j' + aBase64(bytes);

  const prefijo = esDelivery(mesa) ? `#${mesa}` : `#MESA${String(mesa).padStart(2, '0')}`;
  const id = `${prefijo}-${base36(crc32(carga), 6).toUpperCase()}`;
  const control = base36(crc32(`${id}:${carga}`), 4);
  const firma = codigoDia ? `:${await firmar(codigoDia, `${id}:${carga}`)}` : '';
  return { codigo: `[${id}:${carga}:${control}${firma}]`, id };
}

/**
 * Extrae y decodifica un código desde cualquier texto (puede ser el
 * mensaje de WhatsApp completo). Lanza CodigoError si algo no cuadra.
 */
export async function decodificarPedido(texto) {
  // Se quitan espacios y saltos de línea por si el código se partió al copiar
  const limpio = String(texto || '').replace(/\s+/g, '');
  const m = limpio.match(PATRON);
  if (!m) throw new CodigoError('No se encontró un código de pedido válido. Debe verse como [#MESA05-XXXXXX:…] o [#D987654321-XXXXXX:…].');

  const [, id, mesaTxt, celular, , carga, control, firma = ''] = m;
  if (base36(crc32(`${id}:${carga}`), 4) !== control) {
    throw new CodigoError('El código está incompleto o fue modificado. Pide al cliente que lo reenvíe.');
  }

  let bytes = deBase64(carga.slice(1));
  if (carga[0] === 'z') {
    if (typeof DecompressionStream === 'undefined') {
      throw new CodigoError('Este navegador no puede descomprimir el código. Actualiza Chrome/Safari.');
    }
    try { bytes = await transformar(bytes, DecompressionStream); } catch {
      throw new CodigoError('No se pudo descomprimir el código.');
    }
  }

  let datos;
  try { datos = JSON.parse(new TextDecoder().decode(bytes)); } catch {
    throw new CodigoError('El contenido del código no es legible.');
  }

  const [version, mesa, mozoId, fecha36, filas, entregaCruda] = datos;
  if (version !== VERSION) throw new CodigoError(`Versión de código no soportada (${version}).`);
  if (mesa !== (celular ? `D${celular}` : Number(mesaTxt))) throw new CodigoError('La mesa del código no coincide con su contenido.');
  if (!Array.isArray(filas) || !filas.length) throw new CodigoError('El pedido no contiene platos.');

  // Todo lo que viene en el código lo escribió un cliente: se valida y acota
  const acotar = (v, max = MAX_TEXTO_ENTREGA) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  if (filas.length > MAX_LINEAS) throw new CodigoError('El pedido tiene demasiadas líneas.');
  const items = filas.map((fila) => {
    const [pid, qty, cent, nombre, nota = ''] = Array.isArray(fila) ? fila : [];
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_CANTIDAD
      || !Number.isInteger(cent) || cent < 0 || cent > MAX_PRECIO_CENT || !acotar(nombre)) {
      throw new CodigoError('El pedido trae cantidades o precios no válidos.');
    }
    return { id: acotar(String(pid), 40), qty, precio: cent / 100, nombre: acotar(nombre, 80), nota: acotar(nota, 120) };
  });
  const total = items.reduce((s, i) => s + i.precio * i.qty, 0);
  const [nombre, direccion, referencia, ubicacion] = (Array.isArray(entregaCruda) ? entregaCruda : []).concat(['', '', '', '']).map((v) => acotar(v));
  const entrega = celular ? { telefono: celular, nombre, direccion, referencia, ubicacion: mapaDesdeUbicacion(ubicacion) } : null;
  return {
    id, mesa, mozoId, fecha: new Date(parseInt(fecha36, 36) * 1000), items, total, entrega,
    firma, contenido: `${id}:${carga}`,
  };
}
