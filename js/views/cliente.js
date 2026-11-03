/**
 * ============================================================
 *  MÓDULO CLIENTE — Carta digital por QR (mobile-first)
 * ============================================================
 *  Flujo: Intro animada (≈3 s) → Bienvenida (mesa → mozo → código del
 *         día) → Catálogo → Carrito → WhatsApp con mensaje + código firmado.
 *  Sin el código del día el cliente solo puede VER la carta; el código se
 *  lo pide a su mozo por WhatsApp (ver jornada.js).
 *
 *  Un pedido enviado NO queda en el celular: al tocar «Enviar» el carrito
 *  se vacía. Cada envío es un pedido nuevo para la misma cuenta (el mensaje
 *  dice «PEDIDO NUEVO» o «PEDIDO ADICIONAL»). Para cambiar o quitar algo ya
 *  enviado, el cliente le escribe al mozo, que lo corrige en su panel.
 *
 *  El QR de cada mesa puede apuntar a  .../?mesa=7  para que la
 *  mesa venga preseleccionada (el cliente igual la confirma).
 *
 *  DELIVERY: el mozo envía por WhatsApp  .../?delivery=987654321&m=2
 *  La "mesa" es el celular del cliente (D987654321); el cliente escribe
 *  su dirección y el pedido llega al WhatsApp del mozo indicado (m).
 */
import { CONFIG } from '../config.js';
import { store, claveCompleta } from '../store.js';
import { cargarCarta } from '../menu.js';
import { codificarPedido, esDelivery, normalizarCelular, formatoCelular } from '../codec.js';
import { codigoGuardado, validarCodigo, textoFallo, jornadaActiva, soloDigitos, textoHorario } from '../jornada.js';
import { navegar } from '../router.js';
import {
  fotoLocal,
  esc, soles, pad2, normalizar, debounce, toast, abrirHoja, imagenPlato, logotipo,
  botonTema, stepper, bump, volarHacia, transicion, cerrarHojas, reducirMovimiento, enlaceMapa, confirmar, ICONOS,
} from '../ui.js';

const VIGENCIA_SESION_MS = 4 * 60 * 60 * 1000; // la mesa elegida se recuerda 4 horas
const VIGENCIA_CARRITO_MS = 3 * 60 * 60 * 1000; // un carrito sin cambios en 3 horas se descarta
const MAX_NOTA = 80;                            // notas cortas = código más compacto
const DURACION_INTRO_MS = 3000;                 // animación de entrada al escanear el QR
const NOTAS_RAPIDAS = ['Sin picante', 'Picante aparte', 'Bien frito', 'Sin cebolla', 'Para llevar'];

/** Filtros rápidos (se combinan con Y lógico). */
const FILTROS = [
  { id: 'especialidad', etiqueta: '★ Especialidades', fn: (p) => p.especialidad },
  { id: 'marino', etiqueta: '🐟 Marinos', fn: (p) => p.tags?.includes('marino') },
  { id: 'sinpicante', etiqueta: '🌿 Sin picante', fn: (p) => !p.tags?.includes('picante') },
  { id: 'economico', etiqueta: `💸 Hasta ${CONFIG.moneda} 20`, fn: (p) => p.precio <= 20 },
];

export async function vistaCliente(raiz) {
  const ac = new AbortController();
  let acPantalla = null; // listeners de la pantalla actual (bienvenida o catálogo)

  const estado = {
    carta: null,
    mesa: null,
    mozoId: null,
    categoria: 'todo',
    busqueda: '',
    filtros: new Set(),
    carrito: [],           // [{ k, id, qty, nota }]
    carritoTs: 0,          // último cambio del carrito
    enlace: null,          // URL de WhatsApp precalculada
    pedidoId: null,
    hojaCarrito: null,
    entrega: null,         // delivery: { nombre, direccion, referencia, ubicacion }
    mozoDelLink: null,     // delivery: mozo fijado por el enlace (m=…), si es válido
  };

  const mozos = () => estado.carta.mozos;
  const mozoActual = () => mozos().find((m) => m.id === estado.mozoId);
  const plato = (id) => estado.carta.platos.find((p) => p.id === id);
  const claveCarrito = () => `carrito.m${estado.mesa}`;
  const limpiarNota = (n = '') => n.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTA);
  const totalCarrito = () => estado.carrito.reduce((s, l) => s + (plato(l.id)?.precio || 0) * l.qty, 0);
  const unidadesCarrito = () => estado.carrito.reduce((s, l) => s + l.qty, 0);
  let versionCalculo = 0; // descarta cálculos de enlace obsoletos
  const enDelivery = () => esDelivery(estado.mesa);
  const celularDelivery = () => formatoCelular(String(estado.mesa).slice(1));
  /** ¿Este dispositivo ya ingresó el código del día vigente? */
  const desbloqueado = () => !!codigoGuardado();
  /** "Mesa 05" o "Delivery 987 654 321". */
  const etiquetaMesa = () => (enDelivery() ? `Delivery ${celularDelivery()}` : `Mesa ${pad2(estado.mesa)}`);

  // No se espera: el router pinta dentro de una View Transition, que congela
  // la pantalla hasta que la vista responde, y la intro no se vería.
  // «Empezar de nuevo»: funciona en bienvenida, delivery y carta
  raiz.addEventListener('click', (e) => { if (e.target.closest('[data-reiniciar]')) reiniciarTodo(); }, { signal: ac.signal });

  iniciar();
  return () => { ac.abort(); acPantalla?.abort(); };

  async function iniciar() {
    const delivery = leerDeliveryDeUrl();
    // Si todo indica que el cliente vuelve a la carta (sesión reciente), no hay intro.
    // (La mesa del QR se valida después: el número de mesas llega con la configuración.)
    const mesaQR = leerMesaDeUrl(Infinity);
    const guardada = store.get(delivery ? 'cliente.delivery' : 'cliente.sesion');
    const reciente = guardada
      && Date.now() - guardada.ts < VIGENCIA_SESION_MS
      && (delivery
        ? guardada.mesa === delivery.mesa && guardada.entrega?.direccion
        : !esDelivery(guardada.mesa) && (!mesaQR || mesaQR === guardada.mesa));

    // La intro muestra el nombre del local: la configuración se espera antes de pintarla
    const carga = cargarCarta();
    await carga.catch(() => {});
    if (ac.signal.aborted) return;
    const intro = reciente ? null : mostrarIntro(raiz, ac.signal);
    if (!intro) raiz.innerHTML = pantallaCarga();
    try {
      [estado.carta] = await Promise.all([carga, intro?.terminada]);
    } catch (err) {
      console.error(err);
      if (!ac.signal.aborted) raiz.innerHTML = pantallaError(err.message);
      return;
    }
    if (ac.signal.aborted) return;

    // Delivery: el mozo del enlace manda (aunque haya una sesión con otro mozo)
    if (delivery && mozos().some((m) => m.id === delivery.mozoId)) estado.mozoDelLink = delivery.mozoId;

    if (reciente && mozos().some((m) => m.id === guardada.mozoId)) {
      estado.mesa = guardada.mesa;
      estado.mozoId = estado.mozoDelLink ?? guardada.mozoId;
      estado.entrega = guardada.entrega || null;
      if (delivery && estado.mozoId !== guardada.mozoId) guardarSesionDelivery();
      mostrarCatalogo();
    } else if (delivery) {
      estado.mesa = delivery.mesa;
      if (estado.mozoDelLink) estado.mozoId = estado.mozoDelLink;
      estado.entrega = guardada?.mesa === delivery.mesa ? guardada.entrega : null;
      if (intro) transicion(() => mostrarDelivery());
      else mostrarDelivery();
    } else if (intro) {
      transicion(() => mostrarBienvenida(leerMesaDeUrl()));
    } else {
      mostrarBienvenida(leerMesaDeUrl());
    }
  }

  /**
   * Borra TODO lo que la carta guardó en este celular (mesa, mozo, delivery,
   * carritos y código del día) y vuelve a cargar desde cero: intro animada →
   * mesa → mozo → pedir código. No toca el panel del mozo (mesas, historial).
   */
  async function reiniciarTodo() {
    const ok = await confirmar('Se borrará la mesa, el mozo, tu pedido sin enviar y el código ingresado en este celular. Empezarás desde la bienvenida.', {
      titulo: 'Empezar de nuevo', textoOk: 'Empezar de nuevo', peligro: true,
    });
    if (!ok) return;
    try {
      const borrar = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(claveCompleta('carrito.')) || k.startsWith(claveCompleta('cliente.')) || k === claveCompleta('jornada.codigo')) borrar.push(k);
      }
      borrar.forEach((k) => localStorage.removeItem(k));
    } catch { /* sin almacenamiento: igual se recarga */ }
    // Sin ?mesa ni ?delivery: se elige todo de nuevo
    location.replace(`${location.origin}${location.pathname}`);
  }

  function guardarSesionDelivery() {
    store.set('cliente.delivery', { mesa: estado.mesa, mozoId: estado.mozoId, entrega: estado.entrega, ts: Date.now() });
  }

  /* =========================================================
   *  CÓDIGO DEL DÍA (bloque reutilizable: paso 3 y hoja)
   * ========================================================= */
  /** Mensaje con el que el cliente pide el código a su mozo. */
  function enlacePedirCodigo(mozo) {
    const digitos = String(mozo?.telefono || '').replace(/\D/g, '');
    const tel = digitos.length === 9 ? CONFIG.prefijoPais + digitos : digitos;
    const donde = enDelivery() ? `Quiero pedir delivery (celular ${celularDelivery()})` : `Estoy en la *Mesa ${pad2(estado.mesa)}*`;
    const texto = `Hola ${mozo?.nombre || ''} 👋 ${donde}. ¿Me envías el código para hacer mi pedido en la carta?`;
    return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
  }

  function htmlBloqueCodigo(mozo) {
    const abierto = jornadaActiva();
    return `
      <div class="text-center">
        <p class="mesa-elegida mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-arcilla-500/10 text-3xl dark:bg-oro-400/15">🔑</p>
        <h2 class="mt-3 font-display text-3xl font-bold">Código para pedir</h2>
        <p class="texto-suave mx-auto mt-1 max-w-xs text-sm">
          ${abierto
            ? `Pídeselo a <b class="text-carbon-900 dark:text-crema-50">${esc(mozo?.nombre || 'tu mozo')}</b> por WhatsApp y escríbelo aquí. Así evitamos pedidos falsos.`
            : 'El local aún no abrió los pedidos por la app. Puedes ver la carta y pedirle a tu mozo, o intentar con el código en unos minutos.'}
        </p>
      </div>
      ${mozo ? `
        <a href="${esc(enlacePedirCodigo(mozo))}" target="_blank" rel="noopener"
          class="mt-5 flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 font-bold text-white shadow-lg shadow-[#25D366]/30 transition active:scale-[.98]">
          ${ICONOS.whatsapp('h-5 w-5')} Pedir código a ${esc(mozo.nombre)}
        </a>` : ''}
      <label class="mt-4 block">
        <span class="sr-only">Código de 6 dígitos</span>
        <input data-codigo-input inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000"
          class="campo text-center font-mono text-3xl font-bold tracking-[0.3em]">
      </label>
      <p data-error-codigo class="mt-2 hidden text-center text-sm font-semibold text-red-600 dark:text-red-400" role="alert"></p>
      <button type="button" data-validar-codigo class="btn-primario mt-3 w-full text-base">Desbloquear y pedir</button>`;
  }

  /** Formatea "123456" → "123 456" mientras se escribe. */
  function alEscribirCodigo(e) {
    const input = e.target.closest('[data-codigo-input]');
    if (!input) return;
    const d = soloDigitos(input.value);
    input.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    input.closest('[data-bloque-codigo]')?.querySelector('[data-error-codigo]')?.classList.add('hidden');
  }

  /** Valida el código del bloque que contiene al botón; si es correcto llama a alListo. */
  async function alValidarCodigo(boton, alListo) {
    const bloque = boton.closest('[data-bloque-codigo]');
    const input = bloque.querySelector('[data-codigo-input]');
    const error = bloque.querySelector('[data-error-codigo]');
    boton.disabled = true;
    boton.textContent = 'Verificando…';
    const r = await validarCodigo(input.value);
    boton.disabled = false;
    boton.textContent = 'Desbloquear y pedir';
    if (r.ok) {
      toast('¡Listo! Ya puedes hacer tu pedido 🙌', 'ok', 2500);
      alListo();
      return;
    }
    error.textContent = textoFallo(r);
    error.classList.remove('hidden');
    bloque.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 320 });
    input.select();
  }

  /** Hoja con el bloque del código; tras desbloquear ejecuta la acción pendiente. */
  function abrirCodigo(despues = null) {
    if (desbloqueado()) { despues?.(); return; }
    cerrarHojas();
    const hoja = abrirHoja({
      ancho: 'md:max-w-md',
      render(cuerpo) {
        cuerpo.innerHTML = `<div data-bloque-codigo class="px-6 pb-6 pt-10">${htmlBloqueCodigo(mozoActual())}</div>`;
      },
    });
    hoja.el.addEventListener('input', alEscribirCodigo);
    hoja.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-validar-codigo]');
      if (b) alValidarCodigo(b, () => { hoja.cerrar(); pintarAvisoCodigo(); recalcularEnlace(); despues?.(); });
    });
    setTimeout(() => hoja.el.querySelector('[data-codigo-input]')?.focus(), 350);
  }

  /* =========================================================
   *  PANTALLA 1 — BIENVENIDA
   * ========================================================= */
  function nuevaPantalla() {
    acPantalla?.abort();
    acPantalla = new AbortController();
    return acPantalla.signal;
  }

  /**
   * Bienvenida en dos pasos, centrada en la pantalla:
   *   1. ¿En qué mesa estás?  (cuadrícula grande de números)
   *   2. ¿Quién te atiende?   (los mozos de turno, en tarjetas grandes)
   * Si el QR trae la mesa (?mesa=7) se empieza directo en el paso 2.
   */
  function mostrarBienvenida(preseleccion = null) {
    const signal = nuevaPantalla();
    let mesaSel = preseleccion ?? estado.mesa;
    let mozoSel = estado.mozoId ?? (mozos().length === 1 ? mozos()[0].id : null);
    let paso = preseleccion ? 'mozo' : 'mesa';
    const L = CONFIG.local;
    const mapa = enlaceMapa(L.mapa);

    raiz.innerHTML = `
      <section class="relative flex min-h-[100dvh] flex-col overflow-hidden">
        <div class="fixed inset-0 bg-carbon-950">
          ${fotoLocal('hero-kenburns h-full w-full object-cover')}
          <div class="absolute inset-0 bg-gradient-to-b from-carbon-950/80 via-carbon-950/65 to-carbon-950/85"></div>
        </div>

        <div class="relative z-10 flex items-center justify-between px-4 pt-safe-4">
          ${logotipo('claro')}
          <div class="flex items-center gap-2">
            ${botonReiniciar('btn-icono !bg-white/15 !text-white backdrop-blur-md')}
            ${botonTema('btn-icono !bg-white/15 !text-white backdrop-blur-md')}
          </div>
        </div>

        <div class="relative z-10 flex flex-1 flex-col px-4 py-6">
          <div id="paso" class="glass my-auto w-full max-w-lg self-center rounded-[28px] p-5 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 sm:p-7"></div>
        </div>

        <footer class="relative z-10 px-6 pb-safe-4 text-center text-xs leading-relaxed text-white/75">
          <p class="font-semibold text-white/90">${esc(CONFIG.nombreCompleto)}</p>
          ${[L.direccion, CONFIG.ubicacion].filter(Boolean).length ? `<p>📍 ${esc([L.direccion, CONFIG.ubicacion].filter(Boolean).join(' · '))}</p>` : ''}
          ${L.referencia ? `<p class="text-white/60">${esc(L.referencia)}</p>` : ''}
          <p>🕒 ${esc(L.horario || `Atención: ${textoHorario()}`)}</p>
          <p class="mt-2 flex flex-wrap justify-center gap-2">
            ${mapa ? `<a href="${esc(mapa)}" target="_blank" rel="noopener" class="rounded-full bg-white/15 px-3 py-1.5 font-semibold text-white backdrop-blur-md">🗺️ Cómo llegar</a>` : ''}
            ${L.telefono ? `<a href="tel:${esc(L.telefono.replace(/[^\d+]/g, ''))}" class="rounded-full bg-white/15 px-3 py-1.5 font-semibold text-white backdrop-blur-md">📞 ${esc(L.telefono)}</a>` : ''}
            ${enlaceRed(L.facebook, 'facebook') ? `<a href="${esc(enlaceRed(L.facebook, 'facebook'))}" target="_blank" rel="noopener" class="rounded-full bg-white/15 px-3 py-1.5 font-semibold text-white backdrop-blur-md">Facebook</a>` : ''}
            ${enlaceRed(L.instagram, 'instagram') ? `<a href="${esc(enlaceRed(L.instagram, 'instagram'))}" target="_blank" rel="noopener" class="rounded-full bg-white/15 px-3 py-1.5 font-semibold text-white backdrop-blur-md">Instagram</a>` : ''}
          </p>
        </footer>
      </section>`;

    const cont = raiz.querySelector('#paso');

    const totalPasos = () => (desbloqueado() ? 2 : 3);

    function pintarPaso() {
      cont.innerHTML = paso === 'mesa' ? htmlPasoMesa() : paso === 'mozo' ? htmlPasoMozo() : htmlPasoCodigo();
      cont.classList.remove('paso-entrada');
      void cont.offsetWidth; // reinicia la animación
      cont.classList.add('paso-entrada');
      sincronizar();
    }

    function htmlPasoMesa() {
      return `
        <p class="text-center text-xs font-bold uppercase tracking-[0.3em] text-arcilla-600 dark:text-oro-300">Paso 1 de ${totalPasos()}</p>
        <h2 class="mt-1 text-center font-display text-3xl font-bold">¿En qué mesa estás?</h2>
        <p class="texto-suave mt-1 text-center text-sm">El número está en el centro de tu mesa.</p>
        <div class="mt-5 grid grid-cols-5 gap-2 sm:gap-3" role="group" aria-label="Número de mesa">
          ${Array.from({ length: CONFIG.totalMesas }, (_, i) => i + 1).map((n) => `
            <button type="button" data-mesa="${n}" aria-pressed="false" style="--i:${n - 1}"
              class="aparecer aspect-square rounded-2xl bg-white text-xl font-bold tabular-nums text-carbon-800 shadow-sm ring-1 ring-carbon-900/10 transition duration-200 active:scale-90 aria-pressed:scale-110 aria-pressed:bg-arcilla-500 aria-pressed:text-white aria-pressed:shadow-lg aria-pressed:shadow-arcilla-500/40 aria-pressed:ring-arcilla-500 dark:bg-carbon-800 dark:text-crema-100 dark:ring-white/10 dark:aria-pressed:bg-oro-400 dark:aria-pressed:text-carbon-950 sm:text-2xl">
              ${n}
            </button>`).join('')}
        </div>`;
    }

    function htmlPasoMozo() {
      const lista = mozos();
      return `
        <div class="flex items-center justify-between gap-3">
          <button type="button" data-volver-mesa class="chip !py-2" aria-label="Cambiar de mesa">${ICONOS.atras('h-4 w-4')} Cambiar</button>
          <p class="text-xs font-bold uppercase tracking-[0.3em] text-arcilla-600 dark:text-oro-300">Paso 2 de ${totalPasos()}</p>
        </div>
        <div class="mt-4 text-center">
          <p class="texto-suave text-xs font-semibold uppercase tracking-[0.3em]">Tu mesa</p>
          <p class="mesa-elegida mx-auto mt-1 grid h-24 w-24 place-items-center rounded-[28px] bg-arcilla-500 font-display text-5xl font-black tabular-nums text-white shadow-xl shadow-arcilla-500/40 dark:bg-oro-400 dark:text-carbon-950">${pad2(mesaSel)}</p>
        </div>
        <h2 class="mt-6 text-center font-display text-3xl font-bold">¿Quién te atiende?</h2>
        <p class="texto-suave mt-1 text-center text-sm">
          <span class="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-palma-500 align-middle"></span>
          ${lista.length === 1 ? 'Mozo de turno' : `${lista.length} mozos atendiendo ahora`} · tu pedido llegará a su WhatsApp
        </p>
        <div class="mt-5 grid ${lista.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-3 ${lista.length > 4 ? 'sm:grid-cols-3' : ''}" role="group" aria-label="Mozo">
          ${lista.map((m, i) => `
            <button type="button" data-mozo="${m.id}" aria-pressed="false" style="--i:${i}"
              class="aparecer group relative flex flex-col items-center gap-2 rounded-3xl bg-white px-3 py-5 shadow-sm ring-1 ring-carbon-900/10 transition active:scale-95 aria-pressed:bg-carbon-900 aria-pressed:text-white aria-pressed:shadow-xl aria-pressed:ring-2 aria-pressed:ring-arcilla-500 dark:bg-carbon-800 dark:ring-white/10 dark:aria-pressed:bg-crema-100 dark:aria-pressed:text-carbon-950 dark:aria-pressed:ring-oro-400">
              <span class="relative grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-arcilla-400 to-arcilla-700 font-display text-2xl font-black italic text-white shadow-lg">
                ${esc(m.nombre.charAt(0).toUpperCase())}
                <span class="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full bg-palma-500 ring-[3px] ring-white dark:ring-carbon-800" title="Atendiendo"></span>
              </span>
              <span class="w-full truncate text-base font-bold">${esc(m.nombre)}</span>
              <span class="text-[11px] font-semibold text-palma-600 group-aria-pressed:text-palma-400 dark:text-palma-400">● Atendiendo</span>
              <span class="absolute right-3 top-3 hidden h-6 w-6 place-items-center rounded-full bg-arcilla-500 text-white group-aria-pressed:grid dark:bg-oro-400 dark:text-carbon-950">${ICONOS.check('h-4 w-4')}</span>
            </button>`).join('')}
        </div>
        <button type="button" id="continuar" class="btn-primario mt-6 w-full text-base" disabled>
          <span>Elige a tu mozo</span>${ICONOS.flecha()}
        </button>`;
    }

    function htmlPasoCodigo() {
      return `
        <div class="flex items-center justify-between gap-3">
          <button type="button" data-volver-mozo class="chip !py-2">${ICONOS.atras('h-4 w-4')} Atrás</button>
          <p class="text-xs font-bold uppercase tracking-[0.3em] text-arcilla-600 dark:text-oro-300">Paso 3 de 3</p>
        </div>
        <div data-bloque-codigo class="mt-4">${htmlBloqueCodigo(mozos().find((m) => m.id === mozoSel))}</div>
        <button type="button" data-solo-ver class="texto-suave mt-4 block w-full text-center text-sm font-semibold underline underline-offset-4">Solo quiero ver la carta</button>`;
    }

    /** Guarda mesa y mozo y entra a la carta (con o sin código). */
    function entrarACarta() {
      estado.mesa = mesaSel;
      estado.mozoId = mozoSel;
      store.set('cliente.sesion', { mesa: mesaSel, mozoId: mozoSel, ts: Date.now() });
      transicion(() => { mostrarCatalogo(); window.scrollTo(0, 0); });
    }

    function sincronizar() {
      raiz.querySelectorAll('[data-mesa]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.mesa === mesaSel)));
      raiz.querySelectorAll('[data-mozo]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.mozo === mozoSel)));
      const boton = raiz.querySelector('#continuar');
      if (!boton) return;
      boton.disabled = !mozoSel;
      boton.querySelector('span').textContent = !mozoSel ? 'Elige a tu mozo' : desbloqueado() ? `Ver la carta · Mesa ${pad2(mesaSel)}` : 'Continuar';
    }

    pintarPaso();

    raiz.addEventListener('click', (e) => {
      const bMesa = e.target.closest('[data-mesa]');
      if (bMesa) {
        mesaSel = +bMesa.dataset.mesa;
        sincronizar();
        bump(bMesa);
        // Pequeña pausa para que se vea la mesa marcada antes de pasar a los mozos
        setTimeout(() => { if (!signal.aborted) { paso = 'mozo'; pintarPaso(); } }, reducirMovimiento() ? 0 : 260);
        return;
      }
      if (e.target.closest('[data-volver-mesa]')) { paso = 'mesa'; pintarPaso(); return; }
      const bMozo = e.target.closest('[data-mozo]');
      if (bMozo) { mozoSel = +bMozo.dataset.mozo; bump(bMozo); sincronizar(); return; }
      if (e.target.closest('#continuar') && mesaSel && mozoSel) {
        if (desbloqueado()) { entrarACarta(); return; }
        estado.mesa = mesaSel; // para el mensaje con el que se pide el código
        estado.mozoId = mozoSel;
        paso = 'codigo';
        pintarPaso();
        return;
      }
      if (e.target.closest('[data-volver-mozo]')) { paso = 'mozo'; pintarPaso(); return; }
      if (e.target.closest('[data-solo-ver]')) { entrarACarta(); return; }
      const bCodigo = e.target.closest('[data-validar-codigo]');
      if (bCodigo) alValidarCodigo(bCodigo, entrarACarta);
    }, { signal });
    raiz.addEventListener('input', alEscribirCodigo, { signal });
  }

  /* =========================================================
   *  PANTALLA 1B — DELIVERY (datos de entrega)
   * ========================================================= */
  function mostrarDelivery() {
    const signal = nuevaPantalla();
    const e = estado.entrega || { nombre: '', direccion: '', referencia: '', ubicacion: '' };
    // El mozo del enlace queda fijo; si el enlace no trae uno válido, el cliente elige (y puede cambiarlo)
    const mozoFijo = mozos().find((m) => m.id === estado.mozoDelLink);
    let mozoSel = estado.mozoId ?? (mozos().length === 1 ? mozos()[0].id : null);

    raiz.innerHTML = `
      <section class="relative flex min-h-[100dvh] flex-col overflow-hidden">
        <div class="fixed inset-0 bg-carbon-950">
          ${fotoLocal('hero-kenburns h-full w-full object-cover')}
          <div class="absolute inset-0 bg-gradient-to-b from-carbon-950/80 via-carbon-950/65 to-carbon-950/85"></div>
        </div>
        <div class="relative z-10 flex items-center justify-between px-4 pt-safe-4">
          ${logotipo('claro')}
          <div class="flex items-center gap-2">
            ${botonReiniciar('btn-icono !bg-white/15 !text-white backdrop-blur-md')}
            ${botonTema('btn-icono !bg-white/15 !text-white backdrop-blur-md')}
          </div>
        </div>
        <div class="relative z-10 flex flex-1 flex-col px-4 py-6">
          <form id="form-delivery" novalidate class="glass paso-entrada my-auto w-full max-w-lg self-center rounded-[28px] p-5 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 sm:p-7">
            <div class="text-center">
              <p class="mesa-elegida mx-auto grid h-20 w-20 place-items-center rounded-[26px] bg-arcilla-500 text-4xl shadow-xl shadow-arcilla-500/40 dark:bg-oro-400">🛵</p>
              <h2 class="mt-4 font-display text-3xl font-bold">Pedido delivery</h2>
              <p class="texto-suave mt-1 text-sm">Para el celular <b class="font-mono text-carbon-900 dark:text-crema-50">${esc(celularDelivery())}</b></p>
            </div>

            <div class="mt-6 space-y-3">
              <label class="block"><span class="text-sm font-semibold">Tu nombre</span>
                <input name="nombre" value="${esc(e.nombre)}" maxlength="40" autocomplete="name" placeholder="¿A nombre de quién?" class="campo mt-1"></label>
              <label class="block"><span class="text-sm font-semibold">Dirección de entrega *</span>
                <input name="direccion" value="${esc(e.direccion)}" maxlength="100" autocomplete="street-address" placeholder="Calle, número, urbanización" class="campo mt-1"></label>
              <label class="block"><span class="text-sm font-semibold">Referencia</span>
                <input name="referencia" value="${esc(e.referencia)}" maxlength="80" placeholder="Ej. frente al parque, casa de 2 pisos" class="campo mt-1"></label>
              <div>
                <button type="button" id="mi-ubicacion" class="btn-secundario w-full !min-h-[46px] text-sm">📍 ${e.ubicacion ? 'Ubicación agregada ✓ · actualizar' : 'Compartir mi ubicación (opcional)'}</button>
                <p class="texto-suave mt-1 text-center text-xs">Ayuda al repartidor a encontrarte más rápido.</p>
              </div>
            </div>

            ${mozoFijo ? `
              <p class="mt-6 flex items-center gap-3 rounded-2xl bg-carbon-900/5 p-3 dark:bg-white/10">
                <span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-arcilla-400 to-arcilla-700 font-display text-lg font-black italic text-white">${esc(mozoFijo.nombre.charAt(0).toUpperCase())}</span>
                <span class="text-sm leading-tight"><span class="texto-suave block text-xs">Te atiende</span><b>${esc(mozoFijo.nombre)}</b> · tu pedido llegará a su WhatsApp</span>
              </p>` : `
              <h3 class="mt-6 font-semibold">¿Quién te atiende?</h3>
              <div class="mt-2 grid grid-cols-2 gap-2.5" role="group" aria-label="Mozo">
                ${mozos().map((m) => `
                  <button type="button" data-mozo="${m.id}" aria-pressed="${m.id === mozoSel}"
                    class="flex items-center gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-carbon-900/10 transition active:scale-95 aria-pressed:bg-carbon-900 aria-pressed:text-white dark:bg-carbon-800 dark:ring-white/10 dark:aria-pressed:bg-crema-100 dark:aria-pressed:text-carbon-950">
                    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-arcilla-400 to-arcilla-700 font-display font-black italic text-white">${esc(m.nombre.charAt(0).toUpperCase())}</span>
                    <span class="truncate text-sm font-semibold">${esc(m.nombre)}</span>
                  </button>`).join('')}
              </div>`}

            <button type="submit" class="btn-primario mt-6 w-full text-base"><span>Ver la carta</span>${ICONOS.flecha()}</button>
          </form>
        </div>
      </section>`;

    const form = raiz.querySelector('#form-delivery');
    const leer = () => {
      const f = new FormData(form);
      const limpio = (k) => String(f.get(k) || '').replace(/\s+/g, ' ').trim();
      return { nombre: limpio('nombre'), direccion: limpio('direccion'), referencia: limpio('referencia'), ubicacion: e.ubicacion || '' };
    };

    raiz.addEventListener('click', (ev) => {
      const bMozo = ev.target.closest('[data-mozo]');
      if (bMozo) {
        mozoSel = +bMozo.dataset.mozo;
        raiz.querySelectorAll('[data-mozo]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.mozo === mozoSel)));
        bump(bMozo);
        return;
      }
      const bUbic = ev.target.closest('#mi-ubicacion');
      if (bUbic) {
        if (!navigator.geolocation) { toast('Tu navegador no puede compartir la ubicación', 'error'); return; }
        bUbic.disabled = true;
        bUbic.textContent = '📍 Buscando tu ubicación…';
        navigator.geolocation.getCurrentPosition((pos) => {
          e.ubicacion = `https://maps.google.com/?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
          // Si el cliente ya pasó a la carta mientras se obtenía, se agrega a su entrega igualmente
          if (estado.entrega && estado.entrega !== e) {
            estado.entrega.ubicacion = e.ubicacion;
            guardarSesionDelivery();
            if (estado.hojaCarrito) recalcularEnlace();
          }
          bUbic.disabled = false;
          bUbic.textContent = '📍 Ubicación agregada ✓ · actualizar';
          toast('Ubicación agregada ✓', 'ok', 1800);
        }, (err) => {
          bUbic.disabled = false;
          bUbic.textContent = '📍 Compartir mi ubicación (opcional)';
          toast(err.code === 1 ? 'Permite el acceso a la ubicación para compartirla' : 'No se pudo obtener tu ubicación', 'aviso', 4000);
        }, { enableHighAccuracy: true, timeout: 15000 });
      }
    }, { signal });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const datos = leer();
      if (datos.direccion.length < 5) {
        toast('Escribe tu dirección de entrega', 'error');
        form.querySelector('[name="direccion"]').focus();
        return;
      }
      if (!mozoSel) { toast('Elige quién te atiende', 'error'); return; }
      estado.entrega = datos;
      estado.mozoId = mozoSel;
      guardarSesionDelivery();
      transicion(() => {
        mostrarCatalogo();
        window.scrollTo(0, 0);
        if (!desbloqueado()) setTimeout(() => abrirCodigo(), 450);
      });
    }, { signal });
  }

  /* =========================================================
   *  PANTALLA 2 — CATÁLOGO
   * ========================================================= */
  function mostrarCatalogo() {
    const signal = nuevaPantalla();
    estado.carrito = cargarCarrito();
    const pestañas = [{ id: 'todo', nombre: 'Todo', icono: '✨' }, ...estado.carta.categorias];

    raiz.innerHTML = `
      <div class="min-h-[100dvh] pb-44">
        <header class="glass-header sticky top-0 z-30 border-b border-carbon-900/5 pt-safe dark:border-white/5">
          <div class="mx-auto max-w-6xl px-4">
            <div class="flex h-16 items-center justify-between gap-3">
              <button type="button" id="logo" aria-label="${esc(CONFIG.nombreCompleto)}">${logotipo('compacto')}</button>
              <div class="flex items-center gap-2">
                <button type="button" id="cambiar-mesa" class="chip !py-2.5" aria-label="${enDelivery() ? 'Cambiar datos de entrega' : 'Cambiar mesa'}">
                  ${enDelivery()
                    ? '<span aria-hidden="true">🛵</span><span>Delivery</span>'
                    : `<span class="texto-suave text-xs font-medium">Mesa</span><span class="tabular-nums">${pad2(estado.mesa)}</span>`}
                </button>
                ${botonReiniciar()}
                ${botonTema()}
              </div>
            </div>
            <label class="relative block pb-3">
              <span class="sr-only">Buscar en la carta</span>
              <span class="texto-suave pointer-events-none absolute left-4 top-3.5">${ICONOS.buscar()}</span>
              <input id="buscar" type="search" autocomplete="off" enterkeyhint="search"
                placeholder="Buscar en la carta…" class="campo !rounded-full !py-3 !pl-12">
            </label>
            <nav class="no-scrollbar -mx-4 overflow-x-auto px-4" aria-label="Categorías">
              <div id="tabs" class="relative flex w-max gap-1 pb-3" role="tablist">
                <span id="indicador" class="indicador-tab absolute left-0 top-0 h-10 rounded-full bg-carbon-900 shadow-md dark:bg-oro-400" aria-hidden="true"></span>
                ${pestañas.map((c) => `
                  <button type="button" role="tab" data-cat="${c.id}" aria-selected="${c.id === estado.categoria}"
                    class="relative z-10 h-10 shrink-0 rounded-full px-4 text-sm font-semibold text-carbon-700 transition-colors duration-300 aria-selected:text-white dark:text-crema-100/70 dark:aria-selected:text-carbon-950">
                    ${c.icono} ${esc(c.nombre)}
                  </button>`).join('')}
              </div>
            </nav>
          </div>
        </header>

        <main class="mx-auto max-w-6xl px-4 pt-4">
          <div id="aviso-codigo"></div>
          <div id="filtros" class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filtros rápidos">
            ${FILTROS.map((f) => `<button type="button" class="chip" data-filtro="${f.id}" aria-pressed="${estado.filtros.has(f.id)}">${f.etiqueta}</button>`).join('')}
          </div>
          <div id="resultados" class="mt-5"></div>
        </main>

        <div id="barra-codigo" class="barra-carrito fixed inset-x-0 bottom-0 z-40 px-4 pb-safe-4"></div>
        <div id="barra" class="barra-carrito fixed inset-x-0 bottom-0 z-40 px-4 pb-safe-4">
          <button type="button" id="ver-carrito" class="mx-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-[22px] bg-carbon-900 px-4 py-3.5 text-white shadow-2xl shadow-carbon-950/40 ring-1 ring-white/10 transition active:scale-[.98] dark:bg-oro-400 dark:text-carbon-950">
            <span class="flex items-center gap-3">
              <span id="icono-bolsa" class="relative grid h-11 w-11 place-items-center rounded-2xl bg-white/10 dark:bg-carbon-950/10">
                ${ICONOS.bolsa('h-6 w-6')}
                <span id="cuenta" class="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-arcilla-500 px-1.5 text-xs font-bold text-white ring-2 ring-carbon-900 dark:ring-oro-400">0</span>
              </span>
              <span class="text-left leading-tight">
                <span class="block text-sm font-bold">Ver mi pedido</span>
                <span class="block text-xs opacity-70">${esc(etiquetaMesa())} · ${esc(mozoActual()?.nombre || '')}</span>
              </span>
            </span>
            <span id="total-barra" class="font-display text-xl font-bold tabular-nums">${soles(0)}</span>
          </button>
        </div>
      </div>`;

    pintarAvisoCodigo();
    pintarResultados();
    requestAnimationFrame(moverIndicador);
    actualizarCarrito();

    // --- Eventos ---
    const buscar = raiz.querySelector('#buscar');
    buscar.addEventListener('input', debounce(() => {
      estado.busqueda = buscar.value.trim();
      pintarResultados();
    }, 140), { signal });

    window.addEventListener('resize', debounce(moverIndicador, 100), { signal });
    document.addEventListener('visibilitychange', revisarCarritoVigente, { signal });
    window.addEventListener('pageshow', revisarCarritoVigente, { signal });

    let toquesLogo = 0;
    let temporizadorLogo = null;

    raiz.addEventListener('click', (e) => {
      const t = e.target;

      // Botón rápido "+" en la tarjeta
      if (t.closest('[data-ingresar-codigo]')) { abrirCodigo(); return; }

      const agregarBtn = t.closest('[data-agregar]');
      if (agregarBtn) {
        const p = plato(agregarBtn.dataset.agregar);
        if (!p?.activo) return;
        if (!desbloqueado()) { abrirCodigo(() => agregar(p.id, 1, '')); return; }
        agregar(p.id, 1, '');
        bump(agregarBtn);
        volarHacia(agregarBtn, raiz.querySelector('#icono-bolsa'));
        return;
      }

      // Tarjeta o carrusel → detalle
      const tarjeta = t.closest('[data-plato]');
      if (tarjeta) { abrirDetalle(tarjeta.dataset.plato); return; }

      const tab = t.closest('[data-cat]');
      if (tab) {
        estado.categoria = tab.dataset.cat;
        raiz.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
        moverIndicador();
        tab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        pintarResultados();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const filtro = t.closest('[data-filtro]');
      if (filtro) {
        const id = filtro.dataset.filtro;
        estado.filtros.has(id) ? estado.filtros.delete(id) : estado.filtros.add(id);
        filtro.setAttribute('aria-pressed', String(estado.filtros.has(id)));
        pintarResultados();
        return;
      }

      if (t.closest('#limpiar-busqueda')) {
        estado.busqueda = '';
        estado.filtros.clear();
        buscar.value = '';
        raiz.querySelectorAll('[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        pintarResultados();
        return;
      }

      if (t.closest('#ver-carrito')) { abrirCarrito(); return; }
      if (t.closest('#cambiar-mesa')) { transicion(() => (enDelivery() ? mostrarDelivery() : mostrarBienvenida())); return; }

      // Acceso oculto al administrador: 5 toques seguidos al logotipo
      if (t.closest('#logo')) {
        toquesLogo += 1;
        clearTimeout(temporizadorLogo);
        temporizadorLogo = setTimeout(() => { toquesLogo = 0; }, 1800);
        if (toquesLogo >= 5) { toquesLogo = 0; navegar('/admin'); }
      }
    }, { signal });
  }

  /**
   * Sin código del día: franja arriba + BARRA FIJA abajo (siempre visible)
   * con «Pedir código» por WhatsApp e «Ingresar código».
   */
  function pintarAvisoCodigo() {
    const barra = raiz.querySelector('#barra-codigo');
    if (barra) {
      const mozo = mozoActual();
      barra.classList.toggle('visible', !desbloqueado());
      barra.innerHTML = desbloqueado() ? '' : `
        <div class="mx-auto w-full max-w-lg rounded-[22px] bg-carbon-900 p-3 text-white shadow-2xl shadow-carbon-950/40 ring-1 ring-white/10 dark:bg-carbon-800">
          <p class="px-1 pb-2.5 text-center text-sm font-semibold">🔑 Para pedir necesitas el <span class="text-oro-300">código de ${esc(mozo?.nombre || 'tu mozo')}</span></p>
          <div class="grid grid-cols-2 gap-2">
            ${mozo ? `<a href="${esc(enlacePedirCodigo(mozo))}" target="_blank" rel="noopener"
              class="flex min-h-[50px] items-center justify-center gap-1.5 rounded-2xl bg-[#25D366] px-2 text-sm font-bold text-white transition active:scale-[.97]">${ICONOS.whatsapp('h-5 w-5')} Pedir código</a>` : ''}
            <button type="button" data-ingresar-codigo class="flex min-h-[50px] items-center justify-center gap-1.5 rounded-2xl bg-oro-400 px-2 text-sm font-bold text-carbon-950 transition active:scale-[.97] ${mozo ? '' : 'col-span-2'}">🔑 Ingresar código</button>
          </div>
        </div>`;
    }
    raiz.querySelector('#barra')?.classList.toggle('visible', desbloqueado() && unidadesCarrito() > 0);
    const cont = raiz.querySelector('#aviso-codigo');
    if (!cont) return;
    cont.innerHTML = desbloqueado() ? '' : `
      <div class="mb-4 flex items-center gap-3 rounded-2xl bg-oro-400/15 p-3 ring-1 ring-oro-500/30">
        <span class="text-2xl" aria-hidden="true">👀</span>
        <p class="min-w-0 flex-1 text-sm leading-snug"><b>Estás viendo la carta.</b> Para pedir, ingresa el código que te da tu mozo.</p>
        <button type="button" data-ingresar-codigo class="btn-primario !min-h-[40px] shrink-0 !px-3 text-sm">🔑 Código</button>
      </div>`;
  }

  /** Desliza la "píldora" de la pestaña activa. */
  function moverIndicador() {
    const activo = raiz.querySelector('[data-cat][aria-selected="true"]');
    const ind = raiz.querySelector('#indicador');
    if (!activo || !ind) return;
    ind.style.width = `${activo.offsetWidth}px`;
    ind.style.transform = `translateX(${activo.offsetLeft}px)`;
  }

  function platosFiltrados() {
    const q = normalizar(estado.busqueda);
    const filtros = FILTROS.filter((f) => estado.filtros.has(f.id));
    return estado.carta.platos
      .filter((p) => q || estado.categoria === 'todo' || p.cat === estado.categoria) // la búsqueda recorre toda la carta
      .filter((p) => !q || normalizar(`${p.nombre} ${p.desc} ${(p.tags || []).join(' ')}`).includes(q))
      .filter((p) => filtros.every((f) => f.fn(p)))
      .sort((a, b) => Number(b.activo) - Number(a.activo)); // agotados al final
  }

  function pintarResultados() {
    const cont = raiz.querySelector('#resultados');
    const lista = platosFiltrados();
    const hayFiltro = estado.busqueda || estado.filtros.size;

    if (!lista.length) {
      cont.innerHTML = `
        <div class="aparecer mx-auto max-w-sm py-16 text-center">
          <p class="text-5xl">🍽️</p>
          <h3 class="mt-4 font-display text-2xl font-bold">Nada por aquí</h3>
          <p class="texto-suave mt-2 text-sm">No encontramos platos con esa búsqueda o filtros.</p>
          <button type="button" id="limpiar-busqueda" class="btn-secundario mt-6">Ver toda la carta</button>
        </div>`;
      return;
    }

    let html = '';
    if (estado.categoria === 'todo' && !hayFiltro) html += carruselEspecialidades();

    const categorias = estado.carta.categorias.filter((c) => estado.busqueda || estado.categoria === 'todo' || c.id === estado.categoria);
    let i = 0;
    for (const c of categorias) {
      const ps = lista.filter((p) => p.cat === c.id);
      if (!ps.length) continue;
      html += `
        <section class="mb-10">
          <div class="mb-4 flex items-end justify-between gap-3">
            <h2 class="font-display text-2xl font-bold sm:text-3xl">${c.icono} ${esc(c.nombre)}</h2>
            <span class="texto-suave shrink-0 text-xs font-medium">${ps.length} ${ps.length === 1 ? 'opción' : 'opciones'}</span>
          </div>
          <div class="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            ${ps.map((p) => tarjeta(p, i++)).join('')}
          </div>
        </section>`;
    }
    cont.innerHTML = html;
    actualizarContadores();
  }

  function carruselEspecialidades() {
    const esp = estado.carta.platos.filter((p) => p.especialidad && p.activo);
    if (!esp.length) return '';
    return `
      <section class="-mx-4 mb-10">
        <div class="mb-4 flex items-center gap-2 px-4">
          <span class="grid h-8 w-8 place-items-center rounded-full bg-oro-400 text-carbon-950">${ICONOS.estrella('h-4 w-4')}</span>
          <h2 class="font-display text-2xl font-bold sm:text-3xl">Especialidades de la Casa</h2>
        </div>
        <div class="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2">
          ${esp.map((p, i) => `
            <button type="button" data-plato="${p.id}" style="--i:${i}"
              class="tarjeta aparecer relative h-60 w-[80%] max-w-sm shrink-0 snap-start overflow-hidden rounded-[28px] text-left shadow-xl shadow-carbon-950/10 sm:h-72">
              ${imagenPlato(p)}
              <span class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"></span>
              <span class="absolute inset-x-0 bottom-0 block p-5 text-white">
                <span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-oro-300">${ICONOS.estrella('h-3 w-3')} Especialidad de la Casa</span>
                <span class="mt-1 block font-display text-2xl font-bold leading-tight sm:text-3xl">${esc(p.nombre)}</span>
                <span class="mt-1 block font-semibold tabular-nums text-oro-200">${soles(p.precio)}</span>
              </span>
            </button>`).join('')}
        </div>
      </section>`;
  }

  function tarjeta(p, i) {
    return `
      <article data-plato="${p.id}" style="--i:${i}"
        class="tarjeta aparecer superficie group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl shadow-sm transition hover:-translate-y-1 hover:shadow-xl ${p.activo ? '' : 'grayscale-[.6]'}">
        <div class="relative aspect-[4/3]">
          ${imagenPlato(p)}
          ${p.especialidad ? `
            <span class="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-oro-400/95 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider text-carbon-950 shadow-md backdrop-blur sm:text-[10px]">
              ${ICONOS.estrella('h-3 w-3')} <span class="hidden min-[400px]:inline">Especialidad de la Casa</span><span class="min-[400px]:hidden">Especialidad</span>
            </span>` : ''}
          <span data-contador="${p.id}" class="absolute right-2 top-2 hidden h-7 min-w-7 place-items-center rounded-full bg-arcilla-500 px-2 text-xs font-bold text-white shadow-lg ring-2 ring-white dark:ring-carbon-800"></span>
          ${p.activo ? '' : `
            <div class="absolute inset-0 grid place-items-center bg-carbon-950/55">
              <span class="rounded-full bg-white/95 px-3 py-1 text-[11px] font-extrabold uppercase tracking-widest text-carbon-900">Agotado</span>
            </div>`}
        </div>
        <div class="flex flex-1 flex-col p-3 sm:p-4">
          <h3 class="font-display text-[15px] font-bold leading-snug sm:text-lg">${esc(p.nombre)}</h3>
          <p class="texto-suave mt-1 line-clamp-2 text-xs leading-relaxed sm:text-sm">${esc(p.desc)}</p>
          <div class="mt-auto flex items-center justify-between gap-2 pt-3">
            <span class="precio text-[15px] sm:text-lg">${soles(p.precio)}</span>
            <button type="button" data-agregar="${p.id}" ${p.activo ? '' : 'disabled'} aria-label="Agregar ${esc(p.nombre)}"
              class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-arcilla-500 text-white shadow-lg shadow-arcilla-500/30 transition active:scale-90 disabled:bg-carbon-900/20 disabled:shadow-none dark:bg-oro-400 dark:text-carbon-950 dark:shadow-oro-400/20">
              ${ICONOS.mas()}
            </button>
          </div>
        </div>
      </article>`;
  }

  /* =========================================================
   *  DETALLE DE PLATO (bottom-sheet)
   * ========================================================= */
  function abrirDetalle(id) {
    const p = plato(id);
    if (!p) return;
    let cantidad = 1;

    const hoja = abrirHoja({
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <div class="relative aspect-[16/11] overflow-hidden md:aspect-[16/9]">
            ${imagenPlato(p)}
            ${p.especialidad ? `<span class="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-oro-400 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-carbon-950 shadow-lg">${ICONOS.estrella()} Especialidad de la Casa</span>` : ''}
          </div>
          <div class="p-5 sm:p-6">
            <div class="flex items-start justify-between gap-4">
              <h2 class="font-display text-3xl font-bold leading-tight">${esc(p.nombre)}</h2>
              <span class="precio shrink-0 pt-1 text-xl">${soles(p.precio)}</span>
            </div>
            <p class="texto-suave mt-3 leading-relaxed">${esc(p.desc)}</p>
            ${(p.tags || []).length ? `<div class="mt-3 flex gap-2">${p.tags.map((t) => `<span class="rounded-full bg-arcilla-50 px-2.5 py-1 text-xs font-semibold capitalize text-arcilla-700 dark:bg-white/10 dark:text-crema-100">${t === 'picante' ? '🌶️' : '🐟'} ${esc(t)}</span>`).join('')}</div>` : ''}
            ${p.activo ? `
              <label for="nota-detalle" class="mt-6 flex items-center gap-2 text-sm font-semibold">${ICONOS.nota('h-4 w-4')} Nota para la cocina <span class="texto-suave font-normal">(opcional)</span></label>
              <textarea id="nota-detalle" rows="2" maxlength="${MAX_NOTA}" placeholder="Ej. sin picante, bien frito…" class="campo mt-2 resize-none"></textarea>
              <div class="mt-3 flex flex-wrap gap-2">
                ${NOTAS_RAPIDAS.map((n) => `<button type="button" class="chip !py-1.5 !text-xs" data-nota-rapida="${esc(n)}">+ ${esc(n)}</button>`).join('')}
              </div>` : `
              <p class="mt-6 rounded-2xl bg-carbon-900/5 p-4 text-center text-sm font-semibold dark:bg-white/10">Este plato está agotado por hoy 😔</p>`}
          </div>`;
        pie.innerHTML = p.activo ? `
          <div class="flex items-center gap-3 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
            ${stepper(cantidad)}
            <button type="button" data-confirmar class="btn-primario flex-1">Agregar · <span data-subtotal class="tabular-nums">${soles(p.precio * cantidad)}</span></button>
          </div>` : '';
      },
    });

    hoja.el.addEventListener('click', (e) => {
      const nota = hoja.el.querySelector('#nota-detalle');
      if (e.target.closest('[data-menos]')) cantidad = Math.max(1, cantidad - 1);
      else if (e.target.closest('[data-mas]')) cantidad = Math.min(30, cantidad + 1);
      else if (e.target.closest('[data-nota-rapida]')) {
        const extra = e.target.closest('[data-nota-rapida]').dataset.notaRapida;
        if (!nota.value.toLowerCase().includes(extra.toLowerCase())) {
          nota.value = (nota.value.trim() ? `${nota.value.trim()}, ${extra}` : extra).slice(0, MAX_NOTA);
        }
        bump(e.target.closest('[data-nota-rapida]'));
        return;
      } else if (e.target.closest('[data-confirmar]')) {
        if (!desbloqueado()) {
          const [qty, texto] = [cantidad, nota.value];
          abrirCodigo(() => { agregar(p.id, qty, texto); toast(`${qty}× ${p.nombre} agregado`, 'ok', 1800); });
          return;
        }
        agregar(p.id, cantidad, nota.value);
        volarHacia(e.target.closest('[data-confirmar]'), raiz.querySelector('#icono-bolsa'));
        toast(`${cantidad}× ${p.nombre} agregado`, 'ok', 1800);
        hoja.cerrar();
        return;
      } else return;

      hoja.el.querySelector('[data-valor]').textContent = cantidad;
      hoja.el.querySelector('[data-subtotal]').textContent = soles(p.precio * cantidad);
    });
  }

  /* =========================================================
   *  CARRITO
   * ========================================================= */
  /**
   * Carrito AÚN NO ENVIADO: { items, ts } (sobrevive a una recarga). Se
   * descarta si lleva horas sin cambios o viene de un formato anterior
   * (incluido el de versiones que guardaban pedidos ya enviados).
   */
  function cargarCarrito() {
    const guardado = store.get(claveCarrito(), null);
    if (!guardado) return [];
    if (Array.isArray(guardado) || guardado.enviado || Date.now() - guardado.ts > VIGENCIA_CARRITO_MS) {
      store.remove(claveCarrito());
      return [];
    }
    estado.carritoTs = guardado.ts;
    const validos = guardado.items.filter((l) => plato(l.id)?.activo && l.qty > 0);
    if (validos.length < guardado.items.length) toast('Algunos platos de tu pedido ya no están disponibles', 'aviso');
    return validos;
  }

  function guardarCarrito() {
    if (!estado.carrito.length) { store.remove(claveCarrito()); return; }
    estado.carritoTs = Date.now();
    store.set(claveCarrito(), { items: estado.carrito, ts: estado.carritoTs });
  }

  /* ---------- Pedidos enviados: solo se cuenta cuántos (nunca su contenido) ---------- */
  // (funciones declaradas: esta zona está después del `return` de la vista)
  function claveEnviados() { return `cliente.enviados.${estado.mesa}`; }
  /** Cuántos pedidos se enviaron desde este celular a esta mesa/delivery en la sesión. */
  function pedidosEnviados() {
    const g = store.get(claveEnviados(), null);
    return g && Date.now() - g.ts < VIGENCIA_SESION_MS ? g.n : 0;
  }

  /**
   * Al tocar «Enviar»: el pedido se va a WhatsApp y el carrito queda VACÍO.
   * Así no se puede reenviar ni editar un pedido ya enviado.
   */
  function vaciarTrasEnvio() {
    store.set(claveEnviados(), { n: pedidosEnviados() + 1, ts: Date.now() });
    estado.carrito = [];
    guardarCarrito();
    estado.hojaCarrito?.cerrar();
    actualizarCarrito();
  }

  /** Al volver a la pestaña (sin recargar), descarta un carrito abandonado hace horas. */
  function revisarCarritoVigente() {
    if (document.visibilityState !== 'visible' || !estado.carrito.length) return;
    if (Date.now() - estado.carritoTs <= VIGENCIA_CARRITO_MS) return;
    estado.carrito = [];
    store.remove(claveCarrito());
    cerrarHojas();
    actualizarCarrito();
    toast('Tu pedido sin enviar expiró. Empezamos de nuevo.', 'info', 3500);
  }

  /** Agrega platos; si ya existe el mismo plato con la misma nota, suma la cantidad. */
  function agregar(id, qty, nota) {
    nota = limpiarNota(nota);
    const existente = estado.carrito.find((l) => l.id === id && l.nota === nota);
    if (existente) existente.qty += qty;
    else estado.carrito.push({ k: Math.random().toString(36).slice(2, 9), id, qty, nota });
    guardarCarrito();
    actualizarCarrito(true);
  }

  /** Refresca barra flotante, contadores de tarjetas y la hoja del carrito. */
  function actualizarCarrito(animar = false) {
    const barra = raiz.querySelector('#barra');
    if (!barra) return;
    const unidades = unidadesCarrito();
    barra.classList.toggle('visible', unidades > 0 && desbloqueado()); // sin código manda la barra del código
    raiz.querySelector('#cuenta').textContent = unidades;
    raiz.querySelector('#total-barra').textContent = soles(totalCarrito());
    if (animar) bump(raiz.querySelector('#ver-carrito'));
    actualizarContadores();

    estado.enlace = null;
    if (estado.hojaCarrito) {
      estado.hojaCarrito.refrescar();
      recalcularEnlace();
    }
  }

  function actualizarContadores() {
    const porPlato = {};
    estado.carrito.forEach((l) => { porPlato[l.id] = (porPlato[l.id] || 0) + l.qty; });
    raiz.querySelectorAll('[data-contador]').forEach((el) => {
      const n = porPlato[el.dataset.contador] || 0;
      el.textContent = n;
      el.classList.toggle('hidden', !n);
      el.classList.toggle('grid', !!n);
    });
  }

  function abrirCarrito() {
    const mozo = mozoActual();
    const hoja = abrirHoja({
      titulo: 'Tu pedido',
      subtitulo: `${etiquetaMesa()} · Te atiende ${mozo?.nombre || ''}`,
      render: pintarCarrito,
      alCerrar: () => { estado.hojaCarrito = null; },
    });
    estado.hojaCarrito = hoja;
    recalcularEnlace();

    hoja.el.addEventListener('click', (e) => {
      const linea = e.target.closest('[data-linea]');
      if (linea) {
        const item = estado.carrito.find((l) => l.k === linea.dataset.linea);
        if (!item) return;
        if (e.target.closest('[data-mas]')) item.qty = Math.min(30, item.qty + 1);
        else if (e.target.closest('[data-menos]')) item.qty -= 1;
        else if (e.target.closest('[data-quitar]')) item.qty = 0;
        else return;
        estado.carrito = estado.carrito.filter((l) => l.qty > 0);
        guardarCarrito();
        actualizarCarrito();
        return;
      }

      if (e.target.closest('[data-ingresar-codigo]')) { abrirCodigo(() => abrirCarrito()); return; }

      const enviar = e.target.closest('#enviar');
      if (enviar) {
        if (!estado.enlace) { e.preventDefault(); return; }
        // El enlace abre WhatsApp de forma nativa (el clic sigue su curso);
        // justo después el pedido se borra del celular.
        const enviado = {
          id: estado.pedidoId, enlace: estado.enlace, total: totalCarrito(),
          unidades: unidadesCarrito(), numero: pedidosEnviados() + 1,
        };
        setTimeout(() => { vaciarTrasEnvio(); confirmarEnvio(enviado); }, 0);
      }
    });

    // Las notas se editan en vivo sin volver a pintar (no se pierde el foco)
    hoja.el.addEventListener('input', debounce((e) => {
      const campo = e.target.closest('[data-nota-linea]');
      if (!campo) return;
      const item = estado.carrito.find((l) => l.k === campo.dataset.notaLinea);
      if (!item) return;
      item.nota = limpiarNota(campo.value);
      guardarCarrito();
      recalcularEnlace();
    }, 300));
  }

  function pintarCarrito(cuerpo, pie) {
    if (!estado.carrito.length) {
      cuerpo.innerHTML = `
        <div class="px-6 py-16 text-center">
          <p class="text-5xl">🛒</p>
          <h3 class="mt-4 font-display text-2xl font-bold">Tu pedido está vacío</h3>
          <p class="texto-suave mt-2 text-sm">Agrega platos de la carta para empezar.</p>
          <button type="button" data-cerrar-hoja class="btn-primario mt-6">Ver la carta</button>
        </div>`;
      pie.innerHTML = '';
      return;
    }

    cuerpo.innerHTML = `
      <ul class="divide-y divide-carbon-900/5 dark:divide-white/5">
        ${estado.carrito.map((l) => {
          const p = plato(l.id);
          return `
            <li class="flex gap-3 px-5 py-4" data-linea="${l.k}">
              <div class="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl">${imagenPlato(p)}</div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <h4 class="font-semibold leading-snug">${esc(p.nombre)}</h4>
                  <button type="button" data-quitar class="texto-suave -mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-red-500/10 hover:text-red-600" aria-label="Quitar ${esc(p.nombre)}">${ICONOS.basura('h-4 w-4')}</button>
                </div>
                <input type="text" data-nota-linea="${l.k}" value="${esc(l.nota)}" maxlength="${MAX_NOTA}"
                  placeholder="+ Añadir nota (ej. sin picante)"
                  class="mt-1 w-full rounded-xl bg-transparent px-0 py-1 text-sm text-arcilla-700 outline-none placeholder:text-carbon-700/40 focus:bg-carbon-900/5 focus:px-2 dark:text-oro-300 dark:placeholder:text-crema-100/30 dark:focus:bg-white/5">
                <div class="mt-2 flex items-center justify-between">
                  ${stepper(l.qty)}
                  <span class="precio">${soles(p.precio * l.qty)}</span>
                </div>
              </div>
            </li>`;
        }).join('')}
      </ul>`;

    pie.innerHTML = `
      <div class="space-y-3 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
        <div class="flex items-baseline justify-between">
          <span class="texto-suave text-sm font-medium">${unidadesCarrito()} ${unidadesCarrito() === 1 ? 'plato' : 'platos'} · Total</span>
          <span class="font-display text-3xl font-bold tabular-nums">${soles(totalCarrito())}</span>
        </div>
        ${desbloqueado() ? `
          <a id="enviar" href="#" target="_blank" rel="noopener" aria-disabled="true"
            class="flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-[#25D366] px-5 text-base font-bold text-white shadow-lg shadow-[#25D366]/30 transition active:scale-[.98] aria-disabled:opacity-60">
            ${ICONOS.whatsapp()} Enviar pedido a ${esc(mozoActual()?.nombre || 'mozo')}
          </a>
          <p class="texto-suave text-center text-xs">Se abrirá WhatsApp con tu pedido listo. Solo presiona <b>Enviar</b>.</p>` : `
          <button type="button" data-ingresar-codigo class="btn-primario w-full text-base">🔑 Ingresa el código para enviar</button>
          <p class="texto-suave text-center text-xs">El código del día venció o cambió. Pídeselo de nuevo a tu mozo.</p>`}
      </div>`;
    aplicarEnlace();
  }

  /* =========================================================
   *  WHATSAPP — mensaje + código (precalculado para que el
   *  enlace sea nativo y no lo bloqueen los navegadores)
   * ========================================================= */
  async function recalcularEnlace() {
    const version = ++versionCalculo;
    estado.enlace = null;
    aplicarEnlace();
    const codigoDia = codigoGuardado();
    if (!estado.carrito.length || !codigoDia) return;

    const mozo = mozoActual();
    const items = estado.carrito.map((l) => {
      const p = plato(l.id);
      return { id: p.id, nombre: p.nombre, precio: p.precio, qty: l.qty, nota: l.nota };
    });
    const { codigo, id } = await codificarPedido({
      mesa: estado.mesa, mozoId: estado.mozoId, items, entrega: enDelivery() ? estado.entrega : null, codigoDia,
    });
    if (version !== versionCalculo) return; // el carrito cambió mientras se calculaba

    const mensaje = construirMensaje({ id, codigo, items, mozo, numero: pedidosEnviados() + 1 });
    estado.pedidoId = id;
    // Número de 9 dígitos → se antepone el código de país (51); si ya lo trae, se respeta
    const digitos = String(mozo.telefono).replace(/\D/g, '');
    const telefono = digitos.length === 9 ? CONFIG.prefijoPais + digitos : digitos;
    estado.enlace = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
    aplicarEnlace();
  }

  function aplicarEnlace() {
    const a = document.getElementById('enviar');
    if (!a) return;
    a.href = estado.enlace || '#';
    a.setAttribute('aria-disabled', String(!estado.enlace));
  }

  function construirMensaje({ id, codigo, items, mozo, numero = 1 }) {
    const linea = '━━━━━━━━━━━━━━━━━━';
    const total = items.reduce((s, i) => s + i.precio * i.qty, 0);
    const detalle = items.map((i) => {
      let fila = `▪️ *${i.qty}×* ${i.nombre} — ${soles(i.precio * i.qty)}`;
      if (i.nota) fila += `\n      📝 ${i.nota}`;
      return fila;
    }).join('\n');

    return [
      `🍽️ *${CONFIG.nombreCompleto.toUpperCase()}*`,
      ...(CONFIG.ubicacion ? [`📍 ${CONFIG.ubicacion}`] : []),
      linea,
      ...(enDelivery() ? [
        '🛵 *PEDIDO DELIVERY*',
        `📱 *Celular:* ${celularDelivery()}`,
        ...(estado.entrega?.nombre ? [`👤 *Cliente:* ${estado.entrega.nombre}`] : []),
        `🏠 *Dirección:* ${estado.entrega?.direccion || ''}`,
        ...(estado.entrega?.referencia ? [`🧭 *Referencia:* ${estado.entrega.referencia}`] : []),
        ...(estado.entrega?.ubicacion ? [`📍 *Ubicación:* ${estado.entrega.ubicacion}`] : []),
      ] : [`🪑 *Mesa:* ${pad2(estado.mesa)}`]),
      `🧑‍🍳 *Mozo:* ${mozo.nombre}`,
      `🕒 *Hora:* ${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`,
      `🔖 *Pedido:* ${id}`,
      linea,
      numero > 1 ? `➕ *PEDIDO ADICIONAL* (${numero}.º desde este celular)` : '🆕 *PEDIDO NUEVO*',
      '',
      detalle,
      linea,
      `💰 *TOTAL: ${soles(total)}*`,
      '',
      '📋 Código para el panel del mozo:',
      codigo,
    ].join('\n');
  }

  /**
   * Tras enviar: el carrito ya está vacío. No hay «volver a mi pedido»:
   * agregar = hacer otro pedido; cambiar o quitar = escribirle al mozo.
   */
  function confirmarEnvio(enviado) {
    const mozo = mozoActual();
    const digitos = String(mozo?.telefono || '').replace(/\D/g, '');
    const chatMozo = `https://wa.me/${digitos.length === 9 ? CONFIG.prefijoPais + digitos : digitos}?text=${encodeURIComponent(
      `Hola ${mozo?.nombre || ''} 👋 Sobre mi pedido ${enviado.id} (${etiquetaMesa()}): quiero cambiar `,
    )}`;
    const hoja = abrirHoja({
      ancho: 'md:max-w-md',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <div class="px-6 pb-2 pt-12 text-center">
            <div class="anillo-exito mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#25D366] text-white shadow-xl shadow-[#25D366]/40">
              <svg class="check-dibujado h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>
            </div>
            <h2 class="mt-5 font-display text-3xl font-bold">${enviado.numero > 1 ? '¡Pedido adicional enviado!' : '¡Pedido enviado!'}</h2>
            <p class="texto-suave mt-2">Presiona <b>Enviar</b> en WhatsApp para que <b>${esc(mozo?.nombre || 'tu mozo')}</b> lo reciba.</p>
            <p class="mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-xl bg-carbon-900/5 px-3 py-1.5 text-sm dark:bg-white/10">
              <span class="font-mono font-bold">${esc(enviado.id || '')}</span>
              <span class="texto-suave">· ${enviado.unidades} ${enviado.unidades === 1 ? 'plato' : 'platos'} · ${soles(enviado.total)}</span>
            </p>
          </div>
          <ul class="mx-6 mt-4 space-y-2 rounded-2xl bg-oro-400/10 p-4 text-sm ring-1 ring-oro-500/25">
            <li>➕ <b>¿Quieres algo más?</b> Haz <b>otro pedido</b>: se suma a tu misma cuenta.</li>
            <li>✏️ <b>¿Cambiar o quitar algo?</b> Escríbele a tu mozo: él lo corrige.</li>
          </ul>`;
        pie.innerHTML = `
          <div class="space-y-2.5 px-5 pb-5 pt-4">
            <button type="button" data-cerrar-hoja class="btn-primario w-full">➕ Hacer otro pedido</button>
            <a href="${esc(chatMozo)}" target="_blank" rel="noopener" class="btn-secundario w-full">${ICONOS.whatsapp('h-5 w-5')} Pedir un cambio a ${esc(mozo?.nombre || 'mi mozo')}</a>
            <a href="${esc(enviado.enlace)}" target="_blank" rel="noopener" class="texto-suave block pt-1 text-center text-xs underline underline-offset-4">¿WhatsApp no se abrió? Reintentar este mismo pedido</a>
          </div>`;
      },
    });
    hoja.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerrar-hoja]')) toast('Elige lo que quieras agregar 🍽️', 'info', 1800);
    });
  }
}

/* =========================================================
 *  Utilidades de pantalla
 * ========================================================= */
/** ?delivery=987654321&m=2 → { mesa: 'D987654321', mozoId: 2 } (acepta el 51 delante). */
function leerDeliveryDeUrl() {
  const p = new URLSearchParams(location.search);
  const tel = normalizarCelular(p.get('delivery') || '');
  return tel ? { mesa: `D${tel}`, mozoId: parseInt(p.get('m'), 10) || null } : null;
}

function leerMesaDeUrl(max = CONFIG.totalMesas) {
  const n = parseInt(new URLSearchParams(location.search).get('mesa'), 10);
  return n >= 1 && n <= max ? n : null;
}

/** Botón «Empezar de nuevo» (borra la sesión de la carta en este celular). */
function botonReiniciar(clase = 'btn-icono') {
  return `<button type="button" data-reiniciar class="${clase}" aria-label="Empezar de nuevo" title="Empezar de nuevo">${ICONOS.restaurar()}</button>`;
}

/** Enlace de Facebook/Instagram a partir de un enlace o un @usuario. */
function enlaceRed(valor = '', red) {
  const v = valor.trim();
  if (!v) return '';
  if (/^@?[\w.]+$/.test(v)) return `https://www.${red}.com/${v.replace(/^@/, '')}`;
  return enlaceMapa(v); // cualquier enlace https válido
}

/**
 * Intro animada al escanear el QR: logotipo, frase del local y una barra
 * que se llena en 3 s. Un toque la salta. Mientras corre se carga la carta.
 */
function mostrarIntro(raiz, signal) {
  const ms = reducirMovimiento() ? 900 : DURACION_INTRO_MS;
  raiz.innerHTML = `
    <section class="intro fixed inset-0 z-50 grid place-items-center overflow-hidden bg-carbon-950 text-white" style="--dur:${ms}ms" aria-label="Bienvenido a ${esc(CONFIG.nombreCompleto)}">
      ${fotoLocal('intro-foto absolute inset-0 h-full w-full object-cover')}
      <div class="absolute inset-0 bg-gradient-to-b from-carbon-950/70 via-carbon-950/60 to-carbon-950/90"></div>
      <div class="intro-halo absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full"></div>
      <div class="relative px-8 text-center">
        <p class="intro-plato text-6xl" aria-hidden="true">🍽️</p>
        <div class="mt-4">${logotipo('hero')}</div>
        ${CONFIG.local.eslogan ? `<p class="logo-entrada mx-auto mt-5 max-w-xs text-sm text-white/85" style="--d:500ms">${esc(CONFIG.local.eslogan)}</p>` : ''}
        <div class="mx-auto mt-10 h-1 w-48 overflow-hidden rounded-full bg-white/15">
          <div class="intro-barra h-full rounded-full bg-gradient-to-r from-oro-300 to-arcilla-400"></div>
        </div>
        <p class="logo-entrada mt-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/60" style="--d:700ms">Preparando tu mesa…</p>
      </div>
    </section>`;

  const terminada = new Promise((ok) => {
    const fin = () => { clearTimeout(t); raiz.removeEventListener('click', fin); ok(); };
    const t = setTimeout(fin, ms);
    raiz.addEventListener('click', fin, { signal });
  });
  return { terminada };
}

/** Skeleton mientras llega data/menu.json. */
function pantallaCarga() {
  const tarjetaFantasma = `
    <div class="superficie overflow-hidden rounded-3xl">
      <div class="skeleton aspect-[4/3]"></div>
      <div class="space-y-2 p-4">
        <div class="skeleton h-4 w-3/4 rounded-full"></div>
        <div class="skeleton h-3 w-full rounded-full"></div>
        <div class="skeleton h-3 w-1/2 rounded-full"></div>
      </div>
    </div>`;
  return `
    <div class="mx-auto max-w-6xl px-4 pt-safe-4" aria-busy="true" aria-label="Cargando carta">
      <div class="flex h-12 items-center justify-between">
        <div class="skeleton h-9 w-32 rounded-xl"></div>
        <div class="skeleton h-11 w-11 rounded-full"></div>
      </div>
      <div class="skeleton mt-4 h-12 w-full rounded-full"></div>
      <div class="mt-4 flex gap-2">${'<div class="skeleton h-10 w-24 rounded-full"></div>'.repeat(4)}</div>
      <div class="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">${tarjetaFantasma.repeat(6)}</div>
    </div>`;
}

function pantallaError(detalle) {
  return `
    <div class="grid min-h-[100dvh] place-items-center px-6 text-center">
      <div>
        <p class="text-5xl">😕</p>
        <h1 class="mt-4 font-display text-3xl font-bold">No pudimos cargar la carta</h1>
        <p class="texto-suave mt-2 text-sm">${esc(detalle)}</p>
        <button type="button" onclick="location.reload()" class="btn-primario mt-6">Reintentar</button>
      </div>
    </div>`;
}
