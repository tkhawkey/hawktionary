"""Local development server for Hawktionary: serves public/ with caching turned off,
so every edit shows on reload. Usage: python tools/serve.py [port]"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    print(f'Serving {os.path.normpath(ROOT)} at http://localhost:{PORT}')
    http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler).serve_forever()
