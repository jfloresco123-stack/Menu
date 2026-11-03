/**
 * ============================================================
 *  MÓDULO MOZO — Panel de control de mesas en vivo
 * ============================================================
 *  - Pegar el código de WhatsApp → se decodifica y se asigna a su
 *    mesa automáticamente. Si el texto pegado trae el número o nombre
 *    del remitente, se guarda; el mozo puede ponerle un ALIAS.
 *  - Pedidos manuales (lo que el cliente pide de palabra), incluidos
 *    platos FUERA DE CARTA con descripción y precio que escribe el mozo,
 *    o con un toque desde la lista de EXTRAS FRECUENTES del dueño.
 *  - Checklist por plato (Entregado / Pendiente) con conteo por unidad.
 *  - Acciones destructivas (eliminar pedido, liberar mesa, cerrar el
 *    día) escondidas en menús y protegidas con "mantener presionado".
 *  - HISTORIAL en el celular (7 días): todo lo recibido, eliminado o
 *    liberado se puede revisar y RESTAURAR.
 *  - Cobro por pedido o por mesa (efectivo con vuelto, Yape, Plin,
 *    tarjeta, transferencia). Una mesa NO se libera si falta cobrar.
 *  - Menú ⋯ por plato: cambiar precio, cambiar cantidad o quitarlo
 *    (p. ej. el cliente se fue y no se llegó a servir).
 *  - Cierre del día (clave de administrador o dueño): deja todo en cero.
 *  - Reporte de ventas del día (A4 o ticket de 80 mm) para imprimir.
 *  - Cuenta detallada para el cliente: imprimir o enviar por WhatsApp.
 *  - CUENTA POR MESA con varios pedidos: el cliente no edita lo enviado;
 *    cada envío llega como PEDIDO NUEVO o ADICIONAL (N.º 2, 3…) a la misma
 *    cuenta. «📥 Pedidos recibidos» lista lo último que llegó y marca lo
 *    que el mozo aún no vio. Los cambios los hace el mozo (menú ⋯ por plato).
 *  - CÓDIGO DEL DÍA: el panel exige el código que envía el administrador
 *    y solo acepta pedidos FIRMADOS con ese código (ver jornada.js).
 *  - DELIVERY: el mozo envía al cliente un enlace por WhatsApp; su pedido
 *    llega con el código [#D987654321-…] y se guarda en la "mesa"
 *    "D987654321" (su celular), con dirección, referencia y ubicación.
 *
 *  Estructura guardada en "<prefijo>mesas.v1":
 *  { "5" | "D987654321": { pedidos: [ { id, ts, enviado, mozoId, origen, alias, telefono, entrega?, visto?,
 *                        pago?: { metodo, monto, ts, recibido?, vuelto?, referencia? },
 *                        items: [{ k, id, nombre, precio, precioOriginal?, qty, nota, entregados, fueraCarta? }] } ] } }
 */
import { CONFIG, anteTitulo } from '../config.js';
import { store, claveCompleta } from '../store.js';
import { cargarCarta } from '../menu.js';
import {
  decodificarPedido, CodigoError, esDelivery, firmaValida, normalizarCelular, formatoCelular, mapaDesdeUbicacion,
} from '../codec.js';
import { codigoGuardado, olvidarCodigo } from '../jornada.js';
import { urlBase } from '../github.js';
import { protegerConClave, exigirCodigoDelDia } from '../acceso.js';
import { sha256 } from '../hash.js';
import {
  esc, soles, pad2, horaCorta, normalizar, debounce, toast, abrirHoja, menuAcciones, pedirTexto,
  confirmarManteniendo, botonMantener, activarMantener, logotipo, botonTema, bump, imprimirHTML, ICONOS,
} from '../ui.js';

const CLAVE_MESAS = 'mesas.v1';
const CLAVE_PROCESADOS = 'pedidos.procesados';
const CLAVE_HISTORIAL = 'mozo.historial';
const MAX_PROCESADOS = 600;
const HISTORIAL_DIAS = 7;
const HISTORIAL_MAX = 1500;

/** Estados visuales de una mesa. */
const ESTADOS = {
  libre: {
    etiqueta: 'Libre', punto: 'bg-stone-400',
    tarjeta: 'bg-white text-carbon-700 ring-carbon-900/10 dark:bg-carbon-800 dark:text-crema-100/70 dark:ring-white/10',
    barra: 'bg-stone-300',
  },
  esperando: {
    etiqueta: 'Esperando pedido', punto: 'bg-amber-400',
    tarjeta: 'bg-amber-50 text-amber-950 ring-amber-400/70 dark:bg-amber-400/15 dark:text-amber-100 dark:ring-amber-400/50',
    barra: 'bg-amber-400',
  },
  parcial: {
    etiqueta: 'Servido parcial', punto: 'bg-sky-500',
    tarjeta: 'bg-sky-50 text-sky-950 ring-sky-500/60 dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-400/50',
    barra: 'bg-sky-500',
  },
  completo: {
    etiqueta: 'Atendido completo', punto: 'bg-emerald-500',
    tarjeta: 'bg-emerald-50 text-emerald-950 ring-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-400/50',
    barra: 'bg-emerald-500',
  },
};

/** Formas de pago disponibles. */
const METODOS = {
  efectivo: { nombre: 'Efectivo', icono: '💵' },
  yape: { nombre: 'Yape', icono: '💜' },
  plin: { nombre: 'Plin', icono: '💙' },
  tarjeta: { nombre: 'Tarjeta', icono: '💳' },
  transferencia: { nombre: 'Transferencia', icono: '🏦' },
};
const METODO_MIXTO = { nombre: 'Pago dividido', icono: '🔀' };

/** Tipos de evento del historial. */
const EVENTOS = {
  recibido: { icono: '📥', titulo: 'Pedido recibido', restaurable: false },
  manual: { icono: '✍️', titulo: 'Pedido manual', restaurable: false },
  eliminado: { icono: '🗑️', titulo: 'Pedido eliminado', restaurable: true },
  liberada: { icono: '🪑', titulo: 'Mesa liberada', restaurable: true },
  cierre: { icono: '🌙', titulo: 'Cierre del día', restaurable: true },
  restaurado: { icono: '♻️', titulo: 'Restaurado', restaurable: false },
  pago: { icono: '💰', titulo: 'Pago registrado', restaurable: false },
  'pago-anulado': { icono: '↩️', titulo: 'Pago anulado', restaurable: false },
  'item-eliminado': { icono: '🍽️', titulo: 'Plato quitado', restaurable: true },
  ajuste: { icono: '🏷️', titulo: 'Pedido modificado', restaurable: false },
};

/* ---------- Cálculos puros ---------- */
function resumenMesa(mesa) {
  const items = (mesa?.pedidos || []).flatMap((p) => p.items);
  const unidades = items.reduce((s, i) => s + i.qty, 0);
  const entregados = items.reduce((s, i) => s + i.entregados, 0);
  const total = items.reduce((s, i) => s + i.precio * i.qty, 0);
  let estado = 'libre';
  if (unidades) estado = entregados === 0 ? 'esperando' : entregados < unidades ? 'parcial' : 'completo';
  const desde = mesa?.pedidos?.[0]?.ts || null;
  const alias = (mesa?.pedidos || []).map((p) => p.alias).filter(Boolean);
  const porCobrar = (mesa?.pedidos || []).filter((p) => !p.pago).reduce((s, p) => s + totalPedido(p), 0);
  const pedidos = mesa?.pedidos?.length || 0;
  const nuevos = (mesa?.pedidos || []).filter((p) => p.visto === false).length; // llegaron y el mozo aún no abrió la mesa
  return { estado, unidades, entregados, total, desde, alias, porCobrar, pagado: total - porCobrar, pedidos, nuevos };
}

const totalPedido = (p) => p.items.reduce((s, i) => s + i.precio * i.qty, 0);
const unidadesPedido = (p) => p.items.reduce((s, i) => s + i.qty, 0);
const clonar = (o) => structuredClone(o);
const redondear = (n) => Math.round(n * 100) / 100;
const aNumero = (v) => parseFloat(String(v ?? '').replace(',', '.'));

/** Partes de un pago o evento: [{ metodo, monto, recibido?, vuelto?, referencia? }]. */
const partesPago = (x) => x.partes || [{
  metodo: x.metodo, monto: x.total ?? x.monto, recibido: x.recibido, vuelto: x.vuelto, referencia: x.referencia,
}];
const nombreMetodo = (m) => {
  const info = METODOS[m] || (m === 'mixto' ? METODO_MIXTO : null);
  return `${info?.icono || ''} ${info?.nombre || m}`.trim();
};
/** "💵 Efectivo" o, si es dividido, "💵 Efectivo S/ 30.00 + 💜 Yape S/ 52.00". */
const textoPago = (x) => {
  const partes = partesPago(x);
  return partes.map((pt) => `${nombreMetodo(pt.metodo)}${partes.length > 1 ? ` ${soles(pt.monto)}` : ''}`).join(' + ');
};
const vueltoPago = (x) => partesPago(x).reduce((s, pt) => s + (pt.vuelto || 0), 0);
const grupoPago = (pago) => pago.grupo || pago.ts;

/** Yape / Plin configurados por el dueño (con número o QR). */
const billeteras = () => ['yape', 'plin']
  .map((id) => ({ id, ...METODOS[id], ...(CONFIG.pagos?.[id] || {}) }))
  .filter((b) => b.numero || b.qr);
const formatoNumero = formatoCelular;

/* ---------- Mesas del salón (1, 2, 3…) y delivery ("D987654321") ---------- */
/** Clave de mesa desde un texto (atributo data-*, clave de objeto…). */
const claveMesa = (v) => (esDelivery(String(v)) ? String(v) : Number(v));
const celularDe = (n) => formatoCelular(String(n).slice(1));
/** "Mesa 05" o "Delivery 987 654 321". */
const etiquetaMesa = (n) => (esDelivery(n) ? `Delivery ${celularDe(n)}` : `Mesa ${pad2(n)}`);
/** Versión corta para listas: "05" o "🛵 987 654 321". */
const cortoMesa = (n) => (esDelivery(n) ? `🛵 ${celularDe(n)}` : pad2(n));

const urlAbsoluta = (ruta) => new URL(ruta, location.href).href.split('#')[0];

/** Bloque de Yape/Plin (QR + número + titular) para la cuenta y el cobro. */
function htmlBilleteras(lista = billeteras()) {
  if (!lista.length) return '';
  return `
    <div class="rep-pago">
      ${lista.map((b) => `
        <div class="rep-billetera">
          ${b.qr ? `<img src="${esc(b.qr)}" alt="QR de ${b.nombre}">` : ''}
          <p><b>${b.icono} ${b.nombre}</b></p>
          ${b.numero ? `<p class="rep-num">${formatoNumero(b.numero)}</p>` : ''}
          ${b.titular ? `<p class="rep-titular">${esc(b.titular)}</p>` : ''}
        </div>`).join('')}
    </div>`;
}
const hayDeuda = (r) => r.porCobrar > 0.001;
const minutosDesde = (ts) => Math.max(0, Math.round((Date.now() - ts) / 60000));
const textoTiempo = (ts) => {
  const m = minutosDesde(ts);
  return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`;
};
const formatoTelefono = (t) => (t?.length === 11 && t.startsWith(CONFIG.prefijoPais)
  ? `+${t.slice(0, 2)} ${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}`
  : t ? `+${t}` : '');

/**
 * Al copiar mensajes en WhatsApp (sobre todo en WhatsApp Web) el texto
 * empieza con "[hora, fecha] +51 987 654 321: …" o "[…] Juan: …".
 * Se extrae el teléfono o el nombre del remitente.
 */
function remitente(texto) {
  const m = String(texto).match(/^\s*\[[^\]\n]{4,40}\]\s*([^:\n]{2,40}):/m);
  if (!m) return {};
  const etiqueta = m[1].replace(/^~\s*/, '').trim();
  if (/^\+?[\d\s()-]{7,}$/.test(etiqueta)) {
    const digitos = etiqueta.replace(/\D/g, '');
    return { telefono: digitos.length === 9 ? CONFIG.prefijoPais + digitos : digitos };
  }
  return { alias: etiqueta.slice(0, 30) };
}

/* ---------- Historial (solo en este celular) ---------- */
const leerHistorial = () => store.get(CLAVE_HISTORIAL, []) || [];

/** Registra un evento con una copia completa de los pedidos afectados. Devuelve su id. */
function registrar(tipo, entradas, extra = {}) {
  const limite = Date.now() - HISTORIAL_DIAS * 86400000;
  const historial = leerHistorial().filter((e) => e.ts >= limite);
  const id = Math.random().toString(36).slice(2, 10);
  historial.push({ id, tipo, ts: Date.now(), entradas: clonar(entradas), ...extra });
  store.set(CLAVE_HISTORIAL, historial.slice(-HISTORIAL_MAX));
  return id;
}

/** Mantiene el alias al día en los eventos del historial de ese pedido. */
function aliasEnHistorial(pedidoId, alias) {
  const historial = leerHistorial();
  historial.forEach((e) => e.entradas.forEach(({ pedido }) => { if (pedido.id === pedidoId) pedido.alias = alias; }));
  store.set(CLAVE_HISTORIAL, historial);
}

/* =========================================================
 *  RUTA
 * ========================================================= */
export async function vistaMozo(raiz) {
  let carta = null;
  try { carta = await cargarCarta(); } catch { /* el panel funciona aun sin carta: el código trae nombres y precios */ }

  // 1) PIN opcional (Panel del Dueño → Accesos)  2) Código del día (obligatorio)
  const conCodigo = (r) => exigirCodigoDelDia({ raiz: r, titulo: 'Panel del Mozo', alAcceder: (r2) => panelMozo(r2, carta) });
  if (!CONFIG.accesos.mozoHash) return conCodigo(raiz);
  return protegerConClave({
    raiz,
    clave: 'mozo.ok',
    titulo: 'Panel del Mozo',
    texto: 'Ingresa el PIN del panel de mesas.',
    placeholder: 'PIN',
    hashes: [CONFIG.accesos.mozoHash, CONFIG.accesos.duenoHash],
    alAcceder: conCodigo,
  });
}

function panelMozo(raiz, carta) {
  const ac = new AbortController();
  const { signal } = ac;

  let mesas = store.get(CLAVE_MESAS, {}) || {};
  let filtro = 'todas';
  let hojaMesa = null;      // { numero, hoja }
  let hojaHistorial = null; // { refrescar }

  const guardar = () => store.set(CLAVE_MESAS, mesas);
  const nombreMozo = (id) => (carta?.mozos || CONFIG.mozos).find((m) => m.id === id)?.nombre || `Mozo ${id}`;
  const leerProcesados = () => store.get(CLAVE_PROCESADOS, []) || [];
  const guardarProcesados = (lista) => store.set(CLAVE_PROCESADOS, lista.slice(-MAX_PROCESADOS));

  /** Busca un pedido en todas las mesas: { numero, pedido } o null. */
  function buscarPedido(pedidoId) {
    for (const [numero, mesa] of Object.entries(mesas)) {
      const pedido = mesa.pedidos.find((p) => p.id === pedidoId);
      if (pedido) return { numero: claveMesa(numero), pedido };
    }
    return null;
  }

  function agregarAMesa(numero, pedido) {
    mesas[numero] = mesas[numero] || { pedidos: [] };
    mesas[numero].pedidos.push(pedido);
  }

  raiz.innerHTML = `
    <div class="min-h-[100dvh] pb-16">
      <header class="glass-header sticky top-0 z-30 border-b border-carbon-900/5 pt-safe dark:border-white/5">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
          <div class="flex min-w-0 items-center gap-3">
            ${logotipo('compacto')}
            <span class="hidden h-8 w-px bg-carbon-900/10 dark:bg-white/10 sm:block"></span>
            <span class="hidden text-sm font-semibold sm:block">Panel del Mozo</span>
          </div>
          <div class="flex items-center gap-2">
            <span id="reloj" class="texto-suave hidden font-mono text-sm tabular-nums md:block"></span>
            <button type="button" id="ver-historial" class="btn-icono" aria-label="Historial" title="Historial">${ICONOS.historial()}</button>
            ${botonTema()}
            <button type="button" id="menu-panel" class="btn-icono" aria-label="Más opciones" title="Más opciones">${ICONOS.puntos()}</button>
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-6xl px-4 pt-5">
        <!-- Procesador de códigos -->
        <section class="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-arcilla-500 via-arcilla-600 to-arcilla-800 p-5 text-white shadow-xl shadow-arcilla-700/25 sm:p-6">
          <div class="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-oro-300/20 blur-2xl"></div>
          <label for="codigo" class="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-white/80">
            ${ICONOS.whatsapp('h-4 w-4')} Pegar Código de WhatsApp
          </label>
          <div class="relative mt-3 flex gap-2">
            <textarea id="codigo" rows="1" spellcheck="false" autocomplete="off"
              placeholder="[#MESA05-A7B9X2:…]  o el mensaje completo"
              class="min-h-[56px] flex-1 resize-none rounded-2xl bg-white/15 px-4 py-4 font-mono text-sm text-white outline-none ring-2 ring-white/20 transition placeholder:text-white/55 focus:bg-white/20 focus:ring-white/70"></textarea>
            <button type="button" id="pegar" class="flex min-h-[56px] shrink-0 items-center gap-2 rounded-2xl bg-white px-4 font-bold text-arcilla-700 shadow-lg transition active:scale-95">
              ${ICONOS.pegar()}<span class="hidden min-[420px]:inline">Pegar</span>
            </button>
          </div>
          <div id="estado-codigo" class="relative mt-3 min-h-[1.25rem] text-sm text-white/85">
            Copia el mensaje del cliente en WhatsApp y pégalo aquí: el pedido se asigna solo a su mesa.
          </div>
        </section>

        <section id="recibidos" class="mt-5"></section>
        <div id="resumen" class="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4"></div>
        <section id="delivery" class="mt-5"></section>
        <h2 class="mt-7 font-display text-2xl font-bold">🪑 Salón</h2>
        <div id="grid" class="mt-4 grid grid-cols-3 gap-3 min-[480px]:grid-cols-4 md:grid-cols-5 lg:gap-4"></div>
      </main>
    </div>`;

  const campo = raiz.querySelector('#codigo');
  const estadoCodigo = raiz.querySelector('#estado-codigo');

  pintarResumen();
  pintarGrid();
  actualizarReloj();
  const intervalo = setInterval(() => { actualizarReloj(); pintarGrid(); }, 30000);

  /* =========================================================
   *  PROCESAR CÓDIGO PEGADO
   * ========================================================= */
  async function procesar(texto, { silencioso = false } = {}) {
    if (!texto.trim()) return;
    try {
      const pedido = await decodificarPedido(texto);
      await exigirFirma(pedido);
      const yaEsta = buscarPedido(pedido.id);
      if (yaEsta || leerProcesados().includes(pedido.id)) {
        mostrarEstado(`⚠️ El pedido ${pedido.id} ya fue registrado${yaEsta ? ` en ${etiquetaMesa(yaEsta.numero)}` : ''}. Si lo borraste por error, recupéralo desde el Historial.`);
        toast('Este pedido ya estaba registrado', 'aviso');
        campo.value = '';
        return;
      }
      const delivery = esDelivery(pedido.mesa);
      if (!delivery && (pedido.mesa < 1 || pedido.mesa > CONFIG.totalMesas)) throw new CodigoError(`La mesa ${pedido.mesa} no existe en el salón.`);

      const de = remitente(texto);
      // En delivery el celular y el nombre vienen en el propio código
      const alias = ((delivery && pedido.entrega.nombre) || de.alias || '').slice(0, 30);
      const telefono = delivery ? CONFIG.prefijoPais + pedido.entrega.telefono : de.telefono || '';
      const nuevo = {
        id: pedido.id,
        ts: Date.now(),
        enviado: pedido.fecha.getTime(),
        mozoId: pedido.mozoId,
        origen: 'whatsapp',
        alias,
        telefono,
        items: pedido.items.map((it, i) => ({ ...it, k: i, entregados: 0 })),
        visto: false,
        ...(delivery ? { entrega: pedido.entrega } : {}),
      };
      const previos = mesas[pedido.mesa]?.pedidos.length || 0; // > 0 → pedido ADICIONAL a la misma cuenta
      agregarAMesa(pedido.mesa, nuevo);
      guardar();
      guardarProcesados([...leerProcesados(), pedido.id]);
      registrar('recibido', [{ mesa: pedido.mesa, pedido: nuevo }]);

      campo.value = '';
      const unidades = unidadesPedido(nuevo);
      mostrarEstado(`
        <span class="block text-base font-bold">${previos ? `➕ Pedido ADICIONAL N.º ${previos + 1}` : '🆕 Pedido NUEVO'} → ${esc(etiquetaMesa(pedido.mesa))}</span>
        <span class="block">${esc(pedido.id)} · ${unidades} ${unidades === 1 ? 'plato' : 'platos'} · ${soles(pedido.total)}
          ${previos ? ` · Cuenta de la mesa: <b>${soles(resumenMesa(mesas[pedido.mesa]).total)}</b> (${previos + 1} pedidos)` : ''} ·
          <button type="button" data-abrir-pedido="${esc(`${pedido.mesa}|${pedido.id}`)}" class="font-bold underline underline-offset-4">Ver pedido</button></span>
        <span class="mt-2.5 flex items-center gap-2">
          <span class="shrink-0 opacity-80">${ICONOS.usuario('h-4 w-4')}</span>
          <input data-alias-rapido="${esc(pedido.id)}" value="${esc(alias)}" maxlength="30" placeholder="Alias del cliente (opcional)" autocomplete="off"
            class="min-w-0 flex-1 rounded-xl bg-white/15 px-3 py-2 text-white outline-none ring-1 ring-white/25 placeholder:text-white/55 focus:ring-white/70">
          ${telefono ? `<span class="shrink-0 font-mono text-xs opacity-80">${esc(formatoTelefono(telefono))}</span>` : ''}
        </span>`, true);
      toast(previos ? `➕ Pedido adicional N.º ${previos + 1} · ${etiquetaMesa(pedido.mesa)}` : `🆕 Pedido nuevo · ${etiquetaMesa(pedido.mesa)}`, 'ok');
      if (filtro !== 'todas' && filtro !== 'esperando') filtro = 'todas';
      refrescarTodo(pedido.mesa);
    } catch (err) {
      if (silencioso) return;
      mostrarEstado(`❌ ${esc(err instanceof CodigoError ? err.message : 'No se pudo leer el código.')}`, true);
      if (!(err instanceof CodigoError)) console.error(err);
    }
  }

  /**
   * Solo entran pedidos firmados con el código del día vigente. Si la firma
   * no cuadra, se relee la configuración: el administrador pudo cambiar el
   * código, y entonces este panel debe volver a pedirlo.
   */
  async function exigirFirma(pedido) {
    if (await firmaValida(pedido, codigoGuardado())) return;
    if (!pedido.firma) {
      throw new CodigoError('Este pedido no trae el código del día: no se registró. Pide al cliente que ingrese el código en la carta y vuelva a enviarlo.');
    }
    try { await cargarCarta(true); } catch { /* sin conexión */ }
    if (!codigoGuardado()) {
      olvidarCodigo();
      toast('El código del día cambió o venció. Ingresa el nuevo.', 'aviso', 5000);
      setTimeout(() => location.reload(), 1500);
      throw new CodigoError('El código del día cambió. Vuelve a entrar con el código nuevo.');
    }
    throw new CodigoError('El pedido se hizo con un código que no es el de hoy (enlace filtrado o pedido falso). No se registró.');
  }

  function mostrarEstado(contenido, esHtml = false) {
    if (esHtml) estadoCodigo.innerHTML = contenido;
    else estadoCodigo.textContent = contenido;
    bump(estadoCodigo);
  }

  /** Cambia el alias de un pedido (en la mesa y en el historial). */
  function ponerAlias(pedidoId, alias) {
    const encontrado = buscarPedido(pedidoId);
    if (!encontrado) return;
    encontrado.pedido.alias = alias.trim().slice(0, 30);
    guardar();
    aliasEnHistorial(pedidoId, encontrado.pedido.alias);
  }

  // Al pegar se procesa al instante; al escribir, solo cuando el código ya está completo
  campo.addEventListener('paste', () => setTimeout(() => procesar(campo.value), 0), { signal });
  campo.addEventListener('input', (e) => {
    if (e.inputType === 'insertFromPaste') return;
    if (/\]\s*$/.test(campo.value)) procesar(campo.value);
  }, { signal });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); procesar(campo.value); }
  }, { signal });

  estadoCodigo.addEventListener('input', debounce((e) => {
    const input = e.target.closest('[data-alias-rapido]');
    if (!input) return;
    ponerAlias(input.dataset.aliasRapido, input.value);
    refrescarTodo();
  }, 350), { signal });

  raiz.querySelector('#pegar').addEventListener('click', async () => {
    try {
      const texto = await navigator.clipboard.readText();
      campo.value = texto;
      procesar(texto);
    } catch {
      campo.focus();
      mostrarEstado('No hay permiso para leer el portapapeles: mantén presionado el campo y elige «Pegar».');
    }
  }, { signal });

  /* =========================================================
   *  RESUMEN Y CUADRÍCULA
   * ========================================================= */
  /** Deliveries con pedidos, del más antiguo al más nuevo. */
  function deliveries() {
    return Object.keys(mesas)
      .filter((k) => esDelivery(k) && mesas[k]?.pedidos.length)
      .sort((a, b) => mesas[a].pedidos[0].ts - mesas[b].pedidos[0].ts);
  }

  function pintarResumen() {
    const lista = deliveries();
    const cuenta = { todas: CONFIG.totalMesas + lista.length, libre: 0, esperando: 0, parcial: 0, completo: 0 };
    for (let n = 1; n <= CONFIG.totalMesas; n++) cuenta[resumenMesa(mesas[n]).estado] += 1;
    lista.forEach((k) => { cuenta[resumenMesa(mesas[k]).estado] += 1; });
    const opciones = [['todas', 'Todas', 'bg-carbon-900 dark:bg-crema-100'], ...Object.entries(ESTADOS).map(([k, v]) => [k, v.etiqueta, v.punto])];
    raiz.querySelector('#resumen').innerHTML = opciones.map(([id, etiqueta, punto]) => `
      <button type="button" class="chip" data-filtro="${id}" aria-pressed="${filtro === id}">
        <span class="h-2.5 w-2.5 rounded-full ${punto}"></span>${etiqueta}
        <span class="rounded-full bg-carbon-900/10 px-1.5 text-xs tabular-nums dark:bg-white/15">${cuenta[id]}</span>
      </button>`).join('');
  }

  function pintarGrid(resaltar = null) {
    const grid = raiz.querySelector('#grid');
    let html = '';
    for (let n = 1; n <= CONFIG.totalMesas; n++) {
      const r = resumenMesa(mesas[n]);
      if (filtro !== 'todas' && r.estado !== filtro) continue;
      const e = ESTADOS[r.estado];
      const progreso = r.unidades ? (r.entregados / r.unidades) * 100 : 0;
      html += `
        <button type="button" data-mesa="${n}" aria-label="Mesa ${n}: ${e.etiqueta}"
          class="relative flex min-h-[150px] flex-col justify-between overflow-hidden rounded-3xl p-3 text-left ring-1 transition active:scale-95 sm:min-h-[152px] sm:p-4 ${e.tarjeta} ${resaltar === n ? 'mesa-nueva' : ''}">
          <span class="flex items-center justify-between">
            <span class="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">Mesa</span>
            ${r.nuevos ? `<span class="animate-pulse rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-black text-carbon-950">🆕 ${r.nuevos}</span>` : `<span class="h-2.5 w-2.5 rounded-full ${e.punto} ${r.estado === 'esperando' ? 'animate-pulse' : ''}"></span>`}
          </span>
          <span class="font-display text-4xl font-black leading-none tabular-nums sm:text-5xl">${pad2(n)}</span>
          <span class="block min-w-0">
            ${r.alias.length ? `<span class="block truncate text-[11px] font-bold">👤 ${esc(r.alias.join(', '))}</span>` : ''}
            <span class="block text-[11px] font-bold leading-tight sm:text-xs">${e.etiqueta}</span>
            ${r.unidades ? `
              <span class="mt-0.5 block text-[11px] tabular-nums opacity-75">${r.pedidos > 1 ? `${r.pedidos} pedidos · ` : ''}${r.entregados}/${r.unidades} entregados</span>
              <span class="block text-[11px] font-bold tabular-nums">${hayDeuda(r) ? `💰 Debe ${soles(r.porCobrar)}` : '✓ Pagado'}</span>
              <span class="block text-[10px] opacity-60">${textoTiempo(r.desde)}</span>` : ''}
          </span>
          ${r.unidades ? `<span class="absolute inset-x-0 bottom-0 h-1 bg-black/5 dark:bg-white/10"><span class="block h-full ${e.barra} transition-all duration-500" style="width:${progreso}%"></span></span>` : ''}
        </button>`;
    }
    grid.innerHTML = html || '<p class="texto-suave col-span-full py-12 text-center text-sm">No hay mesas en este estado.</p>';
    pintarDelivery(resaltar);
    pintarRecibidos();
  }

  /** Número del pedido dentro de su mesa (1 = primero de la cuenta). Declaradas: se usan en el primer pintado. */
  function numeroEnMesa(numero, pedidoId) { return (mesas[numero]?.pedidos.findIndex((p) => p.id === pedidoId) ?? -1) + 1; }
  function etiquetaNumero(n) { return n > 1 ? `➕ Adicional N.º ${n}` : '🆕 Nuevo'; }

  /**
   * «📥 Pedidos recibidos»: lo último que mandaron los clientes (nuevo o
   * adicional), con lo que el mozo aún no vio resaltado.
   */
  function pintarRecibidos() {
    const cont = raiz.querySelector('#recibidos');
    if (!cont) return;
    const todos = Object.entries(mesas)
      .flatMap(([n, m]) => m.pedidos.filter((p) => p.origen === 'whatsapp').map((p) => ({ numero: claveMesa(n), p })))
      .sort((a, b) => b.p.ts - a.p.ts);
    if (!todos.length) { cont.innerHTML = ''; return; }
    const sinVer = todos.filter((x) => x.p.visto === false).length;
    cont.innerHTML = `
      <div class="superficie overflow-hidden rounded-3xl">
        <div class="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
          <h2 class="flex items-center gap-2 font-semibold">📥 Pedidos recibidos
            ${sinVer ? `<span class="animate-pulse rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-carbon-950">${sinVer} sin ver</span>` : ''}</h2>
          ${sinVer ? '<button type="button" data-marcar-vistos class="texto-suave text-xs font-semibold underline underline-offset-4">Marcar vistos</button>' : ''}
        </div>
        <ul class="divide-y divide-carbon-900/5 dark:divide-white/5">
          ${todos.slice(0, 6).map(({ numero, p }) => {
            const n = numeroEnMesa(numero, p.id);
            const nuevo = p.visto === false;
            return `
              <li>
                <button type="button" data-abrir-pedido="${esc(`${numero}|${p.id}`)}" class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-carbon-900/[.03] dark:hover:bg-white/[.03] ${nuevo ? 'bg-amber-400/10' : ''}">
                  <span class="w-[4.5rem] shrink-0 whitespace-nowrap font-mono text-xs tabular-nums ${nuevo ? 'font-bold' : 'texto-suave'}">${horaCorta(p.ts)}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-bold">${esc(etiquetaMesa(numero))} <span class="font-semibold ${n > 1 ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}">· ${etiquetaNumero(n)}</span></span>
                    <span class="texto-suave block truncate text-xs">${unidadesPedido(p)} ${unidadesPedido(p) === 1 ? 'plato' : 'platos'} · ${soles(totalPedido(p))}${p.alias ? ` · 👤 ${esc(p.alias)}` : ''} · ${textoTiempo(p.ts)}</span>
                  </span>
                  ${nuevo ? '<span class="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-carbon-950">Nuevo</span>' : '<span class="texto-suave shrink-0">›</span>'}
                </button>
              </li>`;
          }).join('')}
        </ul>
        ${todos.length > 6 ? `<p class="texto-suave px-4 pb-3 pt-1 text-xs">… y ${todos.length - 6} más en las mesas.</p>` : ''}
      </div>`;
  }

  /** Tarjetas de los pedidos delivery (encima de las mesas). */
  function pintarDelivery(resaltar = null) {
    const cont = raiz.querySelector('#delivery');
    const lista = deliveries()
      .map((k) => ({ k, r: resumenMesa(mesas[k]) }))
      .filter(({ r }) => filtro === 'todas' || r.estado === filtro);
    cont.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-display text-2xl font-bold">🛵 Delivery ${lista.length ? `<span class="texto-suave font-sans text-sm font-medium">(${lista.length})</span>` : ''}</h2>
        <button type="button" data-nuevo-delivery class="btn-secundario !min-h-[42px] text-sm">${ICONOS.whatsapp('h-4 w-4')} Enviar link</button>
      </div>
      ${lista.length ? `
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          ${lista.map(({ k, r }) => {
            const e = ESTADOS[r.estado];
            const ent = entregaDe(k); // la dirección más reciente (igual que el detalle y la cuenta)
            const progreso = r.unidades ? (r.entregados / r.unidades) * 100 : 0;
            return `
              <button type="button" data-mesa="${k}" aria-label="${esc(etiquetaMesa(k))}: ${e.etiqueta}"
                class="relative flex flex-col gap-1 overflow-hidden rounded-3xl p-4 text-left ring-1 transition active:scale-[.98] ${e.tarjeta} ${resaltar === k ? 'mesa-nueva' : ''}">
                <span class="flex items-center justify-between gap-2">
                  <span class="font-mono text-lg font-bold tabular-nums">🛵 ${celularDe(k)}</span>
                  ${r.nuevos ? `<span class="animate-pulse rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-black text-carbon-950">🆕 ${r.nuevos} nuevo${r.nuevos > 1 ? 's' : ''}</span>` : `<span class="flex items-center gap-1.5 text-[11px] font-bold"><span class="h-2.5 w-2.5 rounded-full ${e.punto} ${r.estado === 'esperando' ? 'animate-pulse' : ''}"></span>${e.etiqueta}</span>`}
                </span>
                ${r.alias.length ? `<span class="truncate text-sm font-bold">👤 ${esc(r.alias.join(', '))}</span>` : ''}
                <span class="line-clamp-2 text-sm">🏠 ${esc(ent.direccion || 'Sin dirección')}${ent.referencia ? ` <span class="opacity-70">· ${esc(ent.referencia)}</span>` : ''}</span>
                <span class="mt-1 flex items-center justify-between text-[11px] font-bold tabular-nums">
                  <span>${r.pedidos > 1 ? `${r.pedidos} pedidos · ` : ''}${r.entregados}/${r.unidades} listos · ${textoTiempo(r.desde)}</span>
                  <span>${hayDeuda(r) ? `💰 ${soles(r.porCobrar)}` : '✓ Pagado'}</span>
                </span>
                <span class="absolute inset-x-0 bottom-0 h-1 bg-black/5 dark:bg-white/10"><span class="block h-full ${e.barra}" style="width:${progreso}%"></span></span>
              </button>`;
          }).join('')}
        </div>` : `<p class="texto-suave mt-2 text-sm">${filtro === 'todas' ? 'Sin pedidos delivery. Envía el link al cliente por WhatsApp y su pedido aparecerá aquí.' : 'Ningún delivery en este estado.'}</p>`}`;
  }

  function actualizarReloj() {
    const reloj = raiz.querySelector('#reloj');
    if (reloj) reloj.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }

  function refrescarTodo(resaltar = null) {
    pintarResumen();
    pintarGrid(resaltar);
    hojaMesa?.hoja.refrescar();
    hojaHistorial?.refrescar();
  }

  /* =========================================================
   *  ACCIONES PROTEGIDAS (con historial y "Deshacer")
   * ========================================================= */
  async function eliminarPedido(numero, pedidoId) {
    const mesa = mesas[numero];
    const pedido = mesa?.pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    if (pedido.pago) { toast('Este pedido ya está pagado: primero anula el pago desde ⋯', 'aviso', 4500); return; }
    const ok = await confirmarManteniendo(
      `Se quitará el pedido ${pedido.alias ? `de ${pedido.alias} ` : ''}(${unidadesPedido(pedido)} platos · ${soles(totalPedido(pedido))}) de ${etiquetaMesa(numero)}. Quedará guardado en el Historial.`,
      { titulo: 'Eliminar pedido', textoBoton: 'Mantén presionado para eliminar' },
    );
    if (!ok) return;
    mesa.pedidos = mesa.pedidos.filter((p) => p.id !== pedidoId);
    if (!mesa.pedidos.length) delete mesas[numero];
    guardar();
    // Se libera el código para poder volver a pegarlo si hiciera falta
    guardarProcesados(leerProcesados().filter((id) => id !== pedidoId));
    const evento = registrar('eliminado', [{ mesa: numero, pedido }]);
    refrescarTodo();
    toast('Pedido eliminado', 'info', 7000, { texto: 'Deshacer', fn: () => restaurarEvento(evento) });
  }

  async function liberarMesa(numero) {
    const mesa = mesas[numero];
    if (!mesa) return;
    const r = resumenMesa(mesa);
    if (hayDeuda(r)) {
      toast(`No se puede liberar: falta cobrar ${soles(r.porCobrar)}`, 'error', 4500);
      cobrar(numero);
      return;
    }
    const pendientes = r.unidades - r.entregados;
    const ok = await confirmarManteniendo(
      `${pendientes ? `⚠️ Hay ${pendientes} plato(s) sin marcar como entregados. ` : ''}${esDelivery(numero) ? `El ${etiquetaMesa(numero)} se cerrará` : `La Mesa ${pad2(numero)} quedará libre`} (cobrado ${soles(r.total)}). Sus pedidos quedarán guardados en el Historial.`,
      { titulo: 'Liberar mesa', textoBoton: 'Mantén presionado para liberar' },
    );
    if (!ok) return;
    const entradas = mesa.pedidos.map((pedido) => ({ mesa: numero, pedido }));
    delete mesas[numero];
    guardar();
    const evento = registrar('liberada', entradas, { total: r.total });
    hojaMesa?.hoja.cerrar();
    refrescarTodo();
    toast(`${etiquetaMesa(numero)} ${esDelivery(numero) ? 'cerrado' : 'liberada'}`, 'ok', 7000, { texto: 'Deshacer', fn: () => restaurarEvento(evento) });
  }

  /** Devuelve a sus mesas los pedidos guardados en un evento del historial. */
  function restaurarEvento(eventoId) {
    const historial = leerHistorial();
    const evento = historial.find((e) => e.id === eventoId);
    if (!evento) return;
    const restaurados = [];
    let omitidos = 0;
    const procesados = leerProcesados();
    for (const { mesa, pedido } of evento.entradas) {
      // Plato quitado: vuelve a su pedido si este sigue en una mesa (y no está pagado)
      const existente = evento.tipo === 'item-eliminado' ? buscarPedido(pedido.id) : null;
      if (existente) {
        if (existente.pedido.pago) { omitidos += 1; continue; }
        pedido.items.forEach((it) => {
          if (!existente.pedido.items.some((x) => x.k === it.k)) existente.pedido.items.push(clonar(it));
        });
        existente.pedido.items.sort((a, b) => a.k - b.k);
        restaurados.push({ mesa: existente.numero, pedido });
        continue;
      }
      if (buscarPedido(pedido.id) || (!esDelivery(mesa) && mesa > CONFIG.totalMesas)) { omitidos += 1; continue; }
      agregarAMesa(mesa, clonar(pedido));
      if (!procesados.includes(pedido.id)) procesados.push(pedido.id);
      restaurados.push({ mesa, pedido });
    }
    guardar();
    guardarProcesados(procesados);
    evento.restaurado = Date.now();
    store.set(CLAVE_HISTORIAL, historial);
    if (restaurados.length) registrar('restaurado', restaurados, { desde: evento.tipo });
    refrescarTodo();
    if (restaurados.length) toast(`♻️ ${restaurados.length} pedido(s) restaurado(s)${omitidos ? ` · ${omitidos} ya estaban` : ''}`, 'ok');
    else toast('Esos pedidos ya están en sus mesas', 'aviso');
  }

  /* =========================================================
   *  DELIVERY
   * ========================================================= */
  /** Datos de entrega del delivery (los del pedido más reciente que los tenga). */
  function entregaDe(numero) {
    return [...(mesas[numero]?.pedidos || [])].reverse().map((p) => p.entrega).find(Boolean)
      || { telefono: String(numero).slice(1), nombre: '', direccion: '', referencia: '', ubicacion: '' };
  }

  function htmlEntrega(numero) {
    const e = entregaDe(numero);
    const tel = CONFIG.prefijoPais + e.telefono;
    const mapa = mapaDesdeUbicacion(e.ubicacion)
      || (e.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.direccion, CONFIG.ubicacion].filter(Boolean).join(', '))}` : '');
    return `
      <section class="rounded-3xl bg-oro-400/10 p-4 ring-1 ring-oro-500/30">
        <p class="text-xs font-bold uppercase tracking-[0.2em] text-arcilla-600 dark:text-oro-300">🛵 Datos de entrega</p>
        ${e.nombre ? `<p class="mt-2 font-semibold">👤 ${esc(e.nombre)}</p>` : ''}
        <p class="mt-1 font-semibold">🏠 ${esc(e.direccion || 'Sin dirección')}</p>
        ${e.referencia ? `<p class="texto-suave text-sm">🧭 ${esc(e.referencia)}</p>` : ''}
        <p class="mt-1 font-mono text-sm">📱 ${esc(formatoNumero(e.telefono))}</p>
        <div class="mt-3 grid grid-cols-3 gap-2">
          <a href="tel:+${tel}" class="btn-secundario !min-h-[42px] !px-2 text-sm">📞 Llamar</a>
          <a href="https://wa.me/${tel}" target="_blank" rel="noopener" class="btn-secundario !min-h-[42px] !px-2 text-sm">${ICONOS.whatsapp('h-4 w-4')} Chat</a>
          ${mapa ? `<a href="${esc(mapa)}" target="_blank" rel="noopener" class="btn-secundario !min-h-[42px] !px-2 text-sm">🗺️ ${e.ubicacion ? 'Ubicación' : 'Mapa'}</a>` : '<span></span>'}
        </div>
      </section>`;
  }

  /**
   * Hoja para invitar a un cliente a pedir por delivery: se escribe su
   * celular y se abre WhatsApp con el enlace a la carta listo para enviar.
   */
  function enviarLinkDelivery() {
    const lista = carta?.mozos || CONFIG.mozos;
    let telefono = '';
    let nombre = '';
    let mozoId = lista.some((m) => m.id === store.get('delivery.mozo')) ? store.get('delivery.mozo') : lista[0]?.id;

    const digitos = () => normalizarCelular(telefono) || telefono.replace(/\D/g, '');
    const valido = () => !!normalizarCelular(telefono);
    const codigoDia = codigoGuardado();
    const enlaceCarta = () => `${urlBase()}?delivery=${digitos()}&m=${mozoId}`;
    const mensaje = () => [
      `🛵 ¡Hola${nombre.trim() ? ` ${nombre.trim()}` : ''}! Haz tu pedido de *${CONFIG.nombreCompleto}* desde aquí:`,
      '',
      enlaceCarta(),
      '',
      ...(codigoDia ? [`🔑 Tu código para pedir hoy: *${codigoDia.slice(0, 3)} ${codigoDia.slice(3)}*`, ''] : []),
      'Elige tus platos, escribe tu dirección e ingresa el código. Luego envíanos el pedido por WhatsApp. ¡Te lo llevamos! 🍽️',
    ].join('\n');
    const enlaceWsp = () => `https://wa.me/${CONFIG.prefijoPais}${digitos()}?text=${encodeURIComponent(mensaje())}`;

    const hoja = abrirHoja({
      titulo: '🛵 Nuevo delivery',
      subtitulo: 'Envía al cliente el enlace de la carta por WhatsApp',
      ancho: 'md:max-w-md',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <div class="space-y-4 p-5">
            <label class="block"><span class="text-sm font-semibold">Celular del cliente *</span>
              <div class="mt-1 flex gap-2">
                <span class="campo !w-auto shrink-0 !px-3 font-mono texto-suave">+${CONFIG.prefijoPais}</span>
                <input id="del-tel" value="${esc(telefono)}" inputmode="tel" maxlength="15" placeholder="987 654 321" autocomplete="off" class="campo font-mono text-lg">
              </div>
              <span data-aviso-tel class="mt-1 block text-xs font-semibold text-red-600 dark:text-red-400 ${!telefono || valido() ? 'hidden' : ''}">Debe ser un celular de 9 dígitos que empiece con 9</span>
            </label>
            <label class="block"><span class="text-sm font-semibold">Nombre del cliente <span class="texto-suave font-normal">(opcional, para el saludo)</span></span>
              <input id="del-nombre" value="${esc(nombre)}" maxlength="30" placeholder="Ej. Sra. Rosa" autocomplete="off" class="campo mt-1"></label>
            <div>
              <p class="text-sm font-semibold">El pedido llegará al WhatsApp de</p>
              <div class="mt-2 grid grid-cols-2 gap-2">
                ${lista.map((m) => `<button type="button" class="chip justify-center" data-del-mozo="${m.id}" aria-pressed="${m.id === mozoId}">${esc(m.nombre)}</button>`).join('')}
              </div>
            </div>
            <p class="texto-suave break-all rounded-2xl bg-carbon-900/5 p-3 font-mono text-xs dark:bg-white/10" data-vista-link>${valido() ? esc(enlaceCarta()) : 'El enlace aparecerá aquí'}</p>
          </div>`;
        pie.innerHTML = `
          <div class="flex gap-2.5 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
            <button type="button" data-copiar-link class="btn-secundario shrink-0 !px-4" ${valido() ? '' : 'disabled'}>Copiar</button>
            <a data-enviar-link href="${valido() ? esc(enlaceWsp()) : '#'}" target="_blank" rel="noopener" aria-disabled="${!valido()}"
              class="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 font-bold text-white shadow-lg shadow-[#25D366]/30 transition active:scale-[.98] aria-disabled:pointer-events-none aria-disabled:opacity-50">
              ${ICONOS.whatsapp('h-5 w-5')} Enviar por WhatsApp
            </a>
          </div>`;
      },
    });

    /** Actualiza enlace y botones sin repintar (no se pierde el foco al escribir). */
    const actualizar = () => {
      const ok = valido();
      hoja.el.querySelector('[data-aviso-tel]').classList.toggle('hidden', !telefono || ok || digitos().length < 9);
      hoja.el.querySelector('[data-vista-link]').textContent = ok ? enlaceCarta() : 'El enlace aparecerá aquí';
      hoja.el.querySelector('[data-copiar-link]').disabled = !ok;
      const a = hoja.el.querySelector('[data-enviar-link]');
      a.href = ok ? enlaceWsp() : '#';
      a.setAttribute('aria-disabled', String(!ok));
    };
    hoja.el.addEventListener('input', (e) => {
      if (e.target.id === 'del-tel') telefono = e.target.value;
      else if (e.target.id === 'del-nombre') nombre = e.target.value;
      else return;
      actualizar();
    });
    hoja.el.addEventListener('click', async (e) => {
      const bMozo = e.target.closest('[data-del-mozo]');
      if (bMozo) {
        mozoId = +bMozo.dataset.delMozo;
        store.set('delivery.mozo', mozoId);
        hoja.el.querySelectorAll('[data-del-mozo]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.delMozo === mozoId)));
        actualizar();
        return;
      }
      if (e.target.closest('[data-copiar-link]') && valido()) {
        try {
          await navigator.clipboard.writeText(mensaje());
          toast('Mensaje con el enlace copiado', 'ok', 1800);
        } catch {
          toast(enlaceCarta(), 'info', 8000);
        }
        return;
      }
      if (e.target.closest('[data-enviar-link]') && valido()) {
        toast(`Enlace enviado a ${formatoNumero(digitos())} · su pedido aparecerá en 🛵 Delivery`, 'ok', 4000);
        setTimeout(() => hoja.cerrar(), 400);
      }
    });
    setTimeout(() => hoja.el.querySelector('#del-tel')?.focus(), 350);
  }

  /* =========================================================
   *  DETALLE DE MESA (checklist)
   * ========================================================= */
  function abrirMesa(numero, enfocarId = null) {
    let hoja = null; // render se ejecuta antes de que abrirHoja devuelva la referencia
    // Pedidos que llegaron sin verse: se resaltan mientras la hoja esté abierta
    const nuevos = new Set();
    const primeroNuevo = mesas[numero]?.pedidos.find((p) => p.visto === false)?.id;
    hoja = abrirHoja({
      titulo: etiquetaMesa(numero),
      subtitulo: ' ',
      ancho: 'md:max-w-2xl',
      render: (cuerpo, pie) => pintarMesa(numero, hoja?.el, cuerpo, pie, nuevos),
      alCerrar: () => { hojaMesa = null; },
    });
    hojaMesa = { numero, hoja };
    hoja.refrescar();
    const objetivo = enfocarId || primeroNuevo;
    if (objetivo) {
      setTimeout(() => hoja.el.querySelector(`[data-pedido-seccion="${CSS.escape(objetivo)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 380);
    }

    hoja.el.addEventListener('click', async (e) => {
      const mesa = mesas[numero];
      const fila = e.target.closest('[data-item]');
      if (fila && mesa && e.target.closest('[data-opciones-item]')) {
        const [pid, k] = fila.dataset.item.split('|');
        opcionesItem(numero, pid, k);
        return;
      }
      if (fila && mesa) {
        const [pid, k] = fila.dataset.item.split('|');
        const item = mesa.pedidos.find((p) => p.id === pid)?.items.find((i) => String(i.k) === k);
        if (!item) return;
        if (e.target.closest('[data-mas]')) item.entregados = Math.min(item.qty, item.entregados + 1);
        else if (e.target.closest('[data-menos]')) item.entregados = Math.max(0, item.entregados - 1);
        else if (e.target.closest('[data-toggle]')) item.entregados = item.entregados >= item.qty ? 0 : item.qty;
        else return;
        guardar();
        refrescarTodo();
        return;
      }

      if (e.target.closest('[data-todo-entregado]') && mesa) {
        mesa.pedidos.forEach((p) => p.items.forEach((i) => { i.entregados = i.qty; }));
        guardar();
        refrescarTodo();
        toast(`${etiquetaMesa(numero)} ${esDelivery(numero) ? 'listo para enviar' : 'atendida completa'}`, 'ok');
        return;
      }

      if (e.target.closest('[data-agregar-pedido]')) { pedidoManual(numero); return; }
      if (e.target.closest('[data-cobrar]')) { cobrar(numero); return; }
      if (e.target.closest('[data-cuenta]')) { abrirCuenta(numero); return; }
      const pagarPedido = e.target.closest('[data-pagar-pedido]');
      if (pagarPedido) { cobrar(numero, pagarPedido.dataset.pagarPedido); return; }

      const opcionesPedido = e.target.closest('[data-opciones-pedido]');
      if (opcionesPedido) {
        const pedido = mesa?.pedidos.find((p) => p.id === opcionesPedido.dataset.opcionesPedido);
        if (!pedido) return;
        const opcion = await menuAcciones({
          titulo: pedido.alias || 'Pedido',
          subtitulo: `${pedido.id} · ${horaCorta(pedido.ts)}`,
          acciones: [
            { id: 'cuenta', texto: 'Cuenta de este pedido (imprimir / WhatsApp)', icono: '🧾' },
            { id: 'alias', texto: pedido.alias ? 'Cambiar alias' : 'Poner alias al cliente', icono: ICONOS.usuario() },
            ...(pedido.telefono ? [{ id: 'whatsapp', texto: `Escribir a ${formatoTelefono(pedido.telefono)}`, icono: ICONOS.whatsapp('h-5 w-5') }] : []),
            pedido.pago
              ? { id: 'anular-pago', texto: `Anular pago (${textoPago(pedido.pago)})`, icono: '↩️', peligro: true }
              : { id: 'pagar', texto: `Pagar este pedido · ${soles(totalPedido(pedido))}`, icono: '💰' },
            ...(pedido.pago ? [] : [{ id: 'eliminar', texto: 'Eliminar este pedido', icono: ICONOS.basura(), peligro: true }]),
          ],
        });
        if (opcion === 'cuenta') {
          abrirCuenta(numero, pedido.id);
        } else if (opcion === 'alias') {
          const alias = await pedirTexto({ titulo: 'Alias del cliente', etiqueta: 'Nombre o referencia para reconocerlo', valor: pedido.alias, placeholder: 'Ej. Sr. Pérez, camisa roja…' });
          if (alias !== null) { ponerAlias(pedido.id, alias); refrescarTodo(); }
        } else if (opcion === 'whatsapp') {
          window.open(`https://wa.me/${pedido.telefono}`, '_blank', 'noopener');
        } else if (opcion === 'eliminar') {
          eliminarPedido(numero, pedido.id);
        } else if (opcion === 'pagar') {
          cobrar(numero, pedido.id);
        } else if (opcion === 'anular-pago') {
          anularPago(numero, pedido.id);
        }
        return;
      }

      if (e.target.closest('[data-opciones-mesa]')) {
        const opcion = await menuAcciones({
          titulo: etiquetaMesa(numero),
          acciones: [
            { id: 'fuera-carta', texto: 'Agregar plato fuera de carta', icono: '✍️' },
            ...(mesa ? [{ id: 'cuenta', texto: 'Cuenta (imprimir / WhatsApp)', icono: '🧾' }] : []),
            { id: 'historial', texto: esDelivery(numero) ? 'Ver historial de este delivery' : 'Ver historial de esta mesa', icono: ICONOS.historial() },
            ...(mesa ? [{
              id: 'liberar',
              texto: `${esDelivery(numero) ? 'Cerrar delivery (entregado)' : 'Liberar mesa'}${hayDeuda(resumenMesa(mesa)) ? ` (falta cobrar ${soles(resumenMesa(mesa).porCobrar)})` : ''}`,
              icono: ICONOS.salir(),
              peligro: true,
            }] : []),
          ],
        });
        if (opcion === 'fuera-carta') pedidoManual(numero, { soloFueraDeCarta: true });
        if (opcion === 'cuenta') abrirCuenta(numero);
        if (opcion === 'historial') abrirHistorial(numero);
        if (opcion === 'liberar') liberarMesa(numero);
      }
    });
  }

  function pintarMesa(numero, el, cuerpo, pie, nuevos = new Set()) {
    const mesa = mesas[numero];
    // Al mostrarse, lo nuevo pasa a "visto" (pero sigue resaltado en esta hoja)
    let vistos = false;
    mesa?.pedidos.forEach((p) => { if (p.visto === false) { p.visto = true; nuevos.add(p.id); vistos = true; } });
    if (vistos) { guardar(); pintarResumen(); pintarGrid(); }
    const r = resumenMesa(mesa);
    const e = ESTADOS[r.estado];
    const sub = el?.querySelector('header p');
    if (sub) sub.innerHTML = `<span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full ${e.punto}"></span>${e.etiqueta}${r.unidades ? ` · ${r.entregados}/${r.unidades} entregados` : ''}</span>`;

    cuerpo.innerHTML = !mesa?.pedidos.length ? `
      <div class="px-6 py-12 text-center">
        <p class="text-5xl">${esDelivery(numero) ? '🛵' : '🪑'}</p>
        <h3 class="mt-4 font-display text-2xl font-bold">${esDelivery(numero) ? 'Delivery cerrado' : 'Mesa libre'}</h3>
        <p class="texto-suave mx-auto mt-2 max-w-xs text-sm">Pega un código de WhatsApp o agrega un pedido manual.</p>
      </div>` : `
      <div class="space-y-4 p-4 sm:p-5">
        ${esDelivery(numero) ? htmlEntrega(numero) : ''}
        <div class="flex items-center justify-between gap-3 rounded-2xl bg-carbon-900/5 px-4 py-3 dark:bg-white/10">
          <span class="text-sm"><b>🧾 Cuenta de ${esc(esDelivery(numero) ? 'este delivery' : 'la mesa')}</b> · ${r.pedidos} ${r.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
          <span class="font-display text-xl font-bold tabular-nums">${soles(r.total)}</span>
        </div>
        ${mesa.pedidos.map((p, i) => `
          <section data-pedido-seccion="${esc(p.id)}" class="superficie scroll-mt-24 overflow-hidden rounded-3xl ${nuevos.has(p.id) ? 'ring-2 ring-amber-400' : ''}">
            <div class="flex items-center gap-3 bg-carbon-900/[.03] px-4 py-2.5 dark:bg-white/[.03]">
              <div class="min-w-0 flex-1">
                <p class="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span class="rounded-full bg-carbon-900 px-2 py-0.5 text-white dark:bg-crema-100 dark:text-carbon-950">Pedido N.º ${i + 1}</span>
                  ${p.origen === 'whatsapp' ? `<span class="rounded-full px-2 py-0.5 ${i ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'}">${i ? '➕ Adicional' : '🆕 Primer pedido'}</span>` : ''}
                  ${nuevos.has(p.id) ? '<span class="animate-pulse rounded-full bg-amber-400 px-2 py-0.5 uppercase tracking-wider text-carbon-950">Nuevo</span>' : ''}
                  <span class="texto-suave font-medium">${textoTiempo(p.ts)}</span>
                </p>
                <p class="truncate font-semibold">
                  ${p.alias ? `👤 ${esc(p.alias)}` : '<span class="texto-suave font-normal">Sin alias</span>'}
                  ${p.origen === 'manual' ? '<span class="ml-1 rounded-full bg-oro-400/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Manual</span>' : ''}
                  ${p.pago ? '<span class="ml-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Pagado</span>' : ''}
                </p>
                <p class="texto-suave truncate text-xs">
                  <span class="font-mono">${esc(p.id)}</span> · ${horaCorta(p.ts)}${p.mozoId != null ? ` · ${esc(nombreMozo(p.mozoId))}` : ''}${p.telefono ? ` · ${esc(formatoTelefono(p.telefono))}` : ''}
                </p>
              </div>
              <button type="button" data-opciones-pedido="${esc(p.id)}" class="btn-icono !h-10 !w-10" aria-label="Opciones del pedido">${ICONOS.puntos()}</button>
            </div>
            <ul class="divide-y divide-carbon-900/5 dark:divide-white/5">
              ${p.items.map((it) => filaItem(p.id, it)).join('')}
            </ul>
            <div class="flex items-center justify-between gap-3 border-t border-carbon-900/5 px-4 py-2.5 dark:border-white/5">
              <span class="texto-suave shrink-0 whitespace-nowrap text-sm">Total <b class="tabular-nums text-carbon-900 dark:text-crema-50">${soles(totalPedido(p))}</b></span>
              ${p.pago ? `
                <span class="min-w-0 text-right text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓ ${esc(textoPago(p.pago))} · ${horaCorta(p.pago.ts)}${partesPago(p.pago).filter((pt) => pt.referencia).map((pt) => ` · Op. ${esc(pt.referencia)}`).join('')}</span>`
              : `<button type="button" data-pagar-pedido="${esc(p.id)}" class="btn-secundario !min-h-[40px] shrink-0 !px-4 text-sm">💰 Pagar</button>`}
            </div>
          </section>`).join('')}
      </div>`;

    pie.innerHTML = `
      <div class="space-y-3 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
        ${r.unidades ? `
          <div class="flex items-center gap-3">
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-carbon-900/10 dark:bg-white/10">
              <div class="h-full rounded-full ${e.barra} transition-all duration-500" style="width:${(r.entregados / r.unidades) * 100}%"></div>
            </div>
            <span class="font-display text-2xl font-bold tabular-nums">${soles(r.total)}</span>
          </div>
          <p class="texto-suave -mt-1 text-xs">Pagado ${soles(r.pagado)} · Por cobrar <b class="${hayDeuda(r) ? 'text-arcilla-600 dark:text-oro-300' : ''}">${soles(r.porCobrar)}</b></p>` : ''}
        <div class="flex gap-2.5">
          <button type="button" data-opciones-mesa class="btn-secundario shrink-0 !px-3.5" aria-label="Más opciones de la mesa">${ICONOS.puntos()}</button>
          <button type="button" data-agregar-pedido class="btn-secundario flex-1 whitespace-nowrap !px-3 text-sm sm:text-base">${ICONOS.mas('h-4 w-4')} Pedido</button>
          ${r.unidades ? `<button type="button" data-todo-entregado class="btn-secundario flex-1 whitespace-nowrap !px-3 !text-emerald-700 text-sm dark:!text-emerald-300 sm:text-base" ${r.estado === 'completo' ? 'disabled' : ''}>${ICONOS.check()} Todo entregado</button>` : ''}
        </div>
        ${hayDeuda(r)
          ? `<div class="flex gap-2.5">
              <button type="button" data-cuenta class="btn-secundario shrink-0 !px-4">🧾 Cuenta</button>
              <button type="button" data-cobrar class="btn-primario flex-1 whitespace-nowrap text-base">💰 Cobrar ${soles(r.porCobrar)}</button>
            </div>`
          : r.unidades ? `<p class="rounded-2xl bg-emerald-500/10 p-3 text-center text-sm font-semibold text-emerald-700 dark:text-emerald-300">${esDelivery(numero) ? '✓ Delivery pagado · ciérralo desde ⋯ al entregarlo' : '✓ Mesa pagada · puedes liberarla desde ⋯'}</p>` : ''}
      </div>`;
  }

  function filaItem(pedidoId, it) {
    const completo = it.entregados >= it.qty;
    const parcial = it.entregados > 0 && !completo;
    return `
      <li class="flex items-center gap-3 px-4 py-3.5" data-item="${esc(pedidoId)}|${it.k}">
        <button type="button" data-toggle aria-pressed="${completo}" aria-label="${completo ? 'Marcar pendiente' : 'Marcar entregado'}"
          class="grid h-11 w-11 shrink-0 place-items-center rounded-full ring-2 transition active:scale-90 ${completo ? 'bg-emerald-500 text-white ring-emerald-500' : parcial ? 'bg-sky-500/15 text-sky-600 ring-sky-500 dark:text-sky-300' : 'text-transparent ring-carbon-900/20 dark:ring-white/25'}">
          ${ICONOS.check('h-5 w-5')}
        </button>
        <div class="min-w-0 flex-1">
          <p class="font-semibold leading-snug ${completo ? 'line-through opacity-50' : ''}"><span class="tabular-nums">${it.qty}×</span> ${esc(it.nombre)}</p>
          ${it.fueraCarta ? '<span class="mt-0.5 inline-block rounded-full bg-oro-400/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Fuera de carta</span>' : ''}
          ${it.nota ? `<p class="mt-0.5 rounded-lg bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">📝 ${esc(it.nota)}</p>` : ''}
          <p class="mt-0.5 text-xs ${completo ? 'text-emerald-600 dark:text-emerald-400' : 'texto-suave'}">
            ${completo ? 'Entregado' : parcial ? `Entregados ${it.entregados} de ${it.qty}` : 'Pendiente'} · ${soles(it.precio * it.qty)}${it.precioOriginal != null && it.precioOriginal !== it.precio ? ` <s class="opacity-60">${soles(it.precioOriginal * it.qty)}</s>` : ''}
          </p>
        </div>
        ${it.qty > 1 ? `
          <div class="flex shrink-0 flex-col items-center gap-1 sm:flex-row">
            <button type="button" data-menos class="grid h-8 w-8 place-items-center rounded-full bg-carbon-900/5 active:scale-90 dark:bg-white/10" aria-label="Uno menos entregado">${ICONOS.menos('h-4 w-4')}</button>
            <button type="button" data-mas class="grid h-8 w-8 place-items-center rounded-full bg-carbon-900/5 active:scale-90 dark:bg-white/10" aria-label="Uno más entregado">${ICONOS.mas('h-4 w-4')}</button>
          </div>` : ''}
        <button type="button" data-opciones-item class="texto-suave grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-carbon-900/5 active:scale-90 dark:hover:bg-white/10" aria-label="Opciones de ${esc(it.nombre)}">${ICONOS.puntos()}</button>
      </li>`;
  }

  /* =========================================================
   *  OPCIONES DE UN PLATO: precio, cantidad o quitarlo
   * ========================================================= */
  async function opcionesItem(numero, pedidoId, k) {
    const pedido = mesas[numero]?.pedidos.find((p) => p.id === pedidoId);
    const item = pedido?.items.find((i) => String(i.k) === String(k));
    if (!item) return;
    if (pedido.pago) {
      toast('Este pedido ya está pagado. Anula el pago (⋯ del pedido) para modificarlo.', 'aviso', 4500);
      return;
    }
    const opcion = await menuAcciones({
      titulo: item.nombre,
      subtitulo: `${item.qty} × ${soles(item.precio)}${item.nota ? ` · 📝 ${item.nota}` : ''}`,
      acciones: [
        { id: 'precio', texto: 'Cambiar precio', icono: '🏷️' },
        { id: 'cantidad', texto: 'Cambiar cantidad', icono: '🔢' },
        { id: 'quitar', texto: 'Quitar este plato (no se sirvió)', icono: ICONOS.basura(), peligro: true },
      ],
    });

    if (opcion === 'precio') {
      const valor = await pedirTexto({
        titulo: 'Nuevo precio unitario',
        etiqueta: `${item.nombre} · precio actual ${soles(item.precio)}`,
        valor: String(item.precio),
        numerico: true,
        maxlength: 8,
      });
      if (valor === null) return;
      const precio = redondear(parseFloat(valor.replace(',', '.')));
      if (!Number.isFinite(precio) || precio < 0) { toast('Precio no válido', 'error'); return; }
      if (precio === item.precio) return;
      const antes = item.precio;
      if (item.precioOriginal == null) item.precioOriginal = antes;
      item.precio = precio;
      guardar();
      registrar('ajuste', [{ mesa: numero, pedido }], { detalle: `${item.nombre}: ${soles(antes)} → ${soles(precio)} c/u` });
      refrescarTodo();
      toast(`Precio actualizado: ${soles(precio)}`, 'ok');
    }

    if (opcion === 'cantidad') {
      const valor = await pedirTexto({ titulo: 'Cambiar cantidad', etiqueta: `${item.nombre} · ahora ${item.qty}`, valor: String(item.qty), numerico: true, maxlength: 3 });
      if (valor === null) return;
      const qty = parseInt(valor, 10);
      if (!(qty >= 1 && qty <= 99)) { toast('Escribe una cantidad entre 1 y 99 (para quitarlo usa «Quitar»)', 'error', 4000); return; }
      if (qty === item.qty) return;
      const antes = item.qty;
      item.qty = qty;
      item.entregados = Math.min(item.entregados, qty);
      guardar();
      registrar('ajuste', [{ mesa: numero, pedido }], { detalle: `${item.nombre}: cantidad ${antes} → ${qty}` });
      refrescarTodo();
    }

    if (opcion === 'quitar') {
      const ok = await confirmarManteniendo(
        `Se quitará ${item.qty}× ${item.nombre} (${soles(item.precio * item.qty)}) del pedido. Quedará guardado en el Historial.`,
        { titulo: 'Quitar plato', textoBoton: 'Mantén presionado para quitar' },
      );
      if (!ok) return;
      const copia = { ...clonar(pedido), items: [clonar(item)] };
      pedido.items = pedido.items.filter((i) => i !== item);
      if (!pedido.items.length) {
        // Sin platos el pedido deja de existir
        mesas[numero].pedidos = mesas[numero].pedidos.filter((p) => p !== pedido);
        if (!mesas[numero].pedidos.length) delete mesas[numero];
      }
      guardar();
      const evento = registrar('item-eliminado', [{ mesa: numero, pedido: copia }]);
      refrescarTodo();
      toast(`${item.nombre} quitado`, 'info', 7000, { texto: 'Deshacer', fn: () => restaurarEvento(evento) });
    }
  }

  /* =========================================================
   *  COBRAR (por pedido o toda la mesa)
   * ========================================================= */
  function cobrar(numero, soloPedidoId = null) {
    const pendientes = (mesas[numero]?.pedidos || []).filter((p) => !p.pago);
    if (!pendientes.length) { toast('Esta mesa ya está pagada', 'info'); return; }
    const seleccion = new Set(soloPedidoId ? [soloPedidoId] : pendientes.map((p) => p.id));
    // Pago simple
    let metodo = null;
    let recibido = '';
    let referencia = '';
    // Pago dividido: [{ metodo, monto, recibido, referencia, editado }]
    let dividir = false;
    let partes = [];

    const elegidos = () => pendientes.filter((p) => seleccion.has(p.id));
    const total = () => redondear(elegidos().reduce((s, p) => s + totalPedido(p), 0));
    const sinEntregar = () => elegidos().reduce((s, p) => s + p.items.reduce((t, i) => t + i.qty - i.entregados, 0), 0);
    const nuevaParte = (m, monto = '') => ({ metodo: m, monto, recibido: '', referencia: '', editado: false });

    /** Estado del cobro: total, si falta algo y las partes listas para guardar. */
    const calculo = () => {
      const t = total();
      if (!dividir) {
        const r = recibido.trim() === '' ? t : aNumero(recibido);
        const falta = metodo === 'efectivo' && !(r >= t - 0.001);
        const vuelto = metodo === 'efectivo' && r > t ? redondear(r - t) : 0;
        const ref = referencia.trim();
        const parte = { metodo, monto: t, ...(metodo === 'efectivo' ? { recibido: r, vuelto } : {}), ...(ref && metodo !== 'efectivo' ? { referencia: ref } : {}) };
        return { t, r, falta: !metodo || falta, listo: !!metodo && !falta, partes: [parte], vuelto };
      }
      const listas = partes.map((pt) => {
        const monto = redondear(aNumero(pt.monto));
        const parte = { metodo: pt.metodo, monto };
        if (pt.metodo === 'efectivo' && pt.recibido.trim()) {
          parte.recibido = aNumero(pt.recibido);
          parte.vuelto = redondear(parte.recibido - monto);
        }
        if (pt.metodo !== 'efectivo' && pt.referencia.trim()) parte.referencia = pt.referencia.trim();
        return parte;
      });
      const asignado = redondear(listas.reduce((s, pt) => s + (Number.isFinite(pt.monto) ? pt.monto : 0), 0));
      const montosOk = listas.every((pt) => pt.monto > 0);
      const efectivoOk = listas.every((pt) => pt.vuelto == null || pt.vuelto >= -0.001);
      const cuadra = Math.abs(asignado - t) < 0.005;
      return {
        t, asignado, partes: listas, montosOk, efectivoOk, cuadra,
        listo: montosOk && efectivoOk && cuadra,
        vuelto: listas.reduce((s, pt) => s + Math.max(0, pt.vuelto || 0), 0),
      };
    };

    /** Actualiza textos calculados sin repintar (no se pierde el foco al escribir). */
    const actualizar = (cuerpo, pie) => {
      const c = calculo();
      const caja = cuerpo.querySelector('[data-vuelto]');
      if (caja) {
        caja.innerHTML = c.falta
          ? `<span class="text-red-600 dark:text-red-400">Falta ${soles(c.t - (Number.isFinite(c.r) ? c.r : 0))}</span>`
          : `Vuelto: <span class="font-display text-2xl tabular-nums">${soles(c.vuelto)}</span>`;
      }
      if (dividir) {
        cuerpo.querySelectorAll('[data-parte]').forEach((fila) => {
          const pt = c.partes[+fila.dataset.parte];
          const v = fila.querySelector('[data-parte-vuelto]');
          if (v) {
            v.innerHTML = pt.vuelto == null ? ''
              : pt.vuelto < -0.001 ? `<span class="text-red-600 dark:text-red-400">Falta ${soles(-pt.vuelto)}</span>`
                : `Vuelto ${soles(pt.vuelto)}`;
          }
        });
        const resumen = cuerpo.querySelector('[data-resumen-partes]');
        const dif = redondear(c.t - c.asignado);
        resumen.innerHTML = `Asignado ${soles(c.asignado)} de ${soles(c.t)} · ${
          Math.abs(dif) < 0.005 ? '<span class="text-emerald-600 dark:text-emerald-400">✓ Cuadra</span>'
            : dif > 0 ? `<span class="text-red-600 dark:text-red-400">Falta ${soles(dif)}</span>`
              : `<span class="text-red-600 dark:text-red-400">Sobra ${soles(-dif)}</span>`}`;
      }
      const boton = pie.querySelector('[data-confirmar-pago]');
      boton.disabled = !seleccion.size || !c.listo;
      boton.textContent = !seleccion.size ? 'Elige al menos un pedido'
        : dividir ? (c.listo ? `Confirmar pago dividido · ${soles(c.t)}` : 'Completa los montos')
          : !metodo ? 'Elige la forma de pago'
            : `Confirmar ${METODOS[metodo].nombre} · ${soles(c.t)}`;
    };

    const htmlSimple = (t) => {
      const rapidos = [['Exacto', t], ...[20, 50, 100, 200].filter((v) => v > t).slice(0, 3).map((v) => [`${CONFIG.moneda} ${v}`, v])];
      return `
        <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
          ${Object.entries(METODOS).map(([id, m]) => `
            <button type="button" data-metodo="${id}" aria-pressed="${metodo === id}"
              class="flex flex-col items-center gap-1 rounded-2xl bg-white px-2 py-3 text-sm font-semibold ring-1 ring-carbon-900/10 transition active:scale-95 aria-pressed:bg-carbon-900 aria-pressed:text-white aria-pressed:ring-carbon-900 dark:bg-carbon-800 dark:ring-white/10 dark:aria-pressed:bg-crema-100 dark:aria-pressed:text-carbon-950">
              <span class="text-2xl">${m.icono}</span>${m.nombre}
            </button>`).join('')}
        </div>
        ${metodo === 'efectivo' ? `
          <div class="mt-4">
            <label for="recibido" class="text-sm font-semibold">Monto recibido</label>
            <input id="recibido" data-recibido inputmode="decimal" value="${esc(recibido)}" placeholder="${t.toFixed(2)}" autocomplete="off" class="campo mt-1 text-lg font-bold tabular-nums">
            <div class="mt-2 flex flex-wrap gap-2">
              ${rapidos.map(([txt, v]) => `<button type="button" class="chip !py-1.5 text-xs" data-rapido="${v}">${txt}</button>`).join('')}
            </div>
            <p data-vuelto class="mt-3 rounded-2xl bg-carbon-900/5 p-3 text-center font-semibold dark:bg-white/10"></p>
          </div>` : metodo ? `
          ${billeteras().some((b) => b.id === metodo) ? `
            <div class="reporte mt-4 rounded-2xl bg-white p-4 text-center ring-1 ring-carbon-900/10">
              <p class="text-sm font-semibold">Muestra este QR al cliente</p>
              ${htmlBilleteras(billeteras().filter((b) => b.id === metodo))}
            </div>` : ''}
          <label class="mt-4 block">
            <span class="text-sm font-semibold">N° de operación <span class="texto-suave font-normal">(opcional)</span></span>
            <input data-referencia value="${esc(referencia)}" maxlength="30" autocomplete="off" class="campo mt-1 font-mono">
          </label>` : ''}`;
    };

    const htmlDividido = () => `
      <div class="space-y-3">
        ${partes.map((pt, i) => `
          <div data-parte="${i}" class="superficie space-y-2 rounded-2xl p-3">
            <div class="flex items-center gap-2">
              <select data-parte-metodo aria-label="Forma de pago ${i + 1}" class="campo min-w-0 flex-1 !py-2.5">
                ${Object.entries(METODOS).map(([id, m]) => `<option value="${id}" ${pt.metodo === id ? 'selected' : ''}>${m.icono} ${m.nombre}</option>`).join('')}
              </select>
              <div class="relative w-32 shrink-0">
                <span class="texto-suave pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold">S/</span>
                <input data-parte-monto inputmode="decimal" value="${esc(pt.monto)}" placeholder="0.00" autocomplete="off" aria-label="Monto ${i + 1}" class="campo !py-2.5 !pl-9 font-bold tabular-nums">
              </div>
              ${partes.length > 2 ? `<button type="button" data-quitar-parte class="btn-icono !h-10 !w-10" aria-label="Quitar forma de pago">${ICONOS.cerrar('h-4 w-4')}</button>` : ''}
            </div>
            ${pt.metodo === 'efectivo' ? `
              <div class="flex items-center gap-2">
                <input data-parte-recibido inputmode="decimal" value="${esc(pt.recibido)}" placeholder="Recibido (para el vuelto)" autocomplete="off" class="campo min-w-0 flex-1 !py-2 text-sm">
                <span data-parte-vuelto class="shrink-0 text-sm font-semibold"></span>
              </div>` : `
              <input data-parte-ref value="${esc(pt.referencia)}" maxlength="30" placeholder="N° de operación (opcional)" autocomplete="off" class="campo !py-2 font-mono text-sm">`}
          </div>`).join('')}
        <button type="button" data-agregar-parte class="btn-secundario w-full !min-h-[44px] text-sm">${ICONOS.mas('h-4 w-4')} Otra forma de pago</button>
        <p data-resumen-partes class="rounded-2xl bg-carbon-900/5 p-3 text-center text-sm font-semibold dark:bg-white/10"></p>
      </div>`;

    let hoja = null;
    hoja = abrirHoja({
      titulo: `Cobrar · ${etiquetaMesa(numero)}`,
      subtitulo: 'Elige cómo pagó el cliente',
      ancho: 'md:max-w-lg',
      render(cuerpo, pie) {
        const t = total();
        cuerpo.innerHTML = `
          <div class="space-y-5 p-5">
            ${pendientes.length > 1 ? `
              <div>
                <p class="mb-2 text-sm font-semibold">Pedidos a cobrar</p>
                <div class="space-y-2">
                  ${pendientes.map((p) => `
                    <button type="button" data-sel="${esc(p.id)}" class="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition ${seleccion.has(p.id) ? 'bg-arcilla-500/10 ring-2 ring-arcilla-500 dark:ring-oro-400' : 'ring-carbon-900/10 dark:ring-white/10'}">
                      <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md ring-2 ${seleccion.has(p.id) ? 'bg-arcilla-500 text-white ring-arcilla-500' : 'text-transparent ring-carbon-900/25 dark:ring-white/30'}">${ICONOS.check('h-4 w-4')}</span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-semibold">${p.alias ? `👤 ${esc(p.alias)}` : esc(p.id)}</span>
                        <span class="texto-suave block text-xs">${unidadesPedido(p)} platos · ${horaCorta(p.ts)}</span>
                      </span>
                      <span class="font-bold tabular-nums">${soles(totalPedido(p))}</span>
                    </button>`).join('')}
                </div>
              </div>` : ''}
            ${sinEntregar() ? `<p class="rounded-2xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">⚠️ Hay ${sinEntregar()} plato(s) sin entregar. Si el cliente se fue sin recibirlos, quítalos antes de cobrar (botón ⋯ del plato).</p>` : ''}
            <div class="text-center">
              <p class="texto-suave text-sm">Total a cobrar</p>
              <p class="font-display text-5xl font-bold tabular-nums">${soles(t)}</p>
            </div>
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <p class="text-sm font-semibold">Forma de pago</p>
                <button type="button" data-dividir aria-pressed="${dividir}" class="chip !py-1.5 text-xs">🔀 Dividir pago</button>
              </div>
              ${dividir ? htmlDividido() : htmlSimple(t)}
            </div>
          </div>`;
        pie.innerHTML = '<div class="px-5 pb-5 pt-1"><button type="button" data-confirmar-pago class="btn-primario w-full text-base">Confirmar pago</button></div>';
        actualizar(cuerpo, pie);
      },
    });

    hoja.el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-recibido]')) recibido = t.value;
      else if (t.matches('[data-referencia]')) referencia = t.value;
      else if (t.closest('[data-parte]')) {
        const i = +t.closest('[data-parte]').dataset.parte;
        const pt = partes[i];
        if (t.matches('[data-parte-recibido]')) pt.recibido = t.value;
        if (t.matches('[data-parte-ref]')) pt.referencia = t.value;
        if (t.matches('[data-parte-monto]')) {
          pt.monto = t.value;
          pt.editado = true;
          // La última parte (si no se tocó) se completa sola con lo que falta
          const ultima = partes.length - 1;
          if (i !== ultima && !partes[ultima].editado) {
            const resto = redondear(total() - partes.slice(0, ultima).reduce((s, x) => s + (aNumero(x.monto) || 0), 0));
            partes[ultima].monto = resto > 0 ? resto.toFixed(2) : '';
            const input = hoja.el.querySelector(`[data-parte="${ultima}"] [data-parte-monto]`);
            if (input) input.value = partes[ultima].monto;
          }
        }
      } else return;
      actualizar(hoja.cuerpo, hoja.pie);
    });

    hoja.el.addEventListener('change', (e) => {
      const select = e.target.closest('[data-parte-metodo]');
      if (!select) return;
      partes[+select.closest('[data-parte]').dataset.parte].metodo = select.value;
      hoja.refrescar();
    });

    hoja.el.addEventListener('click', (e) => {
      const sel = e.target.closest('[data-sel]');
      if (sel) {
        seleccion.has(sel.dataset.sel) ? seleccion.delete(sel.dataset.sel) : seleccion.add(sel.dataset.sel);
        recibido = '';
        partes.forEach((pt) => { pt.editado = false; });
        if (dividir) partes[partes.length - 1].monto = '';
        hoja.refrescar();
        return;
      }
      if (e.target.closest('[data-dividir]')) {
        dividir = !dividir;
        if (dividir && !partes.length) partes = [nuevaParte(metodo || 'efectivo'), nuevaParte(metodo === 'yape' ? 'efectivo' : 'yape')];
        hoja.refrescar();
        return;
      }
      if (e.target.closest('[data-agregar-parte]')) {
        const resto = redondear(total() - partes.reduce((s, x) => s + (aNumero(x.monto) || 0), 0));
        partes.push(nuevaParte('plin', resto > 0 ? resto.toFixed(2) : ''));
        hoja.refrescar();
        return;
      }
      const quitar = e.target.closest('[data-quitar-parte]');
      if (quitar) {
        partes.splice(+quitar.closest('[data-parte]').dataset.parte, 1);
        hoja.refrescar();
        return;
      }
      const m = e.target.closest('[data-metodo]');
      if (m) { metodo = m.dataset.metodo; hoja.refrescar(); return; }
      const rapido = e.target.closest('[data-rapido]');
      if (rapido) { recibido = Number(rapido.dataset.rapido).toFixed(2); hoja.refrescar(); return; }
      if (!e.target.closest('[data-confirmar-pago]')) return;

      const c = calculo();
      if (!seleccion.size || !c.listo) return;
      const grupo = Math.random().toString(36).slice(2, 9);
      const ts = Date.now();
      const metodoGeneral = c.partes.length === 1 ? c.partes[0].metodo : 'mixto';
      const lista = elegidos();
      lista.forEach((p) => {
        p.pago = { grupo, ts, metodo: metodoGeneral, monto: redondear(totalPedido(p)), total: c.t, partes: c.partes };
      });
      guardar();
      registrar('pago', lista.map((p) => ({ mesa: numero, pedido: p })), { metodo: metodoGeneral, total: c.t, partes: c.partes });
      hoja.cerrar();
      refrescarTodo();
      const resta = resumenMesa(mesas[numero]).porCobrar;
      toast(`Cobrado ${soles(c.t)} · ${textoPago({ partes: c.partes })}${c.vuelto ? ` · vuelto ${soles(c.vuelto)}` : ''}${resta > 0.001 ? ` · aún falta ${soles(resta)}` : ' · mesa pagada'}`, 'ok', 6000);
    });
  }

  /** Anula un pago. Si cubrió varios pedidos a la vez, se anulan todos juntos. */
  async function anularPago(numero, pedidoId) {
    const pedido = mesas[numero]?.pedidos.find((p) => p.id === pedidoId);
    if (!pedido?.pago) return;
    const clave = grupoPago(pedido.pago);
    const grupo = mesas[numero].pedidos.filter((p) => p.pago && grupoPago(p.pago) === clave);
    const total = redondear(pedido.pago.total ?? grupo.reduce((s, p) => s + p.pago.monto, 0));
    const pago = { ...pedido.pago, total };
    const ok = await confirmarManteniendo(
      `Se anulará el pago de ${soles(total)} (${textoPago(pago)})${grupo.length > 1 ? `, que cubrió ${grupo.length} pedidos de esta mesa; todos volverán a quedar por cobrar` : '. El pedido volverá a quedar por cobrar'}.`,
      { titulo: 'Anular pago', textoBoton: 'Mantén presionado para anular' },
    );
    if (!ok) return;
    grupo.forEach((p) => { delete p.pago; });
    guardar();
    registrar('pago-anulado', grupo.map((p) => ({ mesa: numero, pedido: p })), { metodo: pago.metodo, total, partes: partesPago(pago) });
    refrescarTodo();
    toast('Pago anulado', 'info');
  }

  /* =========================================================
   *  PEDIDO MANUAL (lo que el cliente pide de palabra)
   * ========================================================= */
  function pedidoManual(numero, { soloFueraDeCarta = false } = {}) {
    const platos = (carta?.platos || []).filter((p) => p.activo);
    const cantidades = {};
    const notas = {};
    const extras = []; // platos fuera de carta: [{ uid, frecuente?, nombre, precio, qty, nota }]
    const frecuentes = (carta?.extras || []).filter((f) => f.nombre && f.precio > 0);
    let busqueda = '';

    const hoja = abrirHoja({
      titulo: `Nuevo pedido · ${etiquetaMesa(numero)}`,
      subtitulo: platos.length ? 'Marca lo que pidió el cliente o agrega algo fuera de carta' : 'La carta no cargó: agrega los platos fuera de carta',
      ancho: 'md:max-w-2xl',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <div class="space-y-3 px-4 pt-4 sm:px-5">
            <label class="relative block">
              <span class="texto-suave pointer-events-none absolute left-4 top-3.5">${ICONOS.usuario()}</span>
              <input data-alias-manual maxlength="30" placeholder="Alias del cliente (opcional)" autocomplete="off" class="campo !pl-12">
            </label>

            <!-- Fuera de carta: solo el mozo lo escribe (descripción + precio) -->
            <section data-fuera-carta class="rounded-2xl bg-oro-400/10 p-3 ring-1 ring-oro-500/30">
              <p class="flex items-center gap-2 text-sm font-semibold">✍️ Fuera de carta <span class="texto-suave font-normal">(lo que no está en la carta)</span></p>
              ${frecuentes.length ? `
                <div class="mt-2 flex flex-wrap gap-2">
                  ${frecuentes.map((f) => `<button type="button" class="chip !py-1.5 text-xs" data-agregar-frecuente="${esc(f.id)}">+ ${esc(f.nombre)} · ${soles(f.precio)}</button>`).join('')}
                </div>
                <p class="texto-suave mt-3 text-xs">¿Otra cosa? Escríbela:</p>` : ''}
              <div class="mt-2 grid grid-cols-[1fr_6.5rem] gap-2">
                <input data-extra-nombre maxlength="50" placeholder="Descripción (ej. Porción de arroz)" autocomplete="off" class="campo !py-2.5 col-span-2 sm:col-span-1">
                <div class="relative col-span-1">
                  <span class="texto-suave pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold">S/</span>
                  <input data-extra-precio inputmode="decimal" placeholder="0.00" autocomplete="off" aria-label="Precio unitario" class="campo !py-2.5 !pl-9 font-bold tabular-nums">
                </div>
                <div class="col-span-1 inline-flex items-center justify-between rounded-2xl bg-white px-1 ring-1 ring-carbon-900/10 dark:bg-carbon-800 dark:ring-white/10 sm:col-span-2 sm:justify-start sm:gap-2">
                  <button type="button" data-extra-menos class="grid h-9 w-9 place-items-center rounded-full active:scale-90" aria-label="Uno menos">${ICONOS.menos('h-4 w-4')}</button>
                  <span data-extra-cant class="w-8 text-center font-bold tabular-nums">1</span>
                  <button type="button" data-extra-mas class="grid h-9 w-9 place-items-center rounded-full active:scale-90" aria-label="Uno más">${ICONOS.mas('h-4 w-4')}</button>
                </div>
                <input data-extra-nota maxlength="80" placeholder="Nota (opcional)" autocomplete="off" class="campo !py-2.5 col-span-2">
              </div>
              <button type="button" data-agregar-extra class="btn-secundario mt-2 w-full !min-h-[44px] text-sm">${ICONOS.mas('h-4 w-4')} Agregar al pedido</button>
              <ul data-extras class="mt-2 space-y-2"></ul>
            </section>

            ${platos.length ? `
              <label class="relative block">
                <span class="texto-suave pointer-events-none absolute left-4 top-3.5">${ICONOS.buscar()}</span>
                <input data-buscar-manual type="search" placeholder="Buscar plato de la carta…" autocomplete="off" class="campo !rounded-full !pl-12">
              </label>` : ''}
          </div>
          <div data-lista class="space-y-6 p-4 sm:p-5"></div>`;
        pie.innerHTML = '<div data-pie class="border-t border-carbon-900/5 px-5 py-4 dark:border-white/5"></div>';
      },
    });

    let cantidadExtra = 1;

    const pintarExtras = () => {
      hoja.el.querySelector('[data-extras]').innerHTML = extras.map((x) => `
        <li data-extra="${x.uid}" class="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 ring-2 ring-oro-500/60 dark:bg-carbon-800">
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold"><span class="tabular-nums">${x.qty}×</span> ${esc(x.nombre)}</p>
            <p class="texto-suave truncate text-xs">${soles(x.precio)} c/u · ${soles(x.precio * x.qty)}${x.nota ? ` · 📝 ${esc(x.nota)}` : ''}</p>
          </div>
          <button type="button" data-quitar-extra class="btn-icono !h-9 !w-9" aria-label="Quitar ${esc(x.nombre)}">${ICONOS.cerrar('h-4 w-4')}</button>
        </li>`).join('');
    };

    const pintarLista = () => {
      if (!platos.length) { hoja.el.querySelector('[data-lista]').innerHTML = ''; return; }
      const q = normalizar(busqueda);
      hoja.el.querySelector('[data-lista]').innerHTML = (carta.categorias || []).map((c) => {
        const ps = platos.filter((p) => p.cat === c.id && (!q || normalizar(p.nombre).includes(q)));
        if (!ps.length) return '';
        return `
          <section>
            <h3 class="mb-2 font-display text-lg font-bold">${esc(c.icono)} ${esc(c.nombre)}</h3>
            <ul class="space-y-2">
              ${ps.map((p) => {
                const n = cantidades[p.id] || 0;
                return `
                  <li data-manual-id="${esc(p.id)}" class="superficie rounded-2xl px-3 py-2.5 ${n ? '!ring-2 !ring-arcilla-500 dark:!ring-oro-400' : ''}">
                    <div class="flex items-center gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="truncate font-semibold">${esc(p.nombre)}</p>
                        <p class="precio text-sm">${soles(p.precio)}</p>
                      </div>
                      ${n ? `
                        <div class="inline-flex items-center rounded-full bg-carbon-900/5 p-1 dark:bg-white/10">
                          <button type="button" data-menos class="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm active:scale-90 dark:bg-carbon-700" aria-label="Quitar uno">${ICONOS.menos('h-4 w-4')}</button>
                          <span class="w-8 text-center font-bold tabular-nums">${n}</span>
                          <button type="button" data-mas class="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm active:scale-90 dark:bg-carbon-700" aria-label="Agregar uno">${ICONOS.mas('h-4 w-4')}</button>
                        </div>` : `
                        <button type="button" data-mas class="grid h-10 w-10 place-items-center rounded-full bg-arcilla-500 text-white shadow-md active:scale-90 dark:bg-oro-400 dark:text-carbon-950" aria-label="Agregar ${esc(p.nombre)}">${ICONOS.mas()}</button>`}
                    </div>
                    ${n ? `<input data-nota-manual="${esc(p.id)}" value="${esc(notas[p.id] || '')}" maxlength="80" placeholder="+ Nota (ej. sin picante)"
                      class="mt-2 w-full rounded-xl bg-carbon-900/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-arcilla-500 dark:bg-white/5">` : ''}
                  </li>`;
              }).join('')}
            </ul>
          </section>`;
      }).join('') || '<p class="texto-suave py-8 text-center text-sm">Sin resultados.</p>';
    };

    const pintarPie = () => {
      const elegidos = platos.filter((p) => cantidades[p.id]);
      const unidades = elegidos.reduce((s, p) => s + cantidades[p.id], 0) + extras.reduce((s, x) => s + x.qty, 0);
      const total = elegidos.reduce((s, p) => s + p.precio * cantidades[p.id], 0) + extras.reduce((s, x) => s + x.precio * x.qty, 0);
      hoja.el.querySelector('[data-pie]').innerHTML = `
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="texto-suave text-xs">${unidades} ${unidades === 1 ? 'plato' : 'platos'}${extras.length ? ` · ${extras.length} fuera de carta` : ''}</p>
            <p class="font-display text-2xl font-bold tabular-nums">${soles(total)}</p>
          </div>
          <button type="button" data-confirmar-manual class="btn-primario" ${unidades ? '' : 'disabled'}>Agregar a ${esc(etiquetaMesa(numero))}</button>
        </div>`;
    };

    /** Valida y agrega el plato fuera de carta escrito por el mozo. */
    const agregarExtra = () => {
      const nombreEl = hoja.el.querySelector('[data-extra-nombre]');
      const precioEl = hoja.el.querySelector('[data-extra-precio]');
      const notaEl = hoja.el.querySelector('[data-extra-nota]');
      const nombre = nombreEl.value.replace(/\s+/g, ' ').trim();
      const precio = redondear(aNumero(precioEl.value));
      if (!nombre) { toast('Escribe la descripción del plato', 'error'); nombreEl.focus(); return; }
      if (!(precio > 0)) { toast('Escribe un precio mayor a cero', 'error'); precioEl.focus(); return; }
      extras.push({ uid: Math.random().toString(36).slice(2, 8), nombre, precio, qty: cantidadExtra, nota: notaEl.value.replace(/\s+/g, ' ').trim() });
      nombreEl.value = '';
      precioEl.value = '';
      notaEl.value = '';
      cantidadExtra = 1;
      hoja.el.querySelector('[data-extra-cant]').textContent = '1';
      pintarExtras();
      pintarPie();
      nombreEl.focus();
    };

    pintarExtras();
    pintarLista();
    pintarPie();
    if (soloFueraDeCarta || !platos.length) setTimeout(() => hoja.el.querySelector('[data-extra-nombre]')?.focus(), 400);

    hoja.el.addEventListener('input', (e) => {
      if (e.target.matches('[data-buscar-manual]')) { busqueda = e.target.value.trim(); pintarLista(); }
      if (e.target.matches('[data-nota-manual]')) notas[e.target.dataset.notaManual] = e.target.value;
    });

    // Enter en los campos de fuera de carta = Agregar
    hoja.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.closest('[data-fuera-carta]') && e.target.matches('input')) { e.preventDefault(); agregarExtra(); }
    });

    hoja.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-extra-mas]') || e.target.closest('[data-extra-menos]')) {
        cantidadExtra = Math.max(1, Math.min(99, cantidadExtra + (e.target.closest('[data-extra-mas]') ? 1 : -1)));
        hoja.el.querySelector('[data-extra-cant]').textContent = cantidadExtra;
        return;
      }
      if (e.target.closest('[data-agregar-extra]')) { agregarExtra(); return; }
      const frec = e.target.closest('[data-agregar-frecuente]');
      if (frec) {
        // Precio fijo de la lista; otro toque suma una unidad
        const f = frecuentes.find((x) => x.id === frec.dataset.agregarFrecuente);
        const ya = extras.find((x) => x.frecuente === f.id && !x.nota);
        if (ya) ya.qty = Math.min(99, ya.qty + 1);
        else extras.push({ uid: Math.random().toString(36).slice(2, 8), frecuente: f.id, nombre: f.nombre, precio: f.precio, qty: 1, nota: '' });
        bump(frec);
        pintarExtras();
        pintarPie();
        return;
      }
      const quitar = e.target.closest('[data-quitar-extra]');
      if (quitar) {
        const uid = quitar.closest('[data-extra]').dataset.extra;
        extras.splice(extras.findIndex((x) => x.uid === uid), 1);
        pintarExtras();
        pintarPie();
        return;
      }
      const fila = e.target.closest('[data-manual-id]');
      if (fila && (e.target.closest('[data-mas]') || e.target.closest('[data-menos]'))) {
        const id = fila.dataset.manualId;
        cantidades[id] = Math.max(0, Math.min(30, (cantidades[id] || 0) + (e.target.closest('[data-mas]') ? 1 : -1)));
        pintarLista();
        pintarPie();
        return;
      }
      if (!e.target.closest('[data-confirmar-manual]')) return;

      const deCarta = platos.filter((p) => cantidades[p.id]).map((p) => ({
        id: p.id, nombre: p.nombre, precio: p.precio, qty: cantidades[p.id],
        nota: (notas[p.id] || '').replace(/\s+/g, ' ').trim(),
      }));
      const fuera = extras.map((x) => ({
        id: `extra-${x.uid}`, nombre: x.nombre, precio: x.precio, qty: x.qty, nota: x.nota, fueraCarta: true,
      }));
      const items = [...deCarta, ...fuera].map((it, k) => ({ ...it, k, entregados: 0 }));
      if (!items.length) return;
      const pedido = {
        id: `#${esDelivery(numero) ? numero : `MESA${pad2(numero)}`}-M${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        ts: Date.now(),
        enviado: Date.now(),
        mozoId: null,
        origen: 'manual',
        alias: hoja.el.querySelector('[data-alias-manual]').value.trim(),
        telefono: '',
        items,
      };
      agregarAMesa(numero, pedido);
      guardar();
      registrar('manual', [{ mesa: numero, pedido }]);
      hoja.cerrar();
      refrescarTodo(numero);
      toast(`Pedido agregado a ${etiquetaMesa(numero)}${fuera.length ? ` · ${fuera.length} fuera de carta` : ''}`, 'ok');
    });
  }

  /* =========================================================
   *  HISTORIAL
   * ========================================================= */
  function abrirHistorial(mesaFiltro = null) {
    let tipo = 'todo';
    let busqueda = mesaFiltro ? (esDelivery(mesaFiltro) ? String(mesaFiltro).slice(1) : pad2(mesaFiltro)) : '';
    const abiertos = new Set();

    const hoja = abrirHoja({
      titulo: 'Historial',
      subtitulo: `Guardado solo en este celular · últimos ${HISTORIAL_DIAS} días`,
      ancho: 'md:max-w-2xl',
      render(cuerpo) {
        cuerpo.innerHTML = `
          <div class="space-y-3 px-4 pt-4 sm:px-5">
            <label class="relative block">
              <span class="texto-suave pointer-events-none absolute left-4 top-3.5">${ICONOS.buscar()}</span>
              <input data-buscar-historial type="search" value="${esc(busqueda)}" placeholder="Mesa, alias o código…" autocomplete="off" class="campo !rounded-full !pl-12">
            </label>
            <div data-tipos class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5"></div>
          </div>
          <div data-eventos class="p-4 sm:p-5"></div>`;
      },
      alCerrar: () => { hojaHistorial = null; },
    });

    const coincide = (evento) => {
      if (tipo === 'borrados' && !['eliminado', 'liberada', 'cierre', 'item-eliminado'].includes(evento.tipo)) return false;
      if (tipo === 'pedidos' && !['recibido', 'manual'].includes(evento.tipo)) return false;
      if (tipo === 'pagos' && !['pago', 'pago-anulado'].includes(evento.tipo)) return false;
      const q = normalizar(busqueda);
      if (!q) return true;
      return evento.entradas.some(({ mesa, pedido }) => normalizar(`${cortoMesa(mesa)} ${mesa} ${pedido.alias || ''} ${pedido.id}`).includes(q));
    };

    const pintar = () => {
      const opciones = [['todo', 'Todo'], ['pedidos', '📥 Recibidos'], ['pagos', '💰 Pagos'], ['borrados', '🗑️ Eliminados y liberados']];
      hoja.el.querySelector('[data-tipos]').innerHTML = opciones.map(([id, txt]) => `<button type="button" class="chip !py-1.5 text-xs" data-tipo="${id}" aria-pressed="${tipo === id}">${txt}</button>`).join('');

      const eventos = leerHistorial().filter(coincide).reverse();
      if (!eventos.length) {
        hoja.el.querySelector('[data-eventos]').innerHTML = '<p class="texto-suave py-10 text-center text-sm">No hay movimientos que coincidan.</p>';
        return;
      }
      let html = '';
      let diaActual = '';
      for (const ev of eventos) {
        const dia = etiquetaDia(ev.ts);
        if (dia !== diaActual) {
          diaActual = dia;
          html += `<h3 class="texto-suave mb-2 mt-5 text-xs font-bold uppercase tracking-widest first:mt-0">${dia}</h3>`;
        }
        html += tarjetaEvento(ev, abiertos.has(ev.id));
      }
      hoja.el.querySelector('[data-eventos]').innerHTML = html;
    };

    hojaHistorial = { refrescar: pintar };
    pintar();

    hoja.el.addEventListener('input', debounce((e) => {
      if (!e.target.matches('[data-buscar-historial]')) return;
      busqueda = e.target.value.trim();
      pintar();
    }, 200));

    hoja.el.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tipo]');
      if (chip) { tipo = chip.dataset.tipo; pintar(); return; }
      const restaurar = e.target.closest('[data-restaurar]');
      if (restaurar) { restaurarEvento(restaurar.dataset.restaurar); return; }
      const cabecera = e.target.closest('[data-evento]');
      if (cabecera) {
        const id = cabecera.dataset.evento;
        abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id);
        pintar();
      }
    });
  }

  function etiquetaDia(ts) {
    const d = new Date(ts);
    const hoy = new Date();
    const ayer = new Date(Date.now() - 86400000);
    if (d.toDateString() === hoy.toDateString()) return 'Hoy';
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function tarjetaEvento(ev, abierto) {
    const info = EVENTOS[ev.tipo] || { icono: '•', titulo: ev.tipo };
    const total = ev.total ?? ev.entradas.reduce((s, { pedido }) => s + totalPedido(pedido), 0);
    const mesasEv = [...new Set(ev.entradas.map((x) => x.mesa))];
    const aliasEv = [...new Set(ev.entradas.map((x) => x.pedido.alias).filter(Boolean))];
    const esPago = ev.tipo === 'pago' || ev.tipo === 'pago-anulado';
    let detalle = ev.tipo === 'cierre'
      ? `${mesasEv.length} mesa(s) · ${ev.entradas.length} pedido(s)`
      : `${mesasEv.map(etiquetaMesa).join(', ')}${aliasEv.length ? ` · 👤 ${aliasEv.join(', ')}` : ''}`;
    if (esPago) detalle = `${textoPago(ev)}${vueltoPago(ev) ? ` (vuelto ${soles(vueltoPago(ev))})` : ''} · ${detalle}`;
    if (ev.detalle) detalle = `${ev.detalle} · ${detalle}`;
    return `
      <article class="superficie mb-2.5 overflow-hidden rounded-2xl">
        <button type="button" data-evento="${ev.id}" aria-expanded="${abierto}" class="flex w-full items-center gap-3 px-4 py-3 text-left">
          <span class="text-xl">${info.icono}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">${info.titulo}${ev.tipo === 'restaurado' && ev.desde ? ` (${EVENTOS[ev.desde]?.titulo.toLowerCase() || ''})` : ''}</span>
            <span class="texto-suave block truncate text-xs">${horaCorta(ev.ts)} · ${esc(detalle)}</span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block text-sm font-bold tabular-nums">${soles(total)}</span>
            ${ev.restaurado ? '<span class="block text-[10px] font-bold uppercase text-palma-600 dark:text-palma-400">Restaurado</span>' : ''}
          </span>
        </button>
        ${abierto ? `
          <div class="border-t border-carbon-900/5 px-4 py-3 dark:border-white/5">
            ${ev.entradas.map(({ mesa, pedido }) => `
              <div class="mb-3 last:mb-0">
                <p class="text-xs font-semibold">${esc(etiquetaMesa(mesa))} · <span class="font-mono">${esc(pedido.id)}</span>${pedido.alias ? ` · 👤 ${esc(pedido.alias)}` : ''}${pedido.telefono ? ` · ${esc(formatoTelefono(pedido.telefono))}` : ''}</p>
                <ul class="texto-suave mt-1 space-y-0.5 text-sm">
                  ${pedido.items.map((it) => `<li>${it.qty}× ${esc(it.nombre)} — ${soles(it.precio * it.qty)}${it.nota ? ` <span class="text-amber-700 dark:text-amber-300">📝 ${esc(it.nota)}</span>` : ''}</li>`).join('')}
                </ul>
              </div>`).join('')}
            ${info.restaurable && !ev.restaurado ? `
              <button type="button" data-restaurar="${ev.id}" class="btn-secundario mt-2 w-full !min-h-[44px] text-sm">${ICONOS.restaurar('h-4 w-4')} Restaurar ${ev.entradas.length > 1 ? `${ev.entradas.length} pedidos` : 'pedido'} a su mesa</button>` : ''}
          </div>` : ''}
      </article>`;
  }

  /* =========================================================
   *  CIERRE DEL DÍA (clave de administrador o dueño)
   * ========================================================= */
  function cerrarDia() {
    const ocupadas = Object.keys(mesas).filter((n) => mesas[n]?.pedidos.length);
    const entradas = ocupadas.flatMap((n) => mesas[n].pedidos.map((pedido) => ({ mesa: claveMesa(n), pedido })));
    const enMesas = entradas.reduce((s, { pedido }) => s + totalPedido(pedido), 0);
    const hoy = new Date().toDateString();
    const delDia = leerHistorial().filter((e) => ['recibido', 'manual'].includes(e.tipo) && new Date(e.ts).toDateString() === hoy);
    const porMetodo = {};
    leerHistorial()
      .filter((e) => ['pago', 'pago-anulado'].includes(e.tipo) && new Date(e.ts).toDateString() === hoy)
      .forEach((e) => partesPago(e).forEach((pt) => {
        porMetodo[pt.metodo] = (porMetodo[pt.metodo] || 0) + (e.tipo === 'pago' ? 1 : -1) * pt.monto;
      }));
    const cobradoHoy = Object.values(porMetodo).reduce((s, v) => s + v, 0);
    const sinCobrar = ocupadas.reduce((s, n) => s + resumenMesa(mesas[n]).porCobrar, 0);
    const mesasConDeuda = ocupadas.filter((n) => hayDeuda(resumenMesa(mesas[n]))).length;

    const hoja = abrirHoja({
      titulo: 'Cerrar el día',
      subtitulo: 'Deja todas las mesas en cero para empezar de nuevo',
      ancho: 'md:max-w-md',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <div class="space-y-4 p-5">
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-2xl bg-carbon-900/5 p-3 dark:bg-white/10"><p class="texto-suave text-xs">Mesas ocupadas</p><p class="font-display text-2xl font-bold">${ocupadas.length}</p></div>
              <div class="rounded-2xl bg-carbon-900/5 p-3 dark:bg-white/10"><p class="texto-suave text-xs">En mesas ahora</p><p class="font-display text-2xl font-bold tabular-nums">${soles(enMesas)}</p></div>
              <div class="col-span-2 rounded-2xl bg-palma-500/10 p-3">
                <p class="texto-suave text-xs">Cobrado hoy · ${delDia.length} pedido(s) registrados</p>
                <p class="font-display text-2xl font-bold tabular-nums">${soles(cobradoHoy)}</p>
                ${Object.keys(porMetodo).length ? `<div class="mt-2 flex flex-wrap gap-1.5">${Object.entries(porMetodo).filter(([, v]) => Math.abs(v) > 0.001).map(([m, v]) => `<span class="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">${METODOS[m]?.icono || ''} ${METODOS[m]?.nombre || m} ${soles(v)}</span>`).join('')}</div>` : ''}
              </div>
            </div>
            <button type="button" data-ver-reporte class="btn-secundario w-full !min-h-[44px] text-sm">🧾 Ver / imprimir el reporte del día</button>
            ${sinCobrar > 0.001 ? `<p class="rounded-2xl bg-red-500/10 p-3 text-sm font-semibold text-red-700 dark:text-red-300">⚠️ Hay ${soles(sinCobrar)} sin cobrar en ${mesasConDeuda} mesa(s). Cóbralos antes de cerrar.</p>` : ''}
            <label class="block"><span class="text-sm font-semibold">Clave de administrador o dueño</span>
              <input data-clave-cierre type="password" autocomplete="off" class="campo mt-1" placeholder="Clave"></label>
            <label class="flex items-start gap-3 rounded-2xl bg-red-500/10 p-3 text-sm">
              <input data-borrar-historial type="checkbox" class="mt-0.5 h-5 w-5 accent-red-600">
              <span><b>Borrar también el historial</b> de este celular (y con él los reportes de ventas). Si no lo marcas, el cierre queda guardado y se puede restaurar.</span>
            </label>
          </div>`;
        pie.innerHTML = `
          <div class="space-y-2.5 px-5 pb-5">
            ${botonMantener('Mantén presionado para limpiar todo')}
            <button type="button" data-cerrar-hoja class="btn-secundario w-full">Cancelar</button>
          </div>`;
      },
    });

    hoja.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ver-reporte]')) abrirReporte();
    });

    activarMantener(hoja.el.querySelector('[data-mantener]'), async () => {
      const clave = hoja.el.querySelector('[data-clave-cierre]').value;
      const hash = await sha256(clave);
      if (!clave || ![CONFIG.accesos.adminHash, CONFIG.accesos.duenoHash].includes(hash)) {
        toast('Clave incorrecta: solo el administrador o el dueño pueden cerrar el día', 'error', 4000);
        hoja.el.querySelector('[data-clave-cierre]').select();
        return;
      }
      const borrarHistorial = hoja.el.querySelector('[data-borrar-historial]').checked;
      let evento = null;
      if (borrarHistorial) store.remove(CLAVE_HISTORIAL);
      else if (entradas.length) evento = registrar('cierre', entradas, { total: enMesas });
      mesas = {};
      guardar();
      guardarProcesados([]);
      hoja.cerrar();
      refrescarTodo();
      mostrarEstado('🌙 Día cerrado. Todas las mesas están libres.');
      toast('Listo: el panel quedó en cero', 'ok', 7000, evento ? { texto: 'Deshacer', fn: () => restaurarEvento(evento) } : null);
    });
  }

  /* =========================================================
   *  CUENTA PARA EL CLIENTE (pre-cuenta detallada)
   * ========================================================= */

  /** Datos de la cuenta para los pedidos elegidos de una mesa. */
  function datosCuenta(numero, ids, agrupar) {
    const pedidos = (mesas[numero]?.pedidos || []).filter((p) => ids.has(p.id));
    const lineaDe = (it) => ({ nombre: it.nombre, precio: it.precio, qty: it.qty, importe: redondear(it.precio * it.qty) });
    let grupos;
    if (agrupar) {
      // Platos iguales (mismo nombre y precio) en una sola línea
      const mapa = new Map();
      pedidos.forEach((p) => p.items.forEach((it) => {
        const clave = `${it.nombre}|${it.precio}`;
        const l = mapa.get(clave) || { ...lineaDe(it), qty: 0, importe: 0 };
        l.qty += it.qty;
        l.importe = redondear(l.importe + it.precio * it.qty);
        mapa.set(clave, l);
      }));
      grupos = [{ titulo: '', lineas: [...mapa.values()] }];
    } else {
      grupos = pedidos.map((p) => ({ titulo: `${p.alias ? `${p.alias} · ` : ''}${p.id}`, lineas: p.items.map(lineaDe) }));
    }
    const subtotal = redondear(pedidos.reduce((s, p) => s + totalPedido(p), 0));
    const pagados = pedidos.filter((p) => p.pago);
    const pagado = redondear(pagados.reduce((s, p) => s + totalPedido(p), 0));
    return {
      numero,
      fecha: new Date(),
      grupos,
      subtotal,
      pagado,
      formasPagadas: [...new Set(pagados.map((p) => textoPago(p.pago)))].join(' + '),
      porPagar: redondear(subtotal - pagado),
      clientes: [...new Set(pedidos.map((p) => p.alias).filter(Boolean))].join(', '),
      mozos: [...new Set(pedidos.filter((p) => p.mozoId != null).map((p) => nombreMozo(p.mozoId)))].join(', '),
      codigos: pedidos.map((p) => p.id).join(', '),
      entrega: esDelivery(numero) ? entregaDe(numero) : null,
    };
  }

  function htmlCuenta(c) {
    const fecha = c.fecha.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
    const filas = c.grupos.map((g) => `
      ${g.titulo ? `<tr class="rep-grupo"><td colspan="4">${esc(g.titulo)}</td></tr>` : ''}
      ${g.lineas.map((l) => `
        <tr>
          <td class="num">${l.qty}</td>
          <td>${esc(l.nombre)}</td>
          <td class="num">${soles(l.precio)}</td>
          <td class="num">${soles(l.importe)}</td>
        </tr>`).join('')}`).join('');
    return `
      <div class="reporte">
        <header class="rep-cab">
${cabeceraLocal()}
          <h2 class="rep-titulo">Cuenta · ${esc(etiquetaMesa(c.numero))}</h2>
          <p class="rep-fecha">${esc(fecha)}</p>
        </header>
        <div class="rep-meta">
          ${c.clientes ? `<p><b>Cliente:</b> ${esc(c.clientes)}</p>` : ''}
          ${c.entrega ? `<p><b>Entrega:</b> ${esc(c.entrega.direccion)}${c.entrega.referencia ? ` (${esc(c.entrega.referencia)})` : ''}</p>
            <p><b>Celular:</b> ${esc(formatoNumero(c.entrega.telefono))}</p>` : ''}
          ${c.mozos ? `<p><b>Atendido por:</b> ${esc(c.mozos)}</p>` : ''}
          <p><b>Pedido(s):</b> ${esc(c.codigos)}</p>
        </div>
        <table class="rep-cuenta">
          <thead><tr><th class="num" style="width:2.6em">Cant.</th><th>Descripción</th><th class="num">P. U.</th><th class="num">Importe</th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr><td></td><td colspan="2">Subtotal</td><td class="num">${soles(c.subtotal)}</td></tr>
            ${c.pagado > 0.001 ? `<tr><td></td><td colspan="2">Pagado (${esc(c.formasPagadas)})</td><td class="num">−${soles(c.pagado)}</td></tr>` : ''}
          </tfoot>
        </table>
        <div class="rep-total"><span>Total a pagar</span><strong>${soles(c.porPagar)}</strong></div>
        ${billeteras().length ? `<h3>Paga con ${billeteras().map((b) => b.nombre).join(' o ')}</h3>${htmlBilleteras()}` : ''}
        <p class="rep-meta rep-centro">Aceptamos: ${Object.values(METODOS).map((m) => m.nombre).join(' · ')}</p>
        <footer>Pre-cuenta · no es comprobante de pago<br>¡Gracias por su visita! · ${esc(CONFIG.nombreCompleto)}</footer>
      </div>`;
  }

  function textoCuenta(c) {
    const linea = '━━━━━━━━━━━━━━━━━━';
    const detalle = c.grupos.flatMap((g) => [
      ...(g.titulo ? [`*${g.titulo}*`] : []),
      ...g.lineas.map((l) => `▪️ ${l.qty}× ${l.nombre} — ${soles(l.importe)}${l.qty > 1 ? `\n      (${soles(l.precio)} c/u)` : ''}`),
    ]);
    return [
      `🧾 *CUENTA · ${CONFIG.nombreCompleto.toUpperCase()}*`,
      `${esDelivery(c.numero) ? '🛵' : '🪑'} ${etiquetaMesa(c.numero)}${c.clientes ? ` · 👤 ${c.clientes}` : ''}`,
      `🕒 ${c.fecha.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}`,
      linea,
      ...detalle,
      linea,
      `Subtotal: ${soles(c.subtotal)}`,
      ...(c.pagado > 0.001 ? [`Pagado: −${soles(c.pagado)}`] : []),
      `💰 *TOTAL A PAGAR: ${soles(c.porPagar)}*`,
      ...(billeteras().length ? [
        '',
        '*Puedes pagar con:*',
        ...billeteras().flatMap((b) => [
          `${b.icono} *${b.nombre}:* ${b.numero ? formatoNumero(b.numero) : ''}${b.titular ? ` · ${b.titular}` : ''}`,
          ...(b.qr ? [`   QR: ${urlAbsoluta(b.qr)}`] : []),
        ]),
      ] : []),
      '',
      `Aceptamos: ${Object.values(METODOS).map((m) => `${m.icono} ${m.nombre}`).join(' · ')}`,
      '_Pre-cuenta, no es comprobante de pago._',
      '¡Gracias por su visita! 🙌',
    ].join('\n');
  }

  function abrirCuenta(numero, soloPedidoId = null) {
    const pedidosMesa = () => mesas[numero]?.pedidos || [];
    if (!pedidosMesa().length) { toast('La mesa no tiene pedidos', 'info'); return; }
    const pendientes = pedidosMesa().filter((p) => !p.pago);
    const seleccion = new Set(soloPedidoId ? [soloPedidoId] : (pendientes.length ? pendientes : pedidosMesa()).map((p) => p.id));
    let agrupar = true;
    let formato = store.get('cuenta.formato', 'ticket') === 'a4' ? 'a4' : 'ticket';
    // Si al pegar el pedido se capturó el número del cliente, se propone enviarle la cuenta
    const conocido = pedidosMesa().filter((p) => seleccion.has(p.id)).map((p) => p.telefono).find(Boolean)
      || (esDelivery(numero) ? CONFIG.prefijoPais + entregaDe(numero).telefono : '');
    let telefono = conocido.length === 11 && conocido.startsWith(CONFIG.prefijoPais) ? conocido.slice(2) : conocido;

    const cuenta = () => datosCuenta(numero, seleccion, agrupar);
    const enlace = () => {
      const digitos = telefono.replace(/\D/g, '');
      const destino = digitos.length === 9 ? CONFIG.prefijoPais + digitos : digitos.length > 9 ? digitos : '';
      return `https://wa.me/${destino}?text=${encodeURIComponent(textoCuenta(cuenta()))}`;
    };
    const textoBotonEnvio = () => (telefono.replace(/\D/g, '').length >= 9 ? 'Enviar al cliente' : 'Enviar por WhatsApp');

    const hoja = abrirHoja({
      titulo: `Cuenta · ${etiquetaMesa(numero)}`,
      subtitulo: 'Detalle para imprimir o enviar al cliente',
      ancho: 'md:max-w-2xl',
      render(cuerpo, pie) {
        const varios = pedidosMesa().length > 1;
        cuerpo.innerHTML = `
          <div class="space-y-3 p-4 sm:p-5">
            ${varios ? `
              <div>
                <p class="mb-2 text-sm font-semibold">Incluir</p>
                <div class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
                  <button type="button" class="chip !py-1.5 text-xs" data-todos aria-pressed="${seleccion.size === pedidosMesa().length}">Toda la mesa</button>
                  ${pedidosMesa().map((p) => `<button type="button" class="chip !py-1.5 text-xs" data-incluir="${esc(p.id)}" aria-pressed="${seleccion.has(p.id)}">${p.alias ? `👤 ${esc(p.alias)}` : esc(p.id)}${p.pago ? ' ✓' : ''}</button>`).join('')}
                </div>
              </div>` : ''}
            <div class="flex flex-wrap items-center gap-2 text-sm">
              ${varios ? `<button type="button" class="chip !py-1.5 text-xs" data-agrupar aria-pressed="${agrupar}">Unir platos iguales</button>` : ''}
              <span class="texto-suave ml-1">Formato:</span>
              ${[['ticket', '🧾 Ticket 80 mm'], ['a4', '📄 Hoja A4']].map(([id, txt]) => `<button type="button" class="chip !py-1.5 text-xs" data-formato="${id}" aria-pressed="${formato === id}">${txt}</button>`).join('')}
            </div>
            <div class="rounded-2xl bg-white p-5 shadow-inner ring-1 ring-carbon-900/10 ${formato === 'ticket' ? 'mx-auto max-w-[300px] text-[12px]' : 'text-[14px]'}">
              ${seleccion.size ? htmlCuenta(cuenta()) : '<p class="py-6 text-center text-sm text-carbon-700">Elige al menos un pedido.</p>'}
            </div>
            <label class="block">
              <span class="text-sm font-semibold">WhatsApp del cliente <span class="texto-suave font-normal">(opcional)</span></span>
              <div class="mt-1 flex gap-2">
                <span class="campo !w-auto shrink-0 !px-3 font-mono texto-suave">+${CONFIG.prefijoPais}</span>
                <input data-tel-cuenta value="${esc(telefono)}" inputmode="numeric" maxlength="9" placeholder="Vacío: eliges el contacto" autocomplete="off" class="campo font-mono">
              </div>
            </label>
          </div>`;
        pie.innerHTML = `
          <div class="flex gap-2.5 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
            <a data-enviar-cuenta href="${seleccion.size ? enlace() : '#'}" target="_blank" rel="noopener" class="btn-secundario flex-1 text-sm ${seleccion.size ? '' : 'pointer-events-none opacity-50'}">${ICONOS.whatsapp('h-5 w-5')} <span>${textoBotonEnvio()}</span></a>
            <button type="button" data-imprimir-cuenta class="btn-primario flex-1" ${seleccion.size ? '' : 'disabled'}>🖨️ Imprimir</button>
          </div>`;
      },
    });

    hoja.el.addEventListener('input', (e) => {
      if (!e.target.matches('[data-tel-cuenta]')) return;
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 9);
      telefono = e.target.value;
      const a = hoja.el.querySelector('[data-enviar-cuenta]');
      if (seleccion.size) a.href = enlace();
      a.querySelector('span').textContent = textoBotonEnvio();
    });

    hoja.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-todos]')) {
        pedidosMesa().forEach((p) => seleccion.add(p.id));
        hoja.refrescar();
        return;
      }
      const incluir = e.target.closest('[data-incluir]');
      if (incluir) {
        seleccion.has(incluir.dataset.incluir) ? seleccion.delete(incluir.dataset.incluir) : seleccion.add(incluir.dataset.incluir);
        hoja.refrescar();
        return;
      }
      if (e.target.closest('[data-agrupar]')) { agrupar = !agrupar; hoja.refrescar(); return; }
      const f = e.target.closest('[data-formato]');
      if (f) { formato = f.dataset.formato; store.set('cuenta.formato', formato); hoja.refrescar(); return; }
      if (e.target.closest('[data-imprimir-cuenta]') && seleccion.size) {
        imprimirHTML(htmlCuenta(cuenta()), formato === 'ticket'
          ? { clase: 'impresion-ticket', pagina: '80mm auto', margen: '3mm' }
          : { clase: 'impresion-a4', pagina: 'A4', margen: '14mm' });
      }
    });
  }

  /* =========================================================
   *  REPORTE DE VENTAS DEL DÍA
   * ========================================================= */

  /**
   * Calcula el reporte de un día a partir del historial del celular.
   * Los pagos anulados se descuentan, así el total coincide con la caja.
   */
  function calcularReporte(diaClave, tsReferencia) {
    const eventos = leerHistorial()
      .filter((e) => new Date(e.ts).toDateString() === diaClave)
      .sort((a, b) => a.ts - b.ts);
    const porMetodo = {};
    const pagados = new Map(); // pedidoId → { mesa, pedido } (pagado y no anulado)
    const cobros = [];
    const ajustes = [];
    let registrados = 0;
    let cierre = null;
    const mesasDe = (ev) => [...new Set(ev.entradas.map((x) => x.mesa))].map(cortoMesa).join(', ');
    const sumaEvento = (ev) => ev.total ?? ev.entradas.reduce((s, { pedido }) => s + totalPedido(pedido), 0);

    for (const ev of eventos) {
      const signo = ev.tipo === 'pago' ? 1 : ev.tipo === 'pago-anulado' ? -1 : 0;
      if (signo) {
        partesPago(ev).forEach((pt) => {
          porMetodo[pt.metodo] = porMetodo[pt.metodo] || { monto: 0, operaciones: 0 };
          porMetodo[pt.metodo].monto += signo * pt.monto;
          porMetodo[pt.metodo].operaciones += signo;
        });
        ev.entradas.forEach((x) => (signo > 0 ? pagados.set(x.pedido.id, x) : pagados.delete(x.pedido.id)));
        cobros.push({
          ts: ev.ts,
          mesas: mesasDe(ev),
          cliente: [...new Set(ev.entradas.map((x) => x.pedido.alias).filter(Boolean))].join(', '),
          forma: textoPago(ev),
          monto: signo * sumaEvento(ev),
          anulado: signo < 0,
        });
      }
      if (ev.tipo === 'recibido' || ev.tipo === 'manual') registrados += 1;
      if (ev.tipo === 'ajuste') ajustes.push(`${horaCorta(ev.ts)} · Mesa ${mesasDe(ev)} · ${ev.detalle}`);
      if (ev.tipo === 'item-eliminado') {
        const it = ev.entradas[0].pedido.items[0];
        ajustes.push(`${horaCorta(ev.ts)} · Mesa ${mesasDe(ev)} · Plato quitado: ${it.qty}× ${it.nombre} (${soles(it.precio * it.qty)})${ev.restaurado ? ' · restaurado' : ''}`);
      }
      if (ev.tipo === 'eliminado') ajustes.push(`${horaCorta(ev.ts)} · Mesa ${mesasDe(ev)} · Pedido eliminado (${soles(sumaEvento(ev))})${ev.restaurado ? ' · restaurado' : ''}`);
      if (ev.tipo === 'pago-anulado') ajustes.push(`${horaCorta(ev.ts)} · Mesa ${mesasDe(ev)} · Pago anulado (${soles(sumaEvento(ev))} · ${textoPago(ev)})`);
      if (ev.tipo === 'cierre') cierre = ev.ts;
    }

    const platos = new Map();
    pagados.forEach(({ pedido }) => pedido.items.forEach((it) => {
      const nombre = it.fueraCarta ? `${it.nombre} (fuera de carta)` : it.nombre;
      const p = platos.get(nombre) || { nombre, qty: 0, importe: 0 };
      p.qty += it.qty;
      p.importe += it.precio * it.qty;
      platos.set(nombre, p);
    }));
    const listaPlatos = [...platos.values()].sort((a, b) => b.qty - a.qty || b.importe - a.importe);
    const total = redondear(Object.values(porMetodo).reduce((s, m) => s + m.monto, 0));
    const esHoy = diaClave === new Date().toDateString();
    const pendientes = esHoy
      ? Object.entries(mesas).map(([n, m]) => ({ mesa: claveMesa(n), r: resumenMesa(m) })).filter((x) => hayDeuda(x.r))
      : [];

    return {
      fecha: new Date(tsReferencia),
      total,
      porMetodo: Object.keys(METODOS).filter((m) => porMetodo[m] && (Math.abs(porMetodo[m].monto) > 0.001 || porMetodo[m].operaciones))
        .map((m) => ({ metodo: m, ...porMetodo[m] })),
      pedidos: pagados.size,
      unidades: listaPlatos.reduce((s, p) => s + p.qty, 0),
      platos: listaPlatos,
      cobros,
      ajustes,
      registrados,
      cierre,
      pendientes,
    };
  }

  /** HTML del reporte (el mismo para la vista previa y para imprimir). */
  function htmlReporte(r) {
    const fechaLarga = r.fecha.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const fecha = fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1);
    const monto = (n) => (n < 0 ? `−${soles(-n)}` : soles(n));
    const ticket = r.pedidos ? redondear(r.total / r.pedidos) : 0;
    const totalPendiente = r.pendientes.reduce((s, x) => s + x.r.porCobrar, 0);
    return `
      <div class="reporte">
        <header class="rep-cab">
${cabeceraLocal()}
          <h2 class="rep-titulo">Reporte de ventas</h2>
          <p class="rep-fecha">${esc(fecha)}</p>
          <p class="rep-fecha">Emitido: ${new Date().toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</p>
        </header>

        <div class="rep-total"><span>Total cobrado</span><strong>${soles(r.total)}</strong></div>
        <div class="rep-kpis">
          <div>Pedidos cobrados<b>${r.pedidos}</b></div>
          <div>Platos vendidos<b>${r.unidades}</b></div>
          <div>Ticket promedio<b>${soles(ticket)}</b></div>
          <div>Pedidos registrados<b>${r.registrados}</b></div>
        </div>

        <section>
          <h3>Por forma de pago</h3>
          ${r.porMetodo.length ? `
            <table>
              <thead><tr><th>Forma</th><th class="num">Operac.</th><th class="num">Monto</th></tr></thead>
              <tbody>${r.porMetodo.map((m) => `<tr><td>${esc(nombreMetodo(m.metodo))}</td><td class="num">${m.operaciones}</td><td class="num">${monto(m.monto)}</td></tr>`).join('')}</tbody>
              <tfoot><tr><td>Total</td><td></td><td class="num">${soles(r.total)}</td></tr></tfoot>
            </table>` : '<p class="rep-vacio">Sin cobros registrados.</p>'}
        </section>

        <section>
          <h3>Platos vendidos</h3>
          ${r.platos.length ? `
            <table>
              <thead><tr><th class="num" style="width:3.2em">Cant.</th><th>Plato</th><th class="num">Importe</th></tr></thead>
              <tbody>${r.platos.map((p) => `<tr><td class="num">${p.qty}</td><td>${esc(p.nombre)}</td><td class="num">${soles(p.importe)}</td></tr>`).join('')}</tbody>
            </table>` : '<p class="rep-vacio">Sin platos cobrados.</p>'}
        </section>

        <section>
          <h3>Detalle de cobros</h3>
          ${r.cobros.length ? `
            <table>
              <thead><tr><th>Hora</th><th>Mesa</th><th>Forma</th><th class="num">Monto</th></tr></thead>
              <tbody>${r.cobros.map((c) => `
                <tr class="${c.anulado ? 'rep-anulado' : ''}">
                  <td class="nw">${horaCorta(c.ts)}</td>
                  <td>${esc(c.mesas)}${c.cliente ? `<br><small>${esc(c.cliente)}</small>` : ''}</td>
                  <td>${esc(c.forma)}${c.anulado ? ' (anulado)' : ''}</td>
                  <td class="num">${monto(c.monto)}</td>
                </tr>`).join('')}</tbody>
            </table>` : '<p class="rep-vacio">Sin movimientos.</p>'}
        </section>

        ${r.pendientes.length ? `
          <div class="rep-alerta">
            <b>Pendiente de cobro: ${soles(totalPendiente)}</b><br>
            ${r.pendientes.map((x) => `${etiquetaMesa(x.mesa)}${x.r.alias.length ? ` (${esc(x.r.alias.join(', '))})` : ''}: ${soles(x.r.porCobrar)}`).join(' · ')}
          </div>` : ''}

        ${r.ajustes.length ? `
          <section>
            <h3>Ajustes y anulaciones</h3>
            <ul>${r.ajustes.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
          </section>` : ''}

        <footer>
          ${r.cierre ? `Día cerrado a las ${horaCorta(r.cierre)} · ` : ''}Datos del historial de este celular<br>
          ${esc(CONFIG.nombreCompleto)}
        </footer>
      </div>`;
  }

  /** Resumen en texto para enviar por WhatsApp. */
  function textoReporte(r) {
    const fecha = r.fecha.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    const pendiente = r.pendientes.reduce((s, x) => s + x.r.porCobrar, 0);
    return [
      `🧾 *Reporte de ventas · ${CONFIG.nombreCompleto}*`,
      `📅 ${fecha}`,
      '',
      `💰 *Total cobrado: ${soles(r.total)}*`,
      ...r.porMetodo.map((m) => `${nombreMetodo(m.metodo)}: ${soles(m.monto)} (${m.operaciones})`),
      '',
      `🍽️ Pedidos cobrados: ${r.pedidos} · Platos: ${r.unidades}`,
      ...(r.platos.length ? ['', '*Más vendidos:*', ...r.platos.slice(0, 5).map((p) => `• ${p.qty}× ${p.nombre}`)] : []),
      ...(pendiente > 0.001 ? ['', `⏳ Pendiente de cobro: ${soles(pendiente)}`] : []),
    ].join('\n');
  }

  function abrirReporte() {
    const hoyClave = new Date().toDateString();
    const dias = new Map([[hoyClave, Date.now()]]);
    leerHistorial().forEach((e) => {
      const clave = new Date(e.ts).toDateString();
      if (!dias.has(clave)) dias.set(clave, e.ts);
    });
    const opciones = [...dias.entries()].sort((a, b) => b[1] - a[1]);
    let dia = hoyClave;
    let formato = store.get('reporte.formato', 'a4') === 'ticket' ? 'ticket' : 'a4';

    const hoja = abrirHoja({
      titulo: 'Reporte de ventas',
      subtitulo: 'Calculado con el historial de este celular',
      ancho: 'md:max-w-2xl',
      render(cuerpo, pie) {
        const r = calcularReporte(dia, dias.get(dia));
        cuerpo.innerHTML = `
          <div class="space-y-3 p-4 sm:p-5">
            <div class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              ${opciones.map(([clave, ts]) => `<button type="button" class="chip !py-1.5 text-xs capitalize" data-dia="${esc(clave)}" aria-pressed="${clave === dia}">${esc(etiquetaDia(ts))}</button>`).join('')}
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="texto-suave">Formato:</span>
              ${[['a4', '📄 Hoja A4'], ['ticket', '🧾 Ticket 80 mm']].map(([id, txt]) => `<button type="button" class="chip !py-1.5 text-xs" data-formato="${id}" aria-pressed="${formato === id}">${txt}</button>`).join('')}
            </div>
            <div class="rounded-2xl bg-white p-5 shadow-inner ring-1 ring-carbon-900/10 ${formato === 'ticket' ? 'mx-auto max-w-[300px] text-[12px]' : 'text-[14px]'}">
              ${htmlReporte(r)}
            </div>
          </div>`;
        pie.innerHTML = `
          <div class="flex gap-2.5 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
            <a href="https://wa.me/?text=${encodeURIComponent(textoReporte(r))}" target="_blank" rel="noopener" class="btn-secundario flex-1 text-sm">${ICONOS.whatsapp('h-5 w-5')} Enviar resumen</a>
            <button type="button" data-imprimir class="btn-primario flex-1">🖨️ Imprimir</button>
          </div>`;
      },
    });

    hoja.el.addEventListener('click', (e) => {
      const d = e.target.closest('[data-dia]');
      if (d) { dia = d.dataset.dia; hoja.refrescar(); return; }
      const f = e.target.closest('[data-formato]');
      if (f) { formato = f.dataset.formato; store.set('reporte.formato', formato); hoja.refrescar(); return; }
      if (e.target.closest('[data-imprimir]')) {
        const r = calcularReporte(dia, dias.get(dia));
        imprimirHTML(htmlReporte(r), formato === 'ticket'
          ? { clase: 'impresion-ticket', pagina: '80mm auto', margen: '3mm' }
          : { clase: 'impresion-a4', pagina: 'A4', margen: '14mm' });
      }
    });
  }

  /* =========================================================
   *  EVENTOS GENERALES
   * ========================================================= */
  raiz.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filtro]');
    if (f) { filtro = f.dataset.filtro; pintarResumen(); pintarGrid(); return; }
    const m = e.target.closest('[data-mesa], [data-abrir-mesa]');
    if (m) { abrirMesa(claveMesa(m.dataset.mesa || m.dataset.abrirMesa)); return; }
    const ap = e.target.closest('[data-abrir-pedido]');
    if (ap) {
      const corte = ap.dataset.abrirPedido.indexOf('|');
      abrirMesa(claveMesa(ap.dataset.abrirPedido.slice(0, corte)), ap.dataset.abrirPedido.slice(corte + 1));
      return;
    }
    if (e.target.closest('[data-marcar-vistos]')) {
      Object.values(mesas).forEach((mesa) => mesa.pedidos.forEach((p) => { if (p.visto === false) p.visto = true; }));
      guardar();
      refrescarTodo();
      return;
    }
    if (e.target.closest('[data-nuevo-delivery]')) { enviarLinkDelivery(); return; }
    if (e.target.closest('#ver-historial')) { abrirHistorial(); return; }
    if (e.target.closest('#menu-panel')) {
      const opcion = await menuAcciones({
        titulo: 'Panel del Mozo',
        acciones: [
          { id: 'delivery', texto: 'Enviar link de delivery', icono: '🛵' },
          { id: 'reporte', texto: 'Reporte de ventas (imprimir)', icono: '🧾' },
          { id: 'historial', texto: 'Historial (recuperar pedidos)', icono: ICONOS.historial() },
          { id: 'cierre', texto: 'Cerrar el día (limpiar todo)', icono: ICONOS.candado(), peligro: true },
        ],
      });
      if (opcion === 'delivery') enviarLinkDelivery();
      if (opcion === 'reporte') abrirReporte();
      if (opcion === 'historial') abrirHistorial();
      if (opcion === 'cierre') cerrarDia();
    }
  }, { signal });

  // Sincronización entre pestañas/ventanas del mismo dispositivo
  window.addEventListener('storage', (e) => {
    if (e.key === claveCompleta(CLAVE_MESAS)) mesas = store.get(CLAVE_MESAS, {}) || {};
    else if (e.key !== claveCompleta(CLAVE_HISTORIAL)) return;
    refrescarTodo();
  }, { signal });

  return () => { ac.abort(); clearInterval(intervalo); };
}

/** Cabecera de la cuenta y del reporte con los datos del local. */
function cabeceraLocal() {
  const l = CONFIG.local;
  const direccion = [l.direccion, CONFIG.ubicacion].filter(Boolean).join(' · ');
  const legal = [l.razonSocial, l.ruc && `RUC ${l.ruc}`].filter(Boolean).join(' · ');
  return `
    ${anteTitulo() ? `<p class="rep-marca">${esc(anteTitulo())}</p>` : ''}
    <p class="rep-nombre">${esc(CONFIG.nombreCorto)}</p>
    ${direccion ? `<p class="rep-sub">${esc(direccion)}</p>` : ''}
    ${l.telefono ? `<p class="rep-sub">Tel. ${esc(l.telefono)}</p>` : ''}
    ${legal ? `<p class="rep-sub">${esc(legal)}</p>` : ''}`;
}
