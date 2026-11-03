/**
 * ============================================================
 *  PUNTO DE ENTRADA
 * ============================================================
 */
import { iniciarTema, alternarTema } from './theme.js';
import { instalarManejadoresImagen } from './ui.js';
import { ruta, iniciarRouter } from './router.js';
import { vistaCliente } from './views/cliente.js';
import { vistaMozo } from './views/mozo.js';
import { vistaAdmin, vistaDueno } from './views/panel.js';
import { detectarServidorLocal } from './github.js';

iniciarTema();
instalarManejadoresImagen();

// Botón de tema presente en todos los módulos (delegación global)
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-accion="tema"]')) alternarTema();
});

ruta('/', vistaCliente);
ruta('/mozo', vistaMozo);
ruta('/admin', vistaAdmin);
ruta('/dueno', vistaDueno);

await detectarServidorLocal();
iniciarRouter(document.getElementById('app'));
