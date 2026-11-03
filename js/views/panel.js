/**
 * ============================================================
 *  PANEL DE GESTIÓN — Dueño (#/dueno) y Administrador (#/admin)
 * ============================================================
 *  Dueño:  Código del día · Carta · Local · Mozos · Yape/Plin · Mesas, QR y delivery · Accesos · Publicación
 *  Admin:  Código del día · Carta · Datos del local
 *
 *  Flujo de trabajo:
 *   1. Se cargan los datos publicados (desde GitHub si el dispositivo
 *      está conectado; si no, desde el sitio).
 *   2. Los cambios se acumulan en un BORRADOR (se recupera si se
 *      recarga la página; se descarta solo si lo publicado cambió).
 *   3. "Publicar" guarda data/menu.json y data/config.json en GitHub;
 *      GitHub Pages actualiza la web para todos en ≈ 1 minuto.
 */
import { CONFIG, anteTitulo } from '../config.js';
import { store, sesion } from '../store.js';
import { cargarDatos, normalizarDatos, establecerDatos } from '../menu.js';
import {
  conexion, puedePublicar, modoLocal, guardarConexion, olvidarConexion, repoPorDefecto, probarConexion, leerArchivo, escribirArchivo, urlBase,
} from '../github.js';
import { protegerConClave } from '../acceso.js';
import { normalizarCelular, formatoCelular } from '../codec.js';
import {
  generarCodigo, crearJornada, jornadaActiva, horaVence, proximoCierre, textoHorario, HORARIO_POR_DEFECTO,
} from '../jornada.js';
import { sha256 } from '../hash.js';
import { navegar } from '../router.js';
import {
  esc, pad2, normalizar, debounce, toast, abrirHoja, confirmar, imagenPlato, logotipo, botonTema, imprimirHTML, enlaceMapa, ICONOS,
} from '../ui.js';

const PESTAÑAS = {
  codigo: { nombre: 'Código del día', icono: '🔑' },
  carta: { nombre: 'Carta', icono: '🍽️' },
  local: { nombre: 'Datos del local', icono: '🏠' },
  mozos: { nombre: 'Mozos', icono: '🧑‍🍳' },
  pagos: { nombre: 'Yape / Plin', icono: '💳' },
  mesas: { nombre: 'Mesas, QR y delivery', icono: '🪑' },
  accesos: { nombre: 'Accesos', icono: '🔐' },
  conexion: { nombre: 'Publicación', icono: '☁️' },
};

const ROLES = {
  dueno: { titulo: 'Dueño', pestañas: ['codigo', 'carta', 'local', 'mozos', 'pagos', 'mesas', 'accesos', 'conexion'] },
  admin: { titulo: 'Admin', pestañas: ['codigo', 'carta', 'local'] },
};

const ETIQUETAS = [
  { id: 'picante', nombre: '🌶️ Picante' },
  { id: 'marino', nombre: '🐟 Marino' },
];

const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const MAX_MESAS = 99;

/* ---------- Utilidades puras ---------- */
const serializar = (o) => `${JSON.stringify(o, null, 2)}\n`;
const clonar = (o) => structuredClone(o);
const slug = (s) => normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plato';

/** Huella corta de un texto (djb2) para saber si el borrador sigue vigente. */
function huella(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}


/* =========================================================
 *  RUTAS
 * ========================================================= */
export async function vistaDueno(raiz) {
  await cargarDatos(true).catch(() => {});
  return protegerConClave({
    raiz,
    clave: 'panel.dueno',
    titulo: 'Panel del Dueño',
    texto: 'Acceso exclusivo: carta, mozos, mesas y claves.',
    hashes: [CONFIG.accesos.duenoHash],
    alAcceder: (r) => abrirPanel(r, 'dueno'),
  });
}

export async function vistaAdmin(raiz) {
  await cargarDatos(true).catch(() => {});
  return protegerConClave({
    raiz,
    clave: 'panel.admin',
    titulo: 'Administrador',
    texto: 'Ingresa la clave para editar la carta y los datos del local.',
    hashes: [CONFIG.accesos.adminHash, CONFIG.accesos.duenoHash],
    alAcceder: (r) => abrirPanel(r, 'admin'),
  });
}

/* =========================================================
 *  PANEL
 * ========================================================= */
async function abrirPanel(raiz, rol) {
  const ac = new AbortController();
  const { signal } = ac;
  const permitidas = ROLES[rol].pestañas;

  const E = {
    pestaña: permitidas[0],
    publicado: null,   // { menu, config, textoMenu, textoConfig }
    menu: null,        // borrador
    config: null,      // borrador
    busqueda: '',
    publicando: false,
    estadoDespliegue: null,
    vigilancia: null,
  };

  raiz.innerHTML = `<div class="grid min-h-[100dvh] place-items-center"><div class="skeleton h-14 w-14 rounded-2xl" aria-label="Cargando"></div></div>`;
  try {
    E.publicado = await cargarPublicado();
  } catch (err) {
    raiz.innerHTML = `<p class="p-10 text-center">No se pudieron cargar los datos: ${esc(err.message)}</p>`;
    return () => ac.abort();
  }

  /** Por qué este dispositivo no puede guardar cambios, y qué hacer. */
  const avisoSinPublicar = () => {
    if (modoLocal()) return 'En modo local se publica desde la PC del servidor: abre el panel en http://localhost.';
    return rol === 'dueno' ? 'Conecta este dispositivo con GitHub en la pestaña Publicación.' : 'Este dispositivo no puede publicar: pide al dueño que lo conecte.';
  };

  /* ---------- Datos publicados y borrador ---------- */
  async function cargarPublicado() {
    let datos = null;
    if (puedePublicar()) {
      // Con token se lee directo de GitHub: siempre lo último, sin esperar a Pages
      try {
        const [m, k] = await Promise.all([leerArchivo('data/menu.json'), leerArchivo('data/config.json')]);
        if (m) datos = normalizarDatos(JSON.parse(m.texto), k ? JSON.parse(k.texto) : {});
      } catch (err) {
        toast(`GitHub: ${err.message} Se usa la versión del sitio.`, 'aviso', 5000);
      }
    }
    if (!datos) datos = clonar(await cargarDatos(true));
    return instantanea(datos.menu, datos.config);
  }

  function instantanea(menu, config) {
    return { menu: clonar(menu), config: clonar(config), textoMenu: serializar(menu), textoConfig: serializar(config) };
  }

  const huellaBase = () => huella(E.publicado.textoMenu + E.publicado.textoConfig);

  function restaurarBorrador() {
    E.menu = clonar(E.publicado.menu);
    E.config = clonar(E.publicado.config);
    const b = store.get('panel.borrador');
    if (!b) return;
    if (b.huella === huellaBase()) {
      E.menu = b.menu;
      E.config = b.config;
      toast('Recuperamos tus cambios sin publicar', 'info');
    } else {
      store.remove('panel.borrador');
      toast('Se descartó un borrador antiguo: lo publicado cambió desde entonces.', 'aviso', 4500);
    }
  }

  function cambiosPendientes() {
    const r = [];
    if (serializar(E.menu) !== E.publicado.textoMenu) r.push('la carta');
    if (serializar(E.config) !== E.publicado.textoConfig) r.push('la configuración');
    return r;
  }

  function marcarCambio() {
    if (cambiosPendientes().length) {
      store.set('panel.borrador', { huella: huellaBase(), menu: E.menu, config: E.config, ts: Date.now() });
    } else {
      store.remove('panel.borrador');
    }
    pintarBarra();
  }

  /* ---------- Pintado general ---------- */
  function pintar() {
    raiz.querySelectorAll('[data-pestana]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pestana === E.pestaña)));
    const contenido = raiz.querySelector('#contenido');
    const vistas = { codigo: htmlCodigo, carta: htmlCarta, local: htmlLocal, mozos: htmlMozos, pagos: htmlPagos, mesas: htmlMesas, accesos: htmlAccesos, conexion: htmlConexion };
    contenido.innerHTML = vistas[E.pestaña]();
    if (E.pestaña === 'carta') pintarSecciones();
    if (E.pestaña === 'mesas') pintarQR();
  }

  function pintarBarra() {
    const barra = raiz.querySelector('#barra-publicar');
    if (!barra) return;
    const pendientes = cambiosPendientes();
    barra.classList.toggle('visible', pendientes.length > 0 || E.publicando || !!E.estadoDespliegue);
    barra.innerHTML = `
      <div class="mx-auto flex max-w-3xl items-center gap-2 rounded-[22px] bg-carbon-900 p-2.5 pl-5 text-white shadow-2xl shadow-carbon-950/40 ring-1 ring-white/10 dark:bg-crema-100 dark:text-carbon-950">
        <div class="min-w-0 flex-1 py-1">
          ${pendientes.length ? `
            <p class="text-sm font-bold"><span class="text-oro-400 dark:text-arcilla-600">●</span> Cambios sin publicar</p>
            <p class="truncate text-xs opacity-70">En ${pendientes.join(' y ')} · aún no los ven los clientes</p>`
          : `<p class="text-sm font-bold">${esc(E.estadoDespliegue || '')}</p>`}
        </div>
        ${pendientes.length ? `
          <button type="button" data-accion="descartar" class="shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold opacity-75 transition hover:opacity-100">Descartar</button>
          <button type="button" data-accion="publicar" class="btn-primario !min-h-[46px] shrink-0 !px-4 text-sm" ${E.publicando ? 'disabled' : ''}>
            ${E.publicando ? 'Publicando…' : `${ICONOS.subir('h-4 w-4')} Publicar`}
          </button>` : ''}
      </div>`;
  }

  const encabezado = (titulo, texto) => `
    <h1 class="font-display text-3xl font-bold sm:text-4xl">${titulo}</h1>
    <p class="texto-suave mt-1 text-sm">${texto}</p>`;

  /* =========================================================
   *  PESTAÑA: CARTA
   * ========================================================= */
  function htmlCarta() {
    return `
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>${encabezado('Carta', `${E.menu.platos.length} platos · ${E.menu.categorias.length} categorías`)}</div>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-accion="nuevo-plato" class="btn-primario !min-h-[44px] text-sm">${ICONOS.mas()} Nuevo plato</button>
          <button type="button" data-accion="categorias" class="btn-secundario !min-h-[44px] text-sm">Categorías</button>
          <button type="button" data-accion="ir-extras" class="btn-secundario !min-h-[44px] text-sm">✍️ Extras</button>
          <button type="button" data-accion="descargar" class="btn-secundario !min-h-[44px] text-sm" title="Descargar respaldo JSON">${ICONOS.descargar()}</button>
        </div>
      </div>
      <label class="relative mt-5 block">
        <span class="sr-only">Buscar plato</span>
        <span class="texto-suave pointer-events-none absolute left-4 top-3.5">${ICONOS.buscar()}</span>
        <input id="buscar-plato" type="search" value="${esc(E.busqueda)}" placeholder="Buscar plato…" class="campo !rounded-full !pl-12">
      </label>
      <div id="secciones" class="mt-6 space-y-10"></div>
      ${htmlExtrasFrecuentes()}`;
  }

  /** Extras con precio fijo que el mozo agrega con un toque (no aparecen en la carta del cliente). */
  function htmlExtrasFrecuentes() {
    return `
      <section id="extras-frecuentes" class="mt-10 scroll-mt-40 rounded-3xl bg-oro-400/10 p-4 ring-1 ring-oro-500/30 sm:p-5">
        <h2 class="font-display text-2xl font-bold">✍️ Extras frecuentes</h2>
        <p class="texto-suave mt-1 text-sm">Solo para mozos: aparecen como botones en «Fuera de carta» del panel del mozo. Los clientes no los ven.</p>
        <div class="mt-4 space-y-2">
          ${E.menu.extras.map((x, i) => `
            <div data-frecuente="${i}" class="flex items-center gap-2">
              <input data-frec-campo="nombre" value="${esc(x.nombre)}" maxlength="50" placeholder="Descripción (ej. Porción de arroz)" aria-label="Descripción del extra" class="campo min-w-0 flex-1 !py-2.5">
              <div class="relative w-28 shrink-0">
                <span class="texto-suave pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold">${CONFIG.moneda}</span>
                <input data-frec-campo="precio" type="number" inputmode="decimal" min="0" step="0.5" value="${x.precio || ''}" placeholder="0.00" aria-label="Precio del extra" class="campo !py-2.5 !pl-9 font-bold tabular-nums">
              </div>
              <button type="button" data-borrar-frecuente class="btn-icono !h-10 !w-10" aria-label="Eliminar extra">${ICONOS.basura('h-4 w-4')}</button>
            </div>`).join('') || '<p class="texto-suave text-sm">Aún no hay extras. Agrega los que más piden: porción de arroz, huevo frito, táper…</p>'}
        </div>
        <button type="button" data-accion="nuevo-frecuente" class="btn-secundario mt-3 w-full !min-h-[44px] text-sm">${ICONOS.mas('h-4 w-4')} Agregar extra</button>
      </section>`;
  }

  function pintarSecciones() {
    const q = normalizar(E.busqueda);
    const html = E.menu.categorias.map((c) => {
      const platos = E.menu.platos.filter((p) => p.cat === c.id && (!q || normalizar(p.nombre).includes(q)));
      if (q && !platos.length) return '';
      return `
        <section>
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="font-display text-2xl font-bold">${esc(c.icono)} ${esc(c.nombre)} <span class="texto-suave font-sans text-sm font-medium">(${platos.length})</span></h2>
            <button type="button" data-nuevo-plato="${esc(c.id)}" class="chip !py-1.5 text-xs">${ICONOS.mas('h-4 w-4')} Plato</button>
          </div>
          <div class="space-y-2.5">
            ${platos.map(filaPlato).join('') || '<p class="texto-suave rounded-2xl border border-dashed border-carbon-900/15 p-4 text-center text-sm dark:border-white/15">Sin platos en esta categoría.</p>'}
          </div>
        </section>`;
    }).join('');
    raiz.querySelector('#secciones').innerHTML = html || '<p class="texto-suave py-10 text-center">Sin resultados.</p>';
  }

  function filaPlato(p) {
    return `
      <article data-plato-id="${esc(p.id)}" class="superficie flex flex-wrap items-center gap-3 rounded-2xl p-3 transition ${p.activo ? '' : 'opacity-60'}">
        <div class="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">${imagenPlato(p)}</div>
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold">${esc(p.nombre)} ${p.especialidad ? '<span class="text-oro-500" title="Especialidad de la Casa">★</span>' : ''}</p>
          <p class="texto-suave truncate text-xs">${esc(p.desc)}</p>
        </div>
        <div class="flex w-full items-center gap-2 sm:w-auto">
          <div class="relative w-28 shrink-0">
            <span class="texto-suave pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold">${CONFIG.moneda}</span>
            <input data-precio type="number" inputmode="decimal" min="0" step="0.5" value="${p.precio}" aria-label="Precio de ${esc(p.nombre)}" class="campo !py-2 !pl-9 font-bold tabular-nums">
          </div>
          <button type="button" role="switch" data-activo aria-checked="${p.activo}" class="flex items-center gap-2 px-1 text-sm font-semibold">
            <span class="switch" aria-checked="${p.activo}"></span><span data-etiqueta-activo class="w-16 text-left">${p.activo ? 'Activo' : 'Agotado'}</span>
          </button>
          <button type="button" data-editar class="btn-icono ml-auto !h-10 !w-10" aria-label="Editar ${esc(p.nombre)}">${ICONOS.nota('h-4 w-4')}</button>
        </div>
      </article>`;
  }

  function nuevoIdPlato(cat) {
    const prefijo = (cat || 'x').charAt(0).toLowerCase();
    const usados = new Set(E.menu.platos.map((p) => p.id));
    let n = 1;
    while (usados.has(`${prefijo}${n}`)) n += 1;
    return `${prefijo}${n}`;
  }

  /** Hoja con todos los campos de un plato (nuevo o existente). */
  function editarPlato(id, catNueva) {
    const existente = E.menu.platos.find((p) => p.id === id);
    const cat = catNueva || E.menu.categorias[0]?.id;
    const p = existente ? clonar(existente) : {
      id: nuevoIdPlato(cat), cat, nombre: '', desc: '', precio: 0, img: '', especialidad: false, activo: true, tags: [],
    };
    p.tags = p.tags || [];

    const hoja = abrirHoja({
      titulo: existente ? 'Editar plato' : 'Nuevo plato',
      subtitulo: existente ? `Código ${p.id}` : 'Se agrega a la carta al publicar',
      ancho: 'md:max-w-2xl',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <div class="grid gap-4 p-5 sm:grid-cols-2">
            <div class="flex items-center gap-4 sm:col-span-2">
              <div id="foto-previa" class="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl">${imagenPlato(p)}</div>
              <div class="min-w-0 flex-1 space-y-2">
                <label class="btn-secundario !min-h-[44px] cursor-pointer text-sm">${ICONOS.subir()} Subir foto
                  <input id="subir-foto" type="file" accept="image/*" class="sr-only">
                </label>
                <input name="img" value="${esc(p.img)}" placeholder="img/mi-plato.jpg" aria-label="Ruta de la imagen" class="campo !py-2 font-mono text-xs">
              </div>
            </div>
            <label class="sm:col-span-2"><span class="text-sm font-semibold">Nombre</span>
              <input name="nombre" maxlength="60" value="${esc(p.nombre)}" class="campo mt-1"></label>
            <label class="sm:col-span-2"><span class="text-sm font-semibold">Descripción</span>
              <textarea name="desc" rows="3" maxlength="180" class="campo mt-1 resize-none">${esc(p.desc)}</textarea></label>
            <label><span class="text-sm font-semibold">Precio (${CONFIG.moneda})</span>
              <input name="precio" type="number" min="0" step="0.5" inputmode="decimal" value="${p.precio}" class="campo mt-1 font-bold"></label>
            <label><span class="text-sm font-semibold">Categoría</span>
              <select name="cat" class="campo mt-1">
                ${E.menu.categorias.map((c) => `<option value="${esc(c.id)}" ${c.id === p.cat ? 'selected' : ''}>${esc(c.icono)} ${esc(c.nombre)}</option>`).join('')}
              </select></label>
            <div class="sm:col-span-2">
              <p class="mb-2 text-sm font-semibold">Etiquetas (para los filtros)</p>
              <div class="flex flex-wrap gap-2">
                ${ETIQUETAS.map((t) => `<button type="button" class="chip" data-etiqueta="${t.id}" aria-pressed="${p.tags.includes(t.id)}">${t.nombre}</button>`).join('')}
              </div>
            </div>
            <div class="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-2">
              <button type="button" role="switch" data-bool="activo" aria-checked="${p.activo}" class="flex items-center gap-2 text-sm font-semibold">
                <span class="switch" aria-checked="${p.activo}"></span>Disponible (no agotado)</button>
              <button type="button" role="switch" data-bool="especialidad" aria-checked="${!!p.especialidad}" class="flex items-center gap-2 text-sm font-semibold">
                <span class="switch oro" aria-checked="${!!p.especialidad}"></span>Especialidad de la Casa</button>
            </div>
          </div>`;
        pie.innerHTML = `
          <div class="flex gap-3 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
            ${existente ? `<button type="button" data-eliminar class="btn-secundario !px-4 !text-red-600" aria-label="Eliminar plato">${ICONOS.basura()}</button>` : ''}
            <button type="button" data-cerrar-hoja class="btn-secundario flex-1">Cancelar</button>
            <button type="button" data-guardar class="btn-primario flex-1">Guardar</button>
          </div>`;
      },
    });

    const campo = (n) => hoja.el.querySelector(`[name="${n}"]`);

    hoja.el.addEventListener('change', (e) => {
      if (e.target.id === 'subir-foto' && e.target.files?.[0]) subirFoto(e.target.files[0], hoja, campo);
    });

    hoja.el.addEventListener('click', async (e) => {
      const etiqueta = e.target.closest('[data-etiqueta]');
      if (etiqueta) { etiqueta.setAttribute('aria-pressed', String(etiqueta.getAttribute('aria-pressed') !== 'true')); return; }

      const bool = e.target.closest('[data-bool]');
      if (bool) {
        const v = bool.getAttribute('aria-checked') !== 'true';
        bool.setAttribute('aria-checked', String(v));
        bool.querySelector('.switch').setAttribute('aria-checked', String(v));
        return;
      }

      if (e.target.closest('[data-guardar]')) {
        const nombre = campo('nombre').value.trim();
        const precio = Math.round(parseFloat(campo('precio').value) * 100) / 100;
        if (!nombre) { toast('Escribe el nombre del plato', 'error'); campo('nombre').focus(); return; }
        if (!Number.isFinite(precio) || precio < 0) { toast('Precio no válido', 'error'); campo('precio').focus(); return; }
        const datos = {
          ...p,
          nombre,
          precio,
          desc: campo('desc').value.trim(),
          img: campo('img').value.trim(),
          cat: campo('cat').value,
          tags: [...hoja.el.querySelectorAll('[data-etiqueta][aria-pressed="true"]')].map((b) => b.dataset.etiqueta),
          activo: hoja.el.querySelector('[data-bool="activo"]').getAttribute('aria-checked') === 'true',
          especialidad: hoja.el.querySelector('[data-bool="especialidad"]').getAttribute('aria-checked') === 'true',
        };
        if (existente) Object.assign(existente, datos);
        else E.menu.platos.push({ ...datos, id: nuevoIdPlato(datos.cat) }); // el código sigue a la categoría elegida
        marcarCambio();
        pintar();
        hoja.cerrar();
        toast(`${nombre} guardado · recuerda Publicar`, 'ok');
        return;
      }

      if (e.target.closest('[data-eliminar]')) {
        const ok = await confirmar(`Se quitará "${p.nombre}" de la carta (al publicar).`, { titulo: 'Eliminar plato', textoOk: 'Eliminar', peligro: true });
        if (!ok) return;
        E.menu.platos = E.menu.platos.filter((x) => x.id !== p.id);
        marcarCambio();
        pintar();
        hoja.cerrar();
      }
    });
  }

  /** Reduce la foto (máx. 1200 px, JPEG) y la sube a img/platos/ en GitHub. */
  async function subirFoto(archivo, hoja, campo) {
    if (!puedePublicar()) { toast(avisoSinPublicar(), 'aviso', 5000); return; }
    const previa = hoja.el.querySelector('#foto-previa');
    previa.classList.add('skeleton');
    toast('Subiendo foto…', 'info', 2000);
    try {
      const { bytes, url } = await prepararFoto(archivo);
      const nombre = campo('nombre').value.trim() || 'plato';
      const ruta = `img/platos/${slug(nombre)}-${Date.now().toString(36)}.jpg`;
      await escribirArchivo(ruta, bytes, `Panel: foto de ${nombre}`);
      campo('img').value = ruta;
      previa.innerHTML = `<img src="${url}" alt="" class="h-full w-full object-cover">`;
      toast('Foto subida ✓ — pulsa Guardar y luego Publicar', 'ok', 4000);
    } catch (err) {
      toast(err.message || 'No se pudo subir la foto', 'error', 5000);
    } finally {
      previa.classList.remove('skeleton');
    }
  }

  /** Hoja para renombrar, ordenar, crear y borrar categorías. */
  function editarCategorias() {
    const hoja = abrirHoja({
      titulo: 'Categorías',
      subtitulo: 'Nombre, ícono y orden en la carta',
      render(cuerpo, pie) {
        cuerpo.innerHTML = `
          <ul class="space-y-2 p-4">
            ${E.menu.categorias.map((c, i) => {
              const usados = E.menu.platos.filter((p) => p.cat === c.id).length;
              return `
                <li data-cat-idx="${i}" class="superficie flex items-center gap-2 rounded-2xl p-2">
                  <input data-cat-campo="icono" value="${esc(c.icono)}" maxlength="4" aria-label="Ícono" class="campo !w-14 shrink-0 !px-1 !py-2 text-center text-lg">
                  <input data-cat-campo="nombre" value="${esc(c.nombre)}" maxlength="40" aria-label="Nombre" class="campo min-w-0 flex-1 !py-2">
                  <div class="flex shrink-0 flex-col">
                    <button type="button" data-mover="-1" ${i === 0 ? 'disabled' : ''} class="h-6 w-8 rounded text-xs disabled:opacity-25" aria-label="Subir">▲</button>
                    <button type="button" data-mover="1" ${i === E.menu.categorias.length - 1 ? 'disabled' : ''} class="h-6 w-8 rounded text-xs disabled:opacity-25" aria-label="Bajar">▼</button>
                  </div>
                  <button type="button" data-borrar-cat ${usados ? `disabled title="Tiene ${usados} plato(s)"` : ''} class="btn-icono !h-10 !w-10 disabled:opacity-30" aria-label="Eliminar categoría">${ICONOS.basura('h-4 w-4')}</button>
                </li>`;
            }).join('')}
          </ul>
          <p class="texto-suave px-5 pb-4 text-xs">Solo se puede eliminar una categoría vacía.</p>`;
        pie.innerHTML = `
          <div class="flex gap-3 border-t border-carbon-900/5 px-5 py-4 dark:border-white/5">
            <button type="button" data-nueva-cat class="btn-secundario flex-1">${ICONOS.mas()} Nueva</button>
            <button type="button" data-cerrar-hoja class="btn-primario flex-1">Listo</button>
          </div>`;
      },
      alCerrar: () => pintar(),
    });

    hoja.el.addEventListener('input', (e) => {
      const input = e.target.closest('[data-cat-campo]');
      if (!input) return;
      E.menu.categorias[+input.closest('[data-cat-idx]').dataset.catIdx][input.dataset.catCampo] = input.value;
      marcarCambio();
    });

    hoja.el.addEventListener('click', (e) => {
      const fila = e.target.closest('[data-cat-idx]');
      const i = fila ? +fila.dataset.catIdx : -1;
      const mover = e.target.closest('[data-mover]');
      if (mover) {
        const j = i + Number(mover.dataset.mover);
        const cats = E.menu.categorias;
        [cats[i], cats[j]] = [cats[j], cats[i]];
      } else if (e.target.closest('[data-borrar-cat]')) {
        E.menu.categorias.splice(i, 1);
      } else if (e.target.closest('[data-nueva-cat]')) {
        E.menu.categorias.push({ id: `cat-${Date.now().toString(36)}`, nombre: 'Nueva categoría', icono: '🍴' });
      } else return;
      marcarCambio();
      hoja.refrescar();
      if (e.target.closest('[data-nueva-cat]')) hoja.el.querySelector('li:last-child [data-cat-campo="nombre"]')?.select();
    });
  }

  /* =========================================================
   *  PESTAÑA: CÓDIGO DEL DÍA (apertura de la jornada)
   * ========================================================= */
  // El código en texto SOLO vive en el dispositivo que lo generó; en el repo va su huella.
  const codigoLocal = (j = E.config.jornada) => {
    const g = store.get('jornada.admin', null);
    return j && g?.id === j.id ? g.codigo : null;
  };
  const enviadosA = (j = E.config.jornada) => {
    const g = store.get('jornada.enviados', null);
    return new Set(j && g?.id === j.id ? g.ids : []);
  };
  const formatoCodigo = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;

  function mensajeCodigo(mozo, codigo) {
    return [
      `🔑 *Código del día · ${E.config.local.nombre}*`,
      '',
      `Hola ${mozo.nombre}, el código de hoy es:`,
      `*${formatoCodigo(codigo)}*`,
      `Vence: ${horaVence(E.config.jornada)}`,
      '',
      `1️⃣ Entra a tu panel e ingrésalo: ${urlBase()}#/mozo`,
      '2️⃣ Cuando un cliente te lo pida por WhatsApp, respóndele con este código.',
      '',
      '⚠️ No lo publiques ni lo reenvíes a grupos.',
    ].join('\n');
  }

  function htmlCodigo() {
    const j = E.config.jornada;
    const activa = jornadaActiva(j);
    const publicada = E.publicado.config.jornada?.id === j?.id;
    const codigo = activa ? codigoLocal(j) : null;
    const enviados = enviadosA(j);
    return `
      ${encabezado('Código del día', 'Sin este código los clientes solo ven la carta y los mozos no pueden usar su panel.')}
      <section class="mt-6 overflow-hidden rounded-3xl ${activa ? 'bg-carbon-900 text-white dark:bg-carbon-800' : 'superficie'} p-5 sm:p-6">
        <p class="flex items-center gap-2 text-sm font-semibold">
          <span class="h-2.5 w-2.5 rounded-full ${activa ? 'animate-pulse bg-palma-400' : 'bg-stone-400'}"></span>
          ${activa
            ? `Día abierto · desde ${new Date(j.abierta).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} · vence ${horaVence(j)}`
            : 'Día cerrado: los clientes solo pueden ver la carta.'}
        </p>
        ${activa && !publicada ? '<p class="mt-2 rounded-xl bg-oro-400/20 px-3 py-2 text-sm font-semibold text-oro-200">⏳ Falta publicar: el código aún no funciona. Pulsa «Publicar» abajo.</p>' : ''}
        ${activa ? (codigo ? `
          <div class="mt-5 text-center">
            <p class="text-xs font-bold uppercase tracking-[0.3em] text-white/60">Código de hoy</p>
            <p class="mt-1 select-all font-mono text-6xl font-black tracking-[0.15em] text-oro-300 sm:text-7xl">${formatoCodigo(codigo)}</p>
            <button type="button" data-copiar="${codigo}" class="mt-3 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">Copiar</button>
          </div>` : `
          <p class="mt-4 rounded-2xl bg-white/10 p-4 text-sm">Este código se generó en otro dispositivo y aquí no se puede ver (en el repositorio solo se guarda su huella). Si no lo tienes a mano, pulsa <b>Cambiar código</b> y envía el nuevo a los mozos.</p>`) : ''}
        <div class="mt-5 flex flex-wrap gap-2">
          ${activa ? `
            <button type="button" data-accion="nuevo-codigo" class="btn-secundario !min-h-[44px] flex-1 text-sm ${activa ? '!bg-white/10 !text-white' : ''}">🔄 Cambiar código</button>
            <button type="button" data-accion="cerrar-dia" class="btn-secundario !min-h-[44px] flex-1 text-sm !bg-red-500/15 !text-red-300">Cerrar el día</button>`
          : `<button type="button" data-accion="abrir-dia" class="btn-primario w-full text-base" ${E.publicando ? 'disabled' : ''}>🔑 Abrir el día · generar código</button>`}
        </div>
      </section>

      ${htmlHorario(activa)}

      ${activa && codigo ? `
        <section class="superficie mt-4 rounded-3xl p-5">
          <h2 class="text-lg font-semibold">Enviar a los mozos por WhatsApp</h2>
          <p class="texto-suave text-sm">Toca cada mozo que trabaja hoy. Solo a ellos les llega el código.</p>
          <ul class="mt-3 divide-y divide-carbon-900/5 dark:divide-white/5">
            ${E.config.mozos.map((m) => {
              const tel = /^\d{9}$/.test(m.telefono) ? m.telefono : '';
              const ya = enviados.has(m.id);
              return `
                <li class="flex items-center gap-3 py-3">
                  <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-arcilla-400 to-arcilla-700 font-display font-black italic text-white">${esc((m.nombre || '?').charAt(0))}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold">${esc(m.nombre)}</p>
                    <p class="texto-suave font-mono text-xs">${tel ? `+${CONFIG.prefijoPais} ${esc(tel)}` : 'Sin WhatsApp válido'}</p>
                  </div>
                  ${tel ? `<a data-enviar-codigo="${m.id}" href="https://wa.me/${CONFIG.prefijoPais}${tel}?text=${encodeURIComponent(mensajeCodigo(m, codigo))}" target="_blank" rel="noopener"
                      class="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold ${ya ? 'bg-palma-500/15 text-palma-600 dark:text-palma-400' : 'bg-[#25D366] text-white'}">
                      ${ya ? '✓ Enviado' : `${ICONOS.whatsapp('h-4 w-4')} Enviar`}</a>` : ''}
                </li>`;
            }).join('')}
          </ul>
        </section>` : ''}

      <section class="superficie mt-4 rounded-3xl p-5 text-sm leading-relaxed">
        <h2 class="text-lg font-semibold">Cómo funciona</h2>
        <ol class="mt-2 list-decimal space-y-1.5 pl-5">
          <li><b>Abre el día</b>: se genera un código de 6 dígitos y se publica (≈ 1 minuto en activarse).</li>
          <li>Envíalo a cada mozo por WhatsApp. El mozo lo ingresa para usar su panel.</li>
          <li>El cliente elige mesa y mozo, le pide el código por WhatsApp y lo ingresa para poder pedir. Sin código solo ve la carta.</li>
          <li>Cada pedido viaja firmado con el código: el panel del mozo rechaza pedidos falsos o de enlaces filtrados.</li>
          <li>El día <b>se cierra solo</b> a la hora de cierre del horario (por defecto 6:00 a. m.), aunque nadie lo cierre. Si el código se filtró, pulsa <b>Cambiar código</b>: el anterior deja de servir.</li>
        </ol>
      </section>`;
  }

  /** Horario de atención de la jornada: el día se cierra solo a la hora de cierre. */
  function htmlHorario(activa) {
    const h = E.config.horario;
    const cambiado = JSON.stringify(h) !== JSON.stringify(E.publicado.config.horario);
    const porDefecto = h.inicio === HORARIO_POR_DEFECTO.inicio && h.cierre === HORARIO_POR_DEFECTO.cierre;
    return `
      <section class="superficie mt-4 rounded-3xl p-5" id="horario-jornada">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">⏰ Horario de atención</h2>
            <p class="texto-suave text-sm">Si nadie cierra el día, <b>se cierra solo</b> a la hora de cierre (hora de Perú).</p>
          </div>
          ${cambiado ? '<span class="shrink-0 rounded-full bg-oro-400/20 px-2.5 py-1 text-xs font-bold">Por publicar</span>' : ''}
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3">
          <label class="block"><span class="texto-suave text-xs font-semibold">Abre</span>
            <input type="time" data-horario="inicio" value="${h.inicio}" class="campo mt-1 !py-2.5 text-lg font-bold tabular-nums"></label>
          <label class="block"><span class="texto-suave text-xs font-semibold">Cierre automático</span>
            <input type="time" data-horario="cierre" value="${h.cierre}" class="campo mt-1 !py-2.5 text-lg font-bold tabular-nums"></label>
        </div>
        <p data-texto-horario class="mt-3 text-sm font-semibold">🕒 ${textoHorario(h)}</p>
        <p class="texto-suave mt-1 text-xs">
          ${activa ? `Cierre automático del día abierto: <b>${new Date(E.config.jornada.vence).toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'long', hour: '2-digit', minute: '2-digit' })}</b>` : 'Se aplica al abrir el día.'}
          ${porDefecto ? '' : '<button type="button" data-accion="horario-defecto" class="ml-1 font-semibold text-arcilla-600 underline underline-offset-4 dark:text-oro-300">Volver a 6:00 → 6:00</button>'}
        </p>
      </section>`;
  }

  /** Cambia el horario; si hay un día abierto, su cierre automático se recalcula. */
  function cambiarHorario(campo, valor) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) return;
    E.config.horario = { ...E.config.horario, [campo]: valor };
    const j = E.config.jornada;
    if (j && campo === 'cierre') E.config.jornada = { ...j, vence: proximoCierre(j.abierta, valor) };
    marcarCambio();
  }

  /** Abre (o rota) el día: genera código, guarda su huella en el borrador y publica. */
  async function abrirDia(rotar = false) {
    if (!puedePublicar()) { toast(avisoSinPublicar(), 'aviso', 5000); return; }
    const otros = cambiosPendientes().length;
    const aviso = [
      rotar ? 'El código actual dejará de funcionar y tendrás que enviar el nuevo a los mozos.' : 'Se generará el código de hoy y se publicará.',
      otros ? 'También se publicarán los otros cambios que tienes sin publicar.' : '',
    ].filter(Boolean).join(' ');
    if (!await confirmar(aviso, { titulo: rotar ? 'Cambiar código' : 'Abrir el día', textoOk: rotar ? 'Cambiar' : 'Abrir el día', peligro: rotar })) return;
    const codigo = generarCodigo();
    const j = await crearJornada(codigo, Date.now(), E.config.horario);
    store.set('jornada.admin', { id: j.id, codigo });
    E.config.jornada = j;
    marcarCambio();
    pintar();
    await publicar();
    pintar();
  }

  async function cerrarDia() {
    const ok = await confirmar('El código dejará de funcionar: los clientes solo podrán ver la carta y los mozos no podrán usar su panel hasta que abras otro día.', { titulo: 'Cerrar el día', textoOk: 'Cerrar el día', peligro: true });
    if (!ok) return;
    E.config.jornada = null;
    marcarCambio();
    pintar();
    if (puedePublicar()) { await publicar(); pintar(); }
  }

  /* =========================================================
   *  PESTAÑA: DATOS DEL LOCAL
   * ========================================================= */
  const GRUPOS_LOCAL = [
    {
      titulo: '🏷️ Identidad',
      texto: 'Cómo se llama el local en la carta, el WhatsApp, la cuenta y los QR.',
      campos: [
        { id: 'nombre', etiqueta: 'Nombre completo', max: 60, ancho: 2, placeholder: 'Ej. Restaurante La Esquina', requerido: true },
        { id: 'nombreCorto', etiqueta: 'Nombre destacado del logotipo', max: 24, placeholder: 'Ej. La Esquina', ayuda: 'Va en letras grandes; el resto del nombre aparece encima, pequeño.' },
        { id: 'eslogan', etiqueta: 'Frase de bienvenida', max: 120, placeholder: 'Ej. Sabor de casa, todos los días.' },
        { id: 'logo', etiqueta: 'Imagen del logotipo', max: 200, placeholder: 'Ej. img/logo.jpg', ayuda: 'Ruta dentro del proyecto. Vacío = logotipo con letras.' },
        { id: 'foto', etiqueta: 'Foto de fondo de la bienvenida', max: 200, placeholder: 'Ej. img/local.jpg', ayuda: 'Vacío = fondo oscuro.' },
      ],
    },
    {
      titulo: '📍 Ubicación',
      texto: 'Se muestra al cliente con un botón «Cómo llegar».',
      campos: [
        { id: 'direccion', etiqueta: 'Dirección', max: 100, ancho: 2, placeholder: 'Ej. Av. Principal 123' },
        { id: 'referencia', etiqueta: 'Referencia', max: 100, placeholder: 'Ej. Frente a la plaza de armas' },
        { id: 'ciudad', etiqueta: 'Distrito · Provincia', max: 50, placeholder: 'Ej. Distrito · Provincia' },
        { id: 'mapa', etiqueta: 'Ubicación en Google Maps', max: 300, ancho: 2, placeholder: 'Pega el enlace de Google Maps o las coordenadas', tipo: 'url', mapa: true },
      ],
    },
    {
      titulo: '☎️ Contacto y horario',
      campos: [
        { id: 'telefono', etiqueta: 'Teléfono / WhatsApp del local', max: 20, placeholder: 'Ej. 987 654 321', tipo: 'tel' },
        { id: 'horario', etiqueta: 'Horario de atención (texto)', max: 80, placeholder: 'Vacío = el de «Código del día» (6:00 a. m. – 6:00 a. m.)', ayuda: 'Solo es el texto que ve el cliente. El cierre automático se configura en 🔑 Código del día.' },
        { id: 'facebook', etiqueta: 'Facebook', max: 120, placeholder: 'Enlace de la página', tipo: 'url' },
        { id: 'instagram', etiqueta: 'Instagram', max: 120, placeholder: 'Ej. @milocal', tipo: 'url' },
      ],
    },
    {
      titulo: '🌐 Sitio web',
      campos: [
        { id: 'urlPublica', etiqueta: 'Dirección pública', max: 200, ancho: 2, placeholder: 'Ej. https://www.milocal.com/', tipo: 'url', ayuda: 'Solo si usas un dominio propio. Vacío = se deduce (red local o GitHub Pages).' },
      ],
    },
    {
      titulo: '🧾 Datos para la cuenta',
      texto: 'Aparecen en la cabecera de la cuenta impresa.',
      campos: [
        { id: 'razonSocial', etiqueta: 'Razón social', max: 80, placeholder: 'Opcional' },
        { id: 'ruc', etiqueta: 'RUC', max: 11, placeholder: '11 dígitos (opcional)', numerico: true },
      ],
    },
  ];

  function htmlLocal() {
    const l = E.config.local;
    const campo = (c) => `
      <label class="block ${c.ancho === 2 ? 'sm:col-span-2' : ''}">
        <span class="texto-suave text-xs font-semibold">${c.etiqueta}${c.requerido ? ' *' : ''}</span>
        ${c.mapa ? `
          <div class="mt-1 flex gap-2">
            <input data-local-campo="${c.id}" value="${esc(l[c.id])}" maxlength="${c.max}" placeholder="${esc(c.placeholder)}" autocomplete="off" inputmode="url" class="campo min-w-0 flex-1 !py-2.5">
            <button type="button" data-accion="mi-ubicacion" class="btn-secundario !min-h-[46px] shrink-0 !px-3 text-sm" title="Usar la ubicación de este celular">📍<span class="hidden sm:inline">Estoy aquí</span></button>
          </div>
          <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span class="texto-suave">En Google Maps: busca el local → Compartir → Copiar enlace. O pulsa 📍 estando en el local.</span>
            <a data-probar-mapa href="${esc(enlaceMapa(l.mapa) || '#')}" target="_blank" rel="noopener" class="${enlaceMapa(l.mapa) ? '' : 'hidden'} font-semibold text-arcilla-600 underline underline-offset-4 dark:text-oro-300">Abrir en el mapa ↗</a>
          </span>`
        : `<input data-local-campo="${c.id}" value="${esc(l[c.id])}" maxlength="${c.max}" placeholder="${esc(c.placeholder)}" autocomplete="off"
            ${c.numerico ? 'inputmode="numeric"' : c.tipo === 'tel' ? 'inputmode="tel"' : c.tipo === 'url' ? 'inputmode="url"' : ''} class="campo mt-1 !py-2.5">`}
        ${c.ayuda ? `<span class="texto-suave mt-1 block text-xs">${c.ayuda}</span>` : ''}
      </label>`;
    return `
      ${encabezado('Datos del local', 'Se actualizan en la carta, el WhatsApp de pedidos, la cuenta y los QR al publicar.')}
      <section class="mt-6 overflow-hidden rounded-3xl bg-carbon-900 p-5 text-center text-white">
        <p class="texto-suave mb-2 text-left text-[10px] font-bold uppercase tracking-widest !text-white/50">Vista previa</p>
        <div id="vista-local">${vistaPreviaLocal()}</div>
      </section>
      <div class="mt-4 space-y-4">
        ${GRUPOS_LOCAL.map((g) => `
          <section class="superficie rounded-3xl p-5">
            <h2 class="text-lg font-semibold">${g.titulo}</h2>
            ${g.texto ? `<p class="texto-suave text-sm">${g.texto}</p>` : ''}
            <div class="mt-4 grid gap-3 sm:grid-cols-2">${g.campos.map(campo).join('')}</div>
          </section>`).join('')}
      </div>`;
  }

  /** Logotipo y datos tal como los verá el cliente (con los valores del borrador). */
  function vistaPreviaLocal() {
    const l = E.config.local;
    const corto = l.nombreCorto.trim() || l.nombre.trim();
    const i = l.nombre.toLowerCase().lastIndexOf(corto.toLowerCase());
    const ante = corto && i >= 0 ? (l.nombre.slice(0, i) + l.nombre.slice(i + corto.length)).replace(/\s+/g, ' ').trim() : l.nombre;
    const linea = [l.direccion, l.ciudad].filter((x) => x.trim()).join(' · ');
    return `
      ${ante ? `<p class="text-[11px] font-semibold uppercase tracking-[0.45em] text-oro-300">${esc(ante)}</p>` : ''}
      <p class="font-display text-5xl font-black italic leading-tight text-oro-300">${esc(corto || 'Tu local')}</p>
      ${l.eslogan.trim() ? `<p class="mx-auto mt-2 max-w-xs text-sm text-white/80">${esc(l.eslogan)}</p>` : ''}
      ${linea ? `<p class="mt-3 text-xs text-white/70">📍 ${esc(linea)}</p>` : ''}
      ${l.referencia.trim() ? `<p class="text-xs text-white/50">${esc(l.referencia)}</p>` : ''}
      ${l.horario.trim() ? `<p class="mt-1 text-xs text-white/70">🕒 ${esc(l.horario)}</p>` : ''}`;
  }
  const repintarVistaLocal = debounce(() => {
    const v = raiz.querySelector('#vista-local');
    if (v) v.innerHTML = vistaPreviaLocal();
  }, 150);

  function usarMiUbicacion(boton) {
    if (!navigator.geolocation) { toast('Este navegador no puede leer la ubicación.', 'error'); return; }
    boton.disabled = true;
    toast('Buscando tu ubicación…', 'info', 2500);
    navigator.geolocation.getCurrentPosition((pos) => {
      boton.disabled = false;
      const { latitude: la, longitude: lo } = pos.coords;
      E.config.local.mapa = `https://www.google.com/maps?q=${la.toFixed(6)},${lo.toFixed(6)}`;
      marcarCambio();
      pintar();
      toast('Ubicación lista ✓ — revisa en el mapa y publica', 'ok', 4000);
    }, (err) => {
      boton.disabled = false;
      toast(err.code === 1 ? 'Permite el acceso a la ubicación para usar esta opción.' : 'No se pudo obtener la ubicación.', 'error', 5000);
    }, { enableHighAccuracy: true, timeout: 15000 });
  }

  /* =========================================================
   *  PESTAÑA: MOZOS
   * ========================================================= */
  const enlacePrueba = (tel) => `https://wa.me/${CONFIG.prefijoPais}${tel}?text=${encodeURIComponent(`✅ Prueba del sistema de pedidos de ${E.config.local.nombre}`)}`;

  function htmlMozos() {
    return `
      ${encabezado('Mozos', 'El cliente elige a uno al entrar y su pedido llega a ese WhatsApp.')}
      <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        ${E.config.mozos.map((m, i) => {
          const valido = /^\d{9}$/.test(m.telefono);
          return `
            <div data-mozo-idx="${i}" class="superficie rounded-3xl p-4">
              <div class="flex items-center gap-3">
                <span class="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-arcilla-400 to-arcilla-700 font-display text-lg font-black italic text-white">${esc((m.nombre || '?').charAt(0))}</span>
                <span class="texto-suave font-mono text-xs">ID ${m.id}</span>
                <button type="button" data-borrar-mozo ${E.config.mozos.length <= 1 ? 'disabled' : ''} class="btn-icono ml-auto !h-10 !w-10 disabled:opacity-30" aria-label="Eliminar mozo">${ICONOS.basura('h-4 w-4')}</button>
              </div>
              <label class="texto-suave mt-3 block text-xs font-semibold">Nombre</label>
              <input data-mozo-campo="nombre" value="${esc(m.nombre)}" maxlength="24" class="campo mt-1 !py-2.5">
              <label class="texto-suave mt-3 block text-xs font-semibold">WhatsApp</label>
              <div class="mt-1 flex gap-2">
                <span class="campo !w-auto shrink-0 !px-3 !py-2.5 font-mono texto-suave">+${CONFIG.prefijoPais}</span>
                <input data-mozo-campo="telefono" value="${esc(m.telefono)}" inputmode="numeric" maxlength="9" placeholder="9 dígitos" class="campo !py-2.5 font-mono">
              </div>
              <p data-aviso-tel class="mt-1 text-xs font-semibold text-red-600 dark:text-red-400 ${valido ? 'hidden' : ''}">Debe tener 9 dígitos</p>
              <a data-probar href="${enlacePrueba(m.telefono)}" target="_blank" rel="noopener" class="btn-secundario mt-3 w-full !min-h-[40px] text-sm">${ICONOS.whatsapp('h-4 w-4')} Probar WhatsApp</a>
            </div>`;
        }).join('')}
        <button type="button" data-accion="nuevo-mozo" class="texto-suave grid min-h-[220px] place-items-center rounded-3xl border-2 border-dashed border-carbon-900/15 font-semibold transition hover:border-arcilla-500 hover:text-arcilla-600 dark:border-white/15">
          <span class="flex flex-col items-center gap-2">${ICONOS.mas('h-7 w-7')} Agregar mozo</span>
        </button>
      </div>`;
  }

  /* =========================================================
   *  PESTAÑA: PAGOS (Yape / Plin)
   * ========================================================= */
  const BILLETERAS = [
    { id: 'yape', nombre: 'Yape', icono: '💜', ayuda: 'En la app Yape: menú → «Mi QR» → descargar o compartir la imagen.' },
    { id: 'plin', nombre: 'Plin', icono: '💙', ayuda: 'En la app de tu banco con Plin: «Mi QR» → descargar o compartir.' },
  ];
  const vistasQR = new Map(); // QR recién subidos: vista previa local mientras GitHub Pages publica

  function htmlPagos() {
    return `
      ${encabezado('Yape y Plin', 'Aparecen en la cuenta que se imprime o envía al cliente, y al cobrar con Yape o Plin.')}
      <div class="mt-6 space-y-4">
        ${BILLETERAS.map((b) => {
          const d = E.config.pagos[b.id];
          const valido = !d.numero || /^\d{9}$/.test(d.numero);
          const vista = vistasQR.get(b.id) || d.qr;
          return `
            <section class="superficie rounded-3xl p-5" data-billetera="${b.id}">
              <h2 class="text-lg font-semibold">${b.icono} ${b.nombre}</h2>
              <div class="mt-4 grid gap-5 sm:grid-cols-[1fr_auto]">
                <div class="space-y-3">
                  <label class="block"><span class="texto-suave text-xs font-semibold">Número (9 dígitos)</span>
                    <input data-pago-campo="numero" value="${esc(d.numero)}" inputmode="numeric" maxlength="9" placeholder="987654321" autocomplete="off" class="campo mt-1 !py-2.5 font-mono"></label>
                  <p data-aviso-pago class="text-xs font-semibold text-red-600 dark:text-red-400 ${valido ? 'hidden' : ''}">Debe tener 9 dígitos</p>
                  <label class="block"><span class="texto-suave text-xs font-semibold">Titular (como aparece en ${b.nombre})</span>
                    <input data-pago-campo="titular" value="${esc(d.titular)}" maxlength="40" placeholder="Ej. Juan Pérez" autocomplete="off" class="campo mt-1 !py-2.5"></label>
                  <p class="texto-suave text-xs">${b.ayuda}</p>
                </div>
                <div class="flex flex-col items-center gap-2">
                  <div class="grid h-40 w-40 place-items-center overflow-hidden rounded-2xl bg-white p-2 ring-1 ring-carbon-900/10">
                    ${vista ? `<img src="${esc(vista)}" alt="QR de ${b.nombre}" class="h-full w-full object-contain">` : '<span class="text-center text-xs text-carbon-700/60">Sin QR</span>'}
                  </div>
                  <label class="btn-secundario !min-h-[40px] cursor-pointer text-sm">${ICONOS.subir('h-4 w-4')} ${d.qr ? 'Cambiar QR' : 'Subir QR'}
                    <input data-subir-qr type="file" accept="image/*" class="sr-only">
                  </label>
                  ${d.qr ? '<button type="button" data-quitar-qr class="text-xs font-semibold text-red-600 underline-offset-4 hover:underline dark:text-red-400">Quitar QR</button>' : ''}
                </div>
              </div>
            </section>`;
        }).join('')}
      </div>`;
  }

  async function subirQR(billetera, archivo) {
    if (!puedePublicar()) { toast(avisoSinPublicar(), 'aviso', 5000); return; }
    toast('Subiendo QR…', 'info', 2000);
    try {
      // PNG sin pérdida para que el código siga siendo fácil de escanear
      const { bytes, url } = await prepararFoto(archivo, { max: 900, tipo: 'image/png' });
      const ruta = `img/pagos/${billetera}-qr-${Date.now().toString(36)}.png`;
      await escribirArchivo(ruta, bytes, `Panel: QR de ${billetera}`);
      E.config.pagos[billetera].qr = ruta;
      vistasQR.set(billetera, url);
      marcarCambio();
      pintar();
      toast('QR subido ✓ — pulsa Publicar para activarlo', 'ok', 4000);
    } catch (err) {
      toast(err.message || 'No se pudo subir el QR', 'error', 5000);
    }
  }

  /* =========================================================
   *  PESTAÑA: MESAS Y QR
   * ========================================================= */
  function htmlMesas() {
    return `
      ${encabezado('Mesas, QR y delivery', 'Cada QR abre la carta con la mesa ya seleccionada. El link de delivery se envía al cliente por WhatsApp.')}
      <section class="superficie mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5">
        <div>
          <h2 class="text-lg font-semibold">Número de mesas</h2>
          <p class="texto-suave text-sm">Se usa en la bienvenida del cliente y en el panel del mozo.</p>
        </div>
        <div class="inline-flex items-center rounded-full bg-carbon-900/5 p-1 dark:bg-white/10">
          <button type="button" data-mesas-delta="-1" class="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm active:scale-90 dark:bg-carbon-700" aria-label="Una mesa menos">${ICONOS.menos('h-4 w-4')}</button>
          <input id="input-mesas" type="number" min="1" max="${MAX_MESAS}" value="${E.config.totalMesas}" aria-label="Número de mesas" class="w-16 bg-transparent text-center text-xl font-bold tabular-nums outline-none">
          <button type="button" data-mesas-delta="1" class="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm active:scale-90 dark:bg-carbon-700" aria-label="Una mesa más">${ICONOS.mas('h-4 w-4')}</button>
        </div>
      </section>
      ${htmlLinkDelivery()}
      <section class="mt-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2 class="font-display text-2xl font-bold">Códigos QR</h2>
            <p class="texto-suave break-all font-mono text-xs">${esc(urlBase())}?mesa=N</p>
          </div>
          <button type="button" data-accion="imprimir-qr" class="btn-primario !min-h-[44px] text-sm">🖨️ Imprimir todos</button>
        </div>
        <div id="grid-qr" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"></div>
        <p class="texto-suave mt-4 text-xs">Si agregas mesas, publica antes de imprimir sus QR: la carta solo acepta mesas publicadas.</p>
      </section>`;
  }

  /* ---------- Link de delivery (mismo formato que el panel del mozo) ---------- */
  const del = { tel: '', nombre: '', mozoId: store.get('delivery.mozo', null) };
  // Solo mozos ya publicados: un mozo nuevo sin publicar aún no existe para el cliente
  const mozosDelivery = () => E.publicado.config.mozos.filter((m) => /^\d{9}$/.test(m.telefono));
  const mozoDelivery = () => mozosDelivery().find((m) => m.id === del.mozoId) || mozosDelivery()[0];
  const celularDel = () => normalizarCelular(del.tel);
  const urlDelivery = () => `${urlBase()}?delivery=${celularDel()}&m=${mozoDelivery()?.id}`;
  /** Código del día para incluir en el mensaje (solo si este dispositivo lo generó y está publicado). */
  const codigoParaDelivery = () => {
    const j = E.publicado.config.jornada;
    return jornadaActiva(j) ? codigoLocal(j) : null;
  };
  const mensajeDelivery = () => {
    const codigo = codigoParaDelivery();
    return [
      `🛵 ¡Hola${del.nombre.trim() ? ` ${del.nombre.trim()}` : ''}! Haz tu pedido de *${E.publicado.config.local.nombre}* desde aquí:`,
      '',
      urlDelivery(),
      '',
      ...(codigo ? [`🔑 Tu código para pedir hoy: *${formatoCodigo(codigo)}*`, ''] : []),
      `Elige tus platos, escribe tu dirección${codigo ? ' e ingresa el código' : ''}. Tu pedido le llegará a ${mozoDelivery()?.nombre || 'nuestro mozo'} por WhatsApp. ¡Te lo llevamos! 🍽️`,
    ].join('\n');
  };
  const enlaceWspDelivery = () => `https://wa.me/${CONFIG.prefijoPais}${celularDel()}?text=${encodeURIComponent(mensajeDelivery())}`;

  function htmlLinkDelivery() {
    const lista = mozosDelivery();
    const ok = !!celularDel() && !!mozoDelivery();
    const abierto = jornadaActiva(E.publicado.config.jornada);
    const codigo = codigoParaDelivery();
    return `
      <section id="link-delivery" class="superficie mt-4 rounded-3xl p-5">
        <h2 class="text-lg font-semibold">🛵 Link de delivery</h2>
        <p class="texto-suave text-sm">El cliente abre el link, escribe su dirección y su pedido llega al WhatsApp del mozo elegido.</p>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="block"><span class="texto-suave text-xs font-semibold">Celular del cliente *</span>
            <div class="mt-1 flex gap-2">
              <span class="campo !w-auto shrink-0 !px-3 !py-2.5 font-mono texto-suave">+${CONFIG.prefijoPais}</span>
              <input data-del-campo="tel" value="${esc(del.tel)}" inputmode="tel" maxlength="15" placeholder="987 654 321" autocomplete="off" class="campo !py-2.5 font-mono">
            </div>
            <span data-del-aviso class="mt-1 block text-xs font-semibold text-red-600 dark:text-red-400 ${!del.tel || celularDel() ? 'hidden' : ''}">Celular de 9 dígitos que empiece con 9</span>
          </label>
          <label class="block"><span class="texto-suave text-xs font-semibold">Nombre del cliente (opcional)</span>
            <input data-del-campo="nombre" value="${esc(del.nombre)}" maxlength="30" placeholder="Para el saludo" autocomplete="off" class="campo mt-1 !py-2.5"></label>
        </div>
        <p class="texto-suave mt-4 text-xs font-semibold">El pedido llegará a</p>
        <div class="mt-2 flex flex-wrap gap-2">
          ${lista.map((m) => `<button type="button" class="chip" data-del-mozo="${m.id}" aria-pressed="${m.id === mozoDelivery()?.id}">${esc(m.nombre)} <span class="texto-suave font-mono text-xs">m=${m.id}</span></button>`).join('')
            || '<p class="text-sm font-semibold text-red-600 dark:text-red-400">No hay mozos publicados con WhatsApp válido.</p>'}
        </div>
        <p data-del-vista class="texto-suave mt-4 break-all rounded-2xl bg-carbon-900/5 p-3 font-mono text-xs dark:bg-white/10">${ok ? esc(urlDelivery()) : `${esc(urlBase())}?delivery=<span class="text-arcilla-600 dark:text-oro-300">CELULAR</span>&amp;m=${mozoDelivery()?.id ?? 'MOZO'}`}</p>
        <p class="mt-2 text-xs ${abierto ? 'texto-suave' : 'font-semibold text-arcilla-600 dark:text-oro-300'}">
          ${!abierto ? '⚠️ El día no está abierto: el cliente solo podrá ver la carta. Ábrelo en «Código del día».'
            : codigo ? `🔑 El mensaje incluye el código de hoy (${formatoCodigo(codigo)}).`
            : 'ℹ️ El código de hoy se generó en otro dispositivo: el mensaje no lo incluye; el cliente se lo pedirá al mozo.'}
        </p>
        <div class="mt-3 flex gap-2">
          <button type="button" data-del-copiar class="btn-secundario !min-h-[46px] shrink-0 !px-4 text-sm" ${ok ? '' : 'disabled'}>Copiar link</button>
          <a data-del-enviar href="${ok ? esc(enlaceWspDelivery()) : '#'}" target="_blank" rel="noopener" aria-disabled="${!ok}"
            class="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-bold text-white shadow-lg shadow-[#25D366]/30 transition active:scale-[.98] aria-disabled:pointer-events-none aria-disabled:opacity-50">
            ${ICONOS.whatsapp('h-5 w-5')} Enviar por WhatsApp
          </a>
        </div>
      </section>`;
  }

  /** Actualiza vista previa y botones sin repintar (no se pierde el foco al escribir). */
  function refrescarLinkDelivery() {
    const caja = raiz.querySelector('#link-delivery');
    if (!caja) return;
    const ok = !!celularDel() && !!mozoDelivery();
    caja.querySelector('[data-del-aviso]').classList.toggle('hidden', !del.tel || !!celularDel() || del.tel.replace(/\D/g, '').length < 9);
    caja.querySelector('[data-del-vista]').textContent = ok ? urlDelivery() : `${urlBase()}?delivery=CELULAR&m=${mozoDelivery()?.id ?? 'MOZO'}`;
    caja.querySelector('[data-del-copiar]').disabled = !ok;
    const a = caja.querySelector('[data-del-enviar]');
    a.href = ok ? enlaceWspDelivery() : '#';
    a.setAttribute('aria-disabled', String(!ok));
  }

  let promesaQR = null;
  function cargarLibQR() {
    promesaQR ??= new Promise((ok, mal) => {
      if (window.qrcode) { ok(window.qrcode); return; }
      const s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = () => ok(window.qrcode);
      s.onerror = () => { promesaQR = null; mal(new Error('No se pudo cargar el generador de QR (¿sin internet?)')); };
      document.head.appendChild(s);
    });
    return promesaQR;
  }

  function svgQR(qrcode, texto) {
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  const urlMesa = (n) => `${urlBase()}?mesa=${n}`;

  async function pintarQR() {
    const grid = raiz.querySelector('#grid-qr');
    if (!grid) return;
    grid.innerHTML = '<div class="skeleton aspect-square rounded-2xl"></div>'.repeat(Math.min(E.config.totalMesas, 10));
    try {
      const qrcode = await cargarLibQR();
      if (!raiz.querySelector('#grid-qr')) return; // se cambió de pestaña
      grid.innerHTML = Array.from({ length: E.config.totalMesas }, (_, i) => i + 1).map((n) => `
        <figure class="superficie rounded-2xl p-3 text-center">
          <div class="mx-auto aspect-square w-full max-w-[170px] rounded-xl bg-white p-1 [&>svg]:h-full [&>svg]:w-full">${svgQR(qrcode, urlMesa(n))}</div>
          <figcaption class="mt-2 font-display text-xl font-bold">Mesa ${pad2(n)}</figcaption>
        </figure>`).join('');
    } catch (err) {
      grid.innerHTML = `<p class="col-span-full text-sm text-red-600">${esc(err.message)}</p>`;
    }
  }
  const repintarQR = debounce(pintarQR, 400);

  async function imprimirQR() {
    let qrcode;
    try { qrcode = await cargarLibQR(); } catch (err) { toast(err.message, 'error'); return; }
    const html = Array.from({ length: E.config.totalMesas }, (_, i) => i + 1).map((n) => `
      <div class="qr-tarjeta">
        ${anteTitulo() ? `<p class="qr-marca">${esc(anteTitulo())}</p>` : ''}
        <p class="qr-nombre">${esc(CONFIG.nombreCorto)}</p>
        ${svgQR(qrcode, urlMesa(n))}
        <p class="qr-mesa">Mesa ${pad2(n)}</p>
        <p class="qr-ayuda">Escanea para ver la carta y hacer tu pedido</p>
      </div>`).join('');
    imprimirHTML(html, { clase: 'hoja-qr', pagina: 'A4', margen: '8mm' });
  }

  /* =========================================================
   *  PESTAÑA: ACCESOS
   * ========================================================= */
  function htmlAccesos() {
    const tarjeta = (campo, titulo, texto, opcional) => {
      const activa = !!E.config.accesos[campo];
      const cambiada = E.config.accesos[campo] !== E.publicado.config.accesos[campo];
      return `
        <section class="superficie rounded-3xl p-5" data-acceso="${campo}">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">${titulo}</h2>
              <p class="texto-suave text-sm">${texto}</p>
            </div>
            <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${activa ? 'bg-palma-500/15 text-palma-600 dark:text-palma-400' : 'bg-carbon-900/10 texto-suave dark:bg-white/10'}">
              ${cambiada ? 'Por publicar' : activa ? 'Con clave' : 'Sin clave'}
            </span>
          </div>
          <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input type="password" data-clave-nueva placeholder="${opcional ? 'Nuevo PIN' : 'Nueva clave'}" autocomplete="new-password" class="campo !py-2.5">
            <input type="password" data-clave-repetir placeholder="Repetir" autocomplete="new-password" class="campo !py-2.5">
            <button type="button" data-cambiar-clave class="btn-primario !min-h-[44px] text-sm">Cambiar</button>
          </div>
          ${opcional && activa ? '<button type="button" data-quitar-clave class="mt-3 text-sm font-semibold text-red-600 underline-offset-4 hover:underline dark:text-red-400">Quitar PIN (entrar sin clave)</button>' : ''}
        </section>`;
    };
    const enlaces = [
      ['Carta para clientes', ''],
      ['Panel del mozo', '#/mozo'],
      ['Administrador (solo carta)', '#/admin'],
      ['Panel del dueño', '#/dueno'],
    ];
    return `
      ${encabezado('Accesos', 'Las claves nuevas se activan al publicar. Mínimo 4 caracteres.')}
      <div class="mt-6 space-y-4">
        ${tarjeta('duenoHash', 'Panel del Dueño', 'Tu acceso exclusivo a todo el sistema.', false)}
        ${tarjeta('adminHash', 'Administrador', 'Para quien edita la carta (precios, agotados). No ve mozos, mesas ni claves.', false)}
        ${tarjeta('mozoHash', 'Panel del Mozo (PIN opcional)', 'Si lo activas, el panel de mesas pedirá este PIN. Tu clave de dueño también lo abre.', true)}
      </div>
      <section class="superficie mt-6 rounded-3xl p-5">
        <h2 class="text-lg font-semibold">Enlaces de acceso</h2>
        <ul class="mt-2 divide-y divide-carbon-900/5 dark:divide-white/5">
          ${enlaces.map(([nombre, hash]) => `
            <li class="flex items-center gap-3 py-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold">${nombre}</p>
                <p class="texto-suave truncate font-mono text-xs">${esc(urlBase() + hash)}</p>
              </div>
              <button type="button" data-copiar="${esc(urlBase() + hash)}" class="chip !py-1.5 text-xs">Copiar</button>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  /* =========================================================
   *  PESTAÑA: PUBLICACIÓN (conexión con GitHub)
   * ========================================================= */
  function htmlConexion() {
    if (modoLocal()) {
      return `
        ${encabezado('Publicación', 'Modo local: al pulsar Publicar, los cambios se guardan en la carpeta del proyecto, sin GitHub.')}
        <section class="superficie mt-6 rounded-3xl p-5 text-sm leading-relaxed">
          <p class="flex items-center gap-2 font-semibold">
            <span class="h-2.5 w-2.5 rounded-full ${puedePublicar() ? 'bg-palma-500' : 'bg-stone-400'}"></span>
            ${puedePublicar() ? 'Esta PC puede publicar' : 'Este dispositivo solo puede ver: se publica desde la PC del servidor'}
          </p>
          <p class="mt-3">Los celulares de la misma red entran por <code class="rounded bg-black/5 px-1 font-mono dark:bg-white/10">${esc(urlBase())}</code>. Los QR y enlaces ya apuntan a esa dirección.</p>
        </section>`;
    }
    const c = conexion() || { ...repoPorDefecto(), token: '' };
    return `
      ${encabezado('Publicación', 'Al pulsar Publicar, los cambios se guardan en tu repositorio de GitHub y la web se actualiza sola en ≈ 1 minuto.')}
      <section class="superficie mt-6 rounded-3xl p-5">
        <p class="flex items-center gap-2 text-sm font-semibold">
          <span class="h-2.5 w-2.5 rounded-full ${c.token ? 'bg-palma-500' : 'bg-stone-400'}"></span>
          ${c.token ? 'Este dispositivo está conectado y puede publicar' : 'Este dispositivo aún no está conectado'}
        </p>
        <form id="form-conexion" class="mt-4 grid gap-3 sm:grid-cols-2">
          <label><span class="text-sm font-semibold">Usuario de GitHub</span>
            <input name="owner" value="${esc(c.owner)}" required autocomplete="off" class="campo mt-1 !py-2.5 font-mono"></label>
          <label><span class="text-sm font-semibold">Repositorio</span>
            <input name="repo" value="${esc(c.repo)}" required autocomplete="off" class="campo mt-1 !py-2.5 font-mono"></label>
          <label><span class="text-sm font-semibold">Rama</span>
            <input name="rama" value="${esc(c.rama || 'main')}" required autocomplete="off" class="campo mt-1 !py-2.5 font-mono"></label>
          <label><span class="text-sm font-semibold">Token de acceso</span>
            <input name="token" type="password" value="${esc(c.token)}" required placeholder="github_pat_…" autocomplete="off" class="campo mt-1 !py-2.5 font-mono"></label>
          <div class="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" class="btn-primario !min-h-[44px] text-sm">Guardar y probar</button>
            ${c.token ? '<button type="button" data-accion="olvidar-token" class="btn-secundario !min-h-[44px] text-sm">Desconectar este dispositivo</button>' : ''}
          </div>
        </form>
      </section>
      <section class="superficie mt-6 rounded-3xl p-5 text-sm leading-relaxed">
        <h2 class="text-lg font-semibold">Cómo crear el token (una sola vez)</h2>
        <ol class="mt-3 list-decimal space-y-2 pl-5">
          <li>Con tu cuenta de GitHub abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" class="font-semibold text-arcilla-600 underline underline-offset-4 dark:text-oro-300">Fine-grained personal access token</a>.</li>
          <li><b>Token name:</b> Panel de la carta · <b>Expiration:</b> la que prefieras (p. ej. 1 año).</li>
          <li><b>Repository access:</b> Only select repositories → <code class="rounded bg-black/5 px-1 dark:bg-white/10">${esc(c.repo)}</code>.</li>
          <li><b>Permissions → Repository permissions → Contents:</b> Read and write.</li>
          <li>Pulsa <b>Generate token</b>, cópialo y pégalo arriba.</li>
        </ol>
        <p class="mt-4 rounded-2xl bg-oro-400/15 p-3 ring-1 ring-oro-500/30">🔒 El token se guarda <b>solo en este dispositivo</b>; nunca se sube a la web. No lo compartas. Si pierdes el teléfono, revócalo en GitHub → Settings → Developer settings → Personal access tokens.</p>
      </section>`;
  }

  /* =========================================================
   *  PUBLICAR
   * ========================================================= */
  function validar() {
    const p = [];
    if (!E.menu.categorias.length) p.push('Debe haber al menos una categoría.');
    E.menu.categorias.forEach((c) => { if (!c.nombre.trim()) p.push('Hay una categoría sin nombre.'); });
    E.menu.platos.forEach((x) => {
      if (!x.nombre.trim()) p.push(`El plato ${x.id} no tiene nombre.`);
      if (!(x.precio >= 0)) p.push(`Precio no válido en "${x.nombre}".`);
      if (!E.menu.categorias.some((c) => c.id === x.cat)) p.push(`"${x.nombre}" no tiene una categoría válida.`);
    });
    if (!E.config.mozos.length) p.push('Debe haber al menos un mozo.');
    E.menu.extras.forEach((x) => {
      if (!x.nombre.trim()) p.push('Hay un extra frecuente sin descripción.');
      else if (!(x.precio > 0)) p.push(`El extra "${x.nombre}" necesita un precio mayor a cero.`);
    });
    E.config.mozos.forEach((m) => {
      if (!m.nombre.trim()) p.push('Hay un mozo sin nombre.');
      if (!/^\d{9}$/.test(m.telefono)) p.push(`El WhatsApp de ${m.nombre || 'un mozo'} debe tener 9 dígitos.`);
    });
    if (!E.config.local.nombre.trim()) p.push('Escribe el nombre del local (Datos del local).');
    if (E.config.local.ruc && !/^\d{11}$/.test(E.config.local.ruc)) p.push('El RUC debe tener 11 dígitos.');
    if (E.config.local.mapa && !enlaceMapa(E.config.local.mapa)) p.push('La ubicación de Google Maps no es un enlace válido.');
    if (!(E.config.totalMesas >= 1 && E.config.totalMesas <= MAX_MESAS)) p.push(`El número de mesas debe estar entre 1 y ${MAX_MESAS}.`);
    if (!E.config.accesos.duenoHash || !E.config.accesos.adminHash) p.push('El dueño y el administrador deben tener clave.');
    Object.entries(E.config.pagos).forEach(([id, d]) => {
      if (d.numero && !/^\d{9}$/.test(d.numero)) p.push(`El número de ${id === 'yape' ? 'Yape' : 'Plin'} debe tener 9 dígitos.`);
    });
    return p;
  }

  /** Texto normalizado de un archivo tal como está en GitHub (para detectar conflictos). */
  function textoNormalizado(ruta, texto) {
    const json = JSON.parse(texto);
    const d = ruta.endsWith('menu.json') ? normalizarDatos(json, E.publicado.config) : normalizarDatos(E.publicado.menu, json);
    return serializar(ruta.endsWith('menu.json') ? d.menu : d.config);
  }

  async function publicar() {
    const problemas = validar();
    if (problemas.length) { toast(problemas[0], 'error', 5000); return; }
    if (!puedePublicar()) {
      if (rol === 'dueno' && !modoLocal()) {
        E.pestaña = 'conexion';
        pintar();
      }
      toast(avisoSinPublicar(), 'aviso', 5500);
      return;
    }

    E.publicando = true;
    pintarBarra();
    try {
      const archivos = [
        { ruta: 'data/menu.json', datos: E.menu, clave: 'Menu' },
        { ruta: 'data/config.json', datos: E.config, clave: 'Config' },
      ];
      for (const { ruta, datos, clave } of archivos) {
        const texto = serializar(datos);
        if (texto === E.publicado[`texto${clave}`]) continue;
        const actual = await leerArchivo(ruta);
        if (actual && textoNormalizado(ruta, actual.texto) !== E.publicado[`texto${clave}`]) {
          const ok = await confirmar(`${ruta} fue modificado después de abrir el panel. ¿Reemplazarlo con tu versión?`, { titulo: 'Archivo modificado', textoOk: 'Reemplazar', peligro: true });
          if (!ok) throw new Error('Publicación cancelada.');
        }
        await escribirArchivo(ruta, texto, `Panel ${rol === 'dueno' ? 'del dueño' : 'admin'}: actualiza ${ruta.split('/').pop()}`, actual?.sha);
        // Se actualiza la instantánea archivo por archivo (si falla el segundo, el primero ya cuenta)
        E.publicado[clave === 'Menu' ? 'menu' : 'config'] = clonar(datos);
        E.publicado[`texto${clave}`] = texto;
      }
      store.remove('panel.borrador');
      establecerDatos(clonar(E.menu), clonar(E.config));
      if (modoLocal()) {
        toast('¡Guardado! Ya está disponible para clientes y mozos.', 'ok', 4000);
      } else {
        toast('¡Publicado! La web se actualiza en ≈ 1 minuto.', 'ok', 4000);
        vigilarDespliegue();
      }
      if (E.pestaña === 'accesos') pintar();
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      E.publicando = false;
      pintarBarra();
    }
  }

  /** Consulta el sitio cada 10 s hasta que GitHub Pages sirve la versión nueva. */
  function vigilarDespliegue() {
    clearInterval(E.vigilancia);
    const esperado = E.publicado.textoMenu + E.publicado.textoConfig;
    const inicio = Date.now();
    const terminar = (texto) => {
      clearInterval(E.vigilancia);
      E.estadoDespliegue = texto;
      pintarBarra();
      setTimeout(() => { E.estadoDespliegue = null; pintarBarra(); }, 7000);
    };
    E.estadoDespliegue = '⏳ Actualizando la web… (≈ 1 minuto)';
    pintarBarra();
    E.vigilancia = setInterval(async () => {
      try {
        const [m, k] = await Promise.all(['data/menu.json', 'data/config.json']
          .map((r) => fetch(`${r}?t=${Date.now()}`, { cache: 'no-store' }).then((x) => x.json())));
        const d = normalizarDatos(m, k);
        if (serializar(d.menu) + serializar(d.config) === esperado) terminar('✅ Los clientes ya ven los cambios');
        else if (Date.now() - inicio > 5 * 60000) terminar('Publicado. La web puede tardar unos minutos más.');
      } catch { /* se reintenta en el siguiente ciclo */ }
    }, 10000);
  }

  /* =========================================================
   *  EVENTOS
   * ========================================================= */
  raiz.addEventListener('click', async (e) => {
    const t = e.target;

    const pestaña = t.closest('[data-pestana]');
    if (pestaña) { E.pestaña = pestaña.dataset.pestana; pintar(); window.scrollTo({ top: 0 }); return; }

    const accion = t.closest('[data-accion]')?.dataset.accion;
    if (accion && accion !== 'tema') {
      switch (accion) {
        case 'publicar': publicar(); break;
        case 'descartar':
          if (await confirmar('Se perderán todos los cambios que no publicaste.', { titulo: 'Descartar cambios', textoOk: 'Descartar', peligro: true })) {
            E.menu = clonar(E.publicado.menu);
            E.config = clonar(E.publicado.config);
            marcarCambio();
            pintar();
          }
          break;
        case 'nuevo-plato': editarPlato(null, null); break;
        case 'categorias': editarCategorias(); break;
        case 'descargar':
          descargarJSON('menu.json', E.menu);
          if (rol === 'dueno') descargarJSON('config.json', E.config);
          break;
        case 'ir-extras':
          raiz.querySelector('#extras-frecuentes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        case 'nuevo-frecuente':
          E.menu.extras.push({ id: `x${Date.now().toString(36)}`, nombre: '', precio: 0 });
          marcarCambio();
          pintar();
          raiz.querySelector('[data-frecuente]:last-of-type [data-frec-campo="nombre"]')?.focus();
          break;
        case 'nuevo-mozo':
          E.config.mozos.push({ id: Math.max(0, ...E.config.mozos.map((m) => m.id)) + 1, nombre: '', telefono: '' });
          marcarCambio();
          pintar();
          raiz.querySelector('[data-mozo-idx]:last-of-type [data-mozo-campo="nombre"]')?.focus();
          break;
        case 'imprimir-qr': imprimirQR(); break;
        case 'mi-ubicacion': usarMiUbicacion(t.closest('[data-accion]')); break;
        case 'abrir-dia': abrirDia(false); break;
        case 'nuevo-codigo': abrirDia(true); break;
        case 'cerrar-dia': cerrarDia(); break;
        case 'horario-defecto':
          E.config.horario = { ...HORARIO_POR_DEFECTO };
          if (E.config.jornada) E.config.jornada = { ...E.config.jornada, vence: proximoCierre(E.config.jornada.abierta, HORARIO_POR_DEFECTO.cierre) };
          marcarCambio();
          pintar();
          break;
        case 'olvidar-token':
          if (await confirmar('Este dispositivo ya no podrá publicar hasta que vuelvas a pegar el token.', { titulo: 'Desconectar', textoOk: 'Desconectar', peligro: true })) {
            olvidarConexion();
            pintar();
          }
          break;
        default: break;
      }
      return;
    }

    // --- Carta: filas de platos ---
    const fila = t.closest('[data-plato-id]');
    if (fila) {
      const plato = E.menu.platos.find((p) => p.id === fila.dataset.platoId);
      if (t.closest('[data-editar]')) { editarPlato(plato.id); return; }
      const sw = t.closest('[data-activo]');
      if (sw) {
        plato.activo = !plato.activo;
        sw.setAttribute('aria-checked', String(plato.activo));
        sw.querySelector('.switch').setAttribute('aria-checked', String(plato.activo));
        sw.querySelector('[data-etiqueta-activo]').textContent = plato.activo ? 'Activo' : 'Agotado';
        fila.classList.toggle('opacity-60', !plato.activo);
        marcarCambio();
      }
      return;
    }
    const nuevo = t.closest('[data-nuevo-plato]');
    if (nuevo) { editarPlato(null, nuevo.dataset.nuevoPlato); return; }

    // --- Mozos ---
    const borrarFrecuente = t.closest('[data-borrar-frecuente]');
    if (borrarFrecuente) {
      E.menu.extras.splice(+borrarFrecuente.closest('[data-frecuente]').dataset.frecuente, 1);
      marcarCambio();
      pintar();
      return;
    }

    const borrarMozo = t.closest('[data-borrar-mozo]');
    if (borrarMozo) {
      const i = +borrarMozo.closest('[data-mozo-idx]').dataset.mozoIdx;
      const m = E.config.mozos[i];
      if (await confirmar(`${m.nombre || 'Este mozo'} dejará de aparecer para los clientes (al publicar).`, { titulo: 'Eliminar mozo', textoOk: 'Eliminar', peligro: true })) {
        E.config.mozos.splice(i, 1);
        marcarCambio();
        pintar();
      }
      return;
    }

    // --- Pagos ---
    const quitarQR = t.closest('[data-quitar-qr]');
    if (quitarQR) {
      const id = quitarQR.closest('[data-billetera]').dataset.billetera;
      E.config.pagos[id].qr = '';
      vistasQR.delete(id);
      marcarCambio();
      pintar();
      return;
    }

    // --- Link de delivery ---
    const delMozo = t.closest('[data-del-mozo]');
    if (delMozo) {
      del.mozoId = +delMozo.dataset.delMozo;
      store.set('delivery.mozo', del.mozoId);
      raiz.querySelectorAll('[data-del-mozo]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.delMozo === del.mozoId)));
      refrescarLinkDelivery();
      return;
    }
    if (t.closest('[data-del-copiar]') && celularDel()) {
      try {
        await navigator.clipboard.writeText(mensajeDelivery());
        toast('Mensaje con el link copiado ✓', 'ok', 1800);
      } catch {
        toast(urlDelivery(), 'info', 8000);
      }
      return;
    }
    if (t.closest('[data-del-enviar]') && celularDel()) {
      toast(`Link enviado a ${formatoCelular(celularDel())} · el pedido llegará a ${mozoDelivery()?.nombre}`, 'ok', 4000);
      return;
    }

    // --- Mesas ---
    const delta = t.closest('[data-mesas-delta]');
    if (delta) {
      E.config.totalMesas = Math.min(MAX_MESAS, Math.max(1, E.config.totalMesas + Number(delta.dataset.mesasDelta)));
      raiz.querySelector('#input-mesas').value = E.config.totalMesas;
      marcarCambio();
      repintarQR();
      return;
    }

    // --- Accesos ---
    const tarjeta = t.closest('[data-acceso]');
    if (tarjeta && t.closest('[data-cambiar-clave]')) {
      const nueva = tarjeta.querySelector('[data-clave-nueva]').value;
      const repetir = tarjeta.querySelector('[data-clave-repetir]').value;
      if (nueva.length < 4) { toast('Usa al menos 4 caracteres', 'error'); return; }
      if (nueva !== repetir) { toast('Las claves no coinciden', 'error'); return; }
      E.config.accesos[tarjeta.dataset.acceso] = await sha256(nueva);
      marcarCambio();
      pintar();
      toast('Clave lista · se activa al publicar', 'ok');
      return;
    }
    if (tarjeta && t.closest('[data-quitar-clave]')) {
      E.config.accesos[tarjeta.dataset.acceso] = '';
      marcarCambio();
      pintar();
      return;
    }
    const envio = t.closest('[data-enviar-codigo]');
    if (envio) {
      const ids = enviadosA();
      ids.add(+envio.dataset.enviarCodigo);
      store.set('jornada.enviados', { id: E.config.jornada?.id, ids: [...ids] });
      setTimeout(pintar, 600); // deja que se abra WhatsApp antes de repintar
      return;
    }

    const copiar = t.closest('[data-copiar]');
    if (copiar) {
      try {
        await navigator.clipboard.writeText(copiar.dataset.copiar);
        toast('Copiado ✓', 'ok', 1500);
      } catch {
        toast(copiar.dataset.copiar, 'info', 6000);
      }
      return;
    }

    if (t.closest('#salir')) {
      sesion.remove(`panel.${rol}`);
      navegar('/');
    }
  }, { signal });

  raiz.addEventListener('input', (e) => {
    const t = e.target;

    if (t.id === 'buscar-plato') { E.busqueda = t.value.trim(); pintarSecciones(); return; }

    if (t.matches('[data-frec-campo]')) {
      const extra = E.menu.extras[+t.closest('[data-frecuente]').dataset.frecuente];
      if (t.dataset.frecCampo === 'precio') {
        const precio = Math.round(parseFloat(t.value) * 100) / 100;
        extra.precio = Number.isFinite(precio) && precio >= 0 ? precio : 0;
      } else {
        extra.nombre = t.value.trimStart();
      }
      marcarCambio();
      return;
    }

    if (t.matches('[data-precio]')) {
      const precio = Math.round(parseFloat(t.value) * 100) / 100;
      if (!Number.isFinite(precio) || precio < 0) return;
      E.menu.platos.find((p) => p.id === t.closest('[data-plato-id]').dataset.platoId).precio = precio;
      marcarCambio();
      return;
    }

    if (t.matches('[data-local-campo]')) {
      const id = t.dataset.localCampo;
      if (id === 'ruc') t.value = t.value.replace(/\D/g, '').slice(0, 11);
      E.config.local[id] = t.value.trimStart();
      if (id === 'mapa') {
        const a = raiz.querySelector('[data-probar-mapa]');
        const url = enlaceMapa(t.value);
        a.href = url || '#';
        a.classList.toggle('hidden', !url);
      }
      marcarCambio();
      repintarVistaLocal();
      return;
    }

    if (t.matches('[data-mozo-campo]')) {
      const caja = t.closest('[data-mozo-idx]');
      const mozo = E.config.mozos[+caja.dataset.mozoIdx];
      if (t.dataset.mozoCampo === 'telefono') {
        t.value = t.value.replace(/\D/g, '').slice(0, 9);
        mozo.telefono = t.value;
        caja.querySelector('[data-aviso-tel]').classList.toggle('hidden', /^\d{9}$/.test(mozo.telefono));
        caja.querySelector('[data-probar]').href = enlacePrueba(mozo.telefono);
      } else {
        mozo.nombre = t.value.trimStart();
      }
      marcarCambio();
      return;
    }

    if (t.matches('[data-pago-campo]')) {
      const caja = t.closest('[data-billetera]');
      const datos = E.config.pagos[caja.dataset.billetera];
      if (t.dataset.pagoCampo === 'numero') {
        t.value = t.value.replace(/\D/g, '').slice(0, 9);
        caja.querySelector('[data-aviso-pago]').classList.toggle('hidden', !t.value || /^\d{9}$/.test(t.value));
      }
      datos[t.dataset.pagoCampo] = t.dataset.pagoCampo === 'titular' ? t.value.trimStart() : t.value;
      marcarCambio();
      return;
    }

    if (t.matches('[data-horario]')) {
      cambiarHorario(t.dataset.horario, t.value);
      return;
    }

    if (t.matches('[data-del-campo]')) {
      del[t.dataset.delCampo] = t.value;
      refrescarLinkDelivery();
      return;
    }

    if (t.id === 'input-mesas') {
      const n = parseInt(t.value, 10);
      if (n >= 1 && n <= MAX_MESAS) {
        E.config.totalMesas = n;
        marcarCambio();
        repintarQR();
      }
    }
  }, { signal });

  raiz.addEventListener('change', (e) => {
    if (e.target.matches('[data-horario]')) { pintar(); return; }
    const input = e.target.closest('[data-subir-qr]');
    if (input?.files?.[0]) subirQR(input.closest('[data-billetera]').dataset.billetera, input.files[0]);
  }, { signal });

  raiz.addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-conexion') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const datos = {
      owner: String(f.get('owner')).trim(),
      repo: String(f.get('repo')).trim(),
      rama: String(f.get('rama')).trim() || 'main',
      token: String(f.get('token')).trim(),
    };
    const boton = e.target.querySelector('[type="submit"]');
    boton.disabled = true;
    boton.textContent = 'Probando…';
    try {
      const r = await probarConexion(datos);
      if (!r.puedeEscribir) throw new Error('El token puede leer pero no escribir: activa Contents → Read and write.');
      guardarConexion(datos);
      toast(`Conectado a ${r.nombre} ✓`, 'ok');
      // Se recarga lo publicado directo de GitHub (sin perder el borrador si sigue vigente)
      const tenia = cambiosPendientes().length ? { menu: E.menu, config: E.config } : null;
      E.publicado = await cargarPublicado();
      if (tenia) Object.assign(E, tenia);
      else { E.menu = clonar(E.publicado.menu); E.config = clonar(E.publicado.config); }
      marcarCambio();
      pintar();
    } catch (err) {
      toast(err.message, 'error', 6000);
      boton.disabled = false;
      boton.textContent = 'Guardar y probar';
    }
  }, { signal });

  // Aviso al cerrar la pestaña con cambios sin publicar
  window.addEventListener('beforeunload', (e) => {
    if (cambiosPendientes().length) e.preventDefault();
  }, { signal });

  // Montaje inicial (al final: todas las funciones y constantes ya existen)
  restaurarBorrador();

  raiz.innerHTML = `
    <div class="min-h-[100dvh] pb-40">
      <header class="glass-header sticky top-0 z-30 border-b border-carbon-900/5 pt-safe dark:border-white/5">
        <div class="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <div class="flex items-center gap-3">
            ${logotipo('compacto')}
            <span class="rounded-full bg-arcilla-500/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-arcilla-600 dark:bg-oro-400/15 dark:text-oro-300">${ROLES[rol].titulo}</span>
          </div>
          <div class="flex items-center gap-2">
            <a href="#/" class="btn-icono" aria-label="Ver carta" title="Ver carta">${ICONOS.atras()}</a>
            ${botonTema()}
            <button type="button" id="salir" class="btn-icono" aria-label="Cerrar sesión" title="Cerrar sesión">${ICONOS.salir()}</button>
          </div>
        </div>
        ${permitidas.length > 1 ? `
          <nav class="no-scrollbar mx-auto max-w-5xl overflow-x-auto px-4 pb-3" aria-label="Secciones">
            <div class="flex w-max gap-2">
              ${permitidas.map((id) => `<button type="button" class="chip" data-pestana="${id}" aria-pressed="false">${PESTAÑAS[id].icono} ${PESTAÑAS[id].nombre}</button>`).join('')}
            </div>
          </nav>` : ''}
      </header>
      <main id="contenido" class="mx-auto max-w-5xl px-4 pt-6"></main>
      <div id="barra-publicar" class="barra-carrito fixed inset-x-0 bottom-0 z-40 px-4 pb-safe-4"></div>
    </div>`;

  pintar();
  pintarBarra();

  return () => { ac.abort(); clearInterval(E.vigilancia); };
}

/* =========================================================
 *  Utilidades
 * ========================================================= */
function descargarJSON(nombre, datos) {
  const blob = new Blob([serializar(datos)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Redimensiona una imagen (por defecto máx. 1200 px, JPEG liviano). */
async function prepararFoto(archivo, { max = 1200, tipo = 'image/jpeg', calidad = 0.82 } = {}) {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, tipo, calidad));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
}
