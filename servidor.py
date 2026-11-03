#!/usr/bin/env python3
"""
Servidor local de la carta digital (solo usa la biblioteca estándar de Python).

    python servidor.py            # puerto 8080
    python servidor.py 9000       # otro puerto

Sirve el sitio a esta PC y a los celulares de la misma red, y hace de
"Publicar": el panel guarda data/*.json e img/ en esta carpeta, sin GitHub.

Seguridad: los celulares de la red solo pueden LEER. Solo se puede escribir
desde esta misma PC, abriendo el panel en http://localhost, y únicamente en
las rutas de RUTAS_ESCRIBIBLES.
"""
import json
import os
import re
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

RAIZ = Path(__file__).resolve().parent
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
MAX_BYTES = 10 * 1024 * 1024
RUTAS_ESCRIBIBLES = re.compile(r'^(data/(menu|config)\.json|img/(platos|pagos)/[a-z0-9-]+\.(jpg|png))$')
HOSTS_LOCALES = {'localhost', '127.0.0.1', '[::1]'}


def ip_de_red():
    """IP de esta PC en la red local (el UDP no envía nada, solo elige la interfaz)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'


class Manejador(SimpleHTTPRequestHandler):
    # En Windows el registro puede servir .js como text/plain y romper los módulos ES
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.html': 'text/html',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _json(self, estado, datos):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode('utf-8')
        self.send_response(estado)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _desde_esta_pc(self):
        """Cliente en esta PC, y Host/Origin locales (frena CSRF y DNS rebinding)."""
        host = self.headers.get('Host', '').rsplit(':', 1)[0].lower()
        origen = self.headers.get('Origin')
        origen_ok = origen is None or urlsplit(origen).netloc.lower() == self.headers.get('Host', '').lower()
        return self.client_address[0] in ('127.0.0.1', '::1') and host in HOSTS_LOCALES and origen_ok

    def _ruta_oculta(self):
        """Nada de .git, .gitignore, etc.: .git/config puede contener credenciales."""
        ruta = unquote(urlsplit(self.path).path)
        return any(parte.startswith('.') for parte in re.split(r'[/\\]', ruta))

    def do_GET(self):
        ruta = urlsplit(self.path).path
        if ruta == '/api/local':
            self._json(200, {
                'url': f'http://{ip_de_red()}:{PUERTO}/',
                'puedeEscribir': self._desde_esta_pc(),
            })
            return
        if self._ruta_oculta():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self._ruta_oculta():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_PUT(self):
        partes = urlsplit(self.path)
        ruta = parse_qs(partes.query).get('ruta', [''])[0]
        if partes.path != '/api/archivo':
            self.send_error(404)
            return
        if not self._desde_esta_pc():
            self._json(403, {'error': 'Solo se puede publicar desde la PC del servidor, en http://localhost.'})
            return
        if not RUTAS_ESCRIBIBLES.match(ruta):
            self._json(400, {'error': f'Ruta no permitida: {ruta}'})
            return
        try:
            largo = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self._json(411, {'error': 'Falta Content-Length.'})
            return
        if not 0 < largo <= MAX_BYTES:
            self._json(413, {'error': 'Archivo vacío o demasiado grande.'})
            return
        cuerpo = self.rfile.read(largo)
        if ruta.endswith('.json'):
            try:
                json.loads(cuerpo)
            except ValueError:
                self._json(400, {'error': 'El contenido no es JSON válido.'})
                return
        destino = RAIZ / ruta
        destino.parent.mkdir(parents=True, exist_ok=True)
        # Escritura atómica: un corte a medias no deja el archivo dañado
        temporal = destino.with_name(destino.name + '.tmp')
        temporal.write_bytes(cuerpo)
        os.replace(temporal, destino)
        self._json(200, {'ok': True, 'ruta': ruta})


if __name__ == '__main__':
    print('Carta digital en modo local')
    print(f'  En esta PC (publica y edita):  http://localhost:{PUERTO}/')
    print(f'  Panel del dueño:               http://localhost:{PUERTO}/#/dueno')
    print(f'  Celulares en la misma red:     http://{ip_de_red()}:{PUERTO}/')
    print('Ctrl+C para detener.')
    try:
        ThreadingHTTPServer(('0.0.0.0', PUERTO), Manejador).serve_forever()
    except KeyboardInterrupt:
        pass
