/**
 * ============================================================
 *  MODO CLARO / OSCURO
 * ============================================================
 *  - Por defecto sigue la preferencia del sistema operativo.
 *  - Si el usuario elige un modo, se recuerda en localStorage.
 *  - index.html aplica la clase `dark` antes de pintar (sin parpadeo).
 */
import { store } from './store.js';
import { transicion } from './ui.js';

const raiz = document.documentElement;
const consulta = matchMedia('(prefers-color-scheme: dark)');

function aplicar(oscuro) {
  raiz.classList.toggle('dark', oscuro);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#100C0B' : '#C2502E');
}

export function iniciarTema() {
  aplicar(raiz.classList.contains('dark'));
  // Si el usuario nunca eligió, se sincroniza con el sistema en vivo
  consulta.addEventListener('change', (e) => {
    if (!store.get('tema')) aplicar(e.matches);
  });
}

export function alternarTema() {
  const oscuro = !raiz.classList.contains('dark');
  transicion(() => aplicar(oscuro));
  store.set('tema', oscuro ? 'oscuro' : 'claro');
}
