/**
 * ============================================================
 *  CÓDIGO DEL DÍA (jornada)
 * ============================================================
 *  Problema: la carta es pública (GitHub Pages). Un enlace de mesa o de
 *  delivery puede reenviarse a cualquiera y llenar de pedidos falsos el
 *  WhatsApp de los mozos.
 *
 *  Solución (sin servidor):
 *   1. El administrador "abre el día": se genera un código aleatorio de
 *      6 dígitos y se publica en data/config.json SOLO su huella
 *      (PBKDF2-SHA256 con sal aleatoria), nunca el código.
 *   2. El código llega a cada mozo por WhatsApp. El mozo lo ingresa para
 *      usar su panel y se lo da al cliente que lo pide por WhatsApp.
 *   3. Sin código, el cliente solo puede VER la carta.
 *   4. Cada pedido va FIRMADO con el código (ver codec.js). El panel del
 *      mozo rechaza pedidos sin firma válida: un pedido inventado o de un
 *      enlace filtrado sin el código del día no entra.
 *
 *  Límites (documentados en docs/CODIGO-DEL-DIA.md): sin servidor, quien
 *  descargue config.json puede intentar adivinar el código por fuerza
 *  bruta (10⁶ combinaciones). PBKDF2 lo encarece y el código vence solo,
 *  pero es una barrera disuasiva, no criptografía de servidor.
 *
 *  Forma publicada en config.json → "jornada":
 *    { id, sal, iter, hash, abierta, vence }   (o null = día cerrado)
 *  y → "horario": { inicio: "06:00", cierre: "06:00" }  (hora de Perú).
 *  El día se cierra SOLO en la próxima hora de cierre aunque nadie lo cierre.
 */
import { CONFIG } from './config.js';
import { store } from './store.js';
import { cargarDatos } from './menu.js';
import { pbkdf2 } from './hash.js';

export const LARGO_CODIGO = 6;
const ITERACIONES = 150000;                  // ≈ 0,1–0,4 s por intento en un celular
const OFFSET_PERU_MS = -5 * 60 * 60 * 1000;  // Perú: UTC−5 todo el año (sin horario de verano)
const MIN_JORNADA_MS = 60 * 60 * 1000;       // si el cierre está a menos de 1 h, se cierra al día siguiente
export const HORARIO_POR_DEFECTO = Object.freeze({ inicio: '06:00', cierre: '06:00' });
const TOLERANCIA_RELOJ_MS = 10 * 60 * 1000;  // relojes de celular algo adelantados/atrasados
const CLAVE_CODIGO = 'jornada.codigo';       // { id, codigo } en el dispositivo que ya lo ingresó
const CLAVE_INTENTOS = 'jornada.intentos';   // { fallos, hasta }
const MAX_FALLOS = 5;
const ESPERA_FALLOS_MS = 60 * 1000;

/* ---------- Utilidades ---------- */
const aBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const deBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const soloDigitos = (s = '') => String(s).replace(/\D/g, '').slice(0, LARGO_CODIGO);

/** Código uniforme 000000–999999 (sin sesgo de módulo). */
export function generarCodigo() {
  const limite = Math.floor(0xffffffff / 1e6) * 1e6;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limite);
  return String(buf[0] % 1e6).padStart(LARGO_CODIGO, '0');
}

async function derivar(codigo, salB64, iter) {
  return aBase64(await pbkdf2(new TextEncoder().encode(codigo), deBase64(salB64), iter));
}

/** Comparación en tiempo constante (evita filtrar cuántos caracteres coinciden). */
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- Horario de la jornada ---------- */
const esHora = (h) => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/** Horario válido (cualquier valor raro vuelve al de por defecto: 6:00 → 6:00). */
export function normalizarHorario(h) {
  return {
    inicio: esHora(h?.inicio) ? h.inicio : HORARIO_POR_DEFECTO.inicio,
    cierre: esHora(h?.cierre) ? h.cierre : HORARIO_POR_DEFECTO.cierre,
  };
}

/**
 * Momento (ms) del próximo cierre en hora de Perú a partir de `desde`.
 * Ej.: abierto a las 10:00 con cierre 06:00 → mañana a las 06:00.
 * Si el cierre está a menos de 1 h (abrir a las 5:30 con cierre 6:00),
 * se toma el del día siguiente para no cerrar recién abierto.
 */
export function proximoCierre(desde, cierre = HORARIO_POR_DEFECTO.cierre) {
  const [h, m] = (esHora(cierre) ? cierre : HORARIO_POR_DEFECTO.cierre).split(':').map(Number);
  const local = new Date(desde + OFFSET_PERU_MS); // "reloj de Perú" leído con getUTC*
  let objetivo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - OFFSET_PERU_MS;
  while (objetivo - desde < MIN_JORNADA_MS) objetivo += 24 * 60 * 60 * 1000;
  return objetivo;
}

/** "06:00" → "6:00 a. m." */
export function horaLegible(hhmm) {
  const [h, m] = (esHora(hhmm) ? hhmm : '00:00').split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** "6:00 a. m. – 6:00 a. m. (24 h)" */
export function textoHorario(horario = CONFIG.horario) {
  const { inicio, cierre } = normalizarHorario(horario);
  return `${horaLegible(inicio)} – ${horaLegible(cierre)}${inicio === cierre ? ' (24 h)' : ''}`;
}

/* ---------- Administrador ---------- */
/** Crea la jornada publicable para un código (no incluye el código). Vence en la próxima hora de cierre. */
export async function crearJornada(codigo, ahora = Date.now(), horario = CONFIG.horario) {
  const sal = aBase64(crypto.getRandomValues(new Uint8Array(16)));
  const id = aBase64(crypto.getRandomValues(new Uint8Array(6))).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const vence = proximoCierre(ahora, normalizarHorario(horario).cierre);
  return { id, sal, iter: ITERACIONES, hash: await derivar(codigo, sal, ITERACIONES), abierta: ahora, vence };
}

/** Normaliza lo leído de config.json (cualquier cosa rara = día cerrado). */
export function normalizarJornada(j) {
  if (!j || typeof j !== 'object') return null;
  const ok = typeof j.id === 'string' && typeof j.sal === 'string' && typeof j.hash === 'string'
    && Number.isFinite(j.iter) && j.iter >= 1000 && Number.isFinite(j.abierta) && Number.isFinite(j.vence);
  return ok ? { id: j.id, sal: j.sal, iter: j.iter, hash: j.hash, abierta: j.abierta, vence: j.vence } : null;
}

/** ¿Hay un día abierto y vigente? */
export function jornadaActiva(j = CONFIG.jornada, ahora = Date.now()) {
  return !!j && ahora < j.vence && ahora >= j.abierta - TOLERANCIA_RELOJ_MS;
}

/* ---------- Mozo y cliente ---------- */
/** Código ya ingresado en este dispositivo, si sigue siendo el del día vigente. */
export function codigoGuardado(j = CONFIG.jornada) {
  const g = store.get(CLAVE_CODIGO, null);
  return g && jornadaActiva(j) && g.id === j.id ? g.codigo : null;
}

export const olvidarCodigo = () => store.remove(CLAVE_CODIGO);

/** Segundos que faltan para poder reintentar (tras varios fallos seguidos). */
export function esperaRestante() {
  const i = store.get(CLAVE_INTENTOS, null);
  return i?.hasta ? Math.max(0, Math.ceil((i.hasta - Date.now()) / 1000)) : 0;
}

function registrarFallo() {
  const i = store.get(CLAVE_INTENTOS, null) || { fallos: 0, hasta: 0 };
  i.fallos += 1;
  if (i.fallos >= MAX_FALLOS) { i.fallos = 0; i.hasta = Date.now() + ESPERA_FALLOS_MS; }
  store.set(CLAVE_INTENTOS, i);
}

/**
 * Valida el código escrito y, si es correcto, lo recuerda en el dispositivo.
 * Si no cuadra con lo cargado, vuelve a leer config.json una vez: el
 * administrador pudo abrir o cambiar el día después de cargar la página.
 * @returns {Promise<{ok:true, codigo:string} | {ok:false, motivo:'formato'|'espera'|'cerrado'|'incorrecto', segundos?:number}>}
 */
export async function validarCodigo(texto) {
  const codigo = soloDigitos(texto);
  if (codigo.length !== LARGO_CODIGO) return { ok: false, motivo: 'formato' };
  const segundos = esperaRestante();
  if (segundos) return { ok: false, motivo: 'espera', segundos };

  const prueba = async (j) => jornadaActiva(j) && iguales(await derivar(codigo, j.sal, j.iter), j.hash);
  let acierto = await prueba(CONFIG.jornada);
  if (!acierto) {
    try { await cargarDatos(true); } catch { /* sin conexión: se usa lo que hay */ }
    acierto = await prueba(CONFIG.jornada);
  }
  if (!acierto) {
    if (!jornadaActiva()) return { ok: false, motivo: 'cerrado' };
    registrarFallo();
    return { ok: false, motivo: 'incorrecto' };
  }
  store.remove(CLAVE_INTENTOS);
  store.set(CLAVE_CODIGO, { id: CONFIG.jornada.id, codigo });
  return { ok: true, codigo };
}

/** Mensaje listo para mostrar según el motivo de un fallo ('cliente' o 'mozo'). */
export function textoFallo(r, quien = 'cliente') {
  const origen = quien === 'mozo' ? 'el administrador' : 'tu mozo';
  return {
    formato: `El código tiene ${LARGO_CODIGO} dígitos.`,
    espera: `Demasiados intentos. Espera ${r.segundos} s y vuelve a probar.`,
    cerrado: quien === 'mozo'
      ? 'El día aún no está abierto. Pide al administrador que lo abra (Panel → Código del día).'
      : 'El local aún no abrió los pedidos de hoy. Pide el código a tu mozo en unos minutos.',
    incorrecto: `Código incorrecto. Revisa el que te envió ${origen}.`,
  }[r.motivo] || 'No se pudo validar el código.';
}

/** "vence a las 2:05 a. m." */
export const horaVence = (j = CONFIG.jornada) => (j ? new Date(j.vence).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '');
