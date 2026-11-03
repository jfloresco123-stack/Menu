/**
 * ============================================================
 *  ENRUTADOR POR HASH
 * ============================================================
 *  #/       → Módulo Cliente (lo que abre el QR)
 *  #/mozo   → Panel del Mozo
 *  #/admin  → Administrador de la carta
 *  Con hash no hace falta configurar el servidor: GitHub Pages
 *  nunca devuelve 404 al recargar.
 *
 *  Cada vista es `async (contenedor) => limpieza?` y devuelve una
 *  función opcional que se ejecuta al salir (quitar listeners, timers).
 */
import { transicion, cerrarHojas } from './ui.js';

const rutas = new Map();
let contenedor = null;
let limpiezaActual = null;

export const ruta = (path, vista) => rutas.set(path, vista);
export const navegar = (path) => { location.hash = path; };
export const rutaActual = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

async function resolver() {
  const vista = rutas.get(rutaActual()) || rutas.get('/');
  cerrarHojas();
  limpiezaActual?.();
  limpiezaActual = null;

  await (transicion(async () => {
    contenedor.innerHTML = '';
    window.scrollTo(0, 0);
    limpiezaActual = (await vista(contenedor)) || null;
  })?.updateCallbackDone);
}

export function iniciarRouter(elemento) {
  contenedor = elemento;
  window.addEventListener('hashchange', resolver);
  resolver();
}
