#!/usr/bin/env python3
"""Sirve la PWA en http://localhost:8787 y permite lanzar el recolector desde la app."""
import http.server
import json
import subprocess
import sys
import threading
import urllib.parse
from pathlib import Path

import ai
import geo
import regions

ROOT = Path(__file__).resolve().parent
PORT = 8787
state = {"running": False, "last": None}
_listings = {"mtime": 0, "by_id": {}}


def listing(lid):
    f = ROOT / "web" / "data" / "listings.json"
    m = f.stat().st_mtime
    if m != _listings["mtime"]:
        _listings["by_id"] = {x["id"]: x for x in json.loads(f.read_text())["listings"]}
        _listings["mtime"] = m
    return _listings["by_id"].get(lid)


from collector import boe_contact  # noqa: E402


def publish(args=()):
    """Sube los cambios a GitHub Pages (si el repositorio está configurado)."""
    if (ROOT / ".git").exists():
        subprocess.run([str(ROOT / "publish.sh"), *args], capture_output=True, text=True)


def run_collector():
    state["running"] = True
    try:
        r = subprocess.run([str(ROOT / "publish.sh")], capture_output=True, text=True)
        state["last"] = (r.stderr or "").strip().splitlines()[-1:] or ["sin salida"]
    finally:
        state["running"] = False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / "web"), **kw)

    def end_headers(self):
        if self.path.startswith("/data/") or self.path.endswith(("sw.js", ".webmanifest")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/api/status":
            ok, why = ai.available()
            return self._json({**state, "ai": ok, "aiWhy": why})
        if u.path == "/api/prefs":
            f = ROOT / "web" / "data" / "prefs.json"
            p = json.loads(f.read_text()) if f.exists() else {}
            return self._json({**p, "allRegions": regions.all_regions()})
        if u.path == "/api/geo-index":
            cache = json.loads(geo.CACHE.read_text()) if geo.CACHE.exists() else {}
            return self._json({k: {
                "lat": g["lat"], "lon": g["lon"], "approx": g["approx"], "isolation": g.get("isolation"),
                "supermarket": (g.get("drive") or {}).get("supermarket", {}).get("min"),
                "hospital": (g.get("drive") or {}).get("hospital", {}).get("min"),
                "solar": (g.get("solar") or {}).get("kwhPerKwp"), "slope": (g.get("terrain") or {}).get("slope"),
            } for k, g in cache.items()})
        if u.path == "/api/ai-prompt":
            x = listing(q.get("id", ""))
            if not x:
                return self._json({"error": "Anuncio no encontrado"}, 404)
            cached = json.loads(geo.CACHE.read_text()).get(x["id"]) if geo.CACHE.exists() else None
            return self._json({"prompt": ai.manual_prompt(x, cached)})
        if u.path == "/api/contact":
            x = listing(q.get("id", ""))
            if not x:
                return self._json({"error": "Anuncio no encontrado"}, 404)
            if x["country"] != "ES":
                return self._json({"error": "Solo disponible para subastas del BOE"}, 400)
            try:
                return self._json(boe_contact(x["id"][3:]))
            except Exception as e:  # noqa: BLE001
                return self._json({"error": f"No se pudo leer el BOE: {e}"}, 502)
        if u.path == "/api/geo":
            x = listing(q.get("id", ""))
            if not x:
                return self._json({"error": "Anuncio no encontrado"}, 404)
            try:
                return self._json(geo.analyze(x))
            except Exception as e:  # noqa: BLE001
                return self._json({"error": str(e)}, 502)
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/refresh":
            if not state["running"]:
                threading.Thread(target=run_collector, daemon=True).start()
            return self._json({"started": True})
        if self.path == "/api/prefs":
            n = int(self.headers.get("Content-Length", 0))
            new = json.loads(self.rfile.read(n) or b"{}")
            f = ROOT / "web" / "data" / "prefs.json"
            p = json.loads(f.read_text()) if f.exists() else {}
            allowed = set(sum(regions.all_regions().values(), []))
            if "favRegions" in new:
                p["favRegions"] = [r for r in new["favRegions"] if r in allowed]
            for k in ("alertMaxPrice", "alertSkipStop", "notify"):
                if k in new:
                    p[k] = new[k]
            f.write_text(json.dumps(p, ensure_ascii=False))
            threading.Thread(target=publish, args=(["--quick"],), daemon=True).start()
            return self._json(p)
        if self.path == "/api/ai":
            n = int(self.headers.get("Content-Length", 0))
            if n > 60_000_000:
                return self._json({"error": "Demasiados archivos (máx. ~40 MB)"}, 413)
            body = json.loads(self.rfile.read(n) or b"{}")
            x = listing(body.get("id", ""))
            if not x:
                return self._json({"error": "Anuncio no encontrado"}, 404)
            ok, why = ai.available()
            if not ok:
                return self._json({"error": why}, 400)
            cached = geo.json.loads(geo.CACHE.read_text()).get(x["id"]) if geo.CACHE.exists() else None
            return self._json(ai.analyze(x, body.get("files", []), cached))
        self._json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"MiRancho → http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
