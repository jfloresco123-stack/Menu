/**
 * ============================================================
 *  UTILIDADES DE INTERFAZ
 * ============================================================
 *  Formato, íconos, logotipo, toasts, hojas modales (bottom-sheet),
 *  imágenes con skeleton/fallback y micro-animaciones.
 */
import { CONFIG, anteTitulo } from './config.js';

/* ---------- Formato y texto ---------- */

/** Escapa HTML para insertar texto del usuario sin riesgo. */
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const soles = (n) => `${CONFIG.moneda} ${Number(n || 0).toFixed(2)}`;
export const pad2 = (n) => String(n).padStart(2, '0');

/** Minúsculas sin tildes, para búsquedas tolerantes ("cebiche" ≈ "Cébiche"). */
export const normalizar = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const reducirMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const horaCorta = (fecha) => new Date(fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

/* ---------- Íconos SVG (trazo, heredan currentColor) ---------- */
const svg = (d, cls = 'h-5 w-5') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONOS = {
  mas: (c) => svg('<path d="M12 5v14M5 12h14"/>', c),
  menos: (c) => svg('<path d="M5 12h14"/>', c),
  cerrar: (c) => svg('<path d="M18 6 6 18M6 6l12 12"/>', c),
  buscar: (c) => svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', c),
  bolsa: (c) => svg('<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>', c),
  check: (c) => svg('<path d="m5 12 5 5L20 7"/>', c),
  sol: (c) => svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', c),
  luna: (c) => svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>', c),
  basura: (c) => svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', c),
  descargar: (c) => svg('<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>', c),
  subir: (c) => svg('<path d="M12 20V8M6 14l6-6 6 6M4 4h16"/>', c),
  deshacer: (c) => svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', c),
  pegar: (c) => svg('<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>', c),
  nota: (c) => svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>', c),
  salir: (c) => svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>', c),
  candado: (c) => svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', c),
  flecha: (c) => svg('<path d="M5 12h14M13 6l6 6-6 6"/>', c),
  atras: (c) => svg('<path d="M19 12H5M11 18l-6-6 6-6"/>', c),
  historial: (c) => svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>', c),
  puntos: (c) => svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', c),
  usuario: (c) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', c),
  restaurar: (c) => svg('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>', c),
  estrella: (c = 'h-3.5 w-3.5') => `<svg class="${c}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3 6.6 7 .8-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.8L12 2Z"/></svg>`,
  whatsapp: (c = 'h-6 w-6') => `<svg class="${c}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3ZM12 21.8a9.9 9.9 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.9 9.9 0 1 1 12 21.8ZM12 0a12 12 0 0 0-10.3 18L0 24l6.2-1.6A12 12 0 1 0 12 0Z"/></svg>`,
};

/** Foto de fondo del local, si está configurada y existe (si no, queda el fondo oscuro). */
export const fotoLocal = (clases) => (CONFIG.local.foto
  ? `<img src="${esc(CONFIG.local.foto)}" alt="" class="${clases}" onerror="this.remove()">`
  : '');

/* ---------- Logotipo: imagen configurada o tipográfico ---------- */
export function logotipo(variante = 'compacto') {
  const ante = esc(anteTitulo());
  const marca = esc(CONFIG.nombreCorto);
  const ciudad = CONFIG.ubicacion
    ? `<p class="logo-entrada mt-3 flex items-center justify-center gap-3 text-[11px] font-medium uppercase tracking-[0.3em] text-white/80" style="--d:240ms">
          <span class="h-px w-8 bg-oro-300/70"></span>${esc(CONFIG.ubicacion)}<span class="h-px w-8 bg-oro-300/70"></span>
        </p>`
    : '';
  if (CONFIG.local.logo) {
    const img = (clases) => `<img src="${esc(CONFIG.local.logo)}" alt="${esc(CONFIG.nombreCompleto)}" class="${clases} rounded-xl bg-white object-contain p-1" onerror="this.replaceWith(this.alt)">`;
    return variante === 'hero'
      ? `<div class="logo select-none text-center">${img('logo-entrada mx-auto max-h-36 max-w-[80vw]')}${ciudad}</div>`
      : `<span class="flex select-none items-center leading-none">${img('h-11 max-w-[11rem]')}</span>`;
  }
  if (variante === 'hero') {
    return `
      <div class="logo select-none text-center">
        ${ante ? `<p class="logo-entrada text-[11px] font-semibold uppercase tracking-[0.5em] text-oro-300 sm:text-xs">${ante}</p>` : ''}
        <h1 class="logo-entrada logo-brillo font-display font-black italic leading-[0.95]" style="--d:120ms;font-size:min(6rem, ${(150 / Math.max(CONFIG.nombreCorto.length, 1)).toFixed(1)}vw)">${marca}</h1>
        ${ciudad}
      </div>`;
  }
  // 'claro': para fondos oscuros (foto de la bienvenida)
  const claro = variante === 'claro';
  return `
    <span class="flex select-none flex-col text-left leading-none">
      ${ante ? `<span class="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.35em] ${claro ? 'text-oro-300' : 'text-arcilla-500 dark:text-oro-400'}">${ante}</span>` : ''}
      <span class="font-display text-[26px] font-black italic ${claro ? 'text-white' : 'text-carbon-900 dark:text-crema-50'}">${marca}</span>
    </span>`;
}

/** Botón de modo claro/oscuro (el clic se maneja globalmente en app.js). */
export function botonTema(clases = 'btn-icono') {
  return `<button type="button" data-accion="tema" class="${clases}" aria-label="Cambiar modo claro u oscuro">
    <span class="dark:hidden">${ICONOS.luna()}</span><span class="hidden dark:inline">${ICONOS.sol()}</span>
  </button>`;
}

/** Selector − n + reutilizable. */
export function stepper(valor, atributos = '') {
  return `<div class="inline-flex items-center rounded-full bg-carbon-900/5 p-1 dark:bg-white/10" ${atributos}>
    <button type="button" data-menos class="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm transition active:scale-90 dark:bg-carbon-700" aria-label="Quitar uno">${ICONOS.menos('h-4 w-4')}</button>
    <span data-valor class="w-9 text-center font-bold tabular-nums">${valor}</span>
    <button type="button" data-mas class="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm transition active:scale-90 dark:bg-carbon-700" aria-label="Agregar uno">${ICONOS.mas('h-4 w-4')}</button>
  </div>`;
}

/* ---------- Imágenes con skeleton y respaldo tipográfico ---------- */

/**
 * Imagen de plato: muestra shimmer mientras carga y, si el archivo no
 * existe en img/, la reemplaza por una tarjeta tipográfica elegante.
 */
export function imagenPlato(p, contenedor = 'absolute inset-0') {
  return `<div class="skeleton overflow-hidden ${contenedor}">
    <img src="${esc(p.img || '')}" alt="${esc(p.nombre)}" loading="lazy" decoding="async"
         data-nombre="${esc(p.nombre)}" class="img-fade h-full w-full object-cover">
  </div>`;
}

/** Instala (una sola vez) los manejadores globales de carga/error de imágenes. */
export function instalarManejadoresImagen() {
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('img-fade')) {
      img.classList.add('cargada');
      img.parentElement?.classList.remove('skeleton');
    }
  }, true);

  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('img-fade')) return;
    const nombre = img.dataset.nombre || '';
    const ph = document.createElement('div');
    ph.className = 'placeholder-plato h-full w-full';
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', nombre);
    ph.innerHTML = `<span class="ph-inicial">${esc(nombre.charAt(0))}</span><span class="ph-nombre">${esc(nombre)}</span>`;
    img.parentElement?.classList.remove('skeleton');
    img.replaceWith(ph);
  }, true);
}

/* ---------- Toasts ---------- */
const ESTILO_TOAST = {
  ok: 'bg-palma-500 text-white',
  error: 'bg-red-600 text-white',
  aviso: 'bg-oro-400 text-carbon-950',
  info: 'bg-carbon-900 text-white dark:bg-crema-100 dark:text-carbon-950',
};

/**
 * Muestra un aviso breve. `accion` opcional: { texto, fn } añade un botón
 * (p. ej. "Deshacer") que ejecuta fn y cierra el aviso.
 */
export function toast(mensaje, tipo = 'info', ms = 2800, accion = null) {
  const caja = document.getElementById('toasts');
  if (!caja) return;
  const el = document.createElement('div');
  el.className = `toast pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-2xl ${ESTILO_TOAST[tipo] || ESTILO_TOAST.info}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  const texto = document.createElement('span');
  texto.textContent = mensaje;
  el.appendChild(texto);
  const cerrar = () => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 400);
  };
  if (accion) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'shrink-0 rounded-xl bg-black/20 px-3 py-1.5 font-bold uppercase tracking-wide';
    boton.textContent = accion.texto;
    boton.addEventListener('click', () => { accion.fn(); cerrar(); }, { once: true });
    el.appendChild(boton);
  }
  caja.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(cerrar, ms);
}

/* ---------- Hojas modales (bottom-sheet en móvil, diálogo en tablet) ---------- */
const pilaHojas = [];

/**
 * Abre una hoja modal.
 * @param {object} op
 * @param {string} [op.titulo]      Título en cabecera (si se omite, solo botón cerrar flotante)
 * @param {string} [op.subtitulo]
 * @param {string} [op.ancho]       Clase de ancho máximo en tablet/escritorio
 * @param {(cuerpo:HTMLElement, pie:HTMLElement) => void} op.render  Pinta el contenido
 * @param {() => void} [op.alCerrar]
 * @returns {{ el:HTMLElement, cuerpo:HTMLElement, pie:HTMLElement, refrescar:Function, cerrar:Function }}
 */
export function abrirHoja({ titulo = '', subtitulo = '', ancho = 'md:max-w-xl', render, alCerrar }) {
  const el = document.createElement('div');
  el.className = 'hoja fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="hoja-fondo absolute inset-0 bg-carbon-950/60 backdrop-blur-sm" data-cerrar-hoja></div>
    <div class="hoja-panel relative flex max-h-[92dvh] w-full ${ancho} flex-col overflow-hidden rounded-t-[28px] bg-crema-50 shadow-2xl dark:bg-carbon-900 md:rounded-[28px]">
      <div class="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center md:hidden"><span class="h-1.5 w-10 rounded-full bg-carbon-900/20 dark:bg-white/25"></span></div>
      ${titulo ? `
        <header class="flex items-start justify-between gap-4 border-b border-carbon-900/5 px-5 pb-4 pt-6 dark:border-white/5">
          <div class="min-w-0">
            <h2 class="font-display text-2xl font-bold leading-tight">${esc(titulo)}</h2>
            ${subtitulo ? `<p class="texto-suave mt-0.5 text-sm">${esc(subtitulo)}</p>` : ''}
          </div>
          <button type="button" data-cerrar-hoja class="btn-icono -mr-1" aria-label="Cerrar">${ICONOS.cerrar()}</button>
        </header>` : `
        <button type="button" data-cerrar-hoja class="absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition active:scale-90" aria-label="Cerrar">${ICONOS.cerrar()}</button>`}
      <div class="hoja-cuerpo flex-1 overflow-y-auto overscroll-contain"></div>
      <div class="hoja-pie pb-safe"></div>
    </div>`;

  const cuerpo = el.querySelector('.hoja-cuerpo');
  const pie = el.querySelector('.hoja-pie');
  const api = {
    el, cuerpo, pie,
    refrescar: () => render?.(cuerpo, pie),
    cerrar() {
      if (!el.isConnected) return;
      el.classList.remove('abierta');
      pilaHojas.splice(pilaHojas.indexOf(api), 1);
      if (!pilaHojas.length) document.documentElement.classList.remove('sin-scroll');
      setTimeout(() => el.remove(), 380);
      alCerrar?.();
    },
  };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar-hoja]')) api.cerrar();
  });

  render?.(cuerpo, pie);
  document.body.appendChild(el);
  document.documentElement.classList.add('sin-scroll');
  pilaHojas.push(api);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('abierta')));
  return api;
}

/** Cierra la hoja superior con Escape. */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pilaHojas.length) pilaHojas[pilaHojas.length - 1].cerrar();
});

/** Cierra todas las hojas abiertas (al cambiar de módulo). */
export function cerrarHojas() {
  [...pilaHojas].reverse().forEach((h) => h.cerrar());
}

/** Diálogo de confirmación basado en hoja. Resuelve true/false. */
export function confirmar(mensaje, { titulo = '¿Estás seguro?', textoOk = 'Confirmar', peligro = false } = {}) {
  return new Promise((resolver) => {
    let respuesta = false;
    const hoja = abrirHoja({
      titulo,
      ancho: 'md:max-w-md',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `<p class="texto-suave px-5 py-5 text-base">${esc(mensaje)}</p>`;
        pie.innerHTML = `<div class="flex gap-3 px-5 pb-5">
          <button type="button" data-cerrar-hoja class="btn-secundario flex-1">Cancelar</button>
          <button type="button" data-ok class="btn-primario flex-1 ${peligro ? '!bg-red-600 !shadow-red-600/30' : ''}">${esc(textoOk)}</button>
        </div>`;
      },
      alCerrar: () => resolver(respuesta),
    });
    hoja.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) { respuesta = true; hoja.cerrar(); }
    });
  });
}

/* ---------- Animaciones ---------- */

/** Ejecuta un cambio de DOM con View Transitions si el navegador la soporta. */
export function transicion(cambio) {
  if (document.startViewTransition && !reducirMovimiento()) {
    const vt = document.startViewTransition(cambio);
    vt.ready.catch(() => {}); // si se interrumpe, el DOM ya cambió: solo se omite la animación
    return vt;
  }
  cambio();
  return null;
}

/** Pequeño "rebote" para confirmar una acción táctil. */
export function bump(el) {
  if (!el || reducirMovimiento()) return;
  el.classList.remove('bump');
  void el.offsetWidth; // reinicia la animación
  el.classList.add('bump');
}

/** Hace "volar" una pastilla desde un elemento hasta otro (agregar al carrito). */
export function volarHacia(origen, destino) {
  if (!origen || !destino || reducirMovimiento()) return;
  const a = origen.getBoundingClientRect();
  const b = destino.getBoundingClientRect();
  const punto = document.createElement('div');
  punto.className = 'pointer-events-none fixed z-[65] h-5 w-5 rounded-full bg-arcilla-500 shadow-lg shadow-arcilla-500/50 ring-4 ring-white dark:bg-oro-400 dark:ring-carbon-900';
  punto.style.left = `${a.left + a.width / 2 - 10}px`;
  punto.style.top = `${a.top + a.height / 2 - 10}px`;
  document.body.appendChild(punto);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  punto.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(1.25)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: 0.2 },
  ], { duration: 720, easing: 'cubic-bezier(.45,.05,.55,.95)' }).onfinish = () => punto.remove();
}

/* ---------- Acciones protegidas y menús ---------- */

/**
 * Botón que solo se activa MANTENIÉNDOLO presionado (por defecto 1,3 s).
 * Un toque o doble toque accidental nunca lo dispara.
 */
export function botonMantener(texto, clases = 'bg-red-600 text-white') {
  return `<button type="button" data-mantener class="relative min-h-[56px] w-full touch-none select-none overflow-hidden rounded-2xl px-5 font-bold ${clases}">
    <span data-relleno class="absolute inset-y-0 left-0 w-0 bg-black/30"></span>
    <span class="relative flex items-center justify-center gap-2">${ICONOS.candado('h-4 w-4')} ${esc(texto)}</span>
  </button>`;
}

/** Activa un botón creado con botonMantener(). */
export function activarMantener(boton, alCompletar, ms = 1300) {
  const relleno = boton.querySelector('[data-relleno]');
  let temporizador = null;
  let recienCompletado = false; // ignora el "click" que llega al soltar tras completar
  let ultimoAviso = 0;
  const iniciar = () => {
    if (temporizador) return;
    relleno.style.transition = `width ${ms}ms linear`;
    relleno.style.width = '100%';
    temporizador = setTimeout(() => {
      temporizador = null;
      navigator.vibrate?.(40);
      relleno.style.transition = 'none';
      relleno.style.width = '0';
      recienCompletado = true;
      alCompletar();
    }, ms);
  };
  const cancelar = () => {
    if (!temporizador) return;
    clearTimeout(temporizador);
    temporizador = null;
    relleno.style.transition = 'width .25s ease';
    relleno.style.width = '0';
  };
  boton.addEventListener('pointerdown', (e) => { e.preventDefault(); iniciar(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => boton.addEventListener(ev, cancelar));
  boton.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); iniciar(); } });
  boton.addEventListener('keyup', cancelar);
  boton.addEventListener('contextmenu', (e) => e.preventDefault());
  boton.addEventListener('click', () => {
    if (recienCompletado) { recienCompletado = false; return; }
    if (Date.now() - ultimoAviso < 2000) return; // un solo aviso aunque toquen varias veces
    ultimoAviso = Date.now();
    toast('Mantén presionado el botón para confirmar', 'aviso', 1800);
  });
}

/** Confirmación que exige mantener presionado. Resuelve true/false. */
export function confirmarManteniendo(mensaje, { titulo = '¿Estás seguro?', textoBoton = 'Mantén presionado para confirmar' } = {}) {
  return new Promise((resolver) => {
    let respuesta = false;
    const hoja = abrirHoja({
      titulo,
      ancho: 'md:max-w-md',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `<p class="texto-suave px-5 py-5 text-base">${esc(mensaje)}</p>`;
        pie.innerHTML = `<div class="space-y-2.5 px-5 pb-5">
          ${botonMantener(textoBoton)}
          <button type="button" data-cerrar-hoja class="btn-secundario w-full">Cancelar</button>
        </div>`;
      },
      alCerrar: () => resolver(respuesta),
    });
    activarMantener(hoja.el.querySelector('[data-mantener]'), () => { respuesta = true; hoja.cerrar(); });
  });
}

/**
 * Menú de opciones en hoja inferior.
 * @param {{titulo:string, subtitulo?:string, acciones:Array<{id,texto,icono?,peligro?}>}} op
 * @returns {Promise<string|null>} id de la acción elegida
 */
export function menuAcciones({ titulo, subtitulo = '', acciones }) {
  return new Promise((resolver) => {
    let elegida = null;
    const hoja = abrirHoja({
      titulo,
      subtitulo,
      ancho: 'md:max-w-md',
      render(cuerpo) {
        cuerpo.innerHTML = `<div class="space-y-2 p-4 pb-6">
          ${acciones.map((a) => `
            <button type="button" data-opcion="${esc(a.id)}" class="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-4 text-left font-semibold transition active:scale-[.98] ${a.peligro ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-carbon-900/5 dark:bg-white/10'}">
              ${a.icono || ''}<span>${esc(a.texto)}</span>
            </button>`).join('')}
        </div>`;
      },
      alCerrar: () => resolver(elegida),
    });
    hoja.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-opcion]');
      if (b) { elegida = b.dataset.opcion; hoja.cerrar(); }
    });
  });
}

/** Pide un texto corto (alias, nombre…). Resuelve el texto o null si se cancela. */
export function pedirTexto({ titulo, etiqueta = '', valor = '', placeholder = '', maxlength = 30, numerico = false }) {
  return new Promise((resolver) => {
    let resultado = null;
    const hoja = abrirHoja({
      titulo,
      ancho: 'md:max-w-md',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `<form data-form-texto class="px-5 py-5">
          ${etiqueta ? `<label for="pedir-texto" class="text-sm font-semibold">${esc(etiqueta)}</label>` : ''}
          <input id="pedir-texto" value="${esc(valor)}" placeholder="${esc(placeholder)}" maxlength="${maxlength}" inputmode="${numerico ? 'decimal' : 'text'}" autocomplete="off" class="campo mt-2 ${numerico ? 'text-lg font-bold tabular-nums' : ''}">
        </form>`;
        pie.innerHTML = `<div class="flex gap-3 px-5 pb-5">
          <button type="button" data-cerrar-hoja class="btn-secundario flex-1">Cancelar</button>
          <button type="button" data-aceptar class="btn-primario flex-1">Guardar</button>
        </div>`;
      },
      alCerrar: () => resolver(resultado),
    });
    const input = hoja.el.querySelector('#pedir-texto');
    setTimeout(() => { input.focus(); input.select(); }, 350);
    const aceptar = () => { resultado = input.value.trim(); hoja.cerrar(); };
    hoja.el.querySelector('[data-form-texto]').addEventListener('submit', (e) => { e.preventDefault(); aceptar(); });
    hoja.el.querySelector('[data-aceptar]').addEventListener('click', aceptar);
  });
}

/* ---------- Impresión ---------- */

/**
 * Imprime un bloque de HTML ocultando el resto de la página.
 * @param {string} html
 * @param {{clase?:string, pagina?:string, margen?:string}} op  pagina: 'A4', '80mm auto'…
 */
export async function imprimirHTML(html, { clase = '', pagina = 'A4', margen = '10mm' } = {}) {
  document.getElementById('impresion')?.remove();
  const contenedor = document.createElement('div');
  contenedor.id = 'impresion';
  contenedor.className = clase;
  contenedor.innerHTML = html;
  const estilo = document.createElement('style');
  estilo.textContent = `@page { size: ${pagina}; margin: ${margen}; }`;
  document.head.appendChild(estilo);
  document.body.appendChild(contenedor);
  document.documentElement.classList.add('modo-impresion');
  const terminar = () => {
    contenedor.remove();
    estilo.remove();
    document.documentElement.classList.remove('modo-impresion');
    window.removeEventListener('afterprint', terminar);
  };
  window.addEventListener('afterprint', terminar);
  // Espera a que carguen las imágenes (p. ej. QR de pago); como máximo 4 s
  await Promise.race([
    Promise.all([...contenedor.querySelectorAll('img')].map((img) => (img.complete ? null
      : new Promise((ok) => { img.onload = ok; img.onerror = ok; })))),
    new Promise((ok) => setTimeout(ok, 4000)),
  ]);
  window.print();
}

/**
 * Enlace seguro para «Cómo llegar»: acepta un enlace https (Google Maps u
 * otro) o coordenadas «-5.2665, -80.6745». Cualquier otra cosa → ''.
 */
export function enlaceMapa(texto = '') {
  const t = String(texto).trim();
  const coords = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coords) return `https://www.google.com/maps?q=${coords[1]},${coords[2]}`;
  try {
    const url = new URL(t);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
