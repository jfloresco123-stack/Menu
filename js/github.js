/**
 * ============================================================
 *  PUBLICACIÓN EN GITHUB (API de contenidos)
 * ============================================================
 *  El Panel del Dueño guarda los cambios directamente en el repositorio
 *  con un token personal ("fine-grained") limitado a ESTE repositorio y
 *  al permiso Contents: Read and write. GitHub Pages vuelve a publicar
 *  el sitio solo (≈ 1 minuto).
 *
 *  El token se guarda únicamente en el localStorage del dispositivo
 *  del dueño; nunca se sube al repositorio.
 */
import { store } from './store.js';
import { CONFIG } from './config.js';

const API = 'https://api.github.com';
const CLAVE = 'github.conexion';

/* ---------- Modo local (servidor.py): publica en la carpeta del proyecto ---------- */
let servidorLocal = null; // { url, puedeEscribir } o null si no corre con servidor.py

/** Pregunta a servidor.py si está presente. Se llama una vez al arrancar. */
export async function detectarServidorLocal() {
  if (/\.github\.io$/i.test(location.hostname)) return;
  try {
    const resp = await fetch('api/local', { cache: 'no-store' });
    if (resp.ok) servidorLocal = await resp.json();
  } catch { /* servidor estático: sin modo local */ }
}

export const modoLocal = () => !!servidorLocal;

/** ¿Este dispositivo puede guardar cambios? (modo local: solo la PC del servidor). */
export const puedePublicar = () => (servidorLocal ? !!servidorLocal.puedeEscribir : hayToken());

/** Repositorio por defecto: se deduce de la URL en GitHub Pages. */
export function repoPorDefecto() {
  const usuario = location.hostname.match(/^([^.]+)\.github\.io$/i)?.[1];
  const carpeta = location.pathname.split('/').filter(Boolean)[0];
  if (usuario && carpeta) return { owner: usuario, repo: carpeta, rama: 'main' };
  return { ...CONFIG.repo };
}

/** Conexión guardada en este dispositivo: { owner, repo, rama, token } o null. */
export const conexion = () => store.get(CLAVE, null);
const hayToken = () => !!conexion()?.token;
export const guardarConexion = (c) => store.set(CLAVE, c);
export const olvidarConexion = () => store.remove(CLAVE);

async function api(ruta, opciones = {}, c = conexion()) {
  if (!c?.token) throw new Error('Este dispositivo no está conectado a GitHub.');
  const resp = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (resp.ok) return resp.status === 204 ? null : resp.json();

  const detalle = (await resp.json().catch(() => ({}))).message || '';
  const mensajes = {
    401: 'El token no es válido o expiró.',
    403: 'El token no tiene permiso de escritura en este repositorio.',
    404: 'No se encontró el repositorio o el token no tiene acceso a él.',
    409: 'El archivo cambió en GitHub mientras publicabas. Vuelve a intentarlo.',
    422: 'GitHub rechazó el cambio.',
  };
  const error = new Error(`${mensajes[resp.status] || `Error de GitHub (${resp.status}).`} ${detalle}`.trim());
  error.status = resp.status;
  throw error;
}

const rutaRepo = (c) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

/** Comprueba token + repositorio. Devuelve { nombre, puedeEscribir }. */
export async function probarConexion(c) {
  const datos = await api(rutaRepo(c), {}, c);
  return { nombre: datos.full_name, puedeEscribir: !!datos.permissions?.push };
}

/* ---------- Base64 <-> bytes/texto UTF-8 ---------- */
function bytesABase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ATexto(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** Lee un archivo del repositorio. Devuelve { texto, sha } o null si no existe. */
export async function leerArchivo(ruta) {
  if (servidorLocal) {
    const resp = await fetch(`${ruta}?t=${Date.now()}`, { cache: 'no-store' });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`No se pudo leer ${ruta} (HTTP ${resp.status})`);
    return { texto: await resp.text() };
  }
  const c = conexion();
  try {
    const datos = await api(`${rutaRepo(c)}/contents/${ruta}?ref=${encodeURIComponent(c.rama)}`);
    return { texto: base64ATexto(datos.content), sha: datos.sha };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Crea o actualiza un archivo (un commit por archivo).
 * @param {string} ruta              p. ej. "data/menu.json"
 * @param {string|Uint8Array} contenido
 * @param {string} mensaje           mensaje del commit
 * @param {string} [sha]             sha actual (obligatorio si el archivo existe)
 */
export async function escribirArchivo(ruta, contenido, mensaje, sha) {
  const c = conexion();
  const bytes = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
  if (servidorLocal) {
    const resp = await fetch(`api/archivo?ruta=${encodeURIComponent(ruta)}`, { method: 'PUT', body: bytes });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `No se pudo guardar ${ruta} (HTTP ${resp.status})`);
    return resp.json();
  }
  return api(`${rutaRepo(c)}/contents/${ruta}`, {
    method: 'PUT',
    body: JSON.stringify({ message: mensaje, content: bytesABase64(bytes), branch: c.rama, ...(sha ? { sha } : {}) }),
  });
}

/**
 * URL del sitio para QR y enlaces. En modo local usa la IP de la red, para
 * que los celulares puedan abrirlos; si no, el dominio propio configurado,
 * GitHub Pages o, como último recurso, la dirección actual.
 */
export function urlBase() {
  if (servidorLocal) return servidorLocal.url;
  const propia = CONFIG.local.urlPublica?.trim();
  if (propia) return propia.endsWith('/') ? propia : `${propia}/`;
  if (location.hostname.endsWith('github.io')) return `${location.origin}${location.pathname}`;
  const c = conexion() || repoPorDefecto();
  if (c.owner && c.repo) return `https://${c.owner.toLowerCase()}.github.io/${c.repo}/`;
  return `${location.origin}${location.pathname}`;
}
