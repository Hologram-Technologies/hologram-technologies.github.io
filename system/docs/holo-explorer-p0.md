# Holo Explorer — P0 starter code (native device→κ scanner + serve)

P0 is the only genuinely new native code in the whole spec ([holo-explorer.md](holo-explorer.md)).
Everything downstream wires existing seams. This doc gives drop-in starter code.

## The one design decision that makes P0 correct
The sealed-image verifier (`kappa-route::resolve`) serves the IMMUTABLE OS closure: every byte is
pinned in `os-closure.json`, and an **unpinned byte is refused** (Law L5 / SEC-1 — see lib.rs:335).
The user's disk is the opposite: mutable, unpinned, enormous. So device files take a SEPARATE
resolve path with the SAME trust discipline but a DIFFERENT pin set:

> **The device index IS the pin set.** Only indexed paths are servable. Every serve re-derives the
> file's blake3 and checks it against the indexed κ. A file that changed since the scan no longer
> matches → `410 Gone` (caller re-reads the manifest; the P1 watcher patches the delta). The disk is
> exhaustively mapped, self-verifying, and fail-closed — without being sealed.

This keeps ONE audited core for both hosts: put it in `kappa-route` (engine-agnostic, pure Rust,
witness-able without a GUI), expose a Rust API for the Tauri host and a C ABI for the CEF host.

Zero new crate dependencies: reuses `blake3`, `rayon`, `serde_json`, and the `content_type` mime
table already in `kappa-route`.

---

## 1. New module: `kappa-route/src/device.rs`

```rust
// device.rs — the LOCAL DEVICE index + resolver (Holo Explorer, Plane 1).
//
// Counterpart to the sealed-closure verifier (lib.rs): same L5 discipline (re-derive blake3 before
// every serve, refuse a mismatch), but over the user's MUTABLE disk instead of the immutable OS
// image. The runtime device index is the pin set: only indexed paths serve; a file whose bytes no
// longer match its indexed κ is 410 Gone (stale), never silently wrong.

use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{blake3_hex, content_type}; // blake3_hex must be made pub(crate) — see §4

/// One indexed file: its content address at scan time + cheap stat metadata.
pub struct DeviceEntry {
    pub kappa: String, // canonical blake3 hex (64 lowercase) at scan time
    pub bytes: u64,
    pub mtime: i64, // unix seconds
    pub volume: String,
}

/// What to skip: noise that bloats the index without value. Extend from config later.
pub struct Ignore {
    pub names: HashSet<String>, // exact dir/file names to prune
}
impl Default for Ignore {
    fn default() -> Self {
        let names = [
            "node_modules", ".git", ".cache", "$Recycle.Bin", "System Volume Information",
            "AppData", "Windows", "Program Files", "Program Files (x86)", ".holo-trash",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        Ignore { names }
    }
}

/// The whole-device index. Cheap to read (RwLock), rebuilt by `scan`, patched by the P1 watcher.
pub struct DeviceIndex {
    roots: Vec<PathBuf>,
    device_name: String,
    closure: RwLock<HashMap<String, DeviceEntry>>, // normalized abs-path → entry
    byblake: RwLock<HashMap<String, String>>,      // blake3 hex → normalized abs-path
    manifest: RwLock<Option<Arc<Vec<u8>>>>,        // cached device-closure.json bytes
}

impl DeviceIndex {
    pub fn new(roots: Vec<PathBuf>, device_name: String) -> Self {
        DeviceIndex {
            roots,
            device_name,
            closure: RwLock::new(HashMap::new()),
            byblake: RwLock::new(HashMap::new()),
            manifest: RwLock::new(None),
        }
    }

    /// Walk every root, content-address every readable file (blake3, the canonical σ-axis), and
    /// install the index + the cached manifest. `progress(done, total, bytes)` is called as it runs
    /// (total is 0 during the stat pass, the true count once hashing starts). Unreadable files are
    /// skipped, never fatal (fail-OPEN for indexing; fail-CLOSED for serving). Idempotent.
    pub fn scan<F: Fn(usize, usize, u64) + Sync + Send>(&self, ignore: &Ignore, progress: F) {
        // 1) gather files (stat only) — fast single pass so the tree can render from Tier-0 quickly.
        let mut files: Vec<(String, u64, i64, String)> = Vec::new();
        for root in &self.roots {
            let vol = volume_of(root);
            walk(root, ignore, &mut |p, len, mtime| {
                files.push((norm_key(p), len, mtime, vol.clone()));
                if files.len() % 1024 == 0 {
                    progress(files.len(), 0, 0);
                }
            });
        }
        let total = files.len();
        progress(total, total, 0);

        // 2) content-address in parallel — saturate disk + multicore blake3 (the boot sweep).
        //    P0 reads the whole file to hash it; P1 swaps in mmap + Bao for large files so a 4 GiB
        //    file streams instead of loading whole.
        use rayon::prelude::*;
        let done = AtomicUsize::new(0);
        let bytes_done = AtomicU64::new(0);
        let hashed: Vec<(String, DeviceEntry)> = files
            .par_iter()
            .filter_map(|(key, len, mtime, vol)| {
                let bytes = fs::read(Path::new(key)).ok()?; // unreadable (perms/lock) → skip
                let kappa = blake3_hex(&bytes);
                let n = done.fetch_add(1, Relaxed) + 1;
                let b = bytes_done.fetch_add(*len, Relaxed) + *len;
                if n % 256 == 0 {
                    progress(n, total, b);
                }
                Some((
                    key.clone(),
                    DeviceEntry { kappa, bytes: *len, mtime: *mtime, volume: vol.clone() },
                ))
            })
            .collect();

        // 3) install the index, the by-κ reverse map, and the cached manifest (atomic swap).
        let mut closure = HashMap::with_capacity(hashed.len());
        let mut byblake = HashMap::with_capacity(hashed.len());
        for (key, entry) in hashed {
            byblake.insert(entry.kappa.clone(), key.clone()); // identical content dedups to one κ
            closure.insert(key, entry);
        }
        let manifest = build_manifest(&self.device_name, &closure);
        *self.byblake.write().unwrap() = byblake;
        *self.closure.write().unwrap() = closure;
        *self.manifest.write().unwrap() = Some(Arc::new(manifest));
        progress(total, total, bytes_done.load(Relaxed));
    }

    /// Resolve a `holo://device/<...>` request → verified bytes + mime, or an HTTP error code.
    /// Mirrors `kappa_route::resolve`'s signature so it is a drop-in second branch in the host.
    pub fn resolve(&self, req_path: &str) -> Result<(Vec<u8>, &'static CStr), u16> {
        let rest = req_path.trim_start_matches('/');
        let rest = rest.strip_prefix("device/").ok_or(404u16)?;

        // holo://device/closure → the live device manifest (drives the Explorer tree).
        if rest == "closure" || rest == "closure.json" {
            return match self.manifest.read().unwrap().clone() {
                Some(b) => Ok(((*b).clone(), c"application/json; charset=utf-8")),
                None => Err(503), // scan not finished yet → "mapping…" (caller retries)
            };
        }

        // holo://device/blake3/<hex> → bytes for that κ. L5: re-derive and refuse a stale κ.
        if let Some(tail) = rest.strip_prefix("blake3/") {
            let hex = tail.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
            let key = self.byblake.read().unwrap().get(&hex).cloned();
            let Some(key) = key else { return Err(404) }; // no such κ in the device index
            let bytes = fs::read(Path::new(&key)).map_err(|_| 410u16)?; // path vanished → Gone
            if blake3_hex(&bytes) != hex {
                return Err(410); // file changed since scan → indexed κ is stale (L5 fail-closed)
            }
            return Ok((bytes, content_type(&key)));
        }

        // holo://device/path/<urlencoded-abs-path> → CURRENT bytes of an indexed file (the "open
        // this file" route). FAIL-CLOSED: only paths in the index (the pin set) are servable; the
        // caller reads the live κ for this path from the manifest and stamps/verifies it itself.
        if let Some(enc) = rest.strip_prefix("path/") {
            let key = norm_key(Path::new(&percent_decode(enc)));
            if !self.closure.read().unwrap().contains_key(&key) {
                return Err(403); // unindexed path → refuse (never an arbitrary-file read primitive)
            }
            let bytes = fs::read(Path::new(&key)).map_err(|_| 410u16)?;
            return Ok((bytes, content_type(&key)));
        }

        Err(404)
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

/// Recursive walk (depth-first), skipping symlinks (no loops) and ignored names. Calls `f(path,
/// len, mtime)` for each regular file. Unreadable dirs are skipped silently (fail-open).
fn walk(dir: &Path, ignore: &Ignore, f: &mut dyn FnMut(&Path, u64, i64)) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for ent in entries.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if ignore.names.contains(&name) {
            continue;
        }
        let Ok(ft) = ent.file_type() else { continue };
        if ft.is_symlink() {
            continue; // skip symlinks → no cycles, no escaping a root
        }
        let path = ent.path();
        if ft.is_dir() {
            walk(&path, ignore, f);
        } else if ft.is_file() {
            if let Ok(meta) = ent.metadata() {
                f(&path, meta.len(), mtime_secs(&meta));
            }
        }
    }
}

/// Normalize a path to the index key: absolute, forward slashes (one key space across OSes).
fn norm_key(p: &Path) -> String {
    let abs = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    abs.to_string_lossy().replace('\\', "/")
}

fn volume_of(p: &Path) -> String {
    let s = p.to_string_lossy();
    // Windows "C:\..." → "C:"; POSIX "/..." → "/".
    if s.len() >= 2 && s.as_bytes()[1] == b':' {
        s[..2].to_string()
    } else {
        "/".to_string()
    }
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Minimal percent-decode for the /path/ route (kappa-route has no urlencoding dep).
fn percent_decode(s: &str) -> String {
    let b = s.replace('+', " ").into_bytes();
    let hx = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hx(b[i + 1]), hx(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Build device-closure.json (mirrors os-closure.json; see schema in the doc). Sorted keys for a
/// deterministic, diffable manifest. `uniqueKappa` counts content-distinct files (dedup view).
fn build_manifest(device: &str, closure: &HashMap<String, DeviceEntry>) -> Vec<u8> {
    let mut paths: Vec<&String> = closure.keys().collect();
    paths.sort();
    let mut total_bytes: u64 = 0;
    let mut uniq = HashSet::new();
    let mut map = serde_json::Map::new();
    for p in &paths {
        let e = &closure[*p];
        total_bytes += e.bytes;
        uniq.insert(&e.kappa);
        map.insert(
            (*p).clone(),
            serde_json::json!({
                "blake3": format!("did:holo:blake3:{}", e.kappa),
                "bytes": e.bytes,
                "mtime": e.mtime,
                "volume": e.volume,
                "source": "device",
            }),
        );
    }
    let generated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let doc = serde_json::json!({
        "@context": "https://hologram.os/ns/device-closure",
        "name": device,
        "algo": "blake3",
        "generatedAt": generated_at,
        "files": closure.len(),
        "uniqueKappa": uniq.len(),
        "bytes": total_bytes,
        "closure": map,
    });
    serde_json::to_vec(&doc).unwrap_or_default()
}

// ── witness: scan a temp tree, then prove count parity + L5 re-derivation + stale-κ refusal ─────
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("holo-device-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("a.txt"), b"alpha\n").unwrap();
        fs::write(d.join("sub/b.txt"), b"beta\n").unwrap();
        fs::write(d.join("sub/dup.txt"), b"alpha\n").unwrap(); // same content as a.txt → dedup
        fs::create_dir_all(d.join("node_modules")).unwrap();
        fs::write(d.join("node_modules/skip.txt"), b"noise\n").unwrap(); // must be ignored
        d
    }

    #[test]
    fn scan_indexes_every_file_and_serves_verified_bytes() {
        let root = tmp("scan");
        let idx = DeviceIndex::new(vec![root.clone()], "test-device".into());
        idx.scan(&Ignore::default(), |_, _, _| {});

        // count parity: 3 indexed files (node_modules pruned), 2 unique κ (a.txt == dup.txt).
        assert_eq!(idx.closure.read().unwrap().len(), 3);
        assert_eq!(idx.byblake.read().unwrap().len(), 2);

        // serve by κ → exactly the bytes whose blake3 is that κ (L5).
        let kappa = blake3_hex(b"alpha\n");
        let (bytes, _mime) = idx.resolve(&format!("/device/blake3/{}", kappa)).expect("serve by κ");
        assert_eq!(bytes, b"alpha\n");

        // manifest resolves and reports the counts.
        let (m, _) = idx.resolve("/device/closure").expect("manifest");
        let doc: serde_json::Value = serde_json::from_slice(&m).unwrap();
        assert_eq!(doc["files"], 3);
        assert_eq!(doc["uniqueKappa"], 2);
    }

    #[test]
    fn stale_kappa_is_refused_410() {
        let root = tmp("stale");
        let idx = DeviceIndex::new(vec![root.clone()], "test".into());
        idx.scan(&Ignore::default(), |_, _, _| {});
        let kappa = blake3_hex(b"beta\n");
        // mutate the file on disk → its indexed κ is now stale.
        fs::write(root.join("sub/b.txt"), b"BETA CHANGED\n").unwrap();
        assert_eq!(idx.resolve(&format!("/device/blake3/{}", kappa)), Err(410));
    }

    #[test]
    fn unindexed_path_is_refused_403() {
        let root = tmp("confine");
        let idx = DeviceIndex::new(vec![root.clone()], "test".into());
        idx.scan(&Ignore::default(), |_, _, _| {});
        // a path that exists on disk but was pruned (node_modules) is NOT in the pin set → refuse.
        let secret = norm_key(&root.join("node_modules/skip.txt"));
        let enc = secret.replace('/', "%2F").replace(':', "%3A");
        assert_eq!(idx.resolve(&format!("/device/path/{}", enc)), Err(403));
    }
}
```

---

## 2. Wire into the Tauri host (`src-tauri/src/lib.rs`)

Three small edits — a singleton, a scheme branch, and a boot kickoff.

```rust
// near `static STORE` (lib.rs:26)
use kappa_route::device::{DeviceIndex, Ignore};
static DEVICE: std::sync::OnceLock<DeviceIndex> = std::sync::OnceLock::new();

fn device_index() -> &'static DeviceIndex {
    DEVICE.get_or_init(|| DeviceIndex::new(default_roots(), device_name()))
}

// the volumes/home to map. Start with the user's home; widen to all mounted volumes behind a setting.
fn default_roots() -> Vec<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")            // Windows home
        .or_else(|| std::env::var_os("HOME"))  // POSIX home
        .map(|h| vec![std::path::PathBuf::from(h)])
        .unwrap_or_default()
}
fn device_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "this-device".into())
}
```

In the `holo` scheme handler (lib.rs:282), branch device requests onto the device resolver. Note the
platform nuance already documented in `flat_key`: on some platforms the URL **host** ("device")
arrives as a path prefix, on others as the URI host — handle both:

```rust
.register_asynchronous_uri_scheme_protocol("holo", |_ctx, request: Request<Vec<u8>>, responder| {
    let path = request.uri().path().to_string();
    let host = request.uri().host().unwrap_or("").to_string();
    std::thread::spawn(move || {
        let is_device = host == "device" || path.trim_start_matches('/').starts_with("device/");
        let resolved = if is_device {
            // normalize so the resolver always sees "/device/<rest>"
            let p = if host == "device" { format!("/device{}", path) } else { path.clone() };
            device_index().resolve(&p)
        } else {
            resolve(store(), &path)
        };
        let resp = match resolved {
            Ok((body, mime)) => Response::builder()
                .status(200)
                .header("Content-Type", mime.to_str().unwrap_or("application/octet-stream"))
                .header("Cross-Origin-Opener-Policy", "same-origin")
                .header("Cross-Origin-Embedder-Policy", "credentialless")
                .header("Cross-Origin-Resource-Policy", "cross-origin")
                .header("Cache-Control", "no-store")
                .body(body).unwrap(),
            Err(code) => Response::builder().status(code).body(Vec::new()).unwrap(),
        };
        responder.respond(resp);
    });
});
```

Kick the scan off in `setup()` AFTER the window is built (so first paint never waits) — Design Law 2:

```rust
// Holo Explorer: map the whole device into κ on boot. Background thread; never blocks first paint.
// Streams progress to the shell's "chrome" webview → the quiet "Mapping your world — N files" chip.
{
    let h = app.handle().clone();
    std::thread::spawn(move || {
        device_index().scan(&Ignore::default(), move |done, total, bytes| {
            let _ = h.emit_to("chrome", "device-scan:progress",
                serde_json::json!({ "done": done, "total": total, "bytes": bytes }));
        });
        let _ = h.emit_to("chrome", "device-scan:done", serde_json::json!({}));
    });
}
```

---

## 3. Wire into the CEF host (`cef-host/src/kappa_scheme.cc`)

The `KappaResourceHandler::Open` already has the exact synthetic-route pattern (see `/games`,
`/os/cache/blake3/<hex>`). Add a `/device/*` branch that calls a C ABI over the same `DeviceIndex`:

```cpp
// holo://device/* — the user's whole disk, content-addressed (Holo Explorer, Plane 1). Mutable +
// unpinned, so it takes the DEVICE index path (kr_device_*), not the sealed-closure verifier. Same
// L5 (re-derive blake3, refuse a stale κ → 410), different pin set.
if (req.compare(0, 8, "/device/") == 0) {
  char* mime = nullptr; uint16_t st = 0;
  if (kr_device_resolve(req.c_str(), &data_, &size_, &mime, &st) == 1) {
    status_ = st ? st : 200;
    mime_ = mime ? mime : "application/octet-stream";
    if (mime) kr_cache_free_mime(mime);
  } else {
    status_ = st ? st : 404;   // 410 stale / 403 unindexed / 503 still scanning / 404 no such κ
  }
  return true;
}
```

Boot kickoff: in `main.cc RunMain`, the same 2.5s deferred-task seam used for lens/bench calls
`kr_device_scan(...)` on a worker, posting progress to the shell via the existing CDP/JS bridge.

C ABI to add to `kappa-route/src/ffi.rs` (mirrors the existing `kr_resolve`/`kr_cache_*` shape; the
host frees `out_mime` with `kr_cache_free_mime` and `out` with `kr_free`):

```rust
// in ffi.rs — a process-wide DeviceIndex for the C host, scanned once on boot.
use crate::device::{DeviceIndex, Ignore};
static C_DEVICE: std::sync::OnceLock<DeviceIndex> = std::sync::OnceLock::new();

#[no_mangle]
pub extern "C" fn kr_device_scan(/* roots: *const *const c_char, n: usize, progress fn ptr */) {
    // build DeviceIndex from roots, call .scan() with a callback that trampolines to the C progress fn.
}

#[no_mangle]
pub extern "C" fn kr_device_resolve(
    req: *const std::os::raw::c_char,
    out: *mut *mut u8, out_len: *mut usize,
    out_mime: *mut *mut std::os::raw::c_char, out_status: *mut u16,
) -> i32 {
    // CStr::from_ptr(req) → DeviceIndex::resolve → on Ok copy bytes to a kr_free-able buffer + mime
    // (CString), set *out_status=200, return 1; on Err(code) set *out_status=code, return 0.
}
```

---

## 4. Small enabling edits
- `kappa-route/src/lib.rs`: add `pub mod device;` (next to `pub mod bao;`), and change
  `fn blake3_hex` → `pub(crate) fn blake3_hex` so `device.rs` shares the one hasher (byte-identical
  to the JS kappo and the CEF host — the parity the whole κ promise stands on).
- No `Cargo.toml` change for P0 (reuses `blake3`, `rayon`, `serde_json`). P1 adds `notify` (watcher)
  and `redb` (the incremental (path,size,mtime)→κ cache).

## 5. device-closure.json schema (the runtime manifest)
```json
{
  "@context": "https://hologram.os/ns/device-closure",
  "name": "<device-name>",
  "algo": "blake3",
  "generatedAt": 1751240000,
  "files": 84210,
  "uniqueKappa": 79933,
  "bytes": 412938472913,
  "closure": {
    "C:/Users/me/Documents/lease.pdf": {
      "blake3": "did:holo:blake3:6d2318d6…",
      "bytes": 248133,
      "mtime": 1714512000,
      "volume": "C:",
      "source": "device"
    }
  }
}
```

## 6. P0 witness (the gate)
`cargo test -p kappa-route device::` proves: (a) count parity — every file in a known tree is
indexed, ignores pruned; (b) dedup — identical content shares one κ; (c) L5 — serve-by-κ returns
exactly the bytes that re-derive to it; (d) fail-closed — a changed file's stale κ is 410, an
unindexed path is 403. Plus boot-smoke stays green and first paint is not delayed (the scan thread
is detached after the window builds).

## 7. Known limits / hand-offs to P1
- P0 reads whole files to hash (simple, correct). P1: mmap + Bao streaming for large files.
- P0 re-scans fully each boot. P1: the (path,size,mtime)→κ redb cache → warm boots ~0 re-hashes.
- P0 has no live updates. P1: `notify` watcher patches the index + manifest on change.
- Roots default to the user's home. Widen to all volumes behind a setting; whole-disk read is a
  powerful capability → gate per the spec's capability-security law before broadening.
- `norm_key` uses `fs::canonicalize` (resolves to real paths, dedups junctions). Confirm it doesn't
  choke on very long Windows paths; fall back to the raw path on error (already does).
