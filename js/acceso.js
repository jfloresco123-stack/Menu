/**
 * ============================================================
 *  PANTALLAS DE ACCESO: clave (Dueño, Admin, PIN del Mozo) y
 *  código del día (Mozo)
 * ============================================================
 *  Compara el SHA-256 de lo escrito con los hashes publicados en
 *  data/config.json. Es una protección de interfaz: lo que realmente
 *  protege la publicación es el token de GitHub del dueño.
 */
import { sesion } from './store.js';
import { sha256 } from './hash.js';
import { esc, logotipo, botonTema, ICONOS } from './ui.js';
import { codigoGuardado, jornadaActiva, validarCodigo, textoFallo, soloDigitos } from './jornada.js';

/**
 * Muestra el formulario; si la sesión ya está abierta, entra directo.
 * @param {object} op
 * @param {HTMLElement} op.raiz
 * @param {string} op.clave        clave de sessionStorage para recordar el acceso
 * @param {string} op.titulo
 * @param {string} op.texto
 * @param {string[]} op.hashes     hashes válidos (vacíos se ignoran)
 * @param {(raiz) => Promise<Function|void>} op.alAcceder  pinta el módulo y devuelve su limpieza
 * @returns {Promise<Function>} limpieza para el router
 */
export async function protegerConClave({ raiz, clave, titulo, texto, hashes, alAcceder, placeholder = 'Clave' }) {
  const ac = new AbortController();
  let limpiezaInterna = null;
  const limpiar = () => { ac.abort(); limpiezaInterna?.(); };

  if (sesion.get(clave) === true) {
    limpiezaInterna = await alAcceder(raiz);
    return limpiar;
  }

  raiz.innerHTML = `
    <div class="relative grid min-h-[100dvh] place-items-center overflow-hidden px-4 py-10">
      <div class="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-arcilla-500/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-oro-400/20 blur-3xl"></div>
      <div class="absolute right-4 top-0 pt-safe-4">${botonTema()}</div>

      <form id="acceso" class="superficie animate-subir relative w-full max-w-sm rounded-[28px] p-7 shadow-2xl">
        <div class="flex justify-center">${logotipo('compacto')}</div>
        <div class="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-arcilla-500/10 text-arcilla-600 dark:bg-oro-400/15 dark:text-oro-300">${ICONOS.candado('h-7 w-7')}</div>
        <h1 class="mt-4 text-center font-display text-2xl font-bold">${esc(titulo)}</h1>
        <p class="texto-suave mt-1 text-center text-sm">${esc(texto)}</p>
        <label for="clave-acceso" class="sr-only">${esc(placeholder)}</label>
        <input id="clave-acceso" type="password" autocomplete="current-password" required placeholder="${esc(placeholder)}" class="campo mt-6 text-center tracking-widest">
        <p id="error-acceso" class="mt-2 hidden text-center text-sm font-semibold text-red-600 dark:text-red-400">Clave incorrecta</p>
        <button type="submit" class="btn-primario mt-4 w-full">Entrar</button>
        <a href="#/" class="texto-suave mt-4 block text-center text-sm underline-offset-4 hover:underline">← Volver a la carta</a>
      </form>
    </div>`;

  const form = raiz.querySelector('#acceso');
  const input = raiz.querySelector('#clave-acceso');
  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hash = await sha256(input.value);
    if (hashes.filter(Boolean).includes(hash)) {
      sesion.set(clave, true);
      limpiezaInterna = await alAcceder(raiz);
      return;
    }
    raiz.querySelector('#error-acceso').classList.remove('hidden');
    form.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' },
      { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' },
    ], { duration: 380 });
    input.select();
  }, { signal: ac.signal });

  return limpiar;
}

/**
 * Pide el CÓDIGO DEL DÍA antes de mostrar un módulo (panel del mozo).
 * Si este dispositivo ya lo ingresó y sigue vigente, entra directo.
 * @param {object} op
 * @param {HTMLElement} op.raiz
 * @param {string} op.titulo
 * @param {(raiz) => Promise<Function|void>} op.alAcceder
 * @returns {Promise<Function>} limpieza para el router
 */
export async function exigirCodigoDelDia({ raiz, titulo, alAcceder }) {
  const ac = new AbortController();
  let limpiezaInterna = null;
  const limpiar = () => { ac.abort(); limpiezaInterna?.(); };

  if (codigoGuardado()) {
    limpiezaInterna = await alAcceder(raiz);
    return limpiar;
  }

  const abierto = jornadaActiva();
  raiz.innerHTML = `
    <div class="relative grid min-h-[100dvh] place-items-center overflow-hidden px-4 py-10">
      <div class="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-arcilla-500/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-oro-400/20 blur-3xl"></div>
      <div class="absolute right-4 top-0 pt-safe-4">${botonTema()}</div>

      <form id="form-codigo-dia" class="superficie animate-subir relative w-full max-w-sm rounded-[28px] p-7 shadow-2xl" novalidate>
        <div class="flex justify-center">${logotipo('compacto')}</div>
        <div class="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-arcilla-500/10 text-2xl dark:bg-oro-400/15">🔑</div>
        <h1 class="mt-4 text-center font-display text-2xl font-bold">${esc(titulo)}</h1>
        <p class="texto-suave mt-1 text-center text-sm">
          ${abierto ? 'Ingresa el código del día que te envió el administrador por WhatsApp.' : 'El día aún no está abierto. Cuando el administrador lo abra, te llegará el código por WhatsApp.'}
        </p>
        <label for="codigo-dia" class="sr-only">Código del día</label>
        <input id="codigo-dia" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000"
          class="campo mt-6 text-center font-mono text-3xl font-bold tracking-[0.3em]">
        <p id="error-codigo" class="mt-2 hidden text-center text-sm font-semibold text-red-600 dark:text-red-400"></p>
        <button type="submit" class="btn-primario mt-4 w-full">Entrar</button>
        <a href="#/" class="texto-suave mt-4 block text-center text-sm underline-offset-4 hover:underline">← Volver a la carta</a>
      </form>
    </div>`;

  const form = raiz.querySelector('#form-codigo-dia');
  const input = raiz.querySelector('#codigo-dia');
  const error = raiz.querySelector('#error-codigo');
  const boton = form.querySelector('[type="submit"]');
  input.focus();
  input.addEventListener('input', () => {
    const d = soloDigitos(input.value);
    input.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    error.classList.add('hidden');
  }, { signal: ac.signal });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    boton.disabled = true;
    boton.textContent = 'Verificando…';
    const r = await validarCodigo(input.value);
    if (ac.signal.aborted) return;
    if (r.ok) {
      limpiezaInterna = await alAcceder(raiz);
      return;
    }
    boton.disabled = false;
    boton.textContent = 'Entrar';
    error.textContent = textoFallo(r, 'mozo');
    error.classList.remove('hidden');
    form.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' },
      { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' },
    ], { duration: 380 });
    input.select();
  }, { signal: ac.signal });

  return limpiar;
}
