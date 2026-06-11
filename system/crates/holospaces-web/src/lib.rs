//! **The Hologram Platform Manager** — holospaces' browser peer.
//!
//! Realizes the *Platform Manager* (arc42 chapter 5,
//! `docs/src/arc42/adoc/05_building_block_view.adoc`) and the *Browser* peer
//! (arc42 chapter 7): the operator console, delivered as wasm and **served from
//! GitHub Pages** (arc42 chapter 3 / chapter 6 cold-start). Loading the
//! κ-addressed bundle makes the browser a peer that *is* the substrate — there
//! is no server (Law L1).
//!
//! This crate is the wasm-bindgen surface over holospaces' Manager model. It
//! composes a full browser peer: an in-memory `KappaStore` (RAM as a cache, Law
//! L3) and hologram's **interpreter `ContainerEngine`** (`hologram-runtime-bare`,
//! a `no_std` `wasmi` interpreter that runs in wasm32 where a JIT cannot). It
//! exposes the console operations — sign in, provision (both compute forms),
//! view, resolve (verify by re-derivation, Law L5), the operator roster (R5),
//! the browser `.holo` engine (RT2, `CC-2`), booting a userland container
//! in-browser through the substrate runtime (the execution surface, ADR-008;
//! `CC-6`), and importing and running a devcontainer in the browser — the
//! Codespaces/Gitpod scenario with no Docker daemon and no cloud VM (arc42
//! chapter 1, the motivating scenario). The same holospace κ boots on this
//! browser peer as on a native or remote one (Q6).
//!
//! It also exposes the **[`Workspace`]** — launching a holospace whose code is
//! the [system emulator](holospaces::emulator) **boots a real operating system
//! in the tab** (`CC-9`) and drives it through the [workspace
//! projection](holospaces::projection) (`CC-11`): a live terminal whose commands
//! are canonical events advancing the holospace's κ snapshot, and an editor that
//! reads and edits environment content by κ — the documented launch experience,
//! realized on the browser peer.

mod opfs_store;
mod wsnet;

use hologram_runtime::Runtime;
use hologram_runtime_bare::BareMetalEngine;
use hologram_store_mem::MemKappaStore;
use hologram_substrate_core::{Capabilities, KappaStore, Realization};
use holospaces::assembly::{assemble_ext4, assemble_ext4_bootable, Layer};
use holospaces::boot::{devcontainer, provision, LifecycleError, ReadVerify, Resolver, Session};
use holospaces::config::{Configuration, Directive, LifecycleAction};
use holospaces::emulator::{aarch64, net, Emulator, Halt};
use holospaces::identity::{Operator, Roster};
use holospaces::machine::MachineSpec;
use holospaces::projection::{Intent, Workspace as Projection};
use holospaces::realizations::{address, verify, Holospace, Kappa, Source};
use holospaces::surface;
use wasm_bindgen::prelude::*;

fn js_err<E: core::fmt::Debug>(e: E) -> JsValue {
    JsValue::from_str(&format!("{e:?}"))
}

fn parse_kappa(kappa: &str) -> Result<Kappa, JsValue> {
    Kappa::from_bytes(kappa.as_bytes()).map_err(|_| JsValue::from_str("not a well-formed κ-label"))
}

/// A capability set with a memory budget; the other authorities default closed
/// (the browser peer is a single-participant content-addressed mesh).
fn capabilities(memory_bytes: f64) -> Capabilities {
    Capabilities {
        storage_roots: Vec::new(),
        storage_quota_bytes: 0,
        network_fetch: false,
        network_announce: false,
        publish_channels: Vec::new(),
        subscribe_channels: Vec::new(),
        memory_max_bytes: memory_bytes as u64,
        cpu_time_per_event_ms: 0,
        priority_weight: 0,
    }
}

/// Drive a substrate-runtime future to completion synchronously. The browser
/// peer's store is local (no network), so the lifecycle futures resolve without
/// yielding — a single poll completes them; the bounded loop fails loud rather
/// than spinning if that invariant is ever violated.
fn block_on<F: core::future::Future>(future: F) -> F::Output {
    use core::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
    fn clone(_: *const ()) -> RawWaker {
        RawWaker::new(core::ptr::null(), &VTABLE)
    }
    fn noop(_: *const ()) {}
    static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
    let waker = unsafe { Waker::from_raw(RawWaker::new(core::ptr::null(), &VTABLE)) };
    let mut cx = Context::from_waker(&waker);
    let mut future = core::pin::pin!(future);
    for _ in 0..1024 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
    }
    panic!("a local substrate-runtime future did not complete without yielding");
}

/// The κ-label of bytes on the substrate's default σ-axis (blake3) — the same
/// content address every peer computes (Law L1).
#[wasm_bindgen]
pub fn kappa(bytes: &[u8]) -> String {
    address(bytes).as_str().to_owned()
}

/// Verify bytes against a claimed κ-label by re-derivation (Law L5). This is
/// what makes content fetched from an untrusted gateway safe.
#[wasm_bindgen]
pub fn verify_kappa(bytes: &[u8], kappa: &str) -> Result<bool, JsValue> {
    verify(bytes, &parse_kappa(kappa)?).map_err(js_err)
}

/// Run a `.holo` compute artifact in the browser via the hologram executor
/// compiled to wasm — the *browser `.holo` engine* (arc42 chapter 11, RT2;
/// conformance `CC-2`). Returns the κ-label of the first output. Because the
/// executor is deterministic and content-addressed, this κ equals the one the
/// native executor produces for the same `.holo` (the browser engine equals the
/// native one).
#[wasm_bindgen]
pub fn run_holo(archive: &[u8]) -> Result<String, JsValue> {
    let outputs = holospaces::engine::HoloEngine::run(archive, &[]).map_err(js_err)?;
    let first = outputs
        .first()
        .ok_or_else(|| JsValue::from_str("the .holo produced no outputs"))?;
    Ok(first.as_str().to_owned())
}

/// Validate that `module` is a recompiled userland fit for the *execution
/// surface* (ADR-008; `CC-6`): specification-valid WebAssembly that imports only
/// the substrate host ABI and presents the container ABI. This is the κ-boundary
/// contract the browser peer enforces before a userland may be a holospace's
/// code — ambient (WASI-style) imports and a missing container ABI are refused.
#[wasm_bindgen]
pub fn validate_userland(module: &[u8]) -> Result<(), JsValue> {
    surface::validate_userland(module).map_err(js_err)
}

/// A devcontainer's OCI image, assembled into a bootable root filesystem *in the
/// browser* — the Layer Assembler (`CC-7` / the in-crate ext4 writer) running as
/// the wasm peer. The operator's page fetches the devcontainer's image layers
/// from the cold-start gateway (verified by re-derivation before they are added),
/// then assembles them here; the result boots over the emulator's `virtio-blk`
/// ([`Workspace::boot_devcontainer`], `CC-14`). The browser peer *is* the
/// machine — no server assembles or boots the OS (Law L1/L4).
#[wasm_bindgen]
pub struct DevcontainerImage {
    layers: Vec<(String, Vec<u8>)>,
}

#[wasm_bindgen]
impl DevcontainerImage {
    /// A new, empty image (add its layers lowest-first with [`Self::add_layer`]).
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> DevcontainerImage {
        DevcontainerImage { layers: Vec::new() }
    }

    /// Add an OCI image layer (its media type + the verified blob bytes), in
    /// order from the base layer up.
    pub fn add_layer(&mut self, media_type: &str, blob: &[u8]) {
        self.layers.push((media_type.to_string(), blob.to_vec()));
    }

    /// Assemble the layers into a bootable `ext4` root filesystem (gunzip +
    /// untar + OCI whiteout overlay + the in-crate ext4 writer; Law L4). The
    /// bytes back a [`Workspace::boot_devcontainer`] machine's `virtio-blk` disk.
    pub fn assemble(&self) -> Result<Vec<u8>, JsValue> {
        let layers: Vec<Layer> = self
            .layers
            .iter()
            .map(|(mt, b)| Layer {
                media_type: mt,
                blob: b,
            })
            .collect();
        assemble_ext4(&layers).map_err(js_err)
    }

    /// Assemble the layers into a **bootable, interactive, writable** root
    /// filesystem on a `disk_bytes`-sized disk: the same overlay as
    /// [`Self::assemble`], plus the persistent devcontainer
    /// [`/init`](holospaces::machine::DEVCONTAINER_INIT) injected — it mounts the
    /// pseudo filesystems and the shared `virtio-9p` workspace and execs a shell,
    /// so the booted OS stays running as a dev environment instead of powering off
    /// after boot — and sized to `disk_bytes` so the OS has room to work (the
    /// devcontainer's disk; the caller's to choose, not a hidden cap). The base
    /// image must provide a static `/bin/busybox`.
    pub fn assemble_bootable(&self, disk_bytes: f64) -> Result<Vec<u8>, JsValue> {
        let layers: Vec<Layer> = self
            .layers
            .iter()
            .map(|(mt, b)| Layer {
                media_type: mt,
                blob: b,
            })
            .collect();
        assemble_ext4_bootable(
            &layers,
            holospaces::machine::DEVCONTAINER_INIT,
            disk_bytes as u64,
        )
        .map_err(js_err)
    }

    /// Like [`Self::assemble_bootable`], but inject the **real-OCI-image** `/init`
    /// ([`REAL_IMAGE_INIT`](holospaces::machine::REAL_IMAGE_INIT), `CC-42`) — for a
    /// repository's own base image (debian, ubuntu, buildpack-deps) that ships its
    /// own `/bin/sh` + coreutils + `mount` rather than a static `/bin/busybox`. It
    /// mounts the pseudo-filesystems + the shared `virtio-9p` workspace with the
    /// image's tools and execs its login shell (`bash` if present, else `sh`), so a
    /// stock Debian image boots to its real interactive shell.
    pub fn assemble_bootable_real(&self, disk_bytes: f64) -> Result<Vec<u8>, JsValue> {
        let layers: Vec<Layer> = self
            .layers
            .iter()
            .map(|(mt, b)| Layer {
                media_type: mt,
                blob: b,
            })
            .collect();
        assemble_ext4_bootable(
            &layers,
            holospaces::machine::REAL_IMAGE_INIT,
            disk_bytes as u64,
        )
        .map_err(js_err)
    }

    /// Like [`Self::assemble_bootable_real`], but stream the ext4 image **straight
    /// into an OPFS file** (`CC-50`, the sparse streaming Rootfs Assembly): only the
    /// non-zero blocks are written (the free data region stays a sparse hole), so
    /// even a multi-GiB disk assembles **without ever materializing a dense buffer**
    /// in wasm RAM — peak working memory tracks the image's *content*, not its
    /// declared size ("the KappaStore IS the memory, RAM is a cache", Laws L3/L4).
    /// `rootfs_handle` is a worker sync access handle on the rootfs file; returns the
    /// total image length (a whole number of sectors). The page then boots it
    /// off-heap with [`Workspace::boot_devcontainer_opfs_streamed`] — neither
    /// provisioning nor boot ever holds the whole image in RAM (the lean,
    /// substrate-native path).
    pub fn assemble_bootable_into_opfs(
        &self,
        rootfs_handle: web_sys::FileSystemSyncAccessHandle,
        disk_bytes: f64,
        real: bool,
    ) -> Result<f64, JsValue> {
        // Select the injected /init exactly as the flat assemblers do: a real OCI
        // base (debian/ubuntu) runs its own /bin/sh login shell (REAL_IMAGE_INIT,
        // CC-42); a static-busybox base runs `/bin/busybox sh` (DEVCONTAINER_INIT,
        // CC-22 — busybox images have no /bin/sh, only /bin/busybox).
        let init = if real {
            holospaces::machine::REAL_IMAGE_INIT
        } else {
            holospaces::machine::DEVCONTAINER_INIT
        };
        let layers = self.layers.clone();
        let mut layer_idx = 0usize;
        let next_layer =
            move || -> Result<Option<(String, Vec<u8>)>, holospaces::assembly::AssemblyError> {
                if layer_idx >= layers.len() {
                    return Ok(None);
                }
                let i = layer_idx;
                layer_idx += 1;
                Ok(Some((layers[i].0.clone(), layers[i].1.clone())))
            };
        let mut io_err: Option<JsValue> = None;
        let geom = holospaces::assembly::stream_ext4_image_bootable_streamed_layers(
            next_layer,
            init,
            disk_bytes as u64,
            |block_index, bytes| {
                if io_err.is_some() {
                    return;
                }
                let opts = web_sys::FileSystemReadWriteOptions::new();
                opts.set_at((block_index * bytes.len() as u64) as f64);
                if let Err(e) = rootfs_handle.write_with_u8_array_and_options(bytes, &opts) {
                    io_err = Some(e);
                }
            },
        )
        .map_err(js_err)?;
        if let Some(e) = io_err {
            return Err(e);
        }
        let image_len = geom.image_len();
        // Grow the file to span the full image so the trailing sparse region reads
        // back as zeros (OPFS truncate grows with a hole — no bytes written).
        rootfs_handle.truncate_with_f64(image_len as f64)?;
        Ok(image_len as f64)
    }
}

impl Default for DevcontainerImage {
    fn default() -> Self {
        Self::new()
    }
}

/// The Platform Manager console, running as a browser peer that composes the
/// substrate runtime over the interpreter `ContainerEngine`.
#[wasm_bindgen]
pub struct Console {
    runtime: Runtime<BareMetalEngine, MemKappaStore>,
    operator: Option<Operator>,
    holospaces: Vec<Kappa>,
    /// The latest configuration published per instance — `(instance κ, config κ,
    /// next seq)` (ADR-018; the control plane's reconfiguration record).
    configs: Vec<(Kappa, Kappa, u64)>,
}

impl Default for Console {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Console {
    /// Open a fresh console — a browser peer with a local content-addressed
    /// store and the interpreter container engine.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Console {
        Console {
            runtime: Runtime::new(BareMetalEngine::new(), MemKappaStore::new()),
            operator: None,
            holospaces: Vec::new(),
            configs: Vec::new(),
        }
    }

    /// Sign in by unlocking a self-sovereign key (not a server account,
    /// ADR-001). Returns the operator's content-addressed identity κ.
    pub fn sign_in(&mut self, key: &[u8]) -> String {
        let operator = Operator::from_public_key(key);
        let identity = operator.identity().as_str().to_owned();
        self.operator = Some(operator);
        identity
    }

    /// Provision a holospace from a `.holo` compute artifact (the *holo-file*
    /// compute form) with a memory budget, κ-addressing its parts into the
    /// peer's store (Law L2). Returns the holospace identity κ.
    pub fn provision(&mut self, code: &[u8], memory_bytes: f64) -> Result<String, JsValue> {
        let artifact = self.runtime.store().put("blake3", code).map_err(js_err)?;
        self.provision_source(Source::HoloFile { artifact }, memory_bytes)
    }

    /// Provision a holospace from a **devcontainer** for the management console
    /// (CC-12): the `devcontainer.json` is validated against the Dev Container
    /// spec (`CC-4`) and κ-addressed into the store; the holospace's identity is
    /// the content address of its devcontainer definition (reproducible — same
    /// source ⇒ same κ, Law L1). This *provisions* (records) the holospace; the
    /// operator *enters* it to boot its OS in the workspace IDE (`CC-13`).
    /// Returns the holospace identity κ.
    pub fn provision_devcontainer(
        &mut self,
        config_json: &[u8],
        arch: &str,
        memory_bytes: f64,
    ) -> Result<String, JsValue> {
        devcontainer::parse(config_json).map_err(js_err)?;
        let config = self
            .runtime
            .store()
            .put("blake3", config_json)
            .map_err(js_err)?;
        // The operator's **architecture** selection (`riscv64`/`aarch64`, the
        // Manager's arch picker — ADR-021) is part of the source, hence part of
        // the holospace's content-addressed identity (Law L1): it is fixed for
        // the guest's life, and the same devcontainer config under two ISAs is
        // two distinct holospaces. (Other guest settings —
        // lifecycle/network/storage/account — are mutable `CC-28` directives via
        // [`Console::configure`].) The locally-supplied config doubles as the
        // userland reference; the arch-specific emulator surface is resolved at
        // boot (`CC-9`).
        let source = Source::Devcontainer {
            repo: String::new(),
            reference: String::new(),
            config_path: "devcontainer.json".to_owned(),
            config,
            userland: config,
            arch: holospaces::Arch::from_id(arch).unwrap_or_default(),
        };
        self.provision_source(source, memory_bytes)
    }

    /// Provision a holospace from a *Wasm-recompiled userland* (the execution
    /// surface, the second compute form — ADR-008). The module is validated
    /// against the surface contract ([`validate_userland`]) before it is
    /// κ-addressed into the store, so only a substrate-valid userland can become
    /// a holospace's code. Returns the holospace identity κ.
    pub fn provision_userland(
        &mut self,
        module: &[u8],
        memory_bytes: f64,
    ) -> Result<String, JsValue> {
        surface::validate_userland(module).map_err(js_err)?;
        let entry = self.runtime.store().put("blake3", module).map_err(js_err)?;
        self.provision_source(Source::Userland { entry }, memory_bytes)
    }

    /// Boot a userland holospace **in the browser**: provision it, then spawn it
    /// through the substrate runtime over the interpreter `ContainerEngine`,
    /// capture a κ snapshot of its state (suspend), resume, and terminate — the
    /// execution surface running on the browser peer (ADR-008; RT2; `CC-6`).
    /// Returns the κ-label of the suspend snapshot (state is content, Law L3).
    pub fn boot_userland(&mut self, module: &[u8], memory_bytes: f64) -> Result<String, JsValue> {
        surface::validate_userland(module).map_err(js_err)?;
        let entry = self.runtime.store().put("blake3", module).map_err(js_err)?;
        let holospace = provision(
            self.runtime.store(),
            Source::Userland { entry },
            capabilities(memory_bytes),
        )
        .map_err(js_err)?;
        self.record(&holospace)?;
        Ok(self.boot(holospace)?.as_str().to_owned())
    }

    /// Import and run a **devcontainer in the browser** — the Codespaces/Gitpod
    /// scenario without a Docker daemon or a cloud VM (arc42 chapter 1, the
    /// motivating scenario; chapter 6). The `devcontainer.json` is validated
    /// against the Dev Container spec (`CC-4`); the κ-addressed Wasm `userland`
    /// its config selects is validated against the host-ABI surface (`CC-6`) and
    /// booted through the substrate runtime over the interpreter engine — same
    /// lifecycle as a native or remote peer (Q6). Returns the suspend snapshot κ.
    ///
    /// `arch` is the operator's **architecture selection** (the Manager GUI's
    /// arch picker; ADR-021) — `"riscv64"` or `"aarch64"`. It becomes part of the
    /// holospace's content-addressed identity, so it is fixed for the holospace's
    /// lifetime (an unknown id falls back to the default RISC-V target).
    // A flat JS-facing signature (the repository URL, reference, config path,
    // config + userland bytes, the architecture, and the memory budget) — the
    // wasm-bindgen boundary takes scalars/byte-slices, not a Rust struct.
    #[allow(clippy::too_many_arguments)]
    pub fn run_devcontainer(
        &mut self,
        repo: &str,
        reference: &str,
        config_path: &str,
        config_json: &[u8],
        userland_module: &[u8],
        arch: &str,
        memory_bytes: f64,
    ) -> Result<String, JsValue> {
        devcontainer::parse(config_json).map_err(js_err)?;
        surface::validate_userland(userland_module).map_err(js_err)?;
        let userland = self
            .runtime
            .store()
            .put("blake3", userland_module)
            .map_err(js_err)?;
        let config = self
            .runtime
            .store()
            .put("blake3", config_json)
            .map_err(js_err)?;
        let source = Source::Devcontainer {
            repo: repo.to_owned(),
            reference: reference.to_owned(),
            config_path: config_path.to_owned(),
            config,
            userland,
            arch: holospaces::Arch::from_id(arch).unwrap_or_default(),
        };
        let holospace =
            provision(self.runtime.store(), source, capabilities(memory_bytes)).map_err(js_err)?;
        self.record(&holospace)?;
        Ok(self.boot(holospace)?.as_str().to_owned())
    }

    fn provision_source(&mut self, source: Source, memory_bytes: f64) -> Result<String, JsValue> {
        let holospace =
            provision(self.runtime.store(), source, capabilities(memory_bytes)).map_err(js_err)?;
        self.record(&holospace)?;
        Ok(holospace.kappa().as_str().to_owned())
    }

    /// Record a provisioned holospace in the View and persist the roster.
    fn record(&mut self, holospace: &Holospace) -> Result<(), JsValue> {
        let kappa = holospace.kappa();
        if !self.holospaces.contains(&kappa) {
            self.holospaces.push(kappa);
        }
        self.persist_roster()
    }

    /// Boot a holospace through the substrate runtime over the interpreter
    /// engine, returning the κ snapshot of its suspended state. The lifecycle
    /// (boot → suspend → resume → terminate) runs entirely in the browser peer.
    fn boot(&self, holospace: Holospace) -> Result<Kappa, JsValue> {
        block_on(async {
            let mut session = Session::provision(&self.runtime, holospace);
            session.boot().await?;
            let snapshot = session.suspend().await?;
            session.resume().await?;
            session.terminate().await?;
            Ok::<Kappa, LifecycleError>(snapshot)
        })
        .map_err(js_err)
    }

    /// The console's View — a JSON projection of the operator and their
    /// holospaces (what the UI renders).
    pub fn view(&self) -> String {
        let operator = self.operator.as_ref().map_or("", |o| o.identity().as_str());
        let holospaces: Vec<&str> = self.holospaces.iter().map(Kappa::as_str).collect();
        serde_json::json!({ "operator": operator, "holospaces": holospaces }).to_string()
    }

    /// Resolve a holospace (or any κ) from this peer's own in-session store.
    /// Returns the bytes, or `undefined` if absent.
    ///
    /// This is a *trusted* read ([`ReadVerify::Trusted`], ADR-019): the store is
    /// the canonical memory and RAM is its cache (Law L3), so content that
    /// entered this session was already verified on the way in (on receipt, or
    /// by `put` construction). The deployed peer does not re-derive κ on every
    /// local read — that would treat its own canonical store as untrusted and is
    /// pure overhead. The re-derivation invariant still holds where untrusted
    /// bytes enter (the import/fetch boundary) and is exercised end-to-end in CI.
    pub fn resolve(&self, kappa: &str) -> Result<Option<Vec<u8>>, JsValue> {
        let kappa = parse_kappa(kappa)?;
        Resolver::resolve_local_with(self.runtime.store(), &kappa, ReadVerify::Trusted)
            .map(|opt| opt.map(|b| b.to_vec()))
            .map_err(js_err)
    }

    /// The operator's roster κ — the content address that links their instances
    /// (R5). Its bytes are in the store, so another instance can resolve it.
    pub fn roster_kappa(&self) -> Option<String> {
        self.operator.as_ref().map(|op| {
            Roster::new(op, self.holospaces.clone())
                .kappa()
                .as_str()
                .to_owned()
        })
    }

    fn persist_roster(&self) -> Result<(), JsValue> {
        if let Some(op) = &self.operator {
            let roster = Roster::new(op, self.holospaces.clone());
            self.runtime
                .store()
                .put("blake3", &roster.canonicalize())
                .map_err(js_err)?;
        }
        Ok(())
    }

    /// *Control panel: configure.* Reconfigure a running instance from the panel
    /// (ADR-018; `CC-28`). `directives_json` is a JSON array of operations across
    /// the four classes, e.g. `[{"lifecycle":"suspend"}, {"forwardPort":8080},
    /// {"unforwardPort":8080}, {"network":{"fetch":true,"announce":false}},
    /// {"quota":1073741824}, {"grant":"blake3:…"}]`. The panel builds a
    /// content-addressed [`Configuration`] issued by the signed-in operator,
    /// stores it (Law L2), and returns its κ — the content the running instance
    /// resolves and applies over the substrate (no server, no RPC).
    pub fn configure(&mut self, instance: &str, directives_json: &str) -> Result<String, JsValue> {
        let operator = self
            .operator
            .as_ref()
            .ok_or_else(|| JsValue::from_str("sign in before configuring an instance"))?
            .identity()
            .to_owned();
        let instance = parse_kappa(instance)?;
        let directives = parse_directives(directives_json)?;
        let seq = self
            .configs
            .iter()
            .find(|(i, _, _)| *i == instance)
            .map_or(0, |(_, _, next)| *next);
        let config = Configuration::new(operator, instance, seq, directives);
        let kappa = config.kappa();
        self.runtime
            .store()
            .put("blake3", &config.canonicalize())
            .map_err(js_err)?;
        match self.configs.iter_mut().find(|(i, _, _)| *i == instance) {
            Some(entry) => {
                entry.1 = kappa;
                entry.2 = seq + 1;
            }
            None => self.configs.push((instance, kappa, seq + 1)),
        }
        Ok(kappa.as_str().to_owned())
    }
}

/// Parse the control panel's directive JSON (`Console::configure`).
fn parse_directives(json: &str) -> Result<Vec<Directive>, JsValue> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&format!("directives: {e}")))?;
    let mut out = Vec::with_capacity(arr.len());
    for d in &arr {
        let directive = if let Some(a) = d.get("lifecycle").and_then(|v| v.as_str()) {
            let action = match a {
                "start" => LifecycleAction::Start,
                "suspend" => LifecycleAction::Suspend,
                "resume" => LifecycleAction::Resume,
                "terminate" => LifecycleAction::Terminate,
                other => return Err(JsValue::from_str(&format!("unknown lifecycle: {other}"))),
            };
            Directive::Lifecycle(action)
        } else if let Some(p) = d.get("forwardPort").and_then(serde_json::Value::as_u64) {
            Directive::ForwardPort(u16::try_from(p).map_err(|_| JsValue::from_str("bad port"))?)
        } else if let Some(p) = d.get("unforwardPort").and_then(serde_json::Value::as_u64) {
            Directive::UnforwardPort(u16::try_from(p).map_err(|_| JsValue::from_str("bad port"))?)
        } else if let Some(n) = d.get("network") {
            Directive::SetNetwork {
                fetch: n
                    .get("fetch")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                announce: n
                    .get("announce")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            }
        } else if let Some(q) = d.get("quota").and_then(serde_json::Value::as_u64) {
            Directive::SetStorageQuota(q)
        } else if let Some(op) = d.get("grant").and_then(|v| v.as_str()) {
            Directive::GrantAccess(parse_kappa(op)?)
        } else {
            return Err(JsValue::from_str("unrecognized directive"));
        };
        out.push(directive);
    }
    Ok(out)
}

/// A **workspace** over a running holospace, in the browser tab — the
/// Codespaces/Gitpod experience (ADR-009; `CC-9` + `CC-11`). The operator
/// launches a holospace whose code is the system emulator; it **boots a real
/// operating system** (the [system emulator](holospaces::emulator) running in
/// the browser's own wasm engine), and the [workspace
/// projection](holospaces::projection) drives it: a live **terminal**
/// (keystrokes published as canonical events that advance the holospace's κ
/// snapshot) and an **editor** that reads and edits environment content *by κ*.
///
/// The boot runs in instruction *chunks* ([`run`](Workspace::run)) so the UI
/// stays responsive and can stream the console as the kernel boots — there is no
/// server doing the work; the browser peer *is* the machine (Law L1).
#[wasm_bindgen]
pub struct Workspace {
    machine: Emulator,
    store: MemKappaStore,
    channel: Vec<Kappa>,
    files: std::collections::BTreeMap<String, Kappa>,
    halted: bool,
    /// The next unread byte of the console buffer — the cursor [`Workspace::terminal_delta`]
    /// advances, so the integrated terminal streams only newly-produced output
    /// instead of re-reading the whole console each tick.
    console_cursor: usize,
}

#[wasm_bindgen]
impl Workspace {
    /// Launch a workspace: place the OS `kernel` image and `dtb` in a machine
    /// with `ram_bytes` of RAM at `base`, the device tree at `dtb_addr`, and hand
    /// off as the SBI firmware. The machine is now booting (drive it with
    /// [`run`](Workspace::run)).
    pub fn boot(
        kernel: &[u8],
        dtb: &[u8],
        ram_bytes: f64,
        base: f64,
        dtb_addr: f64,
    ) -> Result<Workspace, JsValue> {
        let mut machine = Emulator::new(base as u64, ram_bytes as usize);
        machine
            .boot_kernel(kernel, dtb, dtb_addr as u64)
            .map_err(js_err)?;
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Boot a **devcontainer** workspace: the Boot Orchestrator
    /// ([`MachineSpec`](holospaces::machine::MachineSpec)) generates the device
    /// tree and boots `kernel` on a machine whose `virtio-blk` disk is the
    /// assembled `rootfs` (from [`DevcontainerImage::assemble`]). The guest
    /// kernel mounts the rootfs over `/dev/vda` and runs the devcontainer's real
    /// OS — entirely in the browser peer (`CC-14`). Drive it with
    /// [`run`](Workspace::run), exactly like [`boot`](Workspace::boot).
    pub fn boot_devcontainer(kernel: &[u8], rootfs: &[u8]) -> Result<Workspace, JsValue> {
        // Attach the shared `virtio-9p` workspace (CC-15) so the workbench's
        // FileSystemProvider (`ws_list`/`ws_read`/`ws_write`) and the OS share the
        // same files — the editor edits the content the devcontainer OS sees.
        let machine = MachineSpec::devcontainer()
            .boot_workspace(kernel, rootfs.to_vec(), &[])
            .map_err(js_err)?;
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Boot a devcontainer with the disk **streamed** off-heap into an OPFS-backed
    /// κ-store (the substrate-native, lean path — ADR/CC-9.d). `rootfs_handle` is a
    /// sync access handle on the provisioned rootfs file (read sector-by-sector,
    /// never materialized as a `Vec` in wasm RAM); `disk_handle` is the OPFS κ-store
    /// pack. Identical sectors dedup to one κ and all-zero sectors stay sparse, so a
    /// real image boots without holding it in RAM — "the KappaStore IS the memory,
    /// RAM is a cache" (Law L3). Non-networked (busybox/Debian dev box); drive with
    /// [`run`](Workspace::run).
    pub fn boot_devcontainer_opfs_streamed(
        kernel: &[u8],
        rootfs_handle: web_sys::FileSystemSyncAccessHandle,
        disk_handle: web_sys::FileSystemSyncAccessHandle,
    ) -> Result<Workspace, JsValue> {
        let store = Box::new(opfs_store::OpfsKappaStore::new(disk_handle));
        let total = rootfs_handle.get_size().map_err(js_err)? as u64;
        let sector_count = total.div_ceil(512);
        // Wrap the handle Send so the lazy loader (held by the engine for the
        // workspace's life) satisfies its `Send + 'static` bound. The κ-disk pages
        // each sector from this handle on first touch, off the wasm heap.
        let rootfs = opfs_store::SendSyncHandle(rootfs_handle);
        let read = move |i: u64, buf: &mut [u8]| {
            let opts = web_sys::FileSystemReadWriteOptions::new();
            opts.set_at((i * 512) as f64);
            // A short read at the tail leaves the rest of `buf` zero (sparse pad).
            let _ = rootfs.0.read_with_u8_array_and_options(buf, &opts);
        };
        let machine = MachineSpec::devcontainer()
            .boot_workspace_streamed(kernel, sector_count, read, &[], store)
            .map_err(js_err)?;
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Boot a **networked** devcontainer workspace (`CC-16`): like
    /// [`boot_devcontainer`](Workspace::boot_devcontainer), but the machine also
    /// has a `virtio-net` device whose userspace TCP/IP NAT tunnels the guest's
    /// TCP streams out over a WebSocket to the relay at `relay_url` (there is no
    /// raw NIC behind a tab; ADR-014). The guest brings its interface up with
    /// DHCP and can then reach the internet — `git clone`, `apt`, `npm` — from the
    /// browser peer. Drive it with [`run`](Workspace::run), yielding to the event
    /// loop between chunks so the WebSocket delivers host-side bytes.
    pub fn boot_devcontainer_net(
        kernel: &[u8],
        rootfs: &[u8],
        relay_url: &str,
    ) -> Result<Workspace, JsValue> {
        let egress = wsnet::WsEgress::connect_relay(relay_url)?;
        let machine = MachineSpec::devcontainer_net()
            .boot_net(kernel, rootfs.to_vec(), Box::new(egress))
            .map_err(js_err)?;
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Boot a devcontainer with the **in-process loopback bridge** enabled
    /// (ADR-020, `CC-33`): the guest's interface comes up with DHCP (so it has a
    /// real TCP stack), but instead of a WebSocket egress to the internet it gets
    /// a no-op egress and the *loopback ingress* — so the workbench, in this same
    /// process, can [`dial_guest`](Workspace::dial_guest) a server *inside* the
    /// devcontainer (a language server, a remote extension host) and exchange a
    /// byte stream with it, with no relay or socket. This is the transport the VS
    /// Code remote model runs over in the browser peer (ADR-015/ADR-020). Drive it
    /// with [`run`](Workspace::run), pumping the NAT so the bridge's bytes flow.
    pub fn boot_devcontainer_bridged(kernel: &[u8], rootfs: &[u8]) -> Result<Workspace, JsValue> {
        let mut machine = MachineSpec::devcontainer_net()
            .boot_workspace_net(kernel, rootfs.to_vec(), &[], Box::new(net::NoEgress))
            .map_err(js_err)?;
        machine.enable_loopback();
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Suspend the running machine to a κ snapshot — the canonical,
    /// content-addressed bytes of the whole machine: CPU, RAM, the rootfs disk,
    /// and the *workspace files* (virtio-9p). The browser persists these (gzipped)
    /// to OPFS so the next launch *resumes* instead of cold-booting (`CC-30`).
    /// Most of guest RAM is zero, so the gzipped snapshot is a small fraction of
    /// the machine size.
    pub fn suspend(&self) -> Vec<u8> {
        self.machine.snapshot()
    }

    /// Resume a devcontainer workspace from a κ snapshot [`suspend`](Workspace::suspend)
    /// produced, instead of cold-booting it (`CC-30`). The running OS, its disk,
    /// and the workspace files come back exactly — so a second launch skips the
    /// boot entirely and the editor's content is intact. The snapshot's integrity
    /// is the caller's to check by re-derivation before trusting it across a
    /// session boundary (Law L5; ADR-019) — OPFS is durable but untrusted storage.
    pub fn resume_devcontainer(snapshot: &[u8]) -> Result<Workspace, JsValue> {
        let base = MachineSpec::devcontainer().base;
        let machine = Emulator::restore(base, snapshot).map_err(js_err)?;
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Resume a **streamed** devcontainer (`CC-30`, the instant warm start for the
    /// lean off-heap κ-disk): like [`resume_devcontainer`](Workspace::resume_devcontainer),
    /// but re-attach the lazy κ-disk's rootfs `loader` from a re-opened OPFS handle —
    /// so the resumed machine pages its *untouched* sectors from the immutable rootfs
    /// again. The content-addressed snapshot carried only the touched disk delta +
    /// the non-zero RAM pages, so resume is O(working set), not O(disk+RAM).
    pub fn resume_devcontainer_streamed(
        snapshot: &[u8],
        rootfs_handle: web_sys::FileSystemSyncAccessHandle,
    ) -> Result<Workspace, JsValue> {
        let base = MachineSpec::devcontainer().base;
        let mut machine = Emulator::restore(base, snapshot).map_err(js_err)?;
        let rootfs = opfs_store::SendSyncHandle(rootfs_handle);
        machine.set_disk_loader(move |i: u64, buf: &mut [u8]| {
            let opts = web_sys::FileSystemReadWriteOptions::new();
            opts.set_at((i * 512) as f64);
            let _ = rootfs.0.read_with_u8_array_and_options(buf, &opts);
        });
        Ok(Workspace {
            machine,
            store: MemKappaStore::new(),
            channel: Vec::new(),
            files: std::collections::BTreeMap::new(),
            halted: false,
            console_cursor: 0,
        })
    }

    /// Advance the running holospace by `budget` instructions (one chunk of the
    /// boot or of servicing input). Returns `true` once the machine has halted
    /// (powered off). Call repeatedly from a UI loop, rendering
    /// [`terminal`](Workspace::terminal) between chunks.
    pub fn run(&mut self, budget: f64) -> bool {
        if self.halted {
            return true;
        }
        if !matches!(self.machine.run(budget as u64), Halt::OutOfBudget) {
            self.halted = true;
        }
        self.halted
    }

    /// Whether the machine has powered off.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn halted(&self) -> bool {
        self.halted
    }

    /// The rendered terminal — the console the running holospace has produced.
    #[must_use]
    pub fn terminal(&self) -> String {
        String::from_utf8_lossy(self.machine.console()).into_owned()
    }

    /// Whether the terminal has rendered `marker` yet (e.g. the ready banner).
    #[must_use]
    pub fn shows(&self, marker: &str) -> bool {
        self.machine
            .console()
            .windows(marker.len())
            .any(|w| w == marker.as_bytes())
    }

    /// Type a line into the terminal: publish it as a canonical event on the
    /// holospace's channel (Law L1/L2), feed the keystrokes to the running
    /// machine, and run until the response settles. The holospace's κ snapshot
    /// advances. Returns the event's κ.
    pub fn type_line(&mut self, line: &str) -> String {
        // Feed the keystrokes + advance the machine (the projection runs the same
        // intent on the live OS).
        {
            let mut projection = Projection::attach(&mut self.machine);
            projection.type_line(line, 400_000_000);
        }
        // Publish the event as *resolvable content* on the channel: the canonical
        // event bytes are stored, so its κ re-derives and resolves (the KappaStore
        // IS the memory, Law L3) — not a dangling label. `put` content-addresses,
        // so the stored κ equals the event's identity (Law L1/L2).
        let canonical = Intent::Type(line.to_owned()).canonicalize();
        let event = self
            .store
            .put("blake3", &canonical)
            .unwrap_or_else(|_| address(&canonical));
        let event_str = event.as_str().to_owned();
        self.channel.push(event);
        // The `exit` line powers the machine off; reflect that in the workspace.
        if self.shows("WORKSPACE-DONE") {
            self.halted = true;
        }
        event_str
    }

    /// Feed **raw terminal input** to the running holospace — the bytes an
    /// interactive terminal delivers for each keystroke, *unbuffered*: ordinary
    /// characters, control bytes (Ctrl-C = `0x03`, Ctrl-D = `0x04`), and escape
    /// sequences (arrows, Home/End). Unlike [`Workspace::type_line`] this does not
    /// line-buffer or block: the bytes go to the guest console and the caller's
    /// render loop ([`Workspace::run`] + [`Workspace::terminal_delta`]) advances
    /// the machine, so the guest's own tty echoes and edits the line and Ctrl-C
    /// raises SIGINT — a real terminal, not a line submitter. The input is part of
    /// the machine's canonical state (it is captured in the κ snapshot), so the
    /// session stays reproducible (Law L1).
    pub fn feed_input(&mut self, bytes: &[u8]) {
        self.machine.feed_console(bytes);
    }

    /// The console bytes produced **since the last call** (an internal cursor),
    /// for the integrated terminal's render loop. Returning only the delta avoids
    /// re-reading and re-encoding the whole console each tick — output stays O(new
    /// bytes), not O(total) per frame. Returns raw bytes (the terminal decodes
    /// them); [`Workspace::terminal`] still returns the full buffer for tests.
    pub fn terminal_delta(&mut self) -> Vec<u8> {
        let console = self.machine.console();
        let from = self.console_cursor.min(console.len());
        let delta = console[from..].to_vec();
        self.console_cursor = console.len();
        delta
    }

    /// Dial an in-process connection to a server *inside* the devcontainer,
    /// listening on `guest_port`, over the loopback substrate bridge (ADR-020,
    /// `CC-33`). Returns the connection id, or `None` if the machine was not booted
    /// with the bridge ([`boot_devcontainer_bridged`](Workspace::boot_devcontainer_bridged)).
    /// The workbench uses this to reach a language server / the remote extension
    /// host (ADR-015) without a relay or socket. Pump with [`run`](Workspace::run)
    /// so the NAT opens the connection and the byte stream flows.
    pub fn dial_guest(&mut self, guest_port: u16) -> Option<u32> {
        self.machine.dial_guest(guest_port)
    }

    /// Write bytes toward the guest server on a loopback connection (`CC-33`).
    pub fn guest_send(&mut self, id: u32, data: &[u8]) {
        self.machine.guest_send(id, data);
    }

    /// Drain the guest server's reply bytes on a loopback connection (empty until
    /// the machine is pumped enough for the stream to advance; `CC-33`).
    pub fn guest_recv(&mut self, id: u32) -> Vec<u8> {
        self.machine.guest_recv(id)
    }

    /// Close the host side of a loopback connection (`CC-33`).
    pub fn guest_close(&mut self, id: u32) {
        self.machine.guest_close(id);
    }

    /// Whether a loopback connection is still usable — the guest has not closed it,
    /// or has but unread bytes remain (`CC-33`).
    #[must_use]
    pub fn guest_is_open(&self, id: u32) -> bool {
        self.machine.guest_is_open(id)
    }

    /// The running holospace's κ snapshot — its canonical state (Law L1/L3/L5).
    #[must_use]
    pub fn state_kappa(&self) -> String {
        address(&self.machine.snapshot()).as_str().to_owned()
    }

    /// The κ of every operator event published on the terminal channel so far.
    #[must_use]
    pub fn channel(&self) -> Vec<JsValue> {
        self.channel
            .iter()
            .map(|k| JsValue::from_str(k.as_str()))
            .collect()
    }

    /// The **editor** surface: save a file's content (the operator's edit). The
    /// content is κ-addressed into the substrate (Law L2), so the returned κ is
    /// the file's new identity — an edit advances it (Law L1). The canonical edit
    /// event for `path` is published on the channel.
    pub fn save_file(&mut self, path: &str, content: &[u8]) -> Result<String, JsValue> {
        let intent = Intent::Edit {
            path: path.to_owned(),
            content: content.to_vec(),
        };
        // Publish the canonical event as *resolvable content* on the channel — its
        // bytes are stored so the κ re-derives and resolves (Law L1/L3), not a
        // dangling label — then store the file content itself.
        let event = self
            .store
            .put("blake3", &intent.canonicalize())
            .map_err(js_err)?;
        self.channel.push(event);
        let stored = self.store.put("blake3", content).map_err(js_err)?;
        self.files.insert(path.to_owned(), stored);
        Ok(stored.as_str().to_owned())
    }

    /// The editor's read: fetch a file's content *by κ*, verifying it by
    /// re-derivation (Law L5). `undefined` if it is not in the workspace store.
    pub fn open_file(&self, kappa: &str) -> Result<Option<Vec<u8>>, JsValue> {
        let kappa = parse_kappa(kappa)?;
        self.store
            .get(&kappa)
            .map(|opt| opt.map(|b| b.to_vec()))
            .map_err(js_err)
    }

    /// The **file tree**: the workspace's files as a JSON array of
    /// `{ path, kappa }` — each file's current content κ (its identity, Law L1).
    /// What the editor's explorer renders.
    #[must_use]
    pub fn files(&self) -> String {
        let entries: Vec<serde_json::Value> = self
            .files
            .iter()
            .map(|(path, kappa)| serde_json::json!({ "path": path, "kappa": kappa.as_str() }))
            .collect();
        serde_json::Value::Array(entries).to_string()
    }

    /// Open a file *by path*: the content at the file's current κ (the editor
    /// reads the environment content by κ). `undefined` if the path is unknown.
    pub fn read_path(&self, path: &str) -> Result<Option<Vec<u8>>, JsValue> {
        match self.files.get(path) {
            Some(kappa) => self
                .store
                .get(kappa)
                .map(|opt| opt.map(|b| b.to_vec()))
                .map_err(js_err),
            None => Ok(None),
        }
    }

    // ── the workbench's filesystem: the shared virtio-9p workspace (CC-15/CC-17) ──
    //
    // The real VS Code web workbench (CC-17) edits the holospace's files through a
    // `FileSystemProvider`. Per ADR-012/015 that provider is the running
    // holospace's `virtio-9p` workspace — the κ-addressed content the editor and
    // the OS *share* (Law L1), not a separate store. A service worker bridges the
    // workbench's web-extension provider to these methods on the wasm peer, so the
    // editor reads and writes the *same content* the devcontainer OS sees.

    /// The shared workspace's directory listing — a JSON array of
    /// `{ name, dir, size }` over the running holospace's `virtio-9p` workspace
    /// (the workbench `FileSystemProvider.readDirectory`).
    #[must_use]
    pub fn ws_list(&self) -> String {
        let entries: Vec<serde_json::Value> = self
            .machine
            .workspace_list()
            .into_iter()
            .map(|(name, dir, size)| serde_json::json!({ "name": name, "dir": dir, "size": size }))
            .collect();
        serde_json::Value::Array(entries).to_string()
    }

    /// Read a file from the shared workspace (the workbench
    /// `FileSystemProvider.readFile`) — the same content the OS reads over
    /// `virtio-9p`. `undefined` if absent.
    #[must_use]
    pub fn ws_read(&self, name: &str) -> Option<Vec<u8>> {
        self.machine.workspace_file(name).map(<[u8]>::to_vec)
    }

    /// Write a file into the shared workspace (the workbench
    /// `FileSystemProvider.writeFile`) — the editor saving the *same content* the
    /// OS reads over `virtio-9p` (one content, Law L1). Returns the content's κ
    /// (its identity, Law L1/L2).
    pub fn ws_write(&mut self, name: &str, content: &[u8]) -> String {
        self.machine.workspace_write(name, content);
        address(content).as_str().to_owned()
    }

    /// Delete a file or folder from the shared workspace (the workbench
    /// `FileSystemProvider.delete`) — the editor removing content the OS sees
    /// over `virtio-9p`. `true` if it existed.
    pub fn ws_delete(&mut self, name: &str) -> bool {
        self.machine.workspace_delete(name)
    }

    /// Rename a file or folder in the shared workspace (the workbench
    /// `FileSystemProvider.rename`). `true` if the source existed.
    pub fn ws_rename(&mut self, from: &str, to: &str) -> bool {
        self.machine.workspace_rename(from, to)
    }

    /// Create a folder in the shared workspace (the workbench
    /// `FileSystemProvider.createDirectory`).
    pub fn ws_mkdir(&mut self, name: &str) {
        self.machine.workspace_mkdir(name);
    }

    /// **Apply a configuration** the control plane published (ADR-018; `CC-28`):
    /// decode the κ-addressed [`Configuration`] bytes (resolved + verified over
    /// the substrate by the caller, Law L5) and enact its live directives on the
    /// *running* machine — each `forwardPort` begins forwarding on the running
    /// instance, without a reboot. Returns a JSON summary of what was applied
    /// (`{ "forwarded": [{ "guest": 8080, "host": 8080 }], "lifecycle": "…",
    /// "unsupported": [...] }`). The instance state changes from the panel's
    /// configuration, carried as content over the substrate — no RPC.
    pub fn reconfigure(&mut self, config_bytes: &[u8]) -> Result<String, JsValue> {
        let config = Configuration::from_canonical(config_bytes).map_err(js_err)?;
        let mut forwarded = Vec::new();
        let mut unsupported = Vec::new();
        let mut lifecycle: Option<&str> = None;
        for d in config.directives() {
            match d {
                Directive::ForwardPort(guest) => match self.machine.forward_port(*guest) {
                    Some(host) => {
                        forwarded.push(serde_json::json!({ "guest": guest, "host": host }))
                    }
                    // This peer's forwarded-port transport cannot bind live (the
                    // browser uses a relay route, ADR-016) — reported, not dropped.
                    None => unsupported.push(serde_json::json!({ "forwardPort": guest })),
                },
                Directive::Lifecycle(a) => {
                    lifecycle = Some(match a {
                        LifecycleAction::Start => "start",
                        LifecycleAction::Suspend => "suspend",
                        LifecycleAction::Resume => "resume",
                        LifecycleAction::Terminate => "terminate",
                    });
                }
                // Network/storage authority and account grants change the
                // instance's capability set (its identity, Law L1); the panel
                // records them — they are not live-machine effects.
                other => unsupported.push(serde_json::json!({ "deferred": format!("{other:?}") })),
            }
        }
        Ok(serde_json::json!({
            "forwarded": forwarded,
            "lifecycle": lifecycle,
            "unsupported": unsupported,
        })
        .to_string())
    }
}

// ── The interactive userland Workspace (QEMU as a CC-6 module) ───────────────

/// Mailbox magic — the ASCII bytes `HOLO` the QEMU module stamps at the head of
/// its control struct, so the driver detects an ABI mismatch loudly (read as a
/// little-endian `u32`: `H,O,L,O`).
const MAILBOX_MAGIC: u32 = 0x4F4C_4F48;
// Byte offsets of the little-endian `u32` fields in the guest-reserved mailbox
// struct (`hg_mailbox()` returns its base). Host↔guest I/O happens only through
// linear memory because the browser container engine wires NO host imports (an
// empty `Linker`, hologram-runtime-bare): a CC-6 container talks via its exported
// `hg_*` functions and its own memory, nothing else.
const MBX_CFG_PTR: u32 = 8;
const MBX_CFG_CAP: u32 = 12;
const MBX_CFG_LEN: u32 = 16;
const MBX_IN_PTR: u32 = 20;
const MBX_IN_CAP: u32 = 24;
const MBX_IN_LEN: u32 = 28;
const MBX_OUT_PTR: u32 = 32;
const MBX_OUT_LEN: u32 = 40;
const MBX_HALTED: u32 = 44;

fn rd_u32(mem: &wasmi::Memory, store: &wasmi::Store<()>, off: u32) -> u32 {
    let d = mem.data(store);
    let o = off as usize;
    if o + 4 > d.len() {
        return 0;
    }
    u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}
fn wr_u32(mem: &wasmi::Memory, store: &mut wasmi::Store<()>, off: u32, v: u32) {
    let o = off as usize;
    let d = mem.data_mut(store);
    if o + 4 <= d.len() {
        d[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }
}
fn wr_bytes(mem: &wasmi::Memory, store: &mut wasmi::Store<()>, off: u32, src: &[u8]) -> u32 {
    let o = off as usize;
    let d = mem.data_mut(store);
    let n = src.len().min(d.len().saturating_sub(o));
    d[o..o + n].copy_from_slice(&src[..n]);
    n as u32
}
fn rd_bytes(mem: &wasmi::Memory, store: &wasmi::Store<()>, off: u32, len: u32) -> Vec<u8> {
    let d = mem.data(store);
    let o = off as usize;
    let end = (o + len as usize).min(d.len());
    if o >= end {
        return Vec::new();
    }
    d[o..end].to_vec()
}

/// **The interactive userland Workspace** — a real CC-6 Wasm code module (e.g.
/// `qemu-system-x86_64` compiled to wasm32 over the hologram host ABI) run *as a
/// live, interactive holospace* in the browser tab (ADR-008/009; `CC-6` + the
/// interactive `CC-11` console). Where [`Console::boot_userland`] proves the
/// one-shot lifecycle (boot → suspend → resume → terminate) through the substrate
/// runtime, this drives the *same validated module* on the *same `wasmi`
/// interpreter* the engine uses — pumped in cooperative slices with a live
/// console, so the operator gets a real terminal (the QEMU holospace; see
/// `web/QEMU-HOLOSPACE.md`).
///
/// **Why a direct `wasmi` driver, not `Session`/`ContainerRuntime`.** The browser
/// `ContainerEngine` (hologram-runtime-bare) wires an *empty* `Linker`: a CC-6
/// container has **no** `hologram.*` host imports, and the one-shot `spawn /
/// suspend / resume / terminate` runtime exposes neither a sub-budget run nor a
/// console stream. So an interactive QEMU communicates the only way that surface
/// allows — through **linear memory** between calls (a mailbox), exactly as the
/// emulator [`Workspace`] drives the native [`Emulator`](holospaces::emulator)
/// directly rather than through the runtime. The module is still gated by
/// [`validate_userland`] (the `CC-6` host-ABI surface) before it runs, and is
/// still a self-contained substrate userland (it imports nothing).
///
/// **The container ABI (the contract `build-qemu-wasm.sh` must satisfy).** The
/// module exports `memory` and: `hg_mailbox() -> i32` (the control struct's byte
/// offset); `hg_init() -> i32` (build the machine from the cfg region — argv +
/// disk the host wrote; `0` = ok); `hg_event(budget: i32) -> i32` (drain stdin
/// from `in`, run up to `budget` guest instructions as a cooperative TCG/TCI slice
/// that **returns** rather than blocking, append console bytes to `out`, set
/// `halted`; `0` = ok, a trap halts); and optional `hg_suspend()`/`hg_resume()`
/// flush/rehydrate around the snapshot. The mailbox is a little-endian `u32`
/// struct: `magic, abi, cfg_ptr, cfg_cap, cfg_len, in_ptr, in_cap, in_len,
/// out_ptr, out_cap, out_len, halted`. The snapshot is taken at an `hg_event`
/// boundary (the C stack unwound), so linear memory holds all persistent machine
/// state (CPU, RAM, devices) and transient Wasm globals need not be carried
/// (`CC-30`/`CC-31`).
#[wasm_bindgen]
pub struct UserlandWorkspace {
    store: wasmi::Store<()>,
    memory: wasmi::Memory,
    hg_event: wasmi::TypedFunc<i32, i32>,
    hg_suspend: Option<wasmi::TypedFunc<(), i32>>,
    mailbox: u32,
    halted: bool,
    /// Stdin queued by [`feed_input`](Self::feed_input), delivered to the guest's
    /// mailbox `in` region on the next [`run`](Self::run).
    input: Vec<u8>,
    /// Console bytes the guest has produced; [`terminal_delta`](Self::terminal_delta)
    /// streams only the newly-appended tail (O(new), not O(total)).
    console: Vec<u8>,
    console_cursor: usize,
}

#[wasm_bindgen]
impl UserlandWorkspace {
    /// Boot a CC-6 module as an interactive holospace. `module` is the QEMU wasm
    /// (validated against the host-ABI surface, `CC-6`); `argv` is the QEMU command
    /// line, one argument per line; `disk` is the guest image (held in the guest's
    /// linear memory in v1 — a large disk needs the staged κ-disk sector protocol).
    /// `memory_bytes` and `relay_url` are reserved (the guest sizes its own RAM
    /// today; networking is the staged `CC-16` step).
    pub fn boot(
        module: &[u8],
        argv: &str,
        disk: &[u8],
        memory_bytes: f64,
        relay_url: &str,
    ) -> Result<UserlandWorkspace, JsValue> {
        let _ = (memory_bytes, relay_url); // reserved (RAM budget; CC-16 networking)
        surface::validate_userland(module).map_err(js_err)?; // the CC-6 host-ABI gate
        let (mut store, memory, instance) = Self::instantiate(module)?;
        let (hg_mailbox, hg_event, hg_suspend, hg_init) = Self::resolve(&store, instance)?;
        let mailbox = hg_mailbox.call(&mut store, ()).map_err(js_err)? as u32;
        if rd_u32(&memory, &store, mailbox) != MAILBOX_MAGIC {
            return Err(JsValue::from_str(
                "QEMU mailbox magic mismatch — module built to a different container ABI",
            ));
        }
        // Stage the cfg (argv NUL-joined + a double-NUL terminator, then a
        // length-prefixed disk) into the guest's cfg region, then hand off via
        // hg_init so the guest builds its machine.
        let cfg_ptr = rd_u32(&memory, &store, mailbox + MBX_CFG_PTR);
        let cfg_cap = rd_u32(&memory, &store, mailbox + MBX_CFG_CAP);
        let mut cfg = Vec::new();
        for arg in argv.split('\n') {
            cfg.extend_from_slice(arg.as_bytes());
            cfg.push(0);
        }
        cfg.push(0);
        cfg.extend_from_slice(&(disk.len() as u32).to_le_bytes());
        cfg.extend_from_slice(disk);
        if cfg.len() as u32 > cfg_cap {
            return Err(JsValue::from_str(
                "guest cfg region too small for argv+disk (use a smaller guest image; large disks need the staged κ-disk sector protocol)",
            ));
        }
        let n = wr_bytes(&memory, &mut store, cfg_ptr, &cfg);
        wr_u32(&memory, &mut store, mailbox + MBX_CFG_LEN, n);
        if let Some(f) = hg_init {
            if f.call(&mut store, ()).map_err(js_err)? != 0 {
                return Err(JsValue::from_str("QEMU hg_init failed"));
            }
        }
        Ok(UserlandWorkspace {
            store,
            memory,
            hg_event,
            hg_suspend,
            mailbox,
            halted: false,
            input: Vec::new(),
            console: Vec::new(),
            console_cursor: 0,
        })
    }

    /// Resume an interactive userland from a linear-memory snapshot
    /// [`suspend`](Self::suspend) produced. `module` is the same CC-6 module (it is
    /// content — re-fetched and verified, not carried in the snapshot); the
    /// snapshot is the machine's memory at an `hg_event` boundary (`CC-30`/`CC-31`).
    pub fn resume(module: &[u8], snapshot: &[u8]) -> Result<UserlandWorkspace, JsValue> {
        surface::validate_userland(module).map_err(js_err)?;
        let (mut store, memory, instance) = Self::instantiate(module)?;
        // Grow linear memory to fit the snapshot, then restore it byte-for-byte.
        let cur = memory.data(&store).len();
        if snapshot.len() > cur {
            let pages = (snapshot.len() - cur).div_ceil(65536) as u64;
            memory.grow(&mut store, pages).map_err(js_err)?;
        }
        {
            let d = memory.data_mut(&mut store);
            let n = snapshot.len().min(d.len());
            d[..n].copy_from_slice(&snapshot[..n]);
        }
        let (hg_mailbox, hg_event, hg_suspend, _hg_init) = Self::resolve(&store, instance)?;
        let mailbox = hg_mailbox.call(&mut store, ()).map_err(js_err)? as u32;
        if let Some(f) = Self::resolve_resume(&store, instance) {
            let _ = f.call(&mut store, ());
        }
        Ok(UserlandWorkspace {
            store,
            memory,
            hg_event,
            hg_suspend,
            mailbox,
            halted: false,
            input: Vec::new(),
            console: Vec::new(),
            console_cursor: 0,
        })
    }

    /// Advance the guest by up to `budget` instructions — one cooperative slice.
    /// Delivers any queued [`feed_input`](Self::feed_input) to the guest first,
    /// then drains the console it produced. Returns `true` once it has halted. Call
    /// repeatedly from a UI loop, streaming [`terminal_delta`](Self::terminal_delta)
    /// between slices.
    pub fn run(&mut self, budget: f64) -> bool {
        if self.halted {
            return true;
        }
        // Deliver queued stdin into the guest's mailbox `in` region.
        let in_ptr = rd_u32(&self.memory, &self.store, self.mailbox + MBX_IN_PTR);
        let in_cap = rd_u32(&self.memory, &self.store, self.mailbox + MBX_IN_CAP);
        let take = self.input.len().min(in_cap as usize);
        if take > 0 {
            let chunk: Vec<u8> = self.input.drain(..take).collect();
            wr_bytes(&self.memory, &mut self.store, in_ptr, &chunk);
        }
        wr_u32(&self.memory, &mut self.store, self.mailbox + MBX_IN_LEN, take as u32);
        // Run the slice — the guest returns after `budget` instructions (cooperative).
        let budget_i = budget.clamp(0.0, i32::MAX as f64) as i32;
        if self.hg_event.call(&mut self.store, budget_i).is_err() {
            self.halted = true; // a trap is fail-loud (SPINE-6)
            return true;
        }
        // Drain the console the guest produced this slice.
        let out_ptr = rd_u32(&self.memory, &self.store, self.mailbox + MBX_OUT_PTR);
        let out_len = rd_u32(&self.memory, &self.store, self.mailbox + MBX_OUT_LEN);
        if out_len > 0 {
            let bytes = rd_bytes(&self.memory, &self.store, out_ptr, out_len);
            self.console.extend_from_slice(&bytes);
        }
        if rd_u32(&self.memory, &self.store, self.mailbox + MBX_HALTED) != 0 {
            self.halted = true;
        }
        self.halted
    }

    /// Whether the guest has powered off.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn halted(&self) -> bool {
        self.halted
    }

    /// The console bytes produced **since the last call** (an internal cursor) —
    /// the integrated terminal's render delta, O(new) not O(total) per frame.
    pub fn terminal_delta(&mut self) -> Vec<u8> {
        let from = self.console_cursor.min(self.console.len());
        let delta = self.console[from..].to_vec();
        self.console_cursor = self.console.len();
        delta
    }

    /// Feed **raw terminal input** (keystrokes, control bytes, escape sequences) to
    /// the guest — queued, then delivered on the next [`run`](Self::run), so the
    /// guest's own tty echoes and edits and Ctrl-C raises SIGINT (a real terminal,
    /// `CC-11`). The input is part of the machine's state captured by the snapshot.
    pub fn feed_input(&mut self, bytes: &[u8]) {
        self.input.extend_from_slice(bytes);
    }

    /// Suspend to a κ snapshot — the guest's linear memory at this `hg_event`
    /// boundary, the canonical content-addressed machine state (`CC-30`). The
    /// browser persists it (gzipped) to OPFS so the next launch resumes (`CC-31`).
    pub fn suspend(&mut self) -> Vec<u8> {
        if let Some(f) = self.hg_suspend {
            let _ = f.call(&mut self.store, ());
        }
        self.memory.data(&self.store).to_vec()
    }

    // ── internals ────────────────────────────────────────────────────────────

    /// Instantiate the module on a fresh `wasmi` store with an **empty** linker —
    /// the import-free CC-6 surface (any `hologram.*`/WASI import is refused at
    /// link, mirroring hologram-runtime-bare). Returns the store, its `memory`
    /// export, and the instance handle.
    fn instantiate(
        module: &[u8],
    ) -> Result<(wasmi::Store<()>, wasmi::Memory, wasmi::Instance), JsValue> {
        let engine = wasmi::Engine::default();
        let compiled = wasmi::Module::new(&engine, module).map_err(js_err)?;
        let mut store = wasmi::Store::new(&engine, ());
        let linker: wasmi::Linker<()> = wasmi::Linker::new(&engine);
        let instance = linker
            .instantiate_and_start(&mut store, &compiled)
            .map_err(js_err)?;
        let memory = instance
            .get_memory(&store, "memory")
            .ok_or_else(|| JsValue::from_str("QEMU module exports no `memory`"))?;
        Ok((store, memory, instance))
    }

    /// Resolve the container-ABI exports (`hg_mailbox`/`hg_event` required;
    /// `hg_suspend`/`hg_init` optional).
    #[allow(clippy::type_complexity)]
    fn resolve(
        store: &wasmi::Store<()>,
        instance: wasmi::Instance,
    ) -> Result<
        (
            wasmi::TypedFunc<(), i32>,
            wasmi::TypedFunc<i32, i32>,
            Option<wasmi::TypedFunc<(), i32>>,
            Option<wasmi::TypedFunc<(), i32>>,
        ),
        JsValue,
    > {
        let f = |n: &str| instance.get_export(store, n).and_then(wasmi::Extern::into_func);
        let hg_mailbox = f("hg_mailbox")
            .and_then(|x| x.typed::<(), i32>(store).ok())
            .ok_or_else(|| JsValue::from_str("QEMU module exports no `hg_mailbox`"))?;
        let hg_event = f("hg_event")
            .and_then(|x| x.typed::<i32, i32>(store).ok())
            .ok_or_else(|| JsValue::from_str("QEMU module exports no `hg_event`"))?;
        let hg_suspend = f("hg_suspend").and_then(|x| x.typed::<(), i32>(store).ok());
        let hg_init = f("hg_init").and_then(|x| x.typed::<(), i32>(store).ok());
        Ok((hg_mailbox, hg_event, hg_suspend, hg_init))
    }

    /// Resolve the optional `hg_resume` export.
    fn resolve_resume(
        store: &wasmi::Store<()>,
        instance: wasmi::Instance,
    ) -> Option<wasmi::TypedFunc<(), i32>> {
        instance
            .get_export(store, "hg_resume")
            .and_then(wasmi::Extern::into_func)
            .and_then(|x| x.typed::<(), i32>(store).ok())
    }
}

/// **The browser peer's AArch64 holospace** — a real arm64 devcontainer booted on
/// the engine's [AArch64 core](holospaces::emulator::aarch64) (ADR-021; `CC-36` a
/// real arm64 Linux boots, `CC-37` a stock `linux-arm64` binary runs). Its κ-disk
/// is the **same substrate-backed `virtio-blk`** the RISC-V [`Workspace`] uses —
/// the shared device bus (`emulator::devbus`), no per-ISA re-implementation (Law
/// L4; `CC-7`/`CC-14`). Boot + the interactive terminal (`CC-11`) are complete;
/// the AArch64 core's `virtio-net`/`9p` parity is the continued engine build, so
/// this surface exposes only what the core does today — nothing it cannot fulfil.
#[wasm_bindgen]
pub struct Aarch64Workspace {
    cpu: aarch64::Cpu,
    halted: bool,
    /// The next unread console byte — the cursor [`Aarch64Workspace::terminal_delta`]
    /// advances so the terminal streams only newly-produced output.
    console_cursor: usize,
}

#[wasm_bindgen]
impl Aarch64Workspace {
    /// Boot a **devcontainer** on the AArch64 core: the assembled `ext4` `rootfs`
    /// (from [`DevcontainerImage::assemble_bootable`]) is taken as κ-addressed
    /// content into the shared `virtio-blk` κ-disk (`CC-7`) and mounted over
    /// `/dev/vda`; the real, unmodified arm64 Linux `kernel` boots it and runs the
    /// devcontainer's OS — entirely in the browser peer (ADR-009/011/021, `CC-37`).
    /// Drive with [`run`](Aarch64Workspace::run), streaming
    /// [`terminal_delta`](Aarch64Workspace::terminal_delta) and feeding keystrokes
    /// with [`feed_input`](Aarch64Workspace::feed_input).
    #[must_use]
    pub fn boot_devcontainer(kernel: &[u8], rootfs: &[u8]) -> Aarch64Workspace {
        let cpu = aarch64::Cpu::boot_linux_disk(
            512 * 1024 * 1024,
            kernel,
            rootfs.to_vec(),
            // nokaslr: deterministic kernel placement (single-user dev box).
            // norandmaps: disable user-space ASLR — certain randomized mmap layouts
            // trip an MMU edge case in the AArch64 core on the dynamic-exec path; a
            // fixed layout avoids it. (The underlying VA-range bug is the tracked
            // engine follow-up; nokaslr+norandmaps is the correct, lean default for a
            // reproducible single-user emulator regardless.)
            "console=ttyAMA0 root=/dev/vda rw init=/init nokaslr norandmaps",
        );
        Aarch64Workspace {
            cpu,
            halted: false,
            console_cursor: 0,
        }
    }

    /// Advance the running holospace by `budget` instructions (one chunk of the
    /// boot or of servicing input); returns `true` once the machine has halted.
    pub fn run(&mut self, budget: f64) -> bool {
        if self.halted {
            return true;
        }
        if !matches!(self.cpu.run(budget as u64), aarch64::Halt::OutOfBudget) {
            self.halted = true;
        }
        self.halted
    }

    /// The full console the guest has produced.
    #[must_use]
    pub fn terminal(&self) -> String {
        String::from_utf8_lossy(self.cpu.console()).into_owned()
    }

    /// Whether the terminal has rendered `marker` yet (e.g. a ready banner).
    #[must_use]
    pub fn shows(&self, marker: &str) -> bool {
        String::from_utf8_lossy(self.cpu.console()).contains(marker)
    }

    /// The console bytes produced **since the last call** — the integrated
    /// terminal's render loop (output stays O(new bytes) per frame).
    pub fn terminal_delta(&mut self) -> Vec<u8> {
        let console = self.cpu.console();
        let from = self.console_cursor.min(console.len());
        let delta = console[from..].to_vec();
        self.console_cursor = console.len();
        delta
    }

    /// Feed raw terminal input to the running guest (`CC-11`, the AArch64 PL011
    /// analogue): the bytes become readable at the serial console, so the guest's
    /// own tty echoes, line-edits, and raises SIGINT on Ctrl-C — a real terminal.
    pub fn feed_input(&mut self, bytes: &[u8]) {
        self.cpu.feed_console(bytes);
    }

    /// Whether the machine has powered off.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn halted(&self) -> bool {
        self.halted
    }
}
