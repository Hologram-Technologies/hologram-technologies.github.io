/* tslint:disable */
/* eslint-disable */

/**
 * **The browser peer's AArch64 holospace** — a real arm64 devcontainer booted on
 * the [AArch64 core](holospaces::emulator::aarch64) (`CC-36`), its κ-disk paged
 * from OPFS (the same substrate as the RISC-V [`Workspace`]). The AArch64 core
 * reaches the **shared** `emulator::devbus` for the 9p workspace, the network
 * (router egress), and the in-process guest bridge (`CC-46`) — the same device
 * surface the RISC-V [`Workspace`] exposes, here over the GIC transport.
 */
export class Aarch64Workspace {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Boot like [`boot_devcontainer_opfs_streamed`](Aarch64Workspace::boot_devcontainer_opfs_streamed),
     * additionally attaching the **shared workspace filesystem** (`virtio-9p`,
     * `CC-15`/`CC-46`), a **router-backed network** (`virtio-net` + the userspace
     * NAT, carried over the egress protocol — `CC-16`/`CC-46`), and the
     * **in-process guest bridge** (`CC-33`/`CC-46`). The editor shares files with
     * the OS ([`workspace_file`](Aarch64Workspace::workspace_file)/[`workspace_write`](Aarch64Workspace::workspace_write)),
     * the page carries the guest's egress to the router, and the workbench can
     * [`dial_guest`](Aarch64Workspace::dial_guest) a server inside the
     * devcontainer — the full shared-devbus surface the RISC-V workspace exposes.
     */
    static boot_devcontainer_opfs_full(kernel: Uint8Array, rootfs_handle: FileSystemSyncAccessHandle, disk_handle: FileSystemSyncAccessHandle): Aarch64Workspace;
    /**
     * Boot a provisioned arm64 image, **streaming** its κ-disk from OPFS (no full
     * image in RAM): `rootfs_handle` is the provisioned rootfs (read
     * sector-by-sector into the OPFS-backed store on `disk_handle`). Drive with
     * [`run`](Aarch64Workspace::run), rendering
     * [`terminal_delta`](Aarch64Workspace::terminal_delta) between chunks.
     */
    static boot_devcontainer_opfs_streamed(kernel: Uint8Array, rootfs_handle: FileSystemSyncAccessHandle, disk_handle: FileSystemSyncAccessHandle): Aarch64Workspace;
    /**
     * Dial an in-process connection to a server inside the devcontainer over the
     * loopback bridge (`CC-33`/`CC-46`). `None` if not a `*_full` boot.
     */
    dial_guest(guest_port: number): number | undefined;
    /**
     * Deliver an egress frame the router returned into the guest's network. A
     * no-op when this is not a `*_full` boot.
     */
    egress_inbound(frame: Uint8Array): void;
    /**
     * Drain the next egress frame the guest produced, for the page to carry to
     * the router (`CC-46` net parity). `undefined` when none is queued (or this
     * is not a `*_full` boot).
     */
    egress_outbound(): Uint8Array | undefined;
    /**
     * Feed keystrokes to the guest's serial console.
     */
    feed_input(bytes: Uint8Array): void;
    /**
     * Close the host side of a loopback connection (`CC-33`).
     */
    guest_close(id: number): void;
    /**
     * Whether a loopback connection is still usable (`CC-33`).
     */
    guest_is_open(id: number): boolean;
    /**
     * Drain the guest server's reply bytes on a loopback connection (`CC-33`).
     */
    guest_recv(id: number): Uint8Array;
    /**
     * Write bytes toward the guest server on a loopback connection (`CC-33`).
     */
    guest_send(id: number, data: Uint8Array): void;
    /**
     * Run a chunk of guest execution; returns `true` once the machine halts.
     */
    run(budget: number): boolean;
    /**
     * The full console the guest has produced.
     */
    terminal(): string;
    /**
     * The console bytes produced since the last call (the integrated terminal
     * streams these).
     */
    terminal_delta(): Uint8Array;
    /**
     * Read a file from the shared workspace — how the editor observes the OS's
     * edits over `virtio-9p` (`CC-15`/`CC-46`). `undefined` if absent / no 9p.
     */
    workspace_file(name: string): Uint8Array | undefined;
    /**
     * Write a file into the shared workspace — the editor saving content the OS
     * reads over `virtio-9p` (one content, Law L1; `CC-15`/`CC-46`).
     */
    workspace_write(name: string, data: Uint8Array): void;
    /**
     * Whether the machine has powered off.
     */
    readonly halted: boolean;
}

/**
 * The Platform Manager console, running as a browser peer that composes the
 * substrate runtime over the interpreter `ContainerEngine`.
 */
export class Console {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Boot a userland holospace **in the browser**: provision it, then spawn it
     * through the substrate runtime over the interpreter `ContainerEngine`,
     * capture a κ snapshot of its state (suspend), resume, and terminate — the
     * execution surface running on the browser peer (ADR-008; RT2; `CC-6`).
     * Returns the κ-label of the suspend snapshot (state is content, Law L3).
     */
    boot_userland(module: Uint8Array, memory_bytes: number): string;
    /**
     * **Announce** to the peer that this node holds `kappa`, over the content
     * network (`CC-38` `announce`). This queues a `KIND_ANNOUNCE` frame for the
     * transport; the next [`cn_pump`](Self::cn_pump) carries it across the real
     * WebRTC data channel to the peer. A deployed tab calls `cn_announce(κ)` then
     * `cn_pump(link)` to advertise content it holds — the same `BareNetSync`
     * `announce` a bare-metal peer drives, only the carrier differs (`CC-49`).
     *
     * The substrate's `announce` emits the frame without awaiting a reply, so the
     * future settles immediately (the frame is then in the outbound queue); the
     * transport pump moves it. No fabrication, no central operator.
     */
    cn_announce(kappa: string): void;
    /**
     * **Discover** which κs the peer holds, over the content network (`CC-38`
     * `discover`). This broadcasts a `KIND_DISCOVER_REQ` frame (queued for the
     * transport) and returns a snapshot — as a JSON array of κ-strings — of the κs
     * learned from peers' `KIND_DISCOVER_RES` replies so far. Because discovery is
     * a round-trip, a deployed tab calls `cn_discover()` to send the request,
     * `cn_pump(link)` (both peers) to carry the request and the reply across the
     * real WebRTC data channel, then `cn_discover()` again to read the now-known
     * holders. Re-issuing is idempotent: each call re-broadcasts and re-snapshots,
     * so the witness loops it until a holder appears (or a deadline, fail-loud).
     *
     * This is the SAME `BareNetSync` `discover` a bare-metal peer drives; the
     * WebRTC data channel only changes the carrier (`CC-49`). κs returned are
     * hints (which peer to fetch from); the bytes themselves are still verified on
     * receipt when fetched (Law L5) — discovery fabricates nothing.
     */
    cn_discover(): string;
    /**
     * Poll the in-flight content-network fetch. Returns `undefined` while it is
     * pending (pump more frames and poll again), `null` when it completed with
     * the content absent (no peer holds it — no forging), or the verified bytes
     * when it resolved. The fetched bytes are also admitted to this peer's
     * content store (a subsequent fetch of the same κ is local).
     */
    cn_fetch_poll(): any;
    /**
     * Begin fetching `kappa` from the peer across the transport (verify on
     * receipt). Drive it by pumping frames and polling [`cn_fetch_poll`]; only
     * one fetch is in flight at a time.
     *
     * [`cn_fetch_poll`]: Self::cn_fetch_poll
     */
    cn_fetch_start(kappa: string): void;
    /**
     * Deliver a content-network frame the transport received from the peer, and
     * service it (answer an inbound fetch from local content, or record a
     * response for an in-flight `cn_fetch`).
     */
    cn_inbound(frame: Uint8Array): void;
    /**
     * Drain the next content-network frame this peer wants to send over the
     * transport, or `undefined` if none is queued.
     */
    cn_outbound(): Uint8Array | undefined;
    /**
     * **The product pump (CC-49).** Carry this peer's content-network frames
     * across a real WebRTC data channel ([`WebRtcLink`]) to another browser peer:
     * drain every frame this peer wants to transmit onto the channel
     * ([`WebRtcLink::send`]) and deliver every frame the channel received from the
     * peer into this peer ([`WebRtcLink::recv`] → [`cn_inbound`]). This is the
     * browser surface's transport pump for the uor-native content network — the
     * counterpart to a real NIC's RX/TX on bare metal — and it lives **in the
     * product**, not the witness: a deployed tab calls `cn_fetch_start`, then
     * `cn_pump(link)` + `cn_fetch_poll` as the channel signals readiness, and so
     * fetches a κ from a peer over WebRTC entirely through this API.
     *
     * The pump moves only opaque frames; it never inspects content or addressing.
     * Verify-on-receipt (SPINE-4 / Law L5) happens inside the content peer, so a
     * forged response carried over the channel is rejected on re-derivation and a
     * κ no peer holds resolves to nothing — the channel changes the carrier, not
     * the law. While the channel is not yet open ([`WebRtcLink::is_open`]) there
     * are no frames to move and this is a no-op.
     *
     * Returns the number of frames moved (outbound + inbound) — diagnostic only;
     * the caller re-polls regardless until the fetch settles.
     *
     * [`cn_inbound`]: Self::cn_inbound
     */
    cn_pump(link: WebRtcLink): number;
    /**
     * Publish bytes into this peer's content store so it can serve them to other
     * peers over the content network (`CC-38`). Returns the κ that addresses
     * them — the handle a peer fetches by.
     */
    cn_put(bytes: Uint8Array): string;
    /**
     * *Control panel: configure.* Reconfigure a running instance from the panel
     * (ADR-018; `CC-28`). `directives_json` is a JSON array of operations across
     * the four classes, e.g. `[{"lifecycle":"suspend"}, {"forwardPort":8080},
     * {"unforwardPort":8080}, {"network":{"fetch":true,"announce":false}},
     * {"quota":1073741824}, {"grant":"blake3:…"}]`. The panel builds a
     * content-addressed [`Configuration`] issued by the signed-in operator,
     * stores it (Law L2), and returns its κ — the content the running instance
     * resolves and applies over the substrate (no server, no RPC).
     */
    configure(instance: string, directives_json: string): string;
    /**
     * Witness the **uor-native content network in the browser** — the "browser
     * as a router" model (ADR-006; the substrate is the network). Two in-process
     * peers are linked by a [`PacketLink`](holospaces::content_net::PacketLink)
     * pair (an in-process stand-in for a WebRTC data channel) and each wrapped in
     * hologram's `BareNetSync` — the substrate's own `KappaSync` over the
     * `NetworkInterface` HAL. Peer B fetches content it does **not** hold from
     * peer A over the substrate frame protocol (`fetch`/`announce`/`discover`),
     * and the bytes are **verified by re-derivation on receipt** (SPINE-4)
     * before they are accepted — exactly as a bare-metal or std peer does it, no
     * central operator. Returns a JSON summary (the fetched content matched, an
     * unheld κ resolves to nothing — no forging). This exercises the real wasm
     * peer's content-network path against an in-process link; the live
     * browser-to-browser transport over a real WebRTC data channel is the product
     * [`cn_pump`](Self::cn_pump) (`CC-49`), witnessed across two tabs.
     */
    content_network_selftest(): string;
    /**
     * Open a fresh console — a browser peer with a local content-addressed
     * store and the interpreter container engine.
     */
    constructor();
    /**
     * Open a **forging** browser peer — a malicious responder that answers every
     * content-network fetch with `forged` bytes (which do not re-derive to the
     * requested κ). It drives the SAME content-network seam (`cn_inbound` /
     * `cn_outbound`) over the same transport, so a real WebRTC peer fetching from
     * it receives a well-formed but forged response and **rejects it on receipt**
     * (SPINE-4 / Law L5). This is the adversary the `CC-49` witness uses to prove
     * a forging responder is refused — a genuine attacker, not a mock.
     */
    static new_forging(forged: Uint8Array): Console;
    /**
     * Provision a holospace from a `.holo` compute artifact (the *holo-file*
     * compute form) with a memory budget, κ-addressing its parts into the
     * peer's store (Law L2). Returns the holospace identity κ.
     */
    provision(code: Uint8Array, memory_bytes: number): string;
    /**
     * Provision a holospace from a **devcontainer** for the management console
     * (CC-12): the `devcontainer.json` is validated against the Dev Container
     * spec (`CC-4`) and κ-addressed into the store; the holospace's identity is
     * the content address of its devcontainer definition (reproducible — same
     * source ⇒ same κ, Law L1). This *provisions* (records) the holospace; the
     * operator *enters* it to boot its OS in the workspace IDE (`CC-13`).
     * Returns the holospace identity κ.
     */
    provision_devcontainer(config_json: Uint8Array, arch: string, memory_bytes: number): string;
    /**
     * Provision a holospace from a **git repository reference** — the
     * Codespaces/Gitpod launch: the operator names a repository URL + reference
     * (not a pasted config) and holospaces runs it as a devcontainer.
     *
     * The repository's own `.devcontainer/devcontainer.json` is fetched by the
     * operator's page from the repository host and **verified on receipt** (Law
     * L5) before it crosses into the peer here as `config_json`; when the
     * repository declares none, the page passes the **usable default** config
     * (`buildpack-deps` — `curl`/`git` over apt; the Dev Container spec's
     * default, `CC-20`/`import`) so *any* repository runs. The `(repo,
     * reference, config, arch)` tuple is the [`Source::Devcontainer`], hence the
     * holospace's content-addressed identity (Law L1): the same repository at
     * the same reference under the same ISA is the **same** holospace
     * (reproducible), and a different repository / reference / architecture is a
     * **distinct** one. Returns the holospace identity κ.
     *
     * The architecture (`arch`: `"riscv64"` / `"aarch64"`) is the operator's
     * launch-time selection and is fixed for the holospace's lifetime (ADR-021).
     */
    provision_repo(repo: string, reference: string, config_path: string, config_json: Uint8Array, arch: string, memory_bytes: number): string;
    /**
     * Provision a holospace from a *Wasm-recompiled userland* (the execution
     * surface, the second compute form — ADR-008). The module is validated
     * against the surface contract ([`validate_userland`]) before it is
     * κ-addressed into the store, so only a substrate-valid userland can become
     * a holospace's code. Returns the holospace identity κ.
     */
    provision_userland(module: Uint8Array, memory_bytes: number): string;
    /**
     * Receive content the operator's page fetched from a substrate **HTTP-CAS
     * gateway** (`GET /cas/{κ}`, `hologram-net-http`) and admit it into this
     * peer's store — the *receive* side of [`get_with_fetch`], realized for the
     * browser where the async `fetch` is the page's and the verification is the
     * peer's. The bytes are **verified by re-derivation against the requested
     * κ** before they are admitted (Law L5): a gateway is untrusted, so content
     * that does not re-derive to the κ the page asked for is **refused**, never
     * stored. On success the content is cached locally (so a subsequent
     * [`resolve`](Self::resolve) is a trusted read) and the κ is returned.
     *
     * This is what lets the browser peer boot a devcontainer it did **not**
     * assemble locally: the page fetches the rootfs + kernel by κ from any
     * hologram gateway, hands each blob here for verify-and-cache, and the
     * content is then trustworthy substrate content — no bespoke server, no
     * trust in the gateway (`CC-20`).
     *
     * [`get_with_fetch`]: hologram_substrate_core::get_with_fetch
     */
    receive(bytes: Uint8Array, kappa: string): string;
    /**
     * Resolve a holospace (or any κ) from this peer's own in-session store.
     * Returns the bytes, or `undefined` if absent.
     *
     * This is a *trusted* read ([`ReadVerify::Trusted`], ADR-019): the store is
     * the canonical memory and RAM is its cache (Law L3), so content that
     * entered this session was already verified on the way in (on receipt, or
     * by `put` construction). The deployed peer does not re-derive κ on every
     * local read — that would treat its own canonical store as untrusted and is
     * pure overhead. The re-derivation invariant still holds where untrusted
     * bytes enter (the import/fetch boundary) and is exercised end-to-end in CI.
     */
    resolve(kappa: string): Uint8Array | undefined;
    /**
     * The operator's roster κ — the content address that links their instances
     * (R5). Its bytes are in the store, so another instance can resolve it.
     */
    roster_kappa(): string | undefined;
    /**
     * Import and run a **devcontainer in the browser** — the Codespaces/Gitpod
     * scenario without a Docker daemon or a cloud VM (arc42 chapter 1, the
     * motivating scenario; chapter 6). The `devcontainer.json` is validated
     * against the Dev Container spec (`CC-4`); the κ-addressed Wasm `userland`
     * its config selects is validated against the host-ABI surface (`CC-6`) and
     * booted through the substrate runtime over the interpreter engine — same
     * lifecycle as a native or remote peer (Q6). Returns the suspend snapshot κ.
     *
     * `arch` is the operator's **architecture selection** (the Manager GUI's
     * arch picker; ADR-021) — `"riscv64"` or `"aarch64"`. It becomes part of the
     * holospace's content-addressed identity, so it is fixed for the holospace's
     * lifetime (an unknown id falls back to the default RISC-V target).
     */
    run_devcontainer(repo: string, reference: string, config_path: string, config_json: Uint8Array, userland_module: Uint8Array, arch: string, memory_bytes: number): string;
    /**
     * Sign in by unlocking a self-sovereign key (not a server account,
     * ADR-001). Returns the operator's content-addressed identity κ.
     */
    sign_in(key: Uint8Array): string;
    /**
     * The console's View — a JSON projection of the operator and their
     * holospaces (what the UI renders).
     */
    view(): string;
}

/**
 * A devcontainer's OCI image, assembled into a bootable root filesystem *in the
 * browser* — the Layer Assembler (`CC-7` / the in-crate ext4 writer) running as
 * the wasm peer. The operator's page fetches the devcontainer's image layers
 * from the cold-start gateway (verified by re-derivation before they are added),
 * then assembles them here; the result boots over the emulator's `virtio-blk`
 * ([`Workspace::boot_devcontainer`], `CC-14`). The browser peer *is* the
 * machine — no server assembles or boots the OS (Law L1/L4).
 */
export class DevcontainerImage {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add an OCI image layer (its media type + the verified blob bytes), in
     * order from the base layer up.
     */
    add_layer(media_type: string, blob: Uint8Array): void;
    /**
     * Assemble the layers into a bootable `ext4` root filesystem (gunzip +
     * untar + OCI whiteout overlay + the in-crate ext4 writer; Law L4). The
     * bytes back a [`Workspace::boot_devcontainer`] machine's `virtio-blk` disk.
     */
    assemble(): Uint8Array;
    /**
     * Assemble the **bootable** rootfs of [`Self::assemble_bootable`] **straight
     * into an OPFS file**, sparse and streaming — the `CC-50` provisioning path
     * that never materializes a dense in-RAM image. The content is identical to
     * [`assemble_bootable`](Self::assemble_bootable) (the same overlay + injected
     * [`DEVCONTAINER_INIT`](holospaces::machine::DEVCONTAINER_INIT) + `disk_bytes`
     * sizing), but instead of returning a `Vec` sized to the whole disk it writes
     * only the **non-zero 4 KiB blocks** to `rootfs_handle` at their byte offsets
     * via the shared streaming serializer
     * ([`stream_ext4_image_bootable`](holospaces::assembly::stream_ext4_image_bootable)) —
     * the very primitive [`DevcontainerProvision::assemble_into_opfs`] uses. The
     * file's free space stays sparse (zero on read); peak wasm heap tracks the
     * image's *content*, not its declared size ("the KappaStore IS the memory, RAM
     * is a cache", Laws L3/L4).
     *
     * Returns the total image length in bytes. The page then boots the file with
     * [`boot_devcontainer_routed_opfs_streamed`](Workspace::boot_devcontainer_routed_opfs_streamed),
     * which pages the disk sector-by-sector — so the streamed-into-OPFS image is
     * what actually boots (not a dense image that merely shares its bytes).
     */
    assembleBootableIntoOpfs(rootfs_handle: FileSystemSyncAccessHandle, disk_bytes: number): number;
    /**
     * Assemble the layers into a **bootable, interactive, writable** root
     * filesystem on a `disk_bytes`-sized disk: the same overlay as
     * [`Self::assemble`], plus the persistent devcontainer
     * [`/init`](holospaces::machine::DEVCONTAINER_INIT) injected — it mounts the
     * pseudo filesystems and the shared `virtio-9p` workspace and execs a shell,
     * so the booted OS stays running as a dev environment instead of powering off
     * after boot — and sized to `disk_bytes` so the OS has room to work (the
     * devcontainer's disk; the caller's to choose, not a hidden cap). The base
     * image must provide a static `/bin/busybox`.
     */
    assemble_bootable(disk_bytes: number): Uint8Array;
    /**
     * A new, empty image (add its layers lowest-first with [`Self::add_layer`]).
     */
    constructor();
}

/**
 * **Provision a devcontainer's real OCI image in the browser** — the deployed
 * path that makes a launched holospace the repository's *actual* devcontainer,
 * not a demo. The page drives it with the router as the transport: while
 * [`is_done`](DevcontainerProvision::is_done) is false, read
 * [`next_url`](DevcontainerProvision::next_url) /
 * [`next_accept`](DevcontainerProvision::next_accept) /
 * [`next_bearer`](DevcontainerProvision::next_bearer), fetch through the router
 * extension's CORS-free `fetch`, and feed the response back with
 * [`deliver`](DevcontainerProvision::deliver); then `assemble` yields the
 * bootable rootfs. The pull is the *same* [`ImagePull`] the native importer uses
 * and re-derives every blob (Law L5) — only the transport differs.
 */
export class DevcontainerProvision {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Ingest the fully-fetched image (re-deriving every blob — Law L5) and
     * assemble it into a **bootable** ext4 rootfs the emulator boots over
     * `virtio-blk`. A real OCI image carries no `/init`, so the devcontainer
     * init for a real image ([`REAL_IMAGE_INIT`](holospaces::machine::REAL_IMAGE_INIT)
     * — `#!/bin/sh`, the image's own coreutils) is injected, and the filesystem
     * is sized to `disk_bytes` so the guest has room to work (`apt`, builds, the
     * files you create). On the paged κ-disk the free space is sparse (zero
     * sectors are not stored), so a generous size is cheap. Pass the result to
     * [`boot_devcontainer_routed_opfs`](Workspace::boot_devcontainer_routed_opfs).
     */
    assemble(disk_bytes: number): Uint8Array;
    /**
     * Assemble the bootable rootfs **straight into an OPFS file**, sparse and
     * streaming — the `CC-50` provisioning path that never materializes a dense
     * in-RAM image. Equivalent in content to [`assemble`](Self::assemble), but
     * instead of returning a `Vec` sized to the whole (possibly multi-GiB) disk,
     * it writes only the **non-zero 4 KiB blocks** to `rootfs_handle` at their
     * byte offsets; the OPFS file's free space stays sparse (zero on read). Peak
     * wasm heap tracks the image's *content*, not its declared size ("the
     * KappaStore IS the memory, RAM is a cache", Laws L3/L4).
     *
     * Returns the total image length in bytes (a whole number of sectors). The
     * page then boots from the file with
     * [`boot_devcontainer_routed_opfs_streamed`](Workspace::boot_devcontainer_routed_opfs_streamed),
     * which pages the disk sector-by-sector — so neither provisioning nor boot
     * ever holds the whole image in RAM.
     */
    assembleIntoOpfs(rootfs_handle: FileSystemSyncAccessHandle, disk_bytes: number): number;
    /**
     * Feed the router's response to the current fetch.
     */
    deliver(status: number, content_type: string, body: Uint8Array): void;
    /**
     * Whether every blob has been delivered and the image is ready to
     * [`assemble`](DevcontainerProvision::assemble).
     */
    isDone(): boolean;
    /**
     * Begin provisioning `image_ref` (e.g. `mcr.microsoft.com/devcontainers/base:debian`)
     * for `arch` (`"riscv64"` / `"aarch64"`).
     */
    constructor(image_ref: string, arch: string);
    /**
     * The `Accept` header for the next fetch (manifests), or `undefined`.
     */
    nextAccept(): string | undefined;
    /**
     * The bearer token for the next fetch once one is held, or `undefined`.
     */
    nextBearer(): string | undefined;
    /**
     * The URL the page must `GET` next through the router, or `undefined` when
     * [`is_done`](DevcontainerProvision::is_done).
     */
    nextUrl(): string | undefined;
}

/**
 * One end of a peer-to-peer content-network transport over a real WebRTC data
 * channel — the browser surface's wire. It carries a [`Console`](crate::Console)'s
 * content-network frames to and from another browser peer (no server between);
 * the product pump [`Console::cn_pump`](crate::Console::cn_pump) couples it to
 * the `BareNetSync`-driven `NetworkInterface`, so a deployed tab fetches over it.
 */
export class WebRtcLink {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * (Offerer) Accept the peer's answer SDP, completing the negotiation.
     */
    accept_answer(answer_sdp: string): Promise<void>;
    /**
     * (Answerer) Accept the peer's offer SDP, set it remote, create the answer
     * and set it local; returns the answer SDP to hand back to the peer.
     */
    accept_offer(offer_sdp: string): Promise<string>;
    /**
     * Add a remote ICE candidate (the JSON the peer produced via
     * [`take_ice`](Self::take_ice)) to this connection.
     */
    add_ice(candidate_json: string): Promise<void>;
    /**
     * Close the connection and its data channel.
     */
    close(): void;
    /**
     * (Offerer) Create the SDP offer and set it as the local description; returns
     * the offer SDP to hand to the peer out of band (paste / existing peer).
     */
    create_offer(): Promise<string>;
    /**
     * Whether the data channel is open and ready to carry frames.
     */
    is_open(): boolean;
    /**
     * Open one end of a peer-to-peer link.
     *
     * `initiator` is the offerer: it creates the data channel and the SDP offer
     * ([`create_offer`](Self::create_offer)). The other end is the answerer: it
     * receives the channel via `ondatachannel` after
     * [`accept_offer`](Self::accept_offer). Either end can then fetch from the
     * other — the content network is symmetric, no client/server roles.
     *
     * With no `iceServers` configured the connection uses only **host
     * candidates** (loopback / LAN) — sufficient for two peers reachable to each
     * other directly, and entirely serverless. A deployment may add STUN/TURN for
     * NAT traversal without changing this transport or the protocol it carries.
     */
    constructor(initiator: boolean);
    /**
     * Take the next content-network frame received from the peer over the data
     * channel, or `undefined` if none is queued. The pump feeds each into a
     * [`Console`](crate::Console)'s `cn_inbound`.
     */
    recv(): Uint8Array | undefined;
    /**
     * Send a content-network frame to the peer over the data channel. The pump
     * drains a [`Console`](crate::Console)'s `cn_outbound` and sends each frame
     * here. Returns an error if the channel is not yet open (the pump should wait
     * for [`is_open`](Self::is_open)).
     */
    send(frame: Uint8Array): void;
    /**
     * Drain the local ICE candidates gathered so far, as JSON strings to hand to
     * the peer out of band. Call repeatedly while negotiating (candidates arrive
     * over a few event-loop turns).
     */
    take_ice(): any[];
}

/**
 * A **workspace** over a running holospace, in the browser tab — the
 * Codespaces/Gitpod experience (ADR-009; `CC-9` + `CC-11`). The operator
 * launches a holospace whose code is the system emulator; it **boots a real
 * operating system** (the [system emulator](holospaces::emulator) running in
 * the browser's own wasm engine), and the [workspace
 * projection](holospaces::projection) drives it: a live **terminal**
 * (keystrokes published as canonical events that advance the holospace's κ
 * snapshot) and an **editor** that reads and edits environment content *by κ*.
 *
 * The boot runs in instruction *chunks* ([`run`](Workspace::run)) so the UI
 * stays responsive and can stream the console as the kernel boots — there is no
 * server doing the work; the browser peer *is* the machine (Law L1).
 */
export class Workspace {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Launch a workspace: place the OS `kernel` image and `dtb` in a machine
     * with `ram_bytes` of RAM at `base`, the device tree at `dtb_addr`, and hand
     * off as the SBI firmware. The machine is now booting (drive it with
     * [`run`](Workspace::run)).
     */
    static boot(kernel: Uint8Array, dtb: Uint8Array, ram_bytes: number, base: number, dtb_addr: number): Workspace;
    /**
     * Boot a **devcontainer** workspace: the Boot Orchestrator
     * ([`MachineSpec`]) generates the device
     * tree and boots `kernel` on a machine whose `virtio-blk` disk is the
     * assembled `rootfs` (from [`DevcontainerImage::assemble`]). The guest
     * kernel mounts the rootfs over `/dev/vda` and runs the devcontainer's real
     * OS — entirely in the browser peer (`CC-14`). Drive it with
     * [`run`](Workspace::run), exactly like [`boot`](Workspace::boot).
     */
    static boot_devcontainer(kernel: Uint8Array, rootfs: Uint8Array): Workspace;
    /**
     * Boot a devcontainer with the **in-process loopback bridge** enabled
     * (ADR-020, `CC-33`): the guest's interface comes up with DHCP (so it has a
     * real TCP stack), but instead of a WebSocket egress to the internet it gets
     * a no-op egress and the *loopback ingress* — so the workbench, in this same
     * process, can [`dial_guest`](Workspace::dial_guest) a server *inside* the
     * devcontainer (a language server, a remote extension host) and exchange a
     * byte stream with it, with no relay or socket. This is the transport the VS
     * Code remote model runs over in the browser peer (ADR-015/ADR-020). Drive it
     * with [`run`](Workspace::run), pumping the NAT so the bridge's bytes flow.
     */
    static boot_devcontainer_bridged(kernel: Uint8Array, rootfs: Uint8Array): Workspace;
    /**
     * Boot a **networked** devcontainer workspace (`CC-16`): like
     * [`boot_devcontainer`](Workspace::boot_devcontainer), but the machine also
     * has a `virtio-net` device whose userspace TCP/IP NAT tunnels the guest's
     * TCP streams out over a WebSocket to the relay at `relay_url` (there is no
     * raw NIC behind a tab; ADR-014). The guest brings its interface up with
     * DHCP and can then reach the internet — `git clone`, `apt`, `npm` — from the
     * browser peer. Drive it with [`run`](Workspace::run), yielding to the event
     * loop between chunks so the WebSocket delivers host-side bytes.
     */
    static boot_devcontainer_net(kernel: Uint8Array, rootfs: Uint8Array, relay_url: string): Workspace;
    /**
     * Boot a devcontainer whose guest egress is carried by an external
     * **router** — the router extension (`CC-41`) or a node (`CC-39`) — over the
     * egress protocol ([`ChannelEgress`](holospaces::emulator::net::ChannelEgress)).
     * The guest comes up with DHCP and a real TCP stack; the page carries its
     * traffic to the router by pumping the seam (drain
     * [`egress_outbound`](Workspace::egress_outbound), feed
     * [`egress_inbound`](Workspace::egress_inbound)), and the router opens the
     * real sockets a tab cannot — so the guest's package managers, network
     * config, and apps reach the internet (Codespaces parity), with no relay and
     * no proxy. Drive with [`run`](Workspace::run), pumping the seam each tick.
     */
    static boot_devcontainer_routed(kernel: Uint8Array, rootfs: Uint8Array): Workspace;
    /**
     * Boot like [`boot_devcontainer_routed`](Workspace::boot_devcontainer_routed),
     * but page the guest's disk from an **OPFS-backed store** (`handle` is an
     * OPFS `FileSystemSyncAccessHandle` the worker opened) — so the disk's
     * sectors live off the wasm heap and a large real image boots without holding
     * it all in RAM (the paged κ-disk; "the KappaStore IS the memory, RAM is a
     * cache"). Egress is routed (`ChannelEgress`); drive with
     * [`run`](Workspace::run), pumping the router seam each tick.
     */
    static boot_devcontainer_routed_opfs(kernel: Uint8Array, rootfs: Uint8Array, disk_handle: FileSystemSyncAccessHandle): Workspace;
    /**
     * Boot the paged κ-disk by **streaming** the rootfs from one OPFS file into
     * an OPFS-backed store in another — the *transient-peak-free* path: neither
     * the full rootfs nor the assembled image is ever held in wasm RAM.
     * `rootfs_handle` is a sync access handle on the provisioned rootfs file (read
     * sector-by-sector); `disk_handle` is the κ-store pack. Egress is routed.
     */
    static boot_devcontainer_routed_opfs_streamed(kernel: Uint8Array, rootfs_handle: FileSystemSyncAccessHandle, disk_handle: FileSystemSyncAccessHandle): Workspace;
    /**
     * The κ of every operator event published on the terminal channel so far.
     */
    channel(): any[];
    /**
     * Dial an in-process connection to a server *inside* the devcontainer,
     * listening on `guest_port`, over the loopback substrate bridge (ADR-020,
     * `CC-33`). Returns the connection id, or `None` if the machine was not booted
     * with the bridge ([`boot_devcontainer_bridged`](Workspace::boot_devcontainer_bridged)).
     * The workbench uses this to reach a language server / the remote extension
     * host (ADR-015) without a relay or socket. Pump with [`run`](Workspace::run)
     * so the NAT opens the connection and the byte stream flows.
     */
    dial_guest(guest_port: number): number | undefined;
    /**
     * Deliver an egress frame the router returned (the host's bytes / connection
     * events) into the guest's network. A no-op when this is not a routed boot.
     */
    egress_inbound(frame: Uint8Array): void;
    /**
     * Drain the next egress frame the guest produced, for the page to carry to
     * the router. `undefined` when none is queued (or this is not a routed boot).
     */
    egress_outbound(): Uint8Array | undefined;
    /**
     * Feed **raw terminal input** to the running holospace — the bytes an
     * interactive terminal delivers for each keystroke, *unbuffered*: ordinary
     * characters, control bytes (Ctrl-C = `0x03`, Ctrl-D = `0x04`), and escape
     * sequences (arrows, Home/End). Unlike [`Workspace::type_line`] this does not
     * line-buffer or block: the bytes go to the guest console and the caller's
     * render loop ([`Workspace::run`] + [`Workspace::terminal_delta`]) advances
     * the machine, so the guest's own tty echoes and edits the line and Ctrl-C
     * raises SIGINT — a real terminal, not a line submitter. The input is part of
     * the machine's canonical state (it is captured in the κ snapshot), so the
     * session stays reproducible (Law L1).
     */
    feed_input(bytes: Uint8Array): void;
    /**
     * The **file tree**: the workspace's files as a JSON array of
     * `{ path, kappa }` — each file's current content κ (its identity, Law L1).
     * What the editor's explorer renders.
     */
    files(): string;
    /**
     * Close the host side of a loopback connection (`CC-33`).
     */
    guest_close(id: number): void;
    /**
     * Whether a loopback connection is still usable — the guest has not closed it,
     * or has but unread bytes remain (`CC-33`).
     */
    guest_is_open(id: number): boolean;
    /**
     * Drain the guest server's reply bytes on a loopback connection (empty until
     * the machine is pumped enough for the stream to advance; `CC-33`).
     */
    guest_recv(id: number): Uint8Array;
    /**
     * Write bytes toward the guest server on a loopback connection (`CC-33`).
     */
    guest_send(id: number, data: Uint8Array): void;
    /**
     * The editor's read: fetch a file's content *by κ*, verifying it by
     * re-derivation (Law L5). `undefined` if it is not in the workspace store.
     */
    open_file(kappa: string): Uint8Array | undefined;
    /**
     * Open a file *by path*: the content at the file's current κ (the editor
     * reads the environment content by κ). `undefined` if the path is unknown.
     */
    read_path(path: string): Uint8Array | undefined;
    /**
     * **Apply a configuration** the control plane published (ADR-018; `CC-28`):
     * decode the κ-addressed [`Configuration`] bytes (resolved + verified over
     * the substrate by the caller, Law L5) and enact its live directives on the
     * *running* machine — each `forwardPort` begins forwarding on the running
     * instance, without a reboot. Returns a JSON summary of what was applied
     * (`{ "forwarded": [{ "guest": 8080, "host": 8080 }], "lifecycle": "…",
     * "unsupported": [...] }`). The instance state changes from the panel's
     * configuration, carried as content over the substrate — no RPC.
     */
    reconfigure(config_bytes: Uint8Array): string;
    /**
     * Resume a devcontainer workspace from a κ snapshot [`suspend`](Workspace::suspend)
     * produced, instead of cold-booting it (`CC-30`). The running OS, its disk,
     * and the workspace files come back exactly — so a second launch skips the
     * boot entirely and the editor's content is intact. The snapshot's integrity
     * is the caller's to check by re-derivation before trusting it across a
     * session boundary (Law L5; ADR-019) — OPFS is durable but untrusted storage.
     */
    static resume_devcontainer(snapshot: Uint8Array): Workspace;
    /**
     * Advance the running holospace by `budget` instructions (one chunk of the
     * boot or of servicing input). Returns `true` once the machine has halted
     * (powered off). Call repeatedly from a UI loop, rendering
     * [`terminal`](Workspace::terminal) between chunks.
     */
    run(budget: number): boolean;
    /**
     * The **editor** surface: save a file's content (the operator's edit). The
     * content is κ-addressed into the substrate (Law L2), so the returned κ is
     * the file's new identity — an edit advances it (Law L1). The canonical edit
     * event for `path` is published on the channel.
     */
    save_file(path: string, content: Uint8Array): string;
    /**
     * Whether the terminal has rendered `marker` yet (e.g. the ready banner).
     */
    shows(marker: string): boolean;
    /**
     * The running holospace's κ snapshot — its canonical state (Law L1/L3/L5).
     */
    state_kappa(): string;
    /**
     * Suspend the running machine to a κ snapshot — the canonical,
     * content-addressed bytes of the whole machine: CPU, RAM, the rootfs disk,
     * and the *workspace files* (virtio-9p). The browser persists these (gzipped)
     * to OPFS so the next launch *resumes* instead of cold-booting (`CC-30`).
     * Most of guest RAM is zero, so the gzipped snapshot is a small fraction of
     * the machine size.
     */
    suspend(): Uint8Array;
    /**
     * The rendered terminal — the console the running holospace has produced.
     */
    terminal(): string;
    /**
     * The console bytes produced **since the last call** (an internal cursor),
     * for the integrated terminal's render loop. Returning only the delta avoids
     * re-reading and re-encoding the whole console each tick — output stays O(new
     * bytes), not O(total) per frame. Returns raw bytes (the terminal decodes
     * them); [`Workspace::terminal`] still returns the full buffer for tests.
     */
    terminal_delta(): Uint8Array;
    /**
     * Type a line into the terminal: publish it as a canonical event on the
     * holospace's channel (Law L1/L2), feed the keystrokes to the running
     * machine, and run until the response settles. The holospace's κ snapshot
     * advances. Returns the event's κ.
     */
    type_line(line: string): string;
    /**
     * Delete a file or folder from the shared workspace (the workbench
     * `FileSystemProvider.delete`) — the editor removing content the OS sees
     * over `virtio-9p`. `true` if it existed.
     */
    ws_delete(name: string): boolean;
    /**
     * The shared workspace's directory listing — a JSON array of
     * `{ name, dir, size }` over the running holospace's `virtio-9p` workspace
     * (the workbench `FileSystemProvider.readDirectory`).
     */
    ws_list(): string;
    /**
     * Create a folder in the shared workspace (the workbench
     * `FileSystemProvider.createDirectory`).
     */
    ws_mkdir(name: string): void;
    /**
     * Read a file from the shared workspace (the workbench
     * `FileSystemProvider.readFile`) — the same content the OS reads over
     * `virtio-9p`. `undefined` if absent.
     */
    ws_read(name: string): Uint8Array | undefined;
    /**
     * Rename a file or folder in the shared workspace (the workbench
     * `FileSystemProvider.rename`). `true` if the source existed.
     */
    ws_rename(from: string, to: string): boolean;
    /**
     * Write a file into the shared workspace (the workbench
     * `FileSystemProvider.writeFile`) — the editor saving the *same content* the
     * OS reads over `virtio-9p` (one content, Law L1). Returns the content's κ
     * (its identity, Law L1/L2).
     */
    ws_write(name: string, content: Uint8Array): string;
    /**
     * Whether the machine has powered off.
     */
    readonly halted: boolean;
}

/**
 * The **usable default** Dev Container base image the peer provisions when a
 * repository declares no `devcontainer.json` (`buildpack-deps` — `curl`/`git`
 * over apt; the Dev Container spec's default, `CC-20`). Exposed so the
 * operator's page names the same default the host importer does — one source
 * of truth across native and wasm ([`holospaces::DEFAULT_DEVCONTAINER_IMAGE`]).
 */
export function default_devcontainer_image(): string;

/**
 * The κ-label of bytes on the substrate's default σ-axis (blake3) — the same
 * content address every peer computes (Law L1).
 */
export function kappa(bytes: Uint8Array): string;

/**
 * Run a `.holo` compute artifact in the browser via the hologram executor
 * compiled to wasm — the *browser `.holo` engine* (arc42 chapter 11, RT2;
 * conformance `CC-2`). Returns the κ-label of the first output. Because the
 * executor is deterministic and content-addressed, this κ equals the one the
 * native executor produces for the same `.holo` (the browser engine equals the
 * native one).
 */
export function run_holo(archive: Uint8Array): string;

/**
 * Validate that `module` is a recompiled userland fit for the *execution
 * surface* (ADR-008; `CC-6`): specification-valid WebAssembly that imports only
 * the substrate host ABI and presents the container ABI. This is the κ-boundary
 * contract the browser peer enforces before a userland may be a holospace's
 * code — ambient (WASI-style) imports and a missing container ABI are refused.
 */
export function validate_userland(module: Uint8Array): void;

/**
 * Verify bytes against a claimed κ-label by re-derivation (Law L5). This is
 * what makes content fetched from an untrusted gateway safe.
 */
export function verify_kappa(bytes: Uint8Array, kappa: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_aarch64workspace_free: (a: number, b: number) => void;
    readonly __wbg_console_free: (a: number, b: number) => void;
    readonly __wbg_devcontainerimage_free: (a: number, b: number) => void;
    readonly __wbg_devcontainerprovision_free: (a: number, b: number) => void;
    readonly __wbg_workspace_free: (a: number, b: number) => void;
    readonly aarch64workspace_boot_devcontainer_opfs_full: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly aarch64workspace_boot_devcontainer_opfs_streamed: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly aarch64workspace_dial_guest: (a: number, b: number) => number;
    readonly aarch64workspace_egress_inbound: (a: number, b: number, c: number) => void;
    readonly aarch64workspace_egress_outbound: (a: number) => [number, number];
    readonly aarch64workspace_feed_input: (a: number, b: number, c: number) => void;
    readonly aarch64workspace_guest_close: (a: number, b: number) => void;
    readonly aarch64workspace_guest_is_open: (a: number, b: number) => number;
    readonly aarch64workspace_guest_recv: (a: number, b: number) => [number, number];
    readonly aarch64workspace_guest_send: (a: number, b: number, c: number, d: number) => void;
    readonly aarch64workspace_halted: (a: number) => number;
    readonly aarch64workspace_run: (a: number, b: number) => number;
    readonly aarch64workspace_terminal: (a: number) => [number, number];
    readonly aarch64workspace_terminal_delta: (a: number) => [number, number];
    readonly aarch64workspace_workspace_file: (a: number, b: number, c: number) => [number, number];
    readonly aarch64workspace_workspace_write: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly console_boot_userland: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly console_cn_announce: (a: number, b: number, c: number) => [number, number];
    readonly console_cn_discover: (a: number) => [number, number, number, number];
    readonly console_cn_fetch_poll: (a: number) => [number, number, number];
    readonly console_cn_fetch_start: (a: number, b: number, c: number) => [number, number];
    readonly console_cn_inbound: (a: number, b: number, c: number) => void;
    readonly console_cn_outbound: (a: number) => [number, number];
    readonly console_cn_pump: (a: number, b: number) => [number, number, number];
    readonly console_cn_put: (a: number, b: number, c: number) => [number, number, number, number];
    readonly console_configure: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly console_content_network_selftest: (a: number) => [number, number, number, number];
    readonly console_new: () => number;
    readonly console_new_forging: (a: number, b: number) => number;
    readonly console_provision: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly console_provision_devcontainer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly console_provision_repo: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number, number];
    readonly console_provision_userland: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly console_receive: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly console_resolve: (a: number, b: number, c: number) => [number, number, number, number];
    readonly console_roster_kappa: (a: number) => [number, number];
    readonly console_run_devcontainer: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number, number];
    readonly console_sign_in: (a: number, b: number, c: number) => [number, number];
    readonly console_view: (a: number) => [number, number];
    readonly default_devcontainer_image: () => [number, number];
    readonly devcontainerimage_add_layer: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly devcontainerimage_assemble: (a: number) => [number, number, number, number];
    readonly devcontainerimage_assembleBootableIntoOpfs: (a: number, b: any, c: number) => [number, number, number];
    readonly devcontainerimage_assemble_bootable: (a: number, b: number) => [number, number, number, number];
    readonly devcontainerimage_new: () => number;
    readonly devcontainerprovision_assemble: (a: number, b: number) => [number, number, number, number];
    readonly devcontainerprovision_assembleIntoOpfs: (a: number, b: any, c: number) => [number, number, number];
    readonly devcontainerprovision_deliver: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly devcontainerprovision_isDone: (a: number) => number;
    readonly devcontainerprovision_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly devcontainerprovision_nextAccept: (a: number) => [number, number];
    readonly devcontainerprovision_nextBearer: (a: number) => [number, number];
    readonly devcontainerprovision_nextUrl: (a: number) => [number, number];
    readonly kappa: (a: number, b: number) => [number, number];
    readonly run_holo: (a: number, b: number) => [number, number, number, number];
    readonly validate_userland: (a: number, b: number) => [number, number];
    readonly verify_kappa: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly workspace_boot: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly workspace_boot_devcontainer: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly workspace_boot_devcontainer_bridged: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly workspace_boot_devcontainer_net: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly workspace_boot_devcontainer_routed: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly workspace_boot_devcontainer_routed_opfs: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly workspace_boot_devcontainer_routed_opfs_streamed: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly workspace_channel: (a: number) => [number, number];
    readonly workspace_dial_guest: (a: number, b: number) => number;
    readonly workspace_egress_inbound: (a: number, b: number, c: number) => void;
    readonly workspace_egress_outbound: (a: number) => [number, number];
    readonly workspace_feed_input: (a: number, b: number, c: number) => void;
    readonly workspace_files: (a: number) => [number, number];
    readonly workspace_guest_close: (a: number, b: number) => void;
    readonly workspace_guest_is_open: (a: number, b: number) => number;
    readonly workspace_guest_recv: (a: number, b: number) => [number, number];
    readonly workspace_guest_send: (a: number, b: number, c: number, d: number) => void;
    readonly workspace_halted: (a: number) => number;
    readonly workspace_open_file: (a: number, b: number, c: number) => [number, number, number, number];
    readonly workspace_read_path: (a: number, b: number, c: number) => [number, number, number, number];
    readonly workspace_reconfigure: (a: number, b: number, c: number) => [number, number, number, number];
    readonly workspace_resume_devcontainer: (a: number, b: number) => [number, number, number];
    readonly workspace_run: (a: number, b: number) => number;
    readonly workspace_save_file: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly workspace_shows: (a: number, b: number, c: number) => number;
    readonly workspace_state_kappa: (a: number) => [number, number];
    readonly workspace_suspend: (a: number) => [number, number];
    readonly workspace_terminal: (a: number) => [number, number];
    readonly workspace_terminal_delta: (a: number) => [number, number];
    readonly workspace_type_line: (a: number, b: number, c: number) => [number, number];
    readonly workspace_ws_delete: (a: number, b: number, c: number) => number;
    readonly workspace_ws_list: (a: number) => [number, number];
    readonly workspace_ws_mkdir: (a: number, b: number, c: number) => void;
    readonly workspace_ws_read: (a: number, b: number, c: number) => [number, number];
    readonly workspace_ws_rename: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly workspace_ws_write: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly __wbg_webrtclink_free: (a: number, b: number) => void;
    readonly webrtclink_accept_answer: (a: number, b: number, c: number) => any;
    readonly webrtclink_accept_offer: (a: number, b: number, c: number) => any;
    readonly webrtclink_add_ice: (a: number, b: number, c: number) => any;
    readonly webrtclink_close: (a: number) => void;
    readonly webrtclink_create_offer: (a: number) => any;
    readonly webrtclink_is_open: (a: number) => number;
    readonly webrtclink_new: (a: number) => [number, number, number];
    readonly webrtclink_recv: (a: number) => [number, number];
    readonly webrtclink_send: (a: number, b: number, c: number) => [number, number];
    readonly webrtclink_take_ice: (a: number) => [number, number];
    readonly wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue__core_5f3522b8ba92ab41___result__Result_____wasm_bindgen_67bef627eb33d79c___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__4: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
