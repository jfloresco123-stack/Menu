/**
 * ============================================================
 *  CONFIGURACIÓN GLOBAL
 * ============================================================
 *  Valores por defecto, sin datos de ningún negocio: todo lo propio de
 *  cada local (nombre, mesas, mozos, claves, pagos…) vive en
 *  data/config.json y se aplica al arrancar con aplicarConfig().
 */
export const CONFIG = {
  // Identidad (logotipo tipográfico). Se derivan de `local` en aplicarConfig().
  nombreCompleto: 'Mi Restaurante',
  nombreCorto: 'Restaurante',
  ubicacion: '',

  /**
   * Datos del local (Panel → «Datos del local»). Aparecen en la bienvenida
   * del cliente, el mensaje de WhatsApp, la cuenta impresa y los QR.
   */
  local: {
    nombre: 'Mi Restaurante',          // nombre completo
    nombreCorto: 'Restaurante',        // palabra destacada del logotipo
    eslogan: '',
    logo: '',                          // ruta de la imagen; vacío = logotipo tipográfico
    foto: '',                          // foto de fondo de la bienvenida; vacío = fondo oscuro
    direccion: '',
    referencia: '',
    ciudad: '',
    mapa: '',                          // enlace de Google Maps
    telefono: '',
    horario: '',
    ruc: '',
    razonSocial: '',
    facebook: '',
    instagram: '',
    urlPublica: '',                    // dominio propio para QR y enlaces; vacío = se deduce
  },

  // WhatsApp: código de país que se antepone al número de 9 dígitos
  prefijoPais: '51',
  moneda: 'S/',

  // --- Gestionados desde data/config.json (estos son solo respaldos) ---
  totalMesas: 10,
  mozos: [],
  /**
   * Hashes SHA-256 de las claves. Se cambian desde el Panel del Dueño
   * (pestaña Accesos). mozoHash vacío = el panel del mozo no pide PIN.
   */
  accesos: {
    duenoHash: '35de0aad96a3ab4d93f3c155b75bd6205c25523ccd70c9a1bb174aaea4a91b7c', // dueno2026
    adminHash: '6051fc84a7a0d74c225fb18a496b09952da5642e60723ecae543298edd7d82d6', // admin2026
    mozoHash: '',
  },

  // Código del día (Panel → Código del día). null = sin día abierto: solo se ve la carta.
  jornada: null,
  // Horario de la jornada (hora de Perú). El día se cierra solo a la hora de cierre.
  horario: { inicio: '06:00', cierre: '06:00' },

  // Billeteras para cobrar (se configuran en Panel del Dueño → Pagos)
  pagos: {
    yape: { numero: '', titular: '', qr: '' },
    plin: { numero: '', titular: '', qr: '' },
  },

  // Repositorio donde el Panel del Dueño publica (se autodetecta en *.github.io)
  repo: { owner: '', repo: '', rama: 'main' },
};

/**
 * Parte del nombre que va encima de la palabra destacada del logotipo:
 * «Restaurante La Esquina» + «La Esquina» → «Restaurante».
 */
export function anteTitulo() {
  const { nombreCompleto: n, nombreCorto: c } = CONFIG;
  if (!c || n === c) return '';
  const i = n.toLowerCase().lastIndexOf(c.toLowerCase());
  return (i >= 0 ? n.slice(0, i) + n.slice(i + c.length) : n).replace(/\s+/g, ' ').trim();
}

/** Aplica la configuración publicada (data/config.json ya normalizado). */
export function aplicarConfig({ totalMesas, mozos, accesos, pagos, local, jornada, horario, repo }) {
  CONFIG.jornada = jornada;
  CONFIG.horario = horario;
  CONFIG.local = local;
  CONFIG.nombreCompleto = local.nombre;
  CONFIG.nombreCorto = local.nombreCorto || local.nombre;
  CONFIG.ubicacion = local.ciudad;
  CONFIG.totalMesas = totalMesas;
  CONFIG.mozos = mozos;
  CONFIG.accesos = accesos;
  CONFIG.pagos = pagos;
  CONFIG.repo = repo;
  pintarIdentidad();
}

/** Título de la pestaña, descripción e ícono según el local configurado. */
function pintarIdentidad() {
  if (typeof document === 'undefined') return;
  const { nombreCompleto: nombre, ubicacion, local } = CONFIG;
  document.title = [nombre, ubicacion].filter(Boolean).join(' · ');
  document.querySelector('meta[name="description"]')?.setAttribute('content', [`Carta digital de ${nombre}`, local.eslogan].filter(Boolean).join(' — '));
  const inicial = (CONFIG.nombreCorto || nombre).trim().charAt(0).toUpperCase().replace(/[<&>]/, '');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='#C2502E'/><text x='50%' y='54%' text-anchor='middle' dominant-baseline='middle' font-family='Georgia,serif' font-style='italic' font-weight='900' font-size='42' fill='#F2D48A'>${inicial}</text></svg>`;
  document.querySelector('link[rel="icon"]')?.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
}
