#!/usr/bin/env python3
"""
Pruebas de punta a punta del modo local (Chrome real, sin interfaz).

    pip install playwright
    python tests/e2e_local.py

Trabajan sobre una COPIA temporal del proyecto con un local ficticio, así que
no tocan data/ ni dependen de los datos del negocio configurado.
Necesitan internet para Tailwind (CDN), igual que el sitio.
"""
import hashlib
import http.client
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
PUERTO = 8765
BASE = f'http://localhost:{PUERTO}/'
CLAVE = 'clave-de-prueba'
NOMBRE_NUEVO = 'Cevichería Prueba Uno'
resultados = []


def comprobar(nombre, ok, detalle=''):
    resultados.append(bool(ok))
    print(f"{'OK  ' if ok else 'FALLA'} {nombre}{f' -> {detalle}' if detalle and not ok else ''}")


def peticion(metodo, ruta, cuerpo=None, cabeceras=None, host='localhost'):
    c = http.client.HTTPConnection(host, PUERTO, timeout=10)
    c.request(metodo, ruta, cuerpo, cabeceras or {})
    r = c.getresponse()
    datos = r.read()
    c.close()
    return r.status, r.getheader('Content-Type', ''), datos



def preparar_copia(destino):
    shutil.copytree(RAIZ, destino, ignore=shutil.ignore_patterns('.git', '__pycache__', 'tests'))
    (destino / '.git').mkdir()
    (destino / '.git' / 'config').write_text('[remote]\nurl = https://usuario:SECRETO@github.com/x/y\n')
    ruta = destino / 'data' / 'config.json'
    cfg = json.loads(ruta.read_text(encoding='utf-8'))
    cfg['jornada'] = None
    cfg['totalMesas'] = 8
    cfg['mozos'] = [{'id': 1, 'nombre': 'Ana', 'telefono': '987654321'}, {'id': 2, 'nombre': 'Luis', 'telefono': '987654322'}]
    cfg['accesos']['duenoHash'] = hashlib.sha256(CLAVE.encode()).hexdigest()
    cfg['local'].update({'nombre': 'Local Inicial', 'nombreCorto': 'Inicial'})
    ruta.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return ruta


def ip_de_red():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]


def pruebas_servidor(ip):
    estado, _, datos = peticion('GET', '/api/local')
    info = json.loads(datos)
    comprobar('api/local responde y permite escribir desde esta PC', estado == 200 and info['puedeEscribir'] is True, datos)
    comprobar('los .js se sirven como JavaScript', 'javascript' in peticion('GET', '/js/app.js')[1])
    comprobar('.git no se sirve', peticion('GET', '/.git/config')[0] == 404)
    comprobar('.git no se sirve con %2e', peticion('GET', '/%2egit/config')[0] == 404)
    ok = b'{"totalMesas": 8}'
    comprobar('PUT fuera de la lista se rechaza', peticion('PUT', '/api/archivo?ruta=index.html', b'x')[0] == 400)
    comprobar('PUT con ../ se rechaza', peticion('PUT', '/api/archivo?ruta=data/../servidor.py', b'x')[0] == 400)
    comprobar('PUT con JSON inválido se rechaza', peticion('PUT', '/api/archivo?ruta=data/config.json', b'{roto')[0] == 400)
    comprobar('PUT desde otra web se rechaza (Origin)', peticion('PUT', '/api/archivo?ruta=data/config.json', ok, {'Origin': 'https://malo.example'})[0] == 403)
    comprobar('PUT con Host ajeno se rechaza (rebinding)', peticion('PUT', '/api/archivo?ruta=data/config.json', ok, {'Host': 'malo.example'})[0] == 403)
    if ip != '127.0.0.1':
        comprobar('PUT desde la red se rechaza', peticion('PUT', '/api/archivo?ruta=data/config.json', ok, host=ip)[0] == 403)
        comprobar('la red no puede escribir según api/local', json.loads(peticion('GET', '/api/local', host=ip)[2])['puedeEscribir'] is False)


def entrar_panel(pagina):
    pagina.goto(BASE + '#/dueno')
    pagina.fill('#clave-acceso', 'incorrecta')
    pagina.click('#acceso [type=submit]')
    pagina.wait_for_selector('#error-acceso:not(.hidden)')
    comprobar('panel: clave incorrecta rechazada', True)
    pagina.fill('#clave-acceso', CLAVE)
    pagina.click('#acceso [type=submit]')
    pagina.wait_for_selector('[data-pestana="local"]')
    comprobar('panel: clave correcta entra', True)


def confirmar_hoja(pagina, texto):
    pagina.locator(f'button:has-text("{texto}")').last.click()


def cliente_pide(pagina, url, codigo, mesa_mozo='Ana'):
    """Desde el enlace de mesa: mozo → código → plato → enlace de WhatsApp."""
    pagina.goto(url)
    pagina.wait_for_selector('[data-mozo]', timeout=15000)
    pagina.locator(f'[data-mozo]:has-text("{mesa_mozo}")').first.click()
    pagina.click('#continuar')
    pagina.fill('[data-codigo-input]', codigo)
    pagina.click('[data-validar-codigo]')
    pagina.wait_for_selector('[data-agregar]', timeout=30000)
    pagina.locator('[data-agregar]').first.click()
    pagina.click('#ver-carrito')
    pagina.wait_for_selector('#enviar')
    pagina.wait_for_function("document.querySelector('#enviar').href.includes('wa.me')", timeout=15000)
    return pagina.get_attribute('#enviar', 'href')


def mesa_con_pedido(pagina, numero, espera=8):
    """¿El estado guardado del mozo tiene pedidos en esa mesa?"""
    js = """(n) => {
      const k = Object.keys(localStorage).find((x) => x.endsWith('mesas.v1'));
      const m = k && JSON.parse(localStorage.getItem(k));
      const mesa = m && (m.mesas || m)[n];
      return !!(mesa && mesa.pedidos && mesa.pedidos.length);
    }"""
    fin = time.time() + espera
    while time.time() < fin:
        if pagina.evaluate(js, str(numero)):
            return True
        pagina.wait_for_timeout(200)
    return False


def main():
    ip = ip_de_red()
    with tempfile.TemporaryDirectory() as tmp:
        copia = Path(tmp) / 'sitio'
        ruta_cfg = preparar_copia(copia)
        srv = subprocess.Popen([sys.executable, str(copia / 'servidor.py'), str(PUERTO)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(1)
            pruebas_servidor(ip)
            with sync_playwright() as pw:
                nav = pw.chromium.launch(channel='chrome', headless=True)
                errores = []

                def contexto():
                    c = nav.new_context(viewport={'width': 412, 'height': 900}, locale='es-PE')
                    c.route(re.compile(r'wa\.me|api\.whatsapp'), lambda r: r.abort())
                    return c

                def pagina_de(c):
                    p = c.new_page()
                    p.on('pageerror', lambda e: errores.append(str(e)))
                    return p

                # --- Configurar el local desde el panel y ver que se aplica ---
                dueno = contexto()
                p = pagina_de(dueno)
                entrar_panel(p)
                p.click('[data-pestana="local"]')
                p.fill('[data-local-campo="nombre"]', NOMBRE_NUEVO)
                p.fill('[data-local-campo="nombreCorto"]', 'Prueba Uno')
                p.fill('[data-local-campo="ciudad"]', 'Distrito · Ciudad')
                p.click('[data-accion="publicar"]')
                p.wait_for_function("document.querySelector('#toasts').textContent.includes('Guardado')", timeout=10000)
                disco = json.loads(ruta_cfg.read_text(encoding='utf-8'))
                comprobar('publicar guarda el nombre en data/config.json', disco['local']['nombre'] == NOMBRE_NUEVO, disco['local'])
                comprobar('publicar conserva las claves', disco['accesos']['duenoHash'] == hashlib.sha256(CLAVE.encode()).hexdigest())
                comprobar('publicar conserva los campos nuevos', 'repo' in disco and 'logo' in disco['local'])

                # --- Abrir el día sin GitHub ---
                p.click('[data-pestana="codigo"]')
                p.click('[data-accion="abrir-dia"]')
                confirmar_hoja(p, 'Abrir el día')
                p.wait_for_function("document.querySelector('[data-accion=\"cerrar-dia\"]') && document.querySelector('#toasts').textContent.includes('Guardado')", timeout=20000)
                disco = json.loads(ruta_cfg.read_text(encoding='utf-8'))
                comprobar('abrir el día publica la huella en disco', bool(disco['jornada'] and disco['jornada']['hash']))
                comprobar('el código no se publica', 'codigo' not in disco['jornada'])
                claves = p.evaluate('Object.keys(localStorage)')
                comprobar('localStorage sin prefijo de un negocio', all(k.startswith('carta.') for k in claves) and claves, claves)
                codigo = p.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('jornada.admin')))).codigo")
                comprobar('el panel genera un código de 6 dígitos', re.fullmatch(r'\d{6}', codigo), codigo)

                # --- Los enlaces apuntan a la red local ---
                p.click('[data-pestana="mesas"]')
                p.wait_for_function(f"document.body.textContent.includes('{ip}:{PUERTO}')", timeout=10000)
                comprobar('QR y enlaces apuntan a la IP de la red', True)
                p.click('[data-pestana="conexion"]')
                comprobar('pestaña Publicación explica el modo local', 'Modo local' in p.inner_text('#app'))
                comprobar('pestaña Publicación no pide token', p.locator('#form-conexion').count() == 0)

                # --- Cliente en esta PC ---
                cli = contexto()
                p = pagina_de(cli)
                enlace = cliente_pide(p, BASE + '?mesa=3', codigo)
                comprobar('título con el nombre configurado', NOMBRE_NUEVO in p.title(), p.title())
                texto = p.evaluate('document.documentElement.outerHTML')
                comprobar('sin nombres de un negocio anterior', not re.search(r'chepita|catacaos|piura', texto, re.I))
                mensaje = unquote(enlace)
                comprobar('pedido va al WhatsApp del mozo elegido', 'wa.me/51987654321' in enlace, enlace[:60])
                comprobar('mensaje con el nombre configurado', NOMBRE_NUEVO.upper() in mensaje, mensaje[:120])
                pedido = re.search(r'\[#MESA03-[^\]]+\]', mensaje)
                comprobar('pedido firmado (5 partes)', pedido and pedido.group(0).count(':') == 3, mensaje[-80:])
                pedido = pedido.group(0)

                # --- Mozo ---
                moz = contexto()
                m = pagina_de(moz)
                m.goto(BASE + '#/mozo')
                m.fill('#codigo-dia', '000000' if codigo != '000000' else '111111')
                m.click('#form-codigo-dia [type=submit]')
                m.wait_for_selector('#error-codigo:not(.hidden)', timeout=15000)
                comprobar('mozo: código errado rechazado', True)
                m.fill('#codigo-dia', codigo)
                m.click('#form-codigo-dia [type=submit]')
                m.wait_for_selector('#codigo', timeout=15000)
                comprobar('mozo: código correcto entra', True)
                m.fill('#codigo', pedido.rsplit(':', 1)[0] + ']')
                m.wait_for_function("/no trae el código/.test(document.body.textContent)", timeout=8000)
                comprobar('mozo: pedido sin firma rechazado', True)
                comprobar('mozo: el pedido sin firma no se guardó', not mesa_con_pedido(m, 3, espera=1))
                m.fill('#codigo', pedido)
                comprobar('mozo: pedido firmado registrado', mesa_con_pedido(m, 3), m.evaluate('JSON.stringify(localStorage)')[:300])

                # --- Celular en la red: HTTP sin crypto.subtle ---
                if ip != '127.0.0.1':
                    cel = contexto()
                    c = pagina_de(cel)
                    red = f'http://{ip}:{PUERTO}/'
                    c.goto(red)
                    comprobar('la red es un contexto sin crypto.subtle', c.evaluate('!crypto.subtle'))
                    inicio = time.time()
                    enlace = cliente_pide(c, red + '?mesa=4', codigo, 'Luis')
                    comprobar('celular en la red: valida el código con PBKDF2 en JS', 'wa.me/51987654322' in enlace)
                    print(f'     (flujo completo en la red: {time.time() - inicio:.1f} s)')
                    pedido_red = re.search(r'\[#MESA04-[^\]]+\]', unquote(enlace)).group(0)
                    m.fill('#codigo', pedido_red)
                    comprobar('firma hecha en la red es válida en el mozo', mesa_con_pedido(m, 4))

                    c2 = pagina_de(contexto())
                    c2.goto(red + '#/dueno')
                    c2.fill('#clave-acceso', CLAVE)
                    c2.click('#acceso [type=submit]')
                    c2.wait_for_selector('[data-pestana="local"]')
                    comprobar('clave SHA-256 en JS funciona en la red', True)
                    c2.click('[data-pestana="local"]')
                    c2.fill('[data-local-campo="nombre"]', 'Intento desde celular')
                    c2.click('[data-accion="publicar"]')
                    c2.wait_for_function("document.querySelector('#toasts').textContent.includes('PC del servidor')", timeout=8000)
                    disco = json.loads(ruta_cfg.read_text(encoding='utf-8'))
                    comprobar('celular no puede publicar', disco['local']['nombre'] == NOMBRE_NUEVO)

                comprobar('sin errores de JavaScript', not errores, errores[:3])
                nav.close()
        finally:
            srv.terminate()
            srv.wait()
    print(f'\n{sum(resultados)} de {len(resultados)} comprobaciones correctas')
    sys.exit(0 if all(resultados) else 1)


if __name__ == '__main__':
    main()
