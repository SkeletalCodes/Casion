#!/usr/bin/env python3
"""Tiny static server for previewing the site: python3 serve.py [port]

Quieter than `python3 -m http.server`: it only prints requests that fail, so a clean
run prints nothing after the first line. Files are sent with no-store so edits show
up on a plain reload. Double-clicking index.html works too - this is just for previews.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_request(self, code='-', size='-'):
        try:
            failed = int(code) >= 400
        except (TypeError, ValueError):
            failed = False
        if failed:
            super().log_request(code, size)

    def log_error(self, format, *args):  # the failed request line above already says it
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = http.server.ThreadingHTTPServer(('', port), functools.partial(Handler, directory=ROOT))
    print(f'BananaBet preview on http://localhost:{port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
