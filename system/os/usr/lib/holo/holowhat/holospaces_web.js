/* @ts-self-types="./holospaces_web.d.ts" */

/**
 * **The browser peer's AArch64 holospace** — a real arm64 devcontainer booted on
 * the [AArch64 core](holospaces::emulator::aarch64) (`CC-36`), its κ-disk paged
 * from OPFS (the same substrate as the RISC-V [`Workspace`]). The AArch64 core
 * reaches the **shared** `emulator::devbus` for the 9p workspace, the network
 * (router egress), and the in-process guest bridge (`CC-46`) — the same device
 * surface the RISC-V [`Workspace`] exposes, here over the GIC transport.
 */
export class Aarch64Workspace {
    static __wrap(ptr) {
        const obj = Object.create(Aarch64Workspace.prototype);
        obj.__wbg_ptr = ptr;
        Aarch64WorkspaceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Aarch64WorkspaceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_aarch64workspace_free(ptr, 0);
    }
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
     * @param {Uint8Array} kernel
     * @param {FileSystemSyncAccessHandle} rootfs_handle
     * @param {FileSystemSyncAccessHandle} disk_handle
     * @returns {Aarch64Workspace}
     */
    static boot_devcontainer_opfs_full(kernel, rootfs_handle, disk_handle) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aarch64workspace_boot_devcontainer_opfs_full(ptr0, len0, rootfs_handle, disk_handle);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Aarch64Workspace.__wrap(ret[0]);
    }
    /**
     * Boot a provisioned arm64 image, **streaming** its κ-disk from OPFS (no full
     * image in RAM): `rootfs_handle` is the provisioned rootfs (read
     * sector-by-sector into the OPFS-backed store on `disk_handle`). Drive with
     * [`run`](Aarch64Workspace::run), rendering
     * [`terminal_delta`](Aarch64Workspace::terminal_delta) between chunks.
     * @param {Uint8Array} kernel
     * @param {FileSystemSyncAccessHandle} rootfs_handle
     * @param {FileSystemSyncAccessHandle} disk_handle
     * @returns {Aarch64Workspace}
     */
    static boot_devcontainer_opfs_streamed(kernel, rootfs_handle, disk_handle) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aarch64workspace_boot_devcontainer_opfs_streamed(ptr0, len0, rootfs_handle, disk_handle);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Aarch64Workspace.__wrap(ret[0]);
    }
    /**
     * Dial an in-process connection to a server inside the devcontainer over the
     * loopback bridge (`CC-33`/`CC-46`). `None` if not a `*_full` boot.
     * @param {number} guest_port
     * @returns {number | undefined}
     */
    dial_guest(guest_port) {
        const ret = wasm.aarch64workspace_dial_guest(this.__wbg_ptr, guest_port);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * Deliver an egress frame the router returned into the guest's network. A
     * no-op when this is not a `*_full` boot.
     * @param {Uint8Array} frame
     */
    egress_inbound(frame) {
        const ptr0 = passArray8ToWasm0(frame, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.aarch64workspace_egress_inbound(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Drain the next egress frame the guest produced, for the page to carry to
     * the router (`CC-46` net parity). `undefined` when none is queued (or this
     * is not a `*_full` boot).
     * @returns {Uint8Array | undefined}
     */
    egress_outbound() {
        const ret = wasm.aarch64workspace_egress_outbound(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Feed keystrokes to the guest's serial console.
     * @param {Uint8Array} bytes
     */
    feed_input(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.aarch64workspace_feed_input(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Close the host side of a loopback connection (`CC-33`).
     * @param {number} id
     */
    guest_close(id) {
        wasm.aarch64workspace_guest_close(this.__wbg_ptr, id);
    }
    /**
     * Whether a loopback connection is still usable (`CC-33`).
     * @param {number} id
     * @returns {boolean}
     */
    guest_is_open(id) {
        const ret = wasm.aarch64workspace_guest_is_open(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * Drain the guest server's reply bytes on a loopback connection (`CC-33`).
     * @param {number} id
     * @returns {Uint8Array}
     */
    guest_recv(id) {
        const ret = wasm.aarch64workspace_guest_recv(this.__wbg_ptr, id);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Write bytes toward the guest server on a loopback connection (`CC-33`).
     * @param {number} id
     * @param {Uint8Array} data
     */
    guest_send(id, data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.aarch64workspace_guest_send(this.__wbg_ptr, id, ptr0, len0);
    }
    /**
     * Whether the machine has powered off.
     * @returns {boolean}
     */
    get halted() {
        const ret = wasm.aarch64workspace_halted(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Run a chunk of guest execution; returns `true` once the machine halts.
     * @param {number} budget
     * @returns {boolean}
     */
    run(budget) {
        const ret = wasm.aarch64workspace_run(this.__wbg_ptr, budget);
        return ret !== 0;
    }
    /**
     * The full console the guest has produced.
     * @returns {string}
     */
    terminal() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.aarch64workspace_terminal(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The console bytes produced since the last call (the integrated terminal
     * streams these).
     * @returns {Uint8Array}
     */
    terminal_delta() {
        const ret = wasm.aarch64workspace_terminal_delta(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Read a file from the shared workspace — how the editor observes the OS's
     * edits over `virtio-9p` (`CC-15`/`CC-46`). `undefined` if absent / no 9p.
     * @param {string} name
     * @returns {Uint8Array | undefined}
     */
    workspace_file(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aarch64workspace_workspace_file(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Write a file into the shared workspace — the editor saving content the OS
     * reads over `virtio-9p` (one content, Law L1; `CC-15`/`CC-46`).
     * @param {string} name
     * @param {Uint8Array} data
     */
    workspace_write(name, data) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.aarch64workspace_workspace_write(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
}
if (Symbol.dispose) Aarch64Workspace.prototype[Symbol.dispose] = Aarch64Workspace.prototype.free;

/**
 * The Platform Manager console, running as a browser peer that composes the
 * substrate runtime over the interpreter `ContainerEngine`.
 */
export class Console {
    static __wrap(ptr) {
        const obj = Object.create(Console.prototype);
        obj.__wbg_ptr = ptr;
        ConsoleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConsoleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_console_free(ptr, 0);
    }
    /**
     * Boot a userland holospace **in the browser**: provision it, then spawn it
     * through the substrate runtime over the interpreter `ContainerEngine`,
     * capture a κ snapshot of its state (suspend), resume, and terminate — the
     * execution surface running on the browser peer (ADR-008; RT2; `CC-6`).
     * Returns the κ-label of the suspend snapshot (state is content, Law L3).
     * @param {Uint8Array} module
     * @param {number} memory_bytes
     * @returns {string}
     */
    boot_userland(module, memory_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(module, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.console_boot_userland(this.__wbg_ptr, ptr0, len0, memory_bytes);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {string} kappa
     */
    cn_announce(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.console_cn_announce(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
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
     * @returns {string}
     */
    cn_discover() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.console_cn_discover(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Poll the in-flight content-network fetch. Returns `undefined` while it is
     * pending (pump more frames and poll again), `null` when it completed with
     * the content absent (no peer holds it — no forging), or the verified bytes
     * when it resolved. The fetched bytes are also admitted to this peer's
     * content store (a subsequent fetch of the same κ is local).
     * @returns {any}
     */
    cn_fetch_poll() {
        const ret = wasm.console_cn_fetch_poll(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Begin fetching `kappa` from the peer across the transport (verify on
     * receipt). Drive it by pumping frames and polling [`cn_fetch_poll`]; only
     * one fetch is in flight at a time.
     *
     * [`cn_fetch_poll`]: Self::cn_fetch_poll
     * @param {string} kappa
     */
    cn_fetch_start(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.console_cn_fetch_start(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Deliver a content-network frame the transport received from the peer, and
     * service it (answer an inbound fetch from local content, or record a
     * response for an in-flight `cn_fetch`).
     * @param {Uint8Array} frame
     */
    cn_inbound(frame) {
        const ptr0 = passArray8ToWasm0(frame, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.console_cn_inbound(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Drain the next content-network frame this peer wants to send over the
     * transport, or `undefined` if none is queued.
     * @returns {Uint8Array | undefined}
     */
    cn_outbound() {
        const ret = wasm.console_cn_outbound(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {WebRtcLink} link
     * @returns {number}
     */
    cn_pump(link) {
        _assertClass(link, WebRtcLink);
        const ret = wasm.console_cn_pump(this.__wbg_ptr, link.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Publish bytes into this peer's content store so it can serve them to other
     * peers over the content network (`CC-38`). Returns the κ that addresses
     * them — the handle a peer fetches by.
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    cn_put(bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.console_cn_put(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * *Control panel: configure.* Reconfigure a running instance from the panel
     * (ADR-018; `CC-28`). `directives_json` is a JSON array of operations across
     * the four classes, e.g. `[{"lifecycle":"suspend"}, {"forwardPort":8080},
     * {"unforwardPort":8080}, {"network":{"fetch":true,"announce":false}},
     * {"quota":1073741824}, {"grant":"blake3:…"}]`. The panel builds a
     * content-addressed [`Configuration`] issued by the signed-in operator,
     * stores it (Law L2), and returns its κ — the content the running instance
     * resolves and applies over the substrate (no server, no RPC).
     * @param {string} instance
     * @param {string} directives_json
     * @returns {string}
     */
    configure(instance, directives_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(instance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(directives_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.console_configure(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
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
     * @returns {string}
     */
    content_network_selftest() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.console_content_network_selftest(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Open a fresh console — a browser peer with a local content-addressed
     * store and the interpreter container engine.
     */
    constructor() {
        const ret = wasm.console_new();
        this.__wbg_ptr = ret;
        ConsoleFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Open a **forging** browser peer — a malicious responder that answers every
     * content-network fetch with `forged` bytes (which do not re-derive to the
     * requested κ). It drives the SAME content-network seam (`cn_inbound` /
     * `cn_outbound`) over the same transport, so a real WebRTC peer fetching from
     * it receives a well-formed but forged response and **rejects it on receipt**
     * (SPINE-4 / Law L5). This is the adversary the `CC-49` witness uses to prove
     * a forging responder is refused — a genuine attacker, not a mock.
     * @param {Uint8Array} forged
     * @returns {Console}
     */
    static new_forging(forged) {
        const ptr0 = passArray8ToWasm0(forged, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.console_new_forging(ptr0, len0);
        return Console.__wrap(ret);
    }
    /**
     * Provision a holospace from a `.holo` compute artifact (the *holo-file*
     * compute form) with a memory budget, κ-addressing its parts into the
     * peer's store (Law L2). Returns the holospace identity κ.
     * @param {Uint8Array} code
     * @param {number} memory_bytes
     * @returns {string}
     */
    provision(code, memory_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(code, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.console_provision(this.__wbg_ptr, ptr0, len0, memory_bytes);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Provision a holospace from a **devcontainer** for the management console
     * (CC-12): the `devcontainer.json` is validated against the Dev Container
     * spec (`CC-4`) and κ-addressed into the store; the holospace's identity is
     * the content address of its devcontainer definition (reproducible — same
     * source ⇒ same κ, Law L1). This *provisions* (records) the holospace; the
     * operator *enters* it to boot its OS in the workspace IDE (`CC-13`).
     * Returns the holospace identity κ.
     * @param {Uint8Array} config_json
     * @param {string} arch
     * @param {number} memory_bytes
     * @returns {string}
     */
    provision_devcontainer(config_json, arch, memory_bytes) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passArray8ToWasm0(config_json, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(arch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.console_provision_devcontainer(this.__wbg_ptr, ptr0, len0, ptr1, len1, memory_bytes);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
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
     * @param {string} repo
     * @param {string} reference
     * @param {string} config_path
     * @param {Uint8Array} config_json
     * @param {string} arch
     * @param {number} memory_bytes
     * @returns {string}
     */
    provision_repo(repo, reference, config_path, config_json, arch, memory_bytes) {
        let deferred7_0;
        let deferred7_1;
        try {
            const ptr0 = passStringToWasm0(repo, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(reference, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(config_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArray8ToWasm0(config_json, wasm.__wbindgen_malloc);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(arch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len4 = WASM_VECTOR_LEN;
            const ret = wasm.console_provision_repo(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, memory_bytes);
            var ptr6 = ret[0];
            var len6 = ret[1];
            if (ret[3]) {
                ptr6 = 0; len6 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred7_0 = ptr6;
            deferred7_1 = len6;
            return getStringFromWasm0(ptr6, len6);
        } finally {
            wasm.__wbindgen_free(deferred7_0, deferred7_1, 1);
        }
    }
    /**
     * Provision a holospace from a *Wasm-recompiled userland* (the execution
     * surface, the second compute form — ADR-008). The module is validated
     * against the surface contract ([`validate_userland`]) before it is
     * κ-addressed into the store, so only a substrate-valid userland can become
     * a holospace's code. Returns the holospace identity κ.
     * @param {Uint8Array} module
     * @param {number} memory_bytes
     * @returns {string}
     */
    provision_userland(module, memory_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(module, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.console_provision_userland(this.__wbg_ptr, ptr0, len0, memory_bytes);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {Uint8Array} bytes
     * @param {string} kappa
     * @returns {string}
     */
    receive(bytes, kappa) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.console_receive(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
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
     * @param {string} kappa
     * @returns {Uint8Array | undefined}
     */
    resolve(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.console_resolve(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * The operator's roster κ — the content address that links their instances
     * (R5). Its bytes are in the store, so another instance can resolve it.
     * @returns {string | undefined}
     */
    roster_kappa() {
        const ret = wasm.console_roster_kappa(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {string} repo
     * @param {string} reference
     * @param {string} config_path
     * @param {Uint8Array} config_json
     * @param {Uint8Array} userland_module
     * @param {string} arch
     * @param {number} memory_bytes
     * @returns {string}
     */
    run_devcontainer(repo, reference, config_path, config_json, userland_module, arch, memory_bytes) {
        let deferred8_0;
        let deferred8_1;
        try {
            const ptr0 = passStringToWasm0(repo, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(reference, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(config_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArray8ToWasm0(config_json, wasm.__wbindgen_malloc);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passArray8ToWasm0(userland_module, wasm.__wbindgen_malloc);
            const len4 = WASM_VECTOR_LEN;
            const ptr5 = passStringToWasm0(arch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len5 = WASM_VECTOR_LEN;
            const ret = wasm.console_run_devcontainer(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, memory_bytes);
            var ptr7 = ret[0];
            var len7 = ret[1];
            if (ret[3]) {
                ptr7 = 0; len7 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred8_0 = ptr7;
            deferred8_1 = len7;
            return getStringFromWasm0(ptr7, len7);
        } finally {
            wasm.__wbindgen_free(deferred8_0, deferred8_1, 1);
        }
    }
    /**
     * Sign in by unlocking a self-sovereign key (not a server account,
     * ADR-001). Returns the operator's content-addressed identity κ.
     * @param {Uint8Array} key
     * @returns {string}
     */
    sign_in(key) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.console_sign_in(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The console's View — a JSON projection of the operator and their
     * holospaces (what the UI renders).
     * @returns {string}
     */
    view() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.console_view(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Console.prototype[Symbol.dispose] = Console.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DevcontainerImageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_devcontainerimage_free(ptr, 0);
    }
    /**
     * Add an OCI image layer (its media type + the verified blob bytes), in
     * order from the base layer up.
     * @param {string} media_type
     * @param {Uint8Array} blob
     */
    add_layer(media_type, blob) {
        const ptr0 = passStringToWasm0(media_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.devcontainerimage_add_layer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * Assemble the layers into a bootable `ext4` root filesystem (gunzip +
     * untar + OCI whiteout overlay + the in-crate ext4 writer; Law L4). The
     * bytes back a [`Workspace::boot_devcontainer`] machine's `virtio-blk` disk.
     * @returns {Uint8Array}
     */
    assemble() {
        const ret = wasm.devcontainerimage_assemble(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
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
     * @param {FileSystemSyncAccessHandle} rootfs_handle
     * @param {number} disk_bytes
     * @returns {number}
     */
    assembleBootableIntoOpfs(rootfs_handle, disk_bytes) {
        const ret = wasm.devcontainerimage_assembleBootableIntoOpfs(this.__wbg_ptr, rootfs_handle, disk_bytes);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
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
     * @param {number} disk_bytes
     * @returns {Uint8Array}
     */
    assemble_bootable(disk_bytes) {
        const ret = wasm.devcontainerimage_assemble_bootable(this.__wbg_ptr, disk_bytes);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * A new, empty image (add its layers lowest-first with [`Self::add_layer`]).
     */
    constructor() {
        const ret = wasm.devcontainerimage_new();
        this.__wbg_ptr = ret;
        DevcontainerImageFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) DevcontainerImage.prototype[Symbol.dispose] = DevcontainerImage.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DevcontainerProvisionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_devcontainerprovision_free(ptr, 0);
    }
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
     * @param {number} disk_bytes
     * @returns {Uint8Array}
     */
    assemble(disk_bytes) {
        const ret = wasm.devcontainerprovision_assemble(this.__wbg_ptr, disk_bytes);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
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
     * @param {FileSystemSyncAccessHandle} rootfs_handle
     * @param {number} disk_bytes
     * @returns {number}
     */
    assembleIntoOpfs(rootfs_handle, disk_bytes) {
        const ret = wasm.devcontainerprovision_assembleIntoOpfs(this.__wbg_ptr, rootfs_handle, disk_bytes);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * Feed the router's response to the current fetch.
     * @param {number} status
     * @param {string} content_type
     * @param {Uint8Array} body
     */
    deliver(status, content_type, body) {
        const ptr0 = passStringToWasm0(content_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.devcontainerprovision_deliver(this.__wbg_ptr, status, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Whether every blob has been delivered and the image is ready to
     * [`assemble`](DevcontainerProvision::assemble).
     * @returns {boolean}
     */
    isDone() {
        const ret = wasm.devcontainerprovision_isDone(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Begin provisioning `image_ref` (e.g. `mcr.microsoft.com/devcontainers/base:debian`)
     * for `arch` (`"riscv64"` / `"aarch64"`).
     * @param {string} image_ref
     * @param {string} arch
     */
    constructor(image_ref, arch) {
        const ptr0 = passStringToWasm0(image_ref, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(arch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.devcontainerprovision_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        DevcontainerProvisionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * The `Accept` header for the next fetch (manifests), or `undefined`.
     * @returns {string | undefined}
     */
    nextAccept() {
        const ret = wasm.devcontainerprovision_nextAccept(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The bearer token for the next fetch once one is held, or `undefined`.
     * @returns {string | undefined}
     */
    nextBearer() {
        const ret = wasm.devcontainerprovision_nextBearer(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The URL the page must `GET` next through the router, or `undefined` when
     * [`is_done`](DevcontainerProvision::is_done).
     * @returns {string | undefined}
     */
    nextUrl() {
        const ret = wasm.devcontainerprovision_nextUrl(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) DevcontainerProvision.prototype[Symbol.dispose] = DevcontainerProvision.prototype.free;

/**
 * One end of a peer-to-peer content-network transport over a real WebRTC data
 * channel — the browser surface's wire. It carries a [`Console`](crate::Console)'s
 * content-network frames to and from another browser peer (no server between);
 * the product pump [`Console::cn_pump`](crate::Console::cn_pump) couples it to
 * the `BareNetSync`-driven `NetworkInterface`, so a deployed tab fetches over it.
 */
export class WebRtcLink {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebRtcLinkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_webrtclink_free(ptr, 0);
    }
    /**
     * (Offerer) Accept the peer's answer SDP, completing the negotiation.
     * @param {string} answer_sdp
     * @returns {Promise<void>}
     */
    accept_answer(answer_sdp) {
        const ptr0 = passStringToWasm0(answer_sdp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.webrtclink_accept_answer(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * (Answerer) Accept the peer's offer SDP, set it remote, create the answer
     * and set it local; returns the answer SDP to hand back to the peer.
     * @param {string} offer_sdp
     * @returns {Promise<string>}
     */
    accept_offer(offer_sdp) {
        const ptr0 = passStringToWasm0(offer_sdp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.webrtclink_accept_offer(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Add a remote ICE candidate (the JSON the peer produced via
     * [`take_ice`](Self::take_ice)) to this connection.
     * @param {string} candidate_json
     * @returns {Promise<void>}
     */
    add_ice(candidate_json) {
        const ptr0 = passStringToWasm0(candidate_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.webrtclink_add_ice(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Close the connection and its data channel.
     */
    close() {
        wasm.webrtclink_close(this.__wbg_ptr);
    }
    /**
     * (Offerer) Create the SDP offer and set it as the local description; returns
     * the offer SDP to hand to the peer out of band (paste / existing peer).
     * @returns {Promise<string>}
     */
    create_offer() {
        const ret = wasm.webrtclink_create_offer(this.__wbg_ptr);
        return ret;
    }
    /**
     * Whether the data channel is open and ready to carry frames.
     * @returns {boolean}
     */
    is_open() {
        const ret = wasm.webrtclink_is_open(this.__wbg_ptr);
        return ret !== 0;
    }
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
     * @param {boolean} initiator
     */
    constructor(initiator) {
        const ret = wasm.webrtclink_new(initiator);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WebRtcLinkFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Take the next content-network frame received from the peer over the data
     * channel, or `undefined` if none is queued. The pump feeds each into a
     * [`Console`](crate::Console)'s `cn_inbound`.
     * @returns {Uint8Array | undefined}
     */
    recv() {
        const ret = wasm.webrtclink_recv(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Send a content-network frame to the peer over the data channel. The pump
     * drains a [`Console`](crate::Console)'s `cn_outbound` and sends each frame
     * here. Returns an error if the channel is not yet open (the pump should wait
     * for [`is_open`](Self::is_open)).
     * @param {Uint8Array} frame
     */
    send(frame) {
        const ptr0 = passArray8ToWasm0(frame, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.webrtclink_send(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Drain the local ICE candidates gathered so far, as JSON strings to hand to
     * the peer out of band. Call repeatedly while negotiating (candidates arrive
     * over a few event-loop turns).
     * @returns {any[]}
     */
    take_ice() {
        const ret = wasm.webrtclink_take_ice(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) WebRtcLink.prototype[Symbol.dispose] = WebRtcLink.prototype.free;

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
    static __wrap(ptr) {
        const obj = Object.create(Workspace.prototype);
        obj.__wbg_ptr = ptr;
        WorkspaceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorkspaceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_workspace_free(ptr, 0);
    }
    /**
     * Launch a workspace: place the OS `kernel` image and `dtb` in a machine
     * with `ram_bytes` of RAM at `base`, the device tree at `dtb_addr`, and hand
     * off as the SBI firmware. The machine is now booting (drive it with
     * [`run`](Workspace::run)).
     * @param {Uint8Array} kernel
     * @param {Uint8Array} dtb
     * @param {number} ram_bytes
     * @param {number} base
     * @param {number} dtb_addr
     * @returns {Workspace}
     */
    static boot(kernel, dtb, ram_bytes, base, dtb_addr) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(dtb, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot(ptr0, len0, ptr1, len1, ram_bytes, base, dtb_addr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * Boot a **devcontainer** workspace: the Boot Orchestrator
     * ([`MachineSpec`]) generates the device
     * tree and boots `kernel` on a machine whose `virtio-blk` disk is the
     * assembled `rootfs` (from [`DevcontainerImage::assemble`]). The guest
     * kernel mounts the rootfs over `/dev/vda` and runs the devcontainer's real
     * OS — entirely in the browser peer (`CC-14`). Drive it with
     * [`run`](Workspace::run), exactly like [`boot`](Workspace::boot).
     * @param {Uint8Array} kernel
     * @param {Uint8Array} rootfs
     * @returns {Workspace}
     */
    static boot_devcontainer(kernel, rootfs) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rootfs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot_devcontainer(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
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
     * @param {Uint8Array} kernel
     * @param {Uint8Array} rootfs
     * @returns {Workspace}
     */
    static boot_devcontainer_bridged(kernel, rootfs) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rootfs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot_devcontainer_bridged(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * Boot a **networked** devcontainer workspace (`CC-16`): like
     * [`boot_devcontainer`](Workspace::boot_devcontainer), but the machine also
     * has a `virtio-net` device whose userspace TCP/IP NAT tunnels the guest's
     * TCP streams out over a WebSocket to the relay at `relay_url` (there is no
     * raw NIC behind a tab; ADR-014). The guest brings its interface up with
     * DHCP and can then reach the internet — `git clone`, `apt`, `npm` — from the
     * browser peer. Drive it with [`run`](Workspace::run), yielding to the event
     * loop between chunks so the WebSocket delivers host-side bytes.
     * @param {Uint8Array} kernel
     * @param {Uint8Array} rootfs
     * @param {string} relay_url
     * @returns {Workspace}
     */
    static boot_devcontainer_net(kernel, rootfs, relay_url) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rootfs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(relay_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot_devcontainer_net(ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
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
     * @param {Uint8Array} kernel
     * @param {Uint8Array} rootfs
     * @returns {Workspace}
     */
    static boot_devcontainer_routed(kernel, rootfs) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rootfs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot_devcontainer_routed(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * Boot like [`boot_devcontainer_routed`](Workspace::boot_devcontainer_routed),
     * but page the guest's disk from an **OPFS-backed store** (`handle` is an
     * OPFS `FileSystemSyncAccessHandle` the worker opened) — so the disk's
     * sectors live off the wasm heap and a large real image boots without holding
     * it all in RAM (the paged κ-disk; "the KappaStore IS the memory, RAM is a
     * cache"). Egress is routed (`ChannelEgress`); drive with
     * [`run`](Workspace::run), pumping the router seam each tick.
     * @param {Uint8Array} kernel
     * @param {Uint8Array} rootfs
     * @param {FileSystemSyncAccessHandle} disk_handle
     * @returns {Workspace}
     */
    static boot_devcontainer_routed_opfs(kernel, rootfs, disk_handle) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rootfs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot_devcontainer_routed_opfs(ptr0, len0, ptr1, len1, disk_handle);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * Boot the paged κ-disk by **streaming** the rootfs from one OPFS file into
     * an OPFS-backed store in another — the *transient-peak-free* path: neither
     * the full rootfs nor the assembled image is ever held in wasm RAM.
     * `rootfs_handle` is a sync access handle on the provisioned rootfs file (read
     * sector-by-sector); `disk_handle` is the κ-store pack. Egress is routed.
     * @param {Uint8Array} kernel
     * @param {FileSystemSyncAccessHandle} rootfs_handle
     * @param {FileSystemSyncAccessHandle} disk_handle
     * @returns {Workspace}
     */
    static boot_devcontainer_routed_opfs_streamed(kernel, rootfs_handle, disk_handle) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_boot_devcontainer_routed_opfs_streamed(ptr0, len0, rootfs_handle, disk_handle);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * The κ of every operator event published on the terminal channel so far.
     * @returns {any[]}
     */
    channel() {
        const ret = wasm.workspace_channel(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Dial an in-process connection to a server *inside* the devcontainer,
     * listening on `guest_port`, over the loopback substrate bridge (ADR-020,
     * `CC-33`). Returns the connection id, or `None` if the machine was not booted
     * with the bridge ([`boot_devcontainer_bridged`](Workspace::boot_devcontainer_bridged)).
     * The workbench uses this to reach a language server / the remote extension
     * host (ADR-015) without a relay or socket. Pump with [`run`](Workspace::run)
     * so the NAT opens the connection and the byte stream flows.
     * @param {number} guest_port
     * @returns {number | undefined}
     */
    dial_guest(guest_port) {
        const ret = wasm.workspace_dial_guest(this.__wbg_ptr, guest_port);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * Deliver an egress frame the router returned (the host's bytes / connection
     * events) into the guest's network. A no-op when this is not a routed boot.
     * @param {Uint8Array} frame
     */
    egress_inbound(frame) {
        const ptr0 = passArray8ToWasm0(frame, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.workspace_egress_inbound(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Drain the next egress frame the guest produced, for the page to carry to
     * the router. `undefined` when none is queued (or this is not a routed boot).
     * @returns {Uint8Array | undefined}
     */
    egress_outbound() {
        const ret = wasm.workspace_egress_outbound(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {Uint8Array} bytes
     */
    feed_input(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.workspace_feed_input(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The **file tree**: the workspace's files as a JSON array of
     * `{ path, kappa }` — each file's current content κ (its identity, Law L1).
     * What the editor's explorer renders.
     * @returns {string}
     */
    files() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.workspace_files(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Close the host side of a loopback connection (`CC-33`).
     * @param {number} id
     */
    guest_close(id) {
        wasm.workspace_guest_close(this.__wbg_ptr, id);
    }
    /**
     * Whether a loopback connection is still usable — the guest has not closed it,
     * or has but unread bytes remain (`CC-33`).
     * @param {number} id
     * @returns {boolean}
     */
    guest_is_open(id) {
        const ret = wasm.workspace_guest_is_open(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * Drain the guest server's reply bytes on a loopback connection (empty until
     * the machine is pumped enough for the stream to advance; `CC-33`).
     * @param {number} id
     * @returns {Uint8Array}
     */
    guest_recv(id) {
        const ret = wasm.workspace_guest_recv(this.__wbg_ptr, id);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Write bytes toward the guest server on a loopback connection (`CC-33`).
     * @param {number} id
     * @param {Uint8Array} data
     */
    guest_send(id, data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.workspace_guest_send(this.__wbg_ptr, id, ptr0, len0);
    }
    /**
     * Whether the machine has powered off.
     * @returns {boolean}
     */
    get halted() {
        const ret = wasm.workspace_halted(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The editor's read: fetch a file's content *by κ*, verifying it by
     * re-derivation (Law L5). `undefined` if it is not in the workspace store.
     * @param {string} kappa
     * @returns {Uint8Array | undefined}
     */
    open_file(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_open_file(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Open a file *by path*: the content at the file's current κ (the editor
     * reads the environment content by κ). `undefined` if the path is unknown.
     * @param {string} path
     * @returns {Uint8Array | undefined}
     */
    read_path(path) {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_read_path(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * **Apply a configuration** the control plane published (ADR-018; `CC-28`):
     * decode the κ-addressed [`Configuration`] bytes (resolved + verified over
     * the substrate by the caller, Law L5) and enact its live directives on the
     * *running* machine — each `forwardPort` begins forwarding on the running
     * instance, without a reboot. Returns a JSON summary of what was applied
     * (`{ "forwarded": [{ "guest": 8080, "host": 8080 }], "lifecycle": "…",
     * "unsupported": [...] }`). The instance state changes from the panel's
     * configuration, carried as content over the substrate — no RPC.
     * @param {Uint8Array} config_bytes
     * @returns {string}
     */
    reconfigure(config_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(config_bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_reconfigure(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Resume a devcontainer workspace from a κ snapshot [`suspend`](Workspace::suspend)
     * produced, instead of cold-booting it (`CC-30`). The running OS, its disk,
     * and the workspace files come back exactly — so a second launch skips the
     * boot entirely and the editor's content is intact. The snapshot's integrity
     * is the caller's to check by re-derivation before trusting it across a
     * session boundary (Law L5; ADR-019) — OPFS is durable but untrusted storage.
     * @param {Uint8Array} snapshot
     * @returns {Workspace}
     */
    static resume_devcontainer(snapshot) {
        const ptr0 = passArray8ToWasm0(snapshot, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_resume_devcontainer(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * Advance the running holospace by `budget` instructions (one chunk of the
     * boot or of servicing input). Returns `true` once the machine has halted
     * (powered off). Call repeatedly from a UI loop, rendering
     * [`terminal`](Workspace::terminal) between chunks.
     * @param {number} budget
     * @returns {boolean}
     */
    run(budget) {
        const ret = wasm.workspace_run(this.__wbg_ptr, budget);
        return ret !== 0;
    }
    /**
     * The **editor** surface: save a file's content (the operator's edit). The
     * content is κ-addressed into the substrate (Law L2), so the returned κ is
     * the file's new identity — an edit advances it (Law L1). The canonical edit
     * event for `path` is published on the channel.
     * @param {string} path
     * @param {Uint8Array} content
     * @returns {string}
     */
    save_file(path, content) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(content, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_save_file(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Whether the terminal has rendered `marker` yet (e.g. the ready banner).
     * @param {string} marker
     * @returns {boolean}
     */
    shows(marker) {
        const ptr0 = passStringToWasm0(marker, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_shows(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * The running holospace's κ snapshot — its canonical state (Law L1/L3/L5).
     * @returns {string}
     */
    state_kappa() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.workspace_state_kappa(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Suspend the running machine to a κ snapshot — the canonical,
     * content-addressed bytes of the whole machine: CPU, RAM, the rootfs disk,
     * and the *workspace files* (virtio-9p). The browser persists these (gzipped)
     * to OPFS so the next launch *resumes* instead of cold-booting (`CC-30`).
     * Most of guest RAM is zero, so the gzipped snapshot is a small fraction of
     * the machine size.
     * @returns {Uint8Array}
     */
    suspend() {
        const ret = wasm.workspace_suspend(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The rendered terminal — the console the running holospace has produced.
     * @returns {string}
     */
    terminal() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.workspace_terminal(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The console bytes produced **since the last call** (an internal cursor),
     * for the integrated terminal's render loop. Returning only the delta avoids
     * re-reading and re-encoding the whole console each tick — output stays O(new
     * bytes), not O(total) per frame. Returns raw bytes (the terminal decodes
     * them); [`Workspace::terminal`] still returns the full buffer for tests.
     * @returns {Uint8Array}
     */
    terminal_delta() {
        const ret = wasm.workspace_terminal_delta(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Type a line into the terminal: publish it as a canonical event on the
     * holospace's channel (Law L1/L2), feed the keystrokes to the running
     * machine, and run until the response settles. The holospace's κ snapshot
     * advances. Returns the event's κ.
     * @param {string} line
     * @returns {string}
     */
    type_line(line) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(line, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_type_line(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Delete a file or folder from the shared workspace (the workbench
     * `FileSystemProvider.delete`) — the editor removing content the OS sees
     * over `virtio-9p`. `true` if it existed.
     * @param {string} name
     * @returns {boolean}
     */
    ws_delete(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_ws_delete(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * The shared workspace's directory listing — a JSON array of
     * `{ name, dir, size }` over the running holospace's `virtio-9p` workspace
     * (the workbench `FileSystemProvider.readDirectory`).
     * @returns {string}
     */
    ws_list() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.workspace_ws_list(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Create a folder in the shared workspace (the workbench
     * `FileSystemProvider.createDirectory`).
     * @param {string} name
     */
    ws_mkdir(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.workspace_ws_mkdir(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Read a file from the shared workspace (the workbench
     * `FileSystemProvider.readFile`) — the same content the OS reads over
     * `virtio-9p`. `undefined` if absent.
     * @param {string} name
     * @returns {Uint8Array | undefined}
     */
    ws_read(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_ws_read(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Rename a file or folder in the shared workspace (the workbench
     * `FileSystemProvider.rename`). `true` if the source existed.
     * @param {string} from
     * @param {string} to
     * @returns {boolean}
     */
    ws_rename(from, to) {
        const ptr0 = passStringToWasm0(from, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(to, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_ws_rename(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * Write a file into the shared workspace (the workbench
     * `FileSystemProvider.writeFile`) — the editor saving the *same content* the
     * OS reads over `virtio-9p` (one content, Law L1). Returns the content's κ
     * (its identity, Law L1/L2).
     * @param {string} name
     * @param {Uint8Array} content
     * @returns {string}
     */
    ws_write(name, content) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(content, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_ws_write(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
}
if (Symbol.dispose) Workspace.prototype[Symbol.dispose] = Workspace.prototype.free;

/**
 * The **usable default** Dev Container base image the peer provisions when a
 * repository declares no `devcontainer.json` (`buildpack-deps` — `curl`/`git`
 * over apt; the Dev Container spec's default, `CC-20`). Exposed so the
 * operator's page names the same default the host importer does — one source
 * of truth across native and wasm ([`holospaces::DEFAULT_DEVCONTAINER_IMAGE`]).
 * @returns {string}
 */
export function default_devcontainer_image() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.default_devcontainer_image();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The κ-label of bytes on the substrate's default σ-axis (blake3) — the same
 * content address every peer computes (Law L1).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function kappa(bytes) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.kappa(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Run a `.holo` compute artifact in the browser via the hologram executor
 * compiled to wasm — the *browser `.holo` engine* (arc42 chapter 11, RT2;
 * conformance `CC-2`). Returns the κ-label of the first output. Because the
 * executor is deterministic and content-addressed, this κ equals the one the
 * native executor produces for the same `.holo` (the browser engine equals the
 * native one).
 * @param {Uint8Array} archive
 * @returns {string}
 */
export function run_holo(archive) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(archive, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.run_holo(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Validate that `module` is a recompiled userland fit for the *execution
 * surface* (ADR-008; `CC-6`): specification-valid WebAssembly that imports only
 * the substrate host ABI and presents the container ABI. This is the κ-boundary
 * contract the browser peer enforces before a userland may be a holospace's
 * code — ambient (WASI-style) imports and a missing container ABI are refused.
 * @param {Uint8Array} module
 */
export function validate_userland(module) {
    const ptr0 = passArray8ToWasm0(module, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.validate_userland(ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Verify bytes against a claimed κ-label by re-derivation (Law L5). This is
 * what makes content fetched from an untrusted gateway safe.
 * @param {Uint8Array} bytes
 * @param {string} kappa
 * @returns {boolean}
 */
export function verify_kappa(bytes, kappa) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.verify_kappa(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_debug_string_8a447059637473e2: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_acc5528be2b923f2: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_undefined_721f8decd50c87a3: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_1cc01dd708740256: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_71bb4348194e31f0: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_ea4887a5f8f9a9db: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_33c39e13d73b25f6: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_addIceCandidate_570c35791b2edc6f: function(arg0, arg1) {
            const ret = arg0.addIceCandidate(arg1);
            return ret;
        },
        __wbg_call_5575218572ead796: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_candidate_abc04d3c9640a945: function(arg0) {
            const ret = arg0.candidate;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_candidate_c5cb995a4adbe7bb: function(arg0, arg1) {
            const ret = arg1.candidate;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_channel_af324f9599e593c2: function(arg0) {
            const ret = arg0.channel;
            return ret;
        },
        __wbg_close_2ba5cc8d6aac7a37: function(arg0) {
            arg0.close();
        },
        __wbg_close_ab4b4711fbe56bef: function(arg0) {
            arg0.close();
        },
        __wbg_createAnswer_cb876f31d510385c: function(arg0) {
            const ret = arg0.createAnswer();
            return ret;
        },
        __wbg_createDataChannel_eb1bfc83623c6000: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.createDataChannel(getStringFromWasm0(arg1, arg2), arg3);
            return ret;
        },
        __wbg_createOffer_8a6c8d39b6ff1dac: function(arg0) {
            const ret = arg0.createOffer();
            return ret;
        },
        __wbg_data_4a7f1308dbd33a21: function(arg0) {
            const ret = arg0.data;
            return ret;
        },
        __wbg_getSize_a9e40ff0a914f5ef: function() { return handleError(function (arg0) {
            const ret = arg0.getSize();
            return ret;
        }, arguments); },
        __wbg_get_dddb90ff5d27a080: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_instanceof_ArrayBuffer_2a7bb09fee70c2da: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_length_589238bdcf171f0e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_2e117a478906f062: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_5a19eef57e9178b5: function() { return handleError(function (arg0, arg1) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_81880fb5002cb255: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_dde64c18d5113696: function() { return handleError(function (arg0) {
            const ret = new RTCIceCandidate(arg0);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_543b875b27789a8f: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_00a409eb4ec4f2d9: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_configuration_3c9a92c37bb537b0: function() { return handleError(function (arg0) {
            const ret = new RTCPeerConnection(arg0);
            return ret;
        }, arguments); },
        __wbg_parse_1f9d3f9cbc8a7da2: function() { return handleError(function (arg0, arg1) {
            const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_d721637c7ca66eb8: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_queueMicrotask_1c9b3800e321a967: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_311744e534a929a3: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_read_56f01ecc43fc9ea2: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.read(getArrayU8FromWasm0(arg1, arg2), arg3);
            return ret;
        }, arguments); },
        __wbg_readyState_d73973ea8c4d5d6e: function(arg0) {
            const ret = arg0.readyState;
            return (__wbindgen_enum_RtcDataChannelState.indexOf(ret) + 1 || 5) - 1;
        },
        __wbg_resolve_d82363d90af6928a: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_sdpMLineIndex_bf069a1914ff0243: function(arg0) {
            const ret = arg0.sdpMLineIndex;
            return isLikeNone(ret) ? 0xFFFFFF : ret;
        },
        __wbg_sdpMid_7c44aacb616d707f: function(arg0, arg1) {
            const ret = arg1.sdpMid;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_send_982c819b9a1b34a5: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.send(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_send_aa0dff2a7e4bd540: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.send(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_setLocalDescription_222e7061e5294b19: function(arg0, arg1) {
            const ret = arg0.setLocalDescription(arg1);
            return ret;
        },
        __wbg_setRemoteDescription_c30999ad0da60100: function(arg0, arg1) {
            const ret = arg0.setRemoteDescription(arg1);
            return ret;
        },
        __wbg_set_4564f7dc44fcb0c9: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_at_3642c6ea0e5ee17d: function(arg0, arg1) {
            arg0.at = arg1;
        },
        __wbg_set_binaryType_148427b11a8e6551: function(arg0, arg1) {
            arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
        },
        __wbg_set_binaryType_e0b5f80e28f0849e: function(arg0, arg1) {
            arg0.binaryType = __wbindgen_enum_RtcDataChannelType[arg1];
        },
        __wbg_set_candidate_141366a4068e38f4: function(arg0, arg1, arg2) {
            arg0.candidate = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_onclose_8134952b2a9ec104: function(arg0, arg1) {
            arg0.onclose = arg1;
        },
        __wbg_set_ondatachannel_8e6f4d09e5c98102: function(arg0, arg1) {
            arg0.ondatachannel = arg1;
        },
        __wbg_set_onicecandidate_65a0e043bddad05d: function(arg0, arg1) {
            arg0.onicecandidate = arg1;
        },
        __wbg_set_onmessage_397a79f643011142: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onmessage_64ff25e6dd70b00f: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onopen_123a6cdc68b54615: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_set_onopen_ca8d311fe5282041: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_set_ordered_f772e63f19da2089: function(arg0, arg1) {
            arg0.ordered = arg1 !== 0;
        },
        __wbg_set_sdp_23bc8e5cbecefd1d: function(arg0, arg1, arg2) {
            arg0.sdp = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_sdp_m_line_index_314714f6f9cb9979: function(arg0, arg1) {
            arg0.sdpMLineIndex = arg1 === 0xFFFFFF ? undefined : arg1;
        },
        __wbg_set_sdp_mid_634f01a5a50f9928: function(arg0, arg1, arg2) {
            arg0.sdpMid = arg1 === 0 ? undefined : getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_type_3bd9367499409fe0: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_RtcSdpType[arg1];
        },
        __wbg_static_accessor_GLOBAL_THIS_2fee5048bcca5938: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_ce44e66a4935da8c: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_44f6e0cb5e67cdad: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_168f178805d978fe: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_stringify_747a843de2eb6359: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbg_then_05edfc8a4fea5106: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_591b6b3a75ee817a: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_truncate_76cd612e76bda8cb: function() { return handleError(function (arg0, arg1) {
            arg0.truncate(arg1);
        }, arguments); },
        __wbg_write_0d7b7d5ddb95d78a: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.write(getArrayU8FromWasm0(arg1, arg2), arg3);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 3545, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue__core_5f3522b8ba92ab41___result__Result_____wasm_bindgen_67bef627eb33d79c___JsError___true_);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 96, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true_);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 96, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__2);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("RTCDataChannelEvent")], shim_idx: 96, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__3);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("RTCPeerConnectionIceEvent")], shim_idx: 96, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__4);
            return ret;
        },
        __wbindgen_cast_0000000000000006: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000007: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./holospaces_web_bg.js": import0,
    };
}

function wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true_(arg0, arg1, arg2);
}

function wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__2(arg0, arg1, arg2) {
    wasm.wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__2(arg0, arg1, arg2);
}

function wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__3(arg0, arg1, arg2) {
    wasm.wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__3(arg0, arg1, arg2);
}

function wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__4(arg0, arg1, arg2) {
    wasm.wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue______true__4(arg0, arg1, arg2);
}

function wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue__core_5f3522b8ba92ab41___result__Result_____wasm_bindgen_67bef627eb33d79c___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___wasm_bindgen_67bef627eb33d79c___JsValue__core_5f3522b8ba92ab41___result__Result_____wasm_bindgen_67bef627eb33d79c___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_67bef627eb33d79c___convert__closures_____invoke___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined___js_sys_690642fda889ca86___Function_fn_wasm_bindgen_67bef627eb33d79c___JsValue_____wasm_bindgen_67bef627eb33d79c___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];


const __wbindgen_enum_RtcDataChannelState = ["connecting", "open", "closing", "closed"];


const __wbindgen_enum_RtcDataChannelType = ["arraybuffer", "blob"];


const __wbindgen_enum_RtcSdpType = ["offer", "pranswer", "answer", "rollback"];
const Aarch64WorkspaceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_aarch64workspace_free(ptr, 1));
const ConsoleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_console_free(ptr, 1));
const DevcontainerImageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_devcontainerimage_free(ptr, 1));
const DevcontainerProvisionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_devcontainerprovision_free(ptr, 1));
const WebRtcLinkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_webrtclink_free(ptr, 1));
const WorkspaceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_workspace_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('holospaces_web_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
