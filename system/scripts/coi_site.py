"""Serve _site with COOP/COEP so the page is crossOriginIsolated (SharedArrayBuffer
available) — the production-equivalent headers for the in-browser VS Code holospace.
Adds HTTP Range support so the browser can read tensor byte-ranges out of a large
GGUF on disk (the disk-streaming ingestion path) without copying the whole file."""
import http.server, socketserver, sys, os, re

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_site")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
# Optional 2nd arg = bind host. Default loopback; pass 0.0.0.0 to expose on the LAN
# (e.g. to install the PWA on a phone over Wi-Fi).
HOST = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"

class H(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.0 (connection per request). Empirically more robust here than the
    # stdlib's HTTP/1.1 keep-alive under heavy concurrent κ-disk load (keep-alive
    # desynced sooner); ports are not the bottleneck (TIME_WAIT stays tiny). The
    # κ-disk's patient, source-rotating retry rides out transient client glitches.
    pass

    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        # CORS so a κ-disk on one origin can read sectors from OTHER source origins
        # (multi-source verified fetch / bandwidth aggregation). Safe: every sector
        # is verified by re-derivation, so a source is never trusted, only checked.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # SimpleHTTPRequestHandler ignores Range; implement 206 Partial Content so the
    # client can pull just the bytes of one tensor (or the GGUF header) on demand.
    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()
        m = re.match(r"bytes=(\d+)-(\d*)", rng.strip())
        if not m:
            return super().send_head()
        size = os.path.getsize(path)
        # OFFSET WINDOWING (?base=N): the client adds N to its (small) Range so the
        # browser never emits a large byte offset — Chromium hangs on Range offsets
        # past a few GB. The server seeks base+range into the file. Lets a 18 GB
        # κ-disk be read entirely with small client-side offsets.
        base = 0
        q = self.path.split("?", 1)
        if len(q) == 2:
            mb = re.search(r"(?:^|&)base=(\d+)", q[1])
            if mb:
                base = int(mb.group(1))
        start = base + int(m.group(1))
        end = base + (int(m.group(2)) if m.group(2) else (size - 1 - base))
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        length = end - start + 1
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        ctype = self.guess_type(path)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        self._range_remaining = length
        return f

    def copyfile(self, source, outputfile):
        # Honor the Range window when one was set in send_head.
        remaining = getattr(self, "_range_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        self._range_remaining = None
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

print(f"COI _site server (Range-enabled) on http://{HOST}:{PORT}  dir={SITE}", flush=True)
S((HOST, PORT), H).serve_forever()
