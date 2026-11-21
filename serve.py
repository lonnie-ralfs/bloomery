"""Local no-cache server for the blacksmithing game, so code edits always show on reload.

    python blacksmith/serve.py [port]        (default 8090)  ->  http://localhost:8090
"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


NoCache.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    here = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCache, directory=here)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as srv:
        print(f"serving {here} at http://localhost:{port}")
        srv.serve_forever()
