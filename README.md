# Carta digital para restaurantes

SPA estática (sin base de datos), reutilizable para cualquier local: los datos del negocio viven en `data/`, no en el código.
Funciona solo con estado local, `localStorage` y enlaces de WhatsApp. Corre en una PC con `servidor.py` y se puede publicar en **GitHub Pages**.

| Módulo | URL | Para quién |
|---|---|---|
| Cliente | `…/` o `…/?mesa=7` | Comensal que escanea el QR de su mesa (sin código del día solo ve la carta) |
| Delivery | `…/?delivery=987654321&m=2` | Cliente al que el mozo le envió el enlace por WhatsApp |
| Mozo | `…/#/mozo` | Panel de mesas y delivery (pide el código del día) |
| Admin | `…/#/admin` (o 5 toques al logotipo en la carta) | Código del día, carta y datos del local |
| **Dueño** | `…/#/dueno` | Todo: código del día, carta, local, mozos, Yape/Plin, mesas y QR, claves, publicación |

## Inicio rápido (local)

Requiere Python 3 e internet (Tailwind, fuentes y el generador de QR vienen de un CDN).

```bash
python servidor.py        # o: python servidor.py 9000
```

| Desde | Dirección | Qué puede hacer |
|---|---|---|
| Esta PC | `http://localhost:8080/` | Todo, incluido publicar: abrir el día y guardar cambios del panel |
| Celulares en la misma red | `http://IP-DE-LA-PC:8080/` (la muestra el servidor al arrancar) | Carta, pedidos y panel del mozo. No pueden publicar |

Para que los celulares entren, permite Python en el Firewall de Windows (redes privadas) la primera vez que lo pida.

Primeros pasos: entra a `#/dueno` con la clave `dueno2026`, completa **Datos del local**, **Mozos** y **Carta**, pulsa **Publicar** y abre el día en **Código del día**. Los números de mozo que trae `data/config.json` son de ejemplo: cámbialos antes de probar envíos por WhatsApp.

## Configurar un local

Todo lo propio del negocio está en dos archivos, editables desde el panel o a mano:

| Archivo | Contenido |
|---|---|
| `data/config.json` → `local` | `nombre`, `nombreCorto` (palabra grande del logotipo), `eslogan`, `logo` y `foto` (rutas en `img/`; vacíos = logotipo con letras y fondo oscuro), `direccion`, `referencia`, `ciudad`, `mapa`, `telefono`, `horario`, `ruc`, `razonSocial`, `facebook`, `instagram`, `urlPublica` (dominio propio) |
| `data/config.json` | `totalMesas`, `mozos`, `accesos` (hashes de claves), `pagos` (Yape/Plin), `horario`, `jornada`, `repo` (`owner`, `repo`, `rama` de GitHub) |
| `data/menu.json` | Categorías, platos y extras. Trae una carta de ejemplo |
| `img/` | Logo, fotos de platos y del local |

Para **otro local**: copia el proyecto a otra carpeta (o a otro repositorio), cambia esos datos y usa otro puerto si corren a la vez (`python servidor.py 8081`). Cada copia guarda sus datos aparte: en el navegador el prefijo incluye la carpeta del sitio, así que varios locales en `usuario.github.io/local-a/` y `/local-b/` no se mezclan.

Lo que sigue fijo en `js/config.js` porque es igual para todos los locales en Perú: `prefijoPais` (51) y `moneda` (S/). También lo están los celulares de 9 dígitos, Yape/Plin y el cierre del día en hora de Perú. Los colores de la marca están en `index.html`.

## Pruebas

```bash
pip install playwright
python tests/e2e_local.py
```

Usan Chrome sin interfaz sobre una copia temporal del proyecto, así que no tocan `data/`. Cubren el servidor (qué rechaza), la configuración desde el panel, abrir el día, el pedido firmado de cliente a mozo y el uso desde la red local.

📄 Documentación técnica:
- [`docs/CODIGO-DEL-DIA.md`](docs/CODIGO-DEL-DIA.md): apertura del día, firma de pedidos y modelo de amenazas.
- [`docs/REVISION-INTERACCION.md`](docs/REVISION-INTERACCION.md): revisión de los puntos donde se puede romper la interacción, con su estado y recomendaciones.

## Stack

- HTML5 + JavaScript (módulos ES nativos), **sin build ni npm**
- Tailwind CSS por CDN (versión fijada 3.4.16)
- Animaciones con View Transitions API, Web Animations y CSS
- Modo claro/oscuro (sigue al sistema y se recuerda la elección)

## Estructura

```
index.html            Shell, Tailwind, fuentes, tema
.nojekyll             GitHub Pages sirve los archivos tal cual
css/styles.css        Skeleton, animaciones, hojas modales, vidrio
data/menu.json        Carta: categorías y platos
data/config.json      Datos del negocio: local, nº de mesas, mozos, claves (hashes), Yape/Plin y huella del código del día
servidor.py           Servidor local: sirve el sitio y hace de «Publicar» sin GitHub
tests/e2e_local.py    Pruebas de punta a punta del modo local
docs/                 Documentación técnica (código del día, revisión de la interacción)
img/                  Fotos de platos y del local
js/
  app.js              Arranque y rutas
  config.js           Valores por defecto, sin datos de ningún negocio
  store.js            localStorage seguro (prefijo "carta.<carpeta del sitio>.")
  menu.js             Lee lo publicado (menu.json + config.json)
  github.js           Publica cambios: en servidor.py (local) o en el repositorio (API de GitHub)
  acceso.js           Pantallas de clave / PIN y de código del día
  jornada.js          CÓDIGO DEL DÍA: generación, huella PBKDF2, validación
  hash.js             SHA-256 y PBKDF2 (con respaldo en JS para HTTP en la red local)
  codec.js            Motor del CÓDIGO DE PEDIDO (deflate + Base64 + CRC32 + firma)
  ui.js               Íconos, logotipo, toasts, bottom-sheets, imágenes
  theme.js            Modo claro / oscuro
  router.js           Rutas por hash (#/, #/mozo, #/admin, #/dueno)
  views/cliente.js    Bienvenida, catálogo, carrito, WhatsApp
  views/mozo.js       Grid de mesas, pegar código, checklist
  views/panel.js      Panel del Dueño y Administrador
```

## Publicar en GitHub Pages

1. Crea un repositorio y sube **todo el contenido** de esta carpeta a la rama `main`.
2. En *Settings → Pages*, elige *Deploy from a branch*, rama `main` y carpeta `/ (root)`.
3. La web quedará en `https://TU-USUARIO.github.io/TU-REPOSITORIO/`.
4. Antes de subir, **cambia las claves** y revisa `data/config.json`: ese repositorio y sus datos serán públicos.

## Códigos QR por mesa

En **#/dueno → Mesas, QR y delivery** se generan los QR de todas las mesas, listos para imprimir. Cada uno apunta a una dirección como esta (mesa 7):

```
https://TU-USUARIO.github.io/TU-REPOSITORIO/?mesa=7
```

En modo local apuntan a la IP de la PC (`http://192.168.x.x:8080/?mesa=7`): imprímelos solo para pruebas, porque esa dirección puede cambiar. La mesa aparece preseleccionada y el cliente solo confirma y elige a su mozo.

## Delivery

En **#/mozo → 🛵 Delivery → Enviar link** (o en **#/dueno → Mesas, QR y delivery → Link de delivery**), se escribe el celular del cliente, elige qué mozo recibirá el pedido y se abre WhatsApp con un mensaje listo para enviar. El mensaje incluye **el código del día** y un enlace como este:

```
https://TU-USUARIO.github.io/TU-REPOSITORIO/?delivery=987654321&m=2
```

El cliente escribe su nombre, su dirección y una referencia (y, si quiere, comparte su ubicación), ingresa el código, elige sus platos y envía el pedido por WhatsApp al mozo indicado. En lugar de un número de mesa, el código lleva el celular del cliente: `[#D987654321-K789II:…]`. Al pegarlo en el panel del mozo, el pedido aparece en la sección **🛵 Delivery** con los datos de entrega y botones para llamar, chatear y abrir el mapa. Se cobra igual que una mesa y se cierra desde ⋯ → **Cerrar delivery** cuando ya se entregó.

## Código del día

Cada día el administrador abre la jornada en **Panel → 🔑 Código del día**. Se genera un código aleatorio de 6 dígitos y se publica solo su huella, nunca el código. Luego el administrador se lo envía por WhatsApp a cada mozo que trabaja ese día.

- **Mozo:** ingresa el código para usar su panel.
- **Cliente:** elige mesa y mozo, le pide el código por WhatsApp (botón «Pedir código») y lo ingresa. Sin código **solo puede ver la carta**.
- **Pedidos:** cada uno viaja firmado con el código. El panel del mozo rechaza los que no tienen firma o la tienen de otro código, así que un enlace filtrado o un pedido fabricado no entra.
- **Horario de atención:** por defecto de **6:00 a. m. a 6:00 a. m.** (24 h), editable en la misma pestaña. Si nadie cierra el día, **se cierra solo** a la hora de cierre. **Cambiar código** invalida el anterior si se filtró.
- **Cliente:** si no tiene código, ve abajo una barra fija con **Pedir código** (WhatsApp al mozo) e **Ingresar código**.
- **Pedidos enviados:** al tocar **Enviar**, el carrito se vacía y nada del pedido queda en el celular. Para agregar algo, el cliente hace **otro pedido**, que llega como «➕ PEDIDO ADICIONAL» a la misma cuenta. Para cambiar o quitar algo, le escribe al mozo, que lo corrige desde su panel (⋯ en cada plato).
- **Empezar de nuevo (↺):** botón en la bienvenida y en la carta. Borra en ese celular la mesa, el mozo, el carrito y el código, y vuelve a la intro animada. No toca los datos del panel del mozo.

Detalles y límites en [`docs/CODIGO-DEL-DIA.md`](docs/CODIGO-DEL-DIA.md).

> ⚠️ Al publicar esta versión, **nadie podrá pedir por la app hasta que se abra el primer día**.

## Cómo viaja un pedido

1. El cliente, ya con el código del día, arma su pedido y toca **Enviar pedido**. Se abre WhatsApp hacia el mozo elegido con un resumen legible y, al final, un código como este:
   `[#MESA05-HN1VED:zHcoxDsIw…:5d23:ap2zvbpj]`
2. El mozo copia el mensaje (o solo el código) y lo pega en **#/mozo**. El sistema hace lo siguiente:
   - comprueba la **firma con el código del día**; si falta o no coincide, el pedido no se registra;
   - indica si es **🆕 Pedido NUEVO** o **➕ Pedido ADICIONAL N.º 2, 3…** de esa mesa y muestra la cuenta acumulada;
   - lo agrega a **📥 Pedidos recibidos**, donde lo que el mozo aún no vio aparece resaltado (y la mesa muestra «🆕»);
   - valida el código con CRC32, así que uno cortado o editado se rechaza;
   - lo descomprime, identifica la mesa y lista los platos, las notas y el total;
   - lo asigna a la mesa al instante y avisa si ese pedido ya estaba registrado.
3. En la mesa, el mozo marca cada plato como **Entregado / Pendiente** (si hay varias unidades, una por una). El color de la mesa cambia según el avance:
   - Gris: libre
   - Amarillo: esperando pedido
   - Azul: servido parcial
   - Verde: atendido completo
4. **Liberar mesa** la deja lista para los siguientes clientes.

### Funciones del panel del mozo

- **Alias:** al pegar, si el texto trae el número o nombre del remitente (como al copiar desde WhatsApp Web), se guarda. Debajo del pedido aparece un campo para ponerle un alias ("Sr. Pérez", "camisa roja"…). También se cambia desde ⋯ en el pedido.
- **Pedido manual:** dentro de la mesa, **+ Pedido**, para lo que el cliente pide de palabra.
- **Fuera de carta:** en **+ Pedido** (o ⋯ de la mesa → *Agregar plato fuera de carta*) el mozo escribe descripción, precio, cantidad y nota de algo que no está en la carta. Se puede combinar con platos de la carta; aparece con la etiqueta *Fuera de carta* en la mesa y en el reporte de ventas, y se cobra como cualquier plato. Solo existe en el panel del mozo: no se agrega a la carta pública.
- **Extras frecuentes:** el dueño o el administrador los define en **Carta → ✍️ Extras** (descripción + precio fijo) y los publica. En *Fuera de carta* el mozo los ve como botones: un toque agrega uno y otro toque suma una unidad. Se guardan en `data/menu.json` (`extras`) y los clientes no los ven.
- **Cobrar:** el botón **💰 Cobrar** (de toda la mesa) o **Pagar** (de un pedido) permite elegir la forma de pago: Efectivo (calcula el vuelto), Yape, Plin, Tarjeta o Transferencia, con N° de operación opcional. Un pago se puede anular desde ⋯ del pedido.
- **Pago dividido (🔀):** reparte el total entre varias formas de pago (p. ej. S/ 30 en efectivo + S/ 54 por Yape). La última forma se completa sola con lo que falta, el efectivo calcula su vuelto y solo se confirma cuando la suma cuadra con el total. Si un pago cubrió varios pedidos, al anularlo se anulan todos juntos.
- **Una mesa no se puede liberar si falta cobrar.** El sistema avisa y abre el cobro.
- **⋯ en cada plato:** cambiar precio (queda visible el precio original), cambiar cantidad o quitar el plato si no se llegó a servir. Los pedidos ya pagados no se pueden modificar sin antes anular el pago.
- **Acciones protegidas:** eliminar un pedido o liberar una mesa están dentro del menú ⋯ y se confirman **manteniendo presionado** el botón. Un toque o doble toque accidental no hace nada, y después aparece **Deshacer**.
- **Historial (🕘):** guarda en el celular los últimos 7 días de pedidos recibidos, eliminados, mesas liberadas y cierres. Se puede buscar por mesa, alias o código y **restaurar** lo borrado.
- **Cuenta para el cliente (🧾 Cuenta):** junto a *Cobrar* o en el menú ⋯ de la mesa o del pedido. Muestra el detalle (cantidad, descripción, precio unitario, importe), subtotal, lo ya pagado y el **total a pagar**. Se puede elegir toda la mesa o solo el pedido de un cliente, unir platos iguales, **imprimir** (ticket de 80 mm o A4) y **enviar por WhatsApp**. Si al pegar el pedido se capturó el número del cliente, se le envía directo; si no, se escribe un número o se elige el contacto. Lleva la nota "Pre-cuenta · no es comprobante de pago".
- **Reporte de ventas (⋯ → Reporte de ventas):** total cobrado del día, desglose por forma de pago, platos vendidos, detalle de cada cobro (los anulados aparecen tachados), lo pendiente por cobrar y los ajustes. Se imprime en **hoja A4** o en **ticket de 80 mm** (impresora térmica) y se puede enviar un resumen por WhatsApp. Permite ver días anteriores (los 7 que guarda el historial). También se abre desde *Cerrar el día*, para imprimirlo antes de limpiar.
- **Cerrar el día (⋯ → Cerrar el día):** con la clave del administrador o del dueño deja todas las mesas en cero. Muestra lo cobrado hoy por forma de pago, avisa si quedó algo sin cobrar y el cierre queda en el historial, salvo que elijas borrarlo también.

El código lleva nombre y precio de cada plato, así que el mozo ve el pedido exactamente como lo vio el cliente.

## Panel del Dueño (`#/dueno`)

Desde aquí se gestiona todo sin tocar archivos:

- **Carta:** precios, agotados, platos nuevos o eliminados, descripciones, etiquetas, fotos (se suben desde el celular) y categorías (nombre, ícono, orden).
- **Mozos:** nombres y WhatsApp, con botón para probar cada número.
- **Yape / Plin:** número, titular e imagen del QR de cada billetera. Aparecen en la cuenta impresa, en la cuenta enviada por WhatsApp (con enlace al QR) y en grande al cobrar con Yape o Plin.
- **Mesas, QR y delivery:** número de mesas, hoja de QR para imprimir y generador del link de delivery (celular del cliente + mozo → copiar o enviar por WhatsApp; incluye el código del día si este dispositivo lo generó).
- **Accesos:** claves del dueño y del administrador, PIN opcional del panel del mozo y enlaces de cada módulo.
- **Publicación:** conexión del dispositivo con GitHub (en modo local no hace falta).

Los cambios se acumulan como **borrador**. Al pulsar **Publicar** se guardan en `data/menu.json` y `data/config.json`. En modo local se escriben al instante en la carpeta del proyecto. En GitHub se guardan en el repositorio y GitHub Pages actualiza la web para todos en unos 1–2 minutos; el panel avisa cuando los clientes ya ven la versión nueva.

### Conectar un dispositivo a GitHub (una sola vez, solo si publicas ahí)

1. En GitHub abre *Settings → Developer settings → Fine-grained personal access tokens → Generate new token*.
2. **Repository access:** *Only select repositories* → tu repositorio.
3. **Permissions → Contents:** *Read and write*.
4. Copia el token y pégalo en **#/dueno → Publicación**.

El token se guarda solo en ese dispositivo y nunca se sube a la web. Si pierdes el teléfono, revócalo en GitHub.

Si quieres que el Administrador también pueda publicar desde su celular, conéctalo una vez con el token entrando como dueño en ese celular. Sin token, el Admin solo puede descargar el JSON.

> **Importante:** clientes y mozos siempre leen lo publicado. Ya no existen copias locales que puedan quedar viejas. Esas copias causaban que se siguieran usando los números anteriores de los mozos.

También puedes seguir editando `data/menu.json` y `data/config.json` directamente en GitHub.

### Fotos de los platos

Cada plato apunta a una ruta en `img/`. Si la foto no existe, se muestra una tarjeta tipográfica con la inicial del plato. Para poner la foto real, súbela desde el panel o cópiala a `img/` con el nombre que indica `menu.json`.

## Claves

| Acceso | Clave inicial |
|---|---|
| Dueño (`#/dueno`) | `dueno2026` |
| Administrador (`#/admin`) | `admin2026` (la clave del dueño también entra) |
| Panel del mozo | sin PIN (se activa en Accesos) |

**Cambia las claves del dueño y del administrador antes de publicar en internet** (Accesos → Publicar). Las iniciales son públicas: están en este README. Ver hallazgo S5 en [`docs/REVISION-INTERACCION.md`](docs/REVISION-INTERACCION.md).

> Los hashes de las claves son públicos en `data/config.json`, así que son una protección de interfaz. Lo que de verdad impide modificar la web es el token de GitHub, que solo existe en tus dispositivos.

## Persistencia (claves de localStorage)

Todas llevan el prefijo `carta.` más la carpeta del sitio si la hay (`carta.mi-local.`).

| Clave | Contenido |
|---|---|
| `mesas.v1` | Estado de las mesas del panel del mozo |
| `pedidos.procesados` | Códigos ya registrados (evita duplicados) |
| `carrito.mN` | Carrito del cliente en la mesa N (se vacía solo tras enviarlo o tras 3 h sin cambios) |
| `cliente.sesion` | Mesa y mozo elegidos (válido 4 horas) |
| `cliente.delivery` | Datos de entrega del cliente delivery (válido 4 horas) |
| `jornada.codigo` | Código del día ya validado en este dispositivo (cliente o mozo) |
| `jornada.intentos` | Intentos fallidos del código (espera de 60 s tras 5) |
| `jornada.admin` / `jornada.enviados` | Código generado y mozos a los que se envió (solo en el dispositivo del administrador) |
| `delivery.mozo` | Último mozo elegido al enviar un link de delivery |
| `panel.borrador` | Cambios sin publicar del panel |
| `github.conexion` | Repositorio y token (solo en dispositivos conectados) |
| `tema` | Modo claro/oscuro elegido |
