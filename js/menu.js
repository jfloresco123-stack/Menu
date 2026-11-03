/**
 * ============================================================
 *  DATOS PUBLICADOS — carta (data/menu.json) + configuración
 *  (data/config.json)
 * ============================================================
 *  Clientes y mozos SIEMPRE usan lo publicado en el sitio: no existen
 *  copias locales que puedan quedar desactualizadas. Los cambios se
 *  hacen en el Panel del Dueño / Administrador y se publican en GitHub.
 */
import { store } from './store.js';
import { CONFIG, aplicarConfig } from './config.js';
import { normalizarJornada, normalizarHorario } from './jornada.js';

// Claves de versiones anteriores (cambios locales del admin): se eliminan
const CLAVES_LEGADO = ['menu.overrides', 'menu.base'];

// Copia inmutable de los valores de fábrica (CONFIG.local cambia al aplicar lo publicado)
const LOCAL_POR_DEFECTO = Object.freeze({ ...CONFIG.local });
const REPO_POR_DEFECTO = Object.freeze({ ...CONFIG.repo });

let cache = null; // { menu, config } normalizados

/**
 * Lee un JSON del sitio evitando cachés viejas. El parámetro ?v cambia
 * cada 30 s: tras publicar, los clientes ven la versión nueva enseguida.
 */
async function leerJSON(ruta) {
  const resp = await fetch(`${ruta}?v=${Math.floor(Date.now() / 30000)}`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`No se pudo cargar ${ruta} (HTTP ${resp.status})`);
  return resp.json();
}

/**
 * Normaliza ambos archivos a una forma estable:
 *  menu   → { version, categorias, platos, extras }  (extras = frecuentes, solo mozos)
 *  config → { totalMesas, mozos, accesos, pagos, local, jornada, horario, repo }
 * (Compatible con la versión anterior, donde los mozos estaban en menu.json.)
 */
export function normalizarDatos(menuCrudo = {}, configCruda = {}) {
  const { mozos: mozosLegado, ...resto } = menuCrudo;
  const menu = {
    version: resto.version || '',
    categorias: resto.categorias || [],
    platos: resto.platos || [],
    extras: resto.extras || [],
  };
  const config = {
    totalMesas: Number(configCruda.totalMesas) || CONFIG.totalMesas,
    mozos: configCruda.mozos || mozosLegado || CONFIG.mozos,
    accesos: { ...CONFIG.accesos, ...(configCruda.accesos || {}) },
    pagos: {
      yape: { numero: '', titular: '', qr: '', ...(configCruda.pagos?.yape || {}) },
      plin: { numero: '', titular: '', qr: '', ...(configCruda.pagos?.plin || {}) },
    },
    local: { ...LOCAL_POR_DEFECTO, ...(configCruda.local || {}) },
    jornada: normalizarJornada(configCruda.jornada),
    horario: normalizarHorario(configCruda.horario),
    repo: { ...REPO_POR_DEFECTO, ...(configCruda.repo || {}) },
  };
  if (!config.local.nombre.trim()) config.local.nombre = LOCAL_POR_DEFECTO.nombre;
  return { menu, config };
}

/** Descarga (una vez por carga de página) los datos publicados. */
export async function cargarDatos(forzar = false) {
  if (!cache || forzar) {
    CLAVES_LEGADO.forEach((k) => store.remove(k));
    const [menu, config] = await Promise.all([
      leerJSON('data/menu.json'),
      leerJSON('data/config.json').catch(() => ({})), // opcional
    ]);
    cache = normalizarDatos(menu, config);
    aplicarConfig(cache.config);
  }
  return cache;
}

/** Carta lista para el cliente/mozo: categorías, platos y mozos. */
export async function cargarCarta(forzar = false) {
  const { menu, config } = await cargarDatos(forzar);
  return { ...menu, mozos: config.mozos };
}

/** Tras publicar desde el panel, esta pestaña usa los datos nuevos sin recargar. */
export function establecerDatos(menu, config) {
  cache = { menu, config };
  aplicarConfig(config);
}
