/**
 * ============================================================
 *  PERSISTENCIA — envoltorio seguro sobre localStorage
 * ============================================================
 *  - Todas las claves llevan el prefijo "carta.<carpeta del sitio>." para
 *    no chocar con otros locales del mismo dominio (usuario.github.io/local-a/,
 *    usuario.github.io/local-b/). index.html lo repite para leer el tema.
 *  - Cada lectura/escritura va en try/catch: en modo privado o con
 *    el almacenamiento bloqueado la app sigue funcionando en memoria.
 */
const carpeta = location.pathname.replace(/[^/]*$/, '').replace(/^\/|\/$/g, '');
const PREFIJO = `carta.${carpeta ? `${carpeta}.` : ''}`;

function crearAlmacen(tipo) {
  const backend = () => {
    try { return window[tipo]; } catch { return null; }
  };
  return {
    /** Lee y parsea JSON; devuelve `porDefecto` si no existe o falla. */
    get(clave, porDefecto = null) {
      try {
        const crudo = backend()?.getItem(PREFIJO + clave);
        return crudo == null ? porDefecto : JSON.parse(crudo);
      } catch {
        return porDefecto;
      }
    },
    /** Serializa y guarda; devuelve false si no se pudo (cuota llena, bloqueo…). */
    set(clave, valor) {
      try {
        backend()?.setItem(PREFIJO + clave, JSON.stringify(valor));
        return true;
      } catch {
        return false;
      }
    },
    remove(clave) {
      try { backend()?.removeItem(PREFIJO + clave); } catch { /* sin almacenamiento */ }
    },
  };
}

export const store = crearAlmacen('localStorage');
export const sesion = crearAlmacen('sessionStorage');

/** Clave completa (con prefijo), útil para comparar en el evento `storage`. */
export const claveCompleta = (clave) => PREFIJO + clave;
