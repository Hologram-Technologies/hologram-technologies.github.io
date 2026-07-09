/* @ts-self-types="./holospaces_web.d.ts" */

/**
 * The **messenger peer** in the browser tab: it mints the channel's content
 * (channels, signed messages forming a causal DAG, feed heads) at the
 * substrate's real blake3 κ, holds it in a content-addressed store, ingests
 * what other peers publish (verifying on receipt, Law L5), and linearises the
 * DAG into one deterministic transcript. The transport (announce / discover /
 * fetch over the κ pub/sub relay) is JavaScript's `WsKappaSync`; this peer is
 * the content + identity half. No homeserver (ADR-001).
 */
export class ChatPeer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChatPeerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_chatpeer_free(ptr, 0);
    }
    /**
     * This peer's 32-byte X25519 **encryption** public key — published so an
     * admin can seal a channel's group key to it ([`ChatPeer::seal_key_to`]).
     * @returns {Uint8Array}
     */
    encryption_key() {
        const ret = wasm.chatpeer_encryption_key(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Publish this peer's signed feed head for `channel` — the mutable pointer
     * other peers resolve to discover its latest. Returns the feed κ.
     * @param {string} channel
     * @param {number} timestamp_ms
     * @returns {string}
     */
    feed(channel, timestamp_ms) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_feed(this.__wbg_ptr, ptr0, len0, timestamp_ms);
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
     * The head message κ a feed points at — JS walks parents back from here.
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    feed_head(bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_feed_head(this.__wbg_ptr, ptr0, len0);
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
     * The operator's content-addressed identity κ (the κ of the ed25519 public
     * key).
     * @returns {string}
     */
    identity() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chatpeer_identity(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The operator identity as a **W3C `did:key`** — the standard, registry-free
     * representation of this ed25519 public key (`did:key:z6Mk…`): multibase
     * base58btc of the multicodec `ed25519-pub` (0xed01) prefix + the 32-byte
     * key. Lets the messenger's self-sovereign identity interoperate with the
     * open decentralized-identity ecosystem (DIDs / Verifiable Credentials)
     * without changing our content-addressed `Operator` κ.
     * @returns {string}
     */
    identity_did() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chatpeer_identity_did(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Ingest bytes a peer fetched over the relay, verifying on receipt (the κ is
     * re-derived from the bytes, Law L5 — forged content cannot enter). If the
     * bytes are a message, its head advances this peer's view of the channel.
     * Returns the κ.
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    ingest(bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_ingest(this.__wbg_ptr, ptr0, len0);
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
     * **Install an epoch key from a published envelope** (member): verify the
     * [`KeyEnvelope`] under the trusted channel `admin_pubkey` (rejecting a
     * relay-injected or non-admin envelope), find this peer's HPKE wrap, open it,
     * and adopt the key as the channel's current epoch. Returns the epoch
     * installed, or `undefined` if the envelope is unauthentic or this peer is
     * not one of its recipients (e.g. a removed member).
     * @param {Uint8Array} bytes
     * @param {Uint8Array} admin_pubkey
     * @returns {number | undefined}
     */
    ingest_key_envelope(bytes, admin_pubkey) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(admin_pubkey, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_ingest_key_envelope(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * A message's causal parent κs — the edges JS follows to pull history.
     * @param {Uint8Array} bytes
     * @returns {any[]}
     */
    message_parents(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_message_parents(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Open a messenger peer signing as the operator whose self-sovereign public
     * key is `public_key` (its κ is the author identity, Law L1).
     * @param {Uint8Array} secret
     */
    constructor(secret) {
        const ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_new(ptr0, len0);
        this.__wbg_ptr = ret;
        ChatPeerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * The canonical bytes of a stored object, to hand to `WsKappaSync.announce`.
     * @param {string} kappa
     * @returns {Uint8Array | undefined}
     */
    object(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_object(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Open a channel; its κ is the genesis every message refers back to. The
     * genesis bytes are stored so the peer can publish them. Returns the κ.
     * @param {string} name
     * @param {number} created_ms
     * @returns {string}
     */
    open_channel(name, created_ms) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_open_channel(this.__wbg_ptr, ptr0, len0, created_ms);
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
     * Open a group key HPKE-sealed to this peer with
     * [`seal_key_to`](ChatPeer::seal_key_to).
     * @param {Uint8Array} wrapped
     * @returns {Uint8Array}
     */
    open_sealed_key(wrapped) {
        const ptr0 = passArray8ToWasm0(wrapped, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_open_sealed_key(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Post a signed message into `channel`, parented on this peer's current head
     * for that channel (its causal view). Stores it and advances the head.
     * Returns the message κ.
     * @param {string} channel
     * @param {number} timestamp_ms
     * @param {string} body
     * @returns {string}
     */
    post(channel, timestamp_ms, body) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_post(this.__wbg_ptr, ptr0, len0, timestamp_ms, ptr1, len1);
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
     * Post a **sealed** message: the `plaintext` is AEAD-encrypted under the
     * 32-byte channel `key` before it becomes the (opaque) message body, so the
     * relay and non-members see only ciphertext. The message is still signed
     * (authenticity) and the ciphertext is bound into its κ (Law L5). Returns
     * the message κ.
     * @param {string} channel
     * @param {number} timestamp_ms
     * @param {string} plaintext
     * @param {Uint8Array} key
     * @returns {string}
     */
    post_sealed(channel, timestamp_ms, plaintext, key) {
        let deferred5_0;
        let deferred5_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(plaintext, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
            const len2 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_post_sealed(this.__wbg_ptr, ptr0, len0, timestamp_ms, ptr1, len1, ptr2, len2);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Post to a closed channel under its **current epoch key** (E2E sealed). The
     * body is `epoch(4) ‖ ChaCha20-Poly1305(group_key, plaintext)`, so a reader
     * selects the right epoch key and a removed member cannot read new epochs.
     * @param {string} channel
     * @param {number} timestamp_ms
     * @param {string} plaintext
     * @returns {string}
     */
    post_to(channel, timestamp_ms, plaintext) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(plaintext, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_post_to(this.__wbg_ptr, ptr0, len0, timestamp_ms, ptr1, len1);
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
     * This peer's 32-byte ed25519 public key — published so other peers can
     * authenticate its messages with [`ChatPeer::verify_message`].
     * @returns {Uint8Array}
     */
    public_key() {
        const ret = wasm.chatpeer_public_key(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * **Rekey a closed channel** (admin): mint a fresh random group key for the
     * next epoch, HPKE-seal it to each member's encryption key, and return a
     * **signed [`KeyEnvelope`]** as canonical bytes — content the admin publishes
     * over the relay (its κ is `kappa(bytes)`). Installs the key locally as the
     * channel's current epoch. Removing a member is rekeying to the smaller set:
     * no envelope entry for them, so they cannot derive the new epoch's key.
     * @param {string} channel
     * @param {Uint8Array[]} member_pubkeys
     * @returns {Uint8Array}
     */
    rekey(channel, member_pubkeys) {
        const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(member_pubkeys, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_rekey(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * **Seal a group key to a member with HPKE** (RFC 9180, base mode): the
     * standard hybrid encryption to the recipient's
     * [`encryption_key`](ChatPeer::encryption_key), so only that member can
     * open it. Output is `encapsulated_key(32) ‖ ciphertext`.
     * @param {Uint8Array} group_key
     * @param {Uint8Array} recipient_pub
     * @returns {Uint8Array}
     */
    seal_key_to(group_key, recipient_pub) {
        const ptr0 = passArray8ToWasm0(group_key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(recipient_pub, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_seal_key_to(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * The channel's transcript: every stored message for `channel`, linearised
     * by [`order`](holospaces::chat::order) into the single sequence every peer
     * computes identically. JSON `[{ author, body, ts, kappa }, …]`.
     * @param {string} channel
     * @returns {string}
     */
    transcript(channel) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_transcript(this.__wbg_ptr, ptr0, len0);
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
     * The closed channel's transcript, each message decrypted under the epoch
     * key it was sealed with. A message whose epoch key this peer lacks (e.g. an
     * epoch it was removed before) is reported `decryptable: false`. JSON
     * `[{ author, body, ts, kappa, epoch, decryptable }, …]`.
     * @param {string} channel
     * @returns {string}
     */
    transcript_of(channel) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_transcript_of(this.__wbg_ptr, ptr0, len0);
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
     * The channel transcript with bodies **decrypted** under `key`
     * (the [`transcript`](ChatPeer::transcript) counterpart for sealed channels).
     * A body that fails to decrypt (wrong key / tampered) is reported as
     * `decryptable: false` rather than crashing. JSON `[{ author, body, ts,
     * kappa, decryptable }, …]`.
     * @param {string} channel
     * @param {Uint8Array} key
     * @returns {string}
     */
    transcript_sealed(channel, key) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.chatpeer_transcript_sealed(this.__wbg_ptr, ptr0, len0, ptr1, len1);
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
     * Authenticate message bytes against an author's `public_key`: real ed25519
     * verification of the carried signature over the canonical signing bytes,
     * *and* that the key's κ matches the message's author (Law L1). A tampered
     * body, a forged signature, or the wrong key all return `false`.
     * @param {Uint8Array} bytes
     * @param {Uint8Array} public_key
     * @returns {boolean}
     */
    verify_message(bytes, public_key) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(public_key, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.chatpeer_verify_message(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
}
if (Symbol.dispose) ChatPeer.prototype[Symbol.dispose] = ChatPeer.prototype.free;

/**
 * The Platform Manager console, running as a browser peer that composes the
 * substrate runtime over the interpreter `ContainerEngine`.
 */
export class Console {
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
     * @param {number} memory_bytes
     * @returns {string}
     */
    provision_devcontainer(config_json, memory_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(config_json, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.console_provision_devcontainer(this.__wbg_ptr, ptr0, len0, memory_bytes);
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
     * Resolve a holospace (or any κ) from the local store, verifying it by
     * re-derivation (Law L5). Returns the bytes, or `undefined` if absent.
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
     * @param {string} repo
     * @param {string} reference
     * @param {string} config_path
     * @param {Uint8Array} config_json
     * @param {Uint8Array} userland_module
     * @param {number} memory_bytes
     * @returns {string}
     */
    run_devcontainer(repo, reference, config_path, config_json, userland_module, memory_bytes) {
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
            const ptr4 = passArray8ToWasm0(userland_module, wasm.__wbindgen_malloc);
            const len4 = WASM_VECTOR_LEN;
            const ret = wasm.console_run_devcontainer(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, memory_bytes);
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
 * **The `Linux` app** — a real RISC-V (RV64GC) Linux machine running in the
 * browser tab. It wraps the holospaces [emulator](holospaces::emulator) booted
 * by the [Boot Orchestrator](holospaces::machine): a real, unmodified RISC-V
 * kernel `Image` over the SBI firmware, rooting on a bootable `ext4` disk
 * (busybox + the interactive [`/init`](holospaces::machine::DEVCONTAINER_INIT))
 * over `virtio-blk`, with the SBI/HVC console wired through to a terminal.
 *
 * The familiar Linux boot UX is the kernel's own console log streaming into
 * xterm.js as it boots, ending at an interactive `holospace:/workspace#` shell.
 * The JS side drives it: pump [`run`](Self::run) (in a worker, so the tab stays
 * responsive), [`take_console`](Self::take_console) the new output into the
 * terminal each tick, and deliver keystrokes with [`feed`](Self::feed) — exactly
 * the [`boot_linux`](https://github.com/Hologram-Technologies/holospaces) example
 * loop, in the browser.
 */
export class LinuxVm {
    static __wrap(ptr) {
        const obj = Object.create(LinuxVm.prototype);
        obj.__wbg_ptr = ptr;
        LinuxVmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LinuxVmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_linuxvm_free(ptr, 0);
    }
    /**
     * Capture the current machine state into the store and return its κ — the
     * parent state of the next step (taken at a quiesced prompt), or the result
     * state to memoize. Page-deduplicated, so an unchanged page costs nothing.
     * @returns {string}
     */
    capture() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.linuxvm_capture(this.__wbg_ptr);
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
     * The guest's exit code once halted (`undefined` while still running; `-1`
     * for a processor trap).
     * @returns {number | undefined}
     */
    exit_code() {
        const ret = wasm.linuxvm_exit_code(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * Deliver terminal input (keystrokes / paste) to the guest's console — the
     * stdin side of the interactive shell.
     * @param {Uint8Array} bytes
     */
    feed(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.linuxvm_feed(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * A human-readable halt reason once halted (`undefined` while running).
     * @returns {string | undefined}
     */
    halt_reason() {
        const ret = wasm.linuxvm_halt_reason(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Whether the machine has halted (powered off or faulted).
     * @returns {boolean}
     */
    halted() {
        const ret = wasm.linuxvm_halted(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Instructions processed so far — drives a live **MIPS** readout in the UI
     * (`instret` / wall-time). `f64` carries the count losslessly well past any
     * realistic boot.
     * @returns {number}
     */
    instret() {
        const ret = wasm.linuxvm_instret(this.__wbg_ptr);
        return ret;
    }
    /**
     * Boot a real Linux machine. `kernel` is the **decompressed** RISC-V `Image`
     * (gunzip the shipped `linux-kernel.bin.gz`); `rootfs` is the bootable `ext4`
     * disk (the decompressed `linux-rootfs.ext4`). Returns a machine loaded and
     * ready to [`run`](Self::run) — the default 512 MiB devcontainer machine
     * ([`MachineSpec::devcontainer`]), rooting `/dev/vda` over the SBI console.
     * @param {Uint8Array} kernel
     * @param {Uint8Array} rootfs
     */
    constructor(kernel, rootfs) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rootfs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.linuxvm_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        LinuxVmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * **Warm-start** the machine from a snapshot `pack` — the booted shell in
     * O(1), skipping the assemble-and-boot entirely (the difference between a
     * multi-minute boot and an instant prompt). `pack` is the *decompressed*
     * snapshot the build-time generator produced (`linux-snapshot.bin.gz`): the
     * content-addressed, page-deduplicated state of the booted machine (RAM +
     * rootfs). [`unpack`](holospaces::snapshot::unpack) re-derives every page's κ
     * on load (Law L5), and the boot is deterministic, so this reconstructs the
     * exact machine a cold boot would have produced (Law L1). Seed the terminal
     * with the captured boot log via [`seed_console`](Self::seed_console).
     * @param {Uint8Array} pack
     * @returns {LinuxVm}
     */
    static restore(pack) {
        const ptr0 = passArray8ToWasm0(pack, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.linuxvm_restore(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return LinuxVm.__wrap(ret[0]);
    }
    /**
     * **Serve a memoized result in O(1):** restore the machine to `kappa` —
     * demand-paged, so it returns immediately and faults its working set in
     * lazily from the store (sub-frame), rather than materializing all RAM. The
     * console resets (a side-channel, not snapshotted); the worker replays the
     * command's memoized output to the terminal.
     * @param {string} kappa
     */
    restore_kappa(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.linuxvm_restore_kappa(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Step the machine up to `max_steps` instructions. Returns `true` while the
     * machine is still live (the step budget was exhausted — call again next
     * tick), `false` once the guest has halted (a clean poweroff or a fault);
     * after that, [`exit_code`](Self::exit_code)/[`halt_reason`](Self::halt_reason)
     * describe the end state and further calls are no-ops.
     * @param {number} max_steps
     * @returns {boolean}
     */
    run(max_steps) {
        const ret = wasm.linuxvm_run(this.__wbg_ptr, max_steps);
        return ret !== 0;
    }
    /**
     * Replay a captured console (the boot log) into the terminal after a warm
     * [`restore`](Self::restore), so the booted shell renders immediately rather
     * than as a blank screen. The console is a side-channel, not part of the
     * state κ, so seeding it does not change the machine.
     * @param {Uint8Array} bytes
     */
    seed_console(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.linuxvm_seed_console(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The memo key for a step: the content address of `(parent state κ, input
     * bytes)`. Identical state + identical input ⇒ identical key (Law L1).
     * @param {string} parent
     * @param {Uint8Array} input
     * @returns {string}
     */
    step_key(parent, input) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(parent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.linuxvm_step_key(this.__wbg_ptr, ptr0, len0, ptr1, len1);
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
     * The console bytes produced since the previous call — the incremental boot
     * log / shell output to write into the terminal (UTF-8 / ANSI as the guest
     * emits it).
     * @returns {Uint8Array}
     */
    take_console() {
        const ret = wasm.linuxvm_take_console(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) LinuxVm.prototype[Symbol.dispose] = LinuxVm.prototype.free;

/**
 * The Welcome + Commit a membership change produces, to publish over the relay.
 */
export class MlsChange {
    static __wrap(ptr) {
        const obj = Object.create(MlsChange.prototype);
        obj.__wbg_ptr = ptr;
        MlsChangeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MlsChangeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mlschange_free(ptr, 0);
    }
    /**
     * The Commit message — delivered to every existing member to advance the epoch.
     * @returns {Uint8Array}
     */
    get commit() {
        const ret = wasm.mlschange_commit(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The Welcome message (empty for a removal) — delivered to the new member.
     * @returns {Uint8Array}
     */
    get welcome() {
        const ret = wasm.mlschange_welcome(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) MlsChange.prototype[Symbol.dispose] = MlsChange.prototype.free;

/**
 * One member's view of one MLS channel: its identity (signature key + basic
 * credential), its crypto provider (key store), and — once created or joined —
 * its [`MlsGroup`].
 */
export class MlsChannel {
    static __wrap(ptr) {
        const obj = Object.create(MlsChannel.prototype);
        obj.__wbg_ptr = ptr;
        MlsChannelFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MlsChannelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mlschannel_free(ptr, 0);
    }
    /**
     * **Add a member** by their KeyPackage bytes (admin). Returns the Welcome
     * (for the new member) and the Commit (for existing members). The Commit is
     * merged locally, advancing the epoch.
     * @param {Uint8Array} key_package_bytes
     * @returns {MlsChange}
     */
    add_member(key_package_bytes) {
        const ptr0 = passArray8ToWasm0(key_package_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mlschannel_add_member(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MlsChange.__wrap(ret[0]);
    }
    /**
     * Found a new group (this peer becomes its admin / first member).
     */
    create_group() {
        const ret = wasm.mlschannel_create_group(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The current epoch (advances on every Commit).
     * @returns {number}
     */
    epoch() {
        const ret = wasm.mlschannel_epoch(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * Snapshot this channel's durable state (the MLS key store + group id +
     * identity) to bytes — what a peer persists to OPFS / the κ-store so the
     * group survives a reload. The bytes hold secret key material, so store them
     * encrypted at rest. Pair with [`restore`](MlsChannel::restore).
     * @returns {Uint8Array}
     */
    export_state() {
        const ret = wasm.mlschannel_export_state(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * **Join** a group from a Welcome message (the bytes the admin published).
     * @param {Uint8Array} welcome_bytes
     */
    join(welcome_bytes) {
        const ptr0 = passArray8ToWasm0(welcome_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mlschannel_join(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * This member's **KeyPackage** bytes — published so an admin can add them.
     * @returns {Uint8Array}
     */
    key_package() {
        const ret = wasm.mlschannel_key_package(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The current member count.
     * @returns {number}
     */
    members() {
        const ret = wasm.mlschannel_members(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * A member identity named `identity`, keyed deterministically from `seed`
     * (the same seed reproduces the same MLS identity on every device). No group
     * yet — call [`create_group`](MlsChannel::create_group) or
     * [`join`](MlsChannel::join). Persist/restore the group with
     * [`export_state`](MlsChannel::export_state) / [`restore`](MlsChannel::restore).
     * @param {Uint8Array} seed
     * @param {Uint8Array} identity
     */
    constructor(seed, identity) {
        const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(identity, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.mlschannel_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        MlsChannelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Process an inbound MLS message (an application message or a Commit). For an
     * application message, returns JSON `{ "kind": "app", "text": "…" }`; for a
     * Commit (membership change), merges it and returns `{ "kind": "commit",
     * "epoch": n, "active": bool }` (`active:false` means this peer was removed).
     * @param {Uint8Array} message_bytes
     * @returns {string}
     */
    receive(message_bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(message_bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.mlschannel_receive(this.__wbg_ptr, ptr0, len0);
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
     * **Remove a member** by their identity bytes (admin). Returns the Commit to
     * publish; existing members [`receive`](MlsChannel::receive) it and the
     * removed member can no longer decrypt subsequent messages (PCS).
     * @param {Uint8Array} identity
     * @returns {MlsChange}
     */
    remove_member(identity) {
        const ptr0 = passArray8ToWasm0(identity, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mlschannel_remove_member(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MlsChange.__wrap(ret[0]);
    }
    /**
     * Restore a channel from a `seed` and the bytes from
     * [`export_state`](MlsChannel::export_state): rebuilds the key store, the
     * deterministic signer, and loads the MLS group — picking the conversation
     * back up at its current epoch (forward secrecy preserved).
     * @param {Uint8Array} seed
     * @param {Uint8Array} state
     * @returns {MlsChannel}
     */
    static restore(seed, state) {
        const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.mlschannel_restore(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MlsChannel.__wrap(ret[0]);
    }
    /**
     * Encrypt and frame `plaintext` as an MLS application message (forward
     * secret) — the bytes to publish as the message body.
     * @param {string} plaintext
     * @returns {Uint8Array}
     */
    send(plaintext) {
        const ptr0 = passStringToWasm0(plaintext, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mlschannel_send(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
}
if (Symbol.dispose) MlsChannel.prototype[Symbol.dispose] = MlsChannel.prototype.free;

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
 * A **content-addressed object store** the browser holds in RAM (the substrate's
 * memory, Law L3) — the L1 tier above a persistent OPFS L2 that JavaScript mirrors
 * to by κ. JS fills it (hydrating objects from OPFS, or [`unpack`](Self::unpack)ing
 * a fetched pack), then hands it to [`Workspace::restore_in`]. Object-level, so a
 * peer fetches only the objects it lacks: `manifest_objects(κ) \ keys()` — the
 * content-addressed delta, never the whole state again. Every `put` re-derives the
 * κ from the bytes, so a forged object cannot enter under a κ it does not hash to
 * (Law L5).
 */
export class ObjectStore {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ObjectStoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_objectstore_free(ptr, 0);
    }
    /**
     * Fetch an object's bytes by κ.
     * @param {string} kappa
     * @returns {Uint8Array | undefined}
     */
    get(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.objectstore_get(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Whether the object is present (the "have" check for delta sync).
     * @param {string} kappa
     * @returns {boolean}
     */
    has(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.objectstore_has(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Every stored κ — what JS persists to OPFS / advertises as its "have" set.
     * @returns {any[]}
     */
    keys() {
        const ret = wasm.objectstore_keys(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The object κs a manifest references (console + pages). JS subtracts its
     * `keys()` to get the delta to fetch. The manifest object must be present first.
     * @param {string} manifest_kappa
     * @returns {any[]}
     */
    manifest_objects(manifest_kappa) {
        const ptr0 = passStringToWasm0(manifest_kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.objectstore_manifest_objects(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    constructor() {
        const ret = wasm.objectstore_new();
        this.__wbg_ptr = ret;
        ObjectStoreFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Store an object; return its κ (re-derived from the bytes — verify-on-receipt).
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    put(bytes) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.objectstore_put(this.__wbg_ptr, ptr0, len0);
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
     * Load a full bootstrap [`pack`](holospaces::snapshot::pack) (the cold-start
     * fast path: one request) into the store; return the manifest κ.
     * @param {Uint8Array} pack
     * @returns {string}
     */
    unpack(pack) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(pack, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.objectstore_unpack(this.__wbg_ptr, ptr0, len0);
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
}
if (Symbol.dispose) ObjectStore.prototype[Symbol.dispose] = ObjectStore.prototype.free;

/**
 * **Streaming VM** — a holospace booted by *demand-paged snapshot streaming*: the
 * machine starts with **no RAM resident** and faults pages in on first touch,
 * each fetched by κ over the page's own transport (HTTP static hosting, a peer)
 * and verified by re-derivation (Law L5). This is the mobile boot path — a
 * 512 MiB-nominal machine runs in the touched working set, and only that working
 * set ever crosses the wire.
 *
 * JavaScript drives the fault loop (no Worker or `Atomics` needed, so it runs on
 * iOS Safari): ingest the eager set (manifest + metadata + disk) → [`boot`](Self::boot)
 * → then `while (!vm.halted()) { const need = vm.run_slice(n); if (need)
 * vm.install(await fetch('/snap/'+need.replace(':','/'))); }`.
 */
export class StreamingVm {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StreamingVmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_streamingvm_free(ptr, 0);
    }
    /**
     * Build the demand-paged machine named by `manifest_kappa` (a `blake3:…`
     * label). The eager objects must already be [`ingest`](Self::ingest)ed; RAM
     * pages stream in afterwards. Resident RAM is zero immediately after this.
     * @param {string} manifest_kappa
     */
    boot(manifest_kappa) {
        const ptr0 = passStringToWasm0(manifest_kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.streamingvm_boot(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The guest's exit code once halted (`undefined` while running; `-1` for a trap).
     * @returns {number | undefined}
     */
    exit_code() {
        const ret = wasm.streamingvm_exit_code(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * Deliver terminal input to the guest's console.
     * @param {Uint8Array} bytes
     */
    feed(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.streamingvm_feed(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Total bytes fetched on demand so far — the bandwidth readout (only the
     * touched working set ever crosses the wire).
     * @returns {number}
     */
    fetched_bytes() {
        const ret = wasm.streamingvm_fetched_bytes(this.__wbg_ptr);
        return ret;
    }
    /**
     * A human-readable halt reason once halted.
     * @returns {string | undefined}
     */
    halt_reason() {
        const ret = wasm.streamingvm_halt_reason(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Whether the machine has halted (powered off or faulted).
     * @returns {boolean}
     */
    halted() {
        const ret = wasm.streamingvm_halted(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Ingest one content object into the local store before [`boot`](Self::boot)
     * — the eager set (manifest + metadata + disk + console). Returns its κ label.
     * `put` re-derives the κ from the bytes (Law L5), so an object is trusted only
     * because it hashes to the κ that named it.
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    ingest(bytes) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.streamingvm_ingest(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Install a fetched demand page: store it (re-deriving its κ — verify on
     * receipt) and make every RAM page with that content resident. Returns how
     * many pages were filled (`0` ⇒ the bytes matched no pending κ — a wrong or
     * corrupt fetch, refused).
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    install(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.streamingvm_install(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * A fresh peer with an empty local store and no machine yet.
     */
    constructor() {
        const ret = wasm.streamingvm_new();
        this.__wbg_ptr = ret;
        StreamingVmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Live RAM footprint in 4 KiB pages — the touched working set (the mobile-
     * memory readout). Stays far below the nominal RAM size.
     * @returns {number}
     */
    resident_pages() {
        const ret = wasm.streamingvm_resident_pages(this.__wbg_ptr);
        return ret;
    }
    /**
     * Run up to `max_steps` instructions. Returns the κ label of a page the guest
     * touched that is **not yet resident** — fetch it, [`install`](Self::install)
     * it, and call again. Returns `undefined` when there was no fault: either the
     * slice ran out (still live — call again) or the machine [`halted`](Self::halted).
     * @param {number} max_steps
     * @returns {string | undefined}
     */
    run_slice(max_steps) {
        const ret = wasm.streamingvm_run_slice(this.__wbg_ptr, max_steps);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The console bytes produced since the previous call (the incremental boot
     * log / shell output).
     * @returns {Uint8Array}
     */
    take_console() {
        const ret = wasm.streamingvm_take_console(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) StreamingVm.prototype[Symbol.dispose] = StreamingVm.prototype.free;

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
     * ([`MachineSpec`](holospaces::machine::MachineSpec)) generates the device
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
     * Capture the running machine as a content-addressed snapshot descending from
     * `parent` (empty = a root), writing its objects into the workspace store.
     * Unchanged pages dedup against what is already resident, so this stores only
     * the delta — and JS then persists/transmits only the new objects. Returns the
     * manifest κ.
     * @param {string} parent
     * @returns {string}
     */
    capture(parent) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(parent, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_capture(this.__wbg_ptr, ptr0, len0);
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
     * **Checkpoint** the current state into the editable history with a `label` and
     * `timestamp_ms` (the caller's wall clock — the machine has none). Captures the
     * state (deduped against the prior one) and records a [commit](holospaces::history)
     * descending from the current history head. Returns the commit κ. This is one row
     * in the History panel — "go back here later" with [`restore_commit`].
     * @param {string} label
     * @param {number} timestamp_ms
     * @returns {string}
     */
    checkpoint(label, timestamp_ms) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_checkpoint(this.__wbg_ptr, ptr0, len0, timestamp_ms);
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
     * Whether the machine has powered off.
     * @returns {boolean}
     */
    get halted() {
        const ret = wasm.workspace_halted(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The κ of the current machine state (the memo head), if established.
     * @returns {string | undefined}
     */
    head() {
        const ret = wasm.workspace_head(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The history log as JSON, newest first:
     * `[{ "commit": κ, "state": κ, "label": string, "timestamp": ms }, …]`. The data
     * the History panel renders.
     * @returns {string}
     */
    history_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.workspace_history_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
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
     * Reset the devcontainer to a prior state by its κ (restored from the store) — an
     * instant jump to any captured/memoized checkpoint, 9P workspace intact.
     * Revisiting a state is what lets a later [`run_memoized`] *serve* a step that was
     * run from there before.
     * @param {string} state_kappa
     */
    reset_to(state_kappa) {
        const ptr0 = passStringToWasm0(state_kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_reset_to(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * **Go back in time** to a commit by its κ: restore that checkpoint's machine
     * state (instant, 9P workspace intact) and set it as the history head — so a
     * later [`checkpoint`] forks a new branch from here, leaving the commits you
     * jumped back from immutable and still restorable.
     * @param {string} commit_kappa
     */
    restore_commit(commit_kappa) {
        const ptr0 = passStringToWasm0(commit_kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_restore_commit(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * **Warm-start** a devcontainer workspace from a precomputed snapshot `pack` —
     * the booted machine in O(1) instead of replaying the assemble-and-boot. `pack`
     * is the *decoded* (gunzipped) [`pack`](holospaces::snapshot::pack) the build-time
     * generator produced (`devcontainer-snapshot.bin.gz`): a Merkle manifest plus
     * every page of the booted machine — RAM, the virtio-blk rootfs, **and the
     * mounted virtio-9p workspace** (`CC-15`). [`unpack`](holospaces::snapshot::unpack)
     * loads the objects into the store (re-deriving each κ on receipt, Law L5) and
     * the whole machine is reconstructed, 9p mount intact — so the workbench's
     * FileSystemProvider and terminal work immediately, but the visitor never paid
     * the boot. The boot is deterministic, so its result is a content-addressed
     * constant (Law L1).
     * @param {Uint8Array} pack
     * @returns {Workspace}
     */
    static restore_devcontainer(pack) {
        const ptr0 = passArray8ToWasm0(pack, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_restore_devcontainer(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * **Warm-start a *networked* devcontainer** (`CC-16`): like
     * [`restore_devcontainer`](Self::restore_devcontainer), but re-dials the egress
     * the snapshot could not carry. A snapshot serializes the `virtio-net` device's
     * negotiated features + virtqueue registers, but its egress transport is a live
     * WebSocket handle no snapshot can hold — so after reconstructing the machine
     * this connects a fresh tunnel to the relay at `relay_url` and reattaches it to
     * the restored NIC (the guest never re-probes; its DHCP lease for the
     * deterministic `10.0.2.15` is in restored RAM). The result: a warm-started
     * devcontainer that reaches the internet in O(working set) — `git clone`, `pip`,
     * or a live Hyperliquid request — without ever replaying the boot. Requires a
     * snapshot captured from a [`boot_devcontainer_net`](Self::boot_devcontainer_net)
     * machine (one whose guest enumerated the NIC); a non-net snapshot has no device
     * to reattach to and this errors.
     * @param {Uint8Array} pack
     * @param {string} relay_url
     * @returns {Workspace}
     */
    static restore_devcontainer_net(pack, relay_url) {
        const ptr0 = passArray8ToWasm0(pack, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relay_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_restore_devcontainer_net(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Workspace.__wrap(ret[0]);
    }
    /**
     * **Warm-start from an [`ObjectStore`]** JS has populated by content-addressed
     * sync — hydrated from OPFS and topped up with only the objects it lacked
     * (`manifest_objects(κ) \ have`), each fetched by κ and verified. Consumes the
     * store, which becomes the workspace's own — so its objects persist for the next
     * snapshot/variant to dedup against. The whole devcontainer (RAM + virtio-blk
     * rootfs + mounted virtio-9p workspace) is reconstructed, 9P intact. This is the
     * content-addressed network path: a return visit or a sibling variant transfers
     * only the delta, never the whole state again.
     * @param {ObjectStore} store
     * @param {string} manifest_kappa
     * @returns {Workspace}
     */
    static restore_in(store, manifest_kappa) {
        _assertClass(store, ObjectStore);
        var ptr0 = store.__destroy_into_raw();
        const ptr1 = passStringToWasm0(manifest_kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_restore_in(ptr0, ptr1, len1);
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
     * Run a line through the **κ-memo** — Hologram's O(1) edge over devcontainer
     * shell steps. The step is keyed by `(current state κ, line)`: if that exact step
     * has run before, its result machine state is *served* by [`restore`] — no
     * re-execution, the full devcontainer (RAM + rootfs + 9P workspace) reconstructed
     * in one shot; otherwise the line runs once and its result is captured and
     * memoized so the next time is served. Cold cost scales with the command; a
     * served hit is flat — re-provisioning, undo/redo, and branching become instant.
     *
     * Returns JSON `{ "hit": bool, "state": "<κ>", "event": "<κ>" }`. `hit=true` means
     * the result came from the memo with zero recomputation.
     * @param {string} line
     * @returns {string}
     */
    run_memoized(line) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(line, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.workspace_run_memoized(this.__wbg_ptr, ptr0, len0);
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
     * Every κ in the workspace store — JS persists new ones to OPFS / advertises its
     * "have" set after a [`capture`](Self::capture).
     * @returns {any[]}
     */
    store_keys() {
        const ret = wasm.workspace_store_keys(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Fetch a stored object's bytes by κ (to write to OPFS or send to a peer).
     * @param {string} kappa
     * @returns {Uint8Array | undefined}
     */
    store_object(kappa) {
        const ptr0 = passStringToWasm0(kappa, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.workspace_store_object(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
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
 * @param {Uint8Array} invite_secret
 * @param {number} epoch
 * @returns {Uint8Array}
 */
export function channel_key(invite_secret, epoch) {
    const ptr0 = passArray8ToWasm0(invite_secret, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.channel_key(ptr0, len0, epoch);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Prove hologram's **full graph pipeline** runs in the tab: build a graph,
 * compile it to a content-addressed `.holo` archive, load an inference
 * session, and execute it on real data. This is the exact mechanism a
 * transformer runs through (just more ops + the weights as constants), so a
 * passing softmax here de-risks the whole model path.
 * @returns {string}
 */
export function hologram_graph_demo() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.hologram_graph_demo();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Run `runs` square f32 matmuls of dimension `dim` through hologram's CPU
 * backend and report throughput as JSON `{ "dim", "ms", "gflops" }`. Timed
 * with the JS clock (`std::time::Instant` is unavailable on wasm).
 * @param {number} dim
 * @param {number} runs
 * @returns {string}
 */
export function hologram_matmul_bench(dim, runs) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.hologram_matmul_bench(dim, runs);
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
 * Run a full two-member MLS exchange in-tab and report the result as JSON:
 * `{ ciphersuite, members, msg1, msg2, epoch }`. The two messages decrypting in
 * order is the forward-secret ratchet working; `members == 2` and a non-zero
 * epoch are the TreeKEM group state.
 * @returns {string}
 */
export function mls_selftest() {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.mls_selftest();
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
 * Decrypt a [`seal_bytes`] blob under the channel `key` (wrong key / tampered
 * ciphertext fails the Poly1305 tag).
 * @param {Uint8Array} key
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array}
 */
export function open_bytes(key, ciphertext) {
    const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.open_bytes(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Continue a mind: given the current token sequence (`ids_json`), greedily
 * generate `n_more` tokens. Returns `{ ids, text, ms }` — the new full
 * sequence and its decoded text. Deterministic, so any holder of the same
 * sequence continues into the identical thought.
 * @param {string} ids_json
 * @param {number} n_more
 * @param {number} temp
 * @param {number} seed
 * @param {number} cap_hint
 * @returns {string}
 */
export function qvac_continue(ids_json, n_more, temp, seed, cap_hint) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.qvac_continue(ptr0, len0, n_more, temp, seed, cap_hint);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Generate tokens from a tiny transformer **entirely in the browser**, through
 * hologram — the whole LM (embedding, multi-head RoPE attention, SwiGLU MLP,
 * LM head, token loop) runs in wasm. Returns JSON `{ tokens, ms }`.
 * @param {number} max_new
 * @param {number} temp
 * @param {number} seed
 * @returns {string}
 */
export function qvac_generate(max_new, temp, seed) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.qvac_generate(max_new, temp, seed);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Generate from a **real GGUF model** entirely in the browser, through hologram.
 * `gguf` is the fetched model file's bytes. Loads it, generates `max_new` tokens
 * greedily/sampled from `<s>`, detokenizes via the embedded vocab, and returns
 * JSON `{ text, tokens, ms, arch }`.
 * @param {Uint8Array} gguf
 * @param {number} max_new
 * @param {number} temp
 * @param {number} seed
 * @returns {string}
 */
export function qvac_generate_gguf(gguf, max_new, temp, seed) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(gguf, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.qvac_generate_gguf(ptr0, len0, max_new, temp, seed);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Export the loaded model for the WebGPU engine — **per-block int8** (a scale per
 * 32 weights, the GGUF's native precision) in `[out,in]` layout. Consumes the
 * retained GGUF (freeing ~its bytes). Blob: `[u32 manifest_len][JSON][q+scales]`.
 * @param {number} bits
 * @returns {Uint8Array}
 */
export function qvac_gpu_export(bits) {
    const ret = wasm.qvac_gpu_export(bits);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Free the retained GGUF once all tensors have been streamed to the GPU.
 */
export function qvac_gpu_free() {
    wasm.qvac_gpu_free();
}

/**
 * **Streaming GPU export** — the manifest only (dims + tensor list). JS then
 * pulls each tensor with [`qvac_gpu_tensor`] and uploads it, so the converted
 * weights never coexist with the GGUF (the memory wall that blocks 1.7B+).
 * @param {number} bits
 * @returns {string}
 */
export function qvac_gpu_manifest(bits) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.qvac_gpu_manifest(bits);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * One tensor's GPU bytes (`[q][f32 scales]` or `[f32]`) — quantized on demand
 * from the retained GGUF. Peak = GGUF + this one tensor.
 * @param {string} name
 * @param {number} bits
 * @returns {Uint8Array}
 */
export function qvac_gpu_tensor(name, bits) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.qvac_gpu_tensor(ptr0, len0, bits);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Load a GGUF model **for the GPU engine only** — parses metadata + tokenizer
 * vocab/scores and retains the GGUF for [`qvac_gpu_export`], but does NOT build
 * the CPU [`OwnedModel`]. That f32→int8 round-trip (≈ the whole model materialised
 * twice) is what OOMs the tab on a 1.1B; skipping it is the difference between a
 * 1.1B loading or crashing. Takes `Vec<u8>` (moved, not copied — one fewer ~640 MB
 * copy than `&[u8].to_vec()`). Returns `{ ok, arch, vocab, bos, eos, add_bos }`.
 * @param {Uint8Array} gguf
 * @returns {string}
 */
export function qvac_load_gpu(gguf) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(gguf, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.qvac_load_gpu(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Load a GGUF model into the page (once). Returns `{ ok, arch, vocab }`.
 * @param {Uint8Array} gguf
 * @returns {string}
 */
export function qvac_load_model(gguf) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(gguf, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.qvac_load_model(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Route Rust panics to `console.error` (release wasm otherwise traps silently).
 */
export function qvac_panic_hook() {
    wasm.qvac_panic_hook();
}

/**
 * Tokenize text with the model's SentencePiece vocab + scores using llama.cpp's
 * **greedy score-merge** algorithm (not unigram Viterbi — Llama's SPM merges the
 * highest-scoring adjacent pair repeatedly), so a typed prompt becomes the *same*
 * tokens the model trained on. Prepends `<s>`; unknown chars fall back to bytes.
 * @param {string} text
 * @returns {string}
 */
export function qvac_tokenize(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.qvac_tokenize(ptr0, len0);
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
 * Derive a channel's symmetric E2E key from its **invite secret** and an
 * `epoch` (HKDF-SHA256) — the simple "possession of the invite = membership"
 * model (à la Keet room keys). Everyone holding the invite derives the same
 * 32-byte key and can seal/open message bodies; the relay, holding only the
 * channel κ, cannot. For closed-membership rotation that excludes a removed
 * member, use the closed-channel [`ChatPeer::rekey`] path (HPKE per member) instead.
 * Encrypt arbitrary bytes (a file) under a 32-byte channel `key` —
 * ChaCha20-Poly1305 with a random nonce (the same AEAD as message bodies). The
 * ciphertext is content: store it with `ChatPeer.ingest` (→ its κ) and ship it
 * over the relay like any object; the relay never sees the plaintext file.
 * @param {Uint8Array} key
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function seal_bytes(key, plaintext) {
    const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.seal_bytes(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
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
        __wbg___wbindgen_is_function_754e9f305ff6029e: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_56732c2bc353f41d: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_c236cabd84a4d769: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_67b456be8673d3d7: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_61db23ac97f16c31: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_call_9c758de292015997: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_data_bd354b70c783c66e: function(arg0) {
            const ret = arg0.data;
            return ret;
        },
        __wbg_error_db4567eeb936c56c: function(arg0, arg1) {
            console.error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_4a591ecaa01354d9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_578aeef4b6b94378: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_d7e476b433a26bea: function() { return handleError(function (arg0, arg1) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_with_length_36a4998e27b014c5: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_190933fa139cc119: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_3249fc62a0fafa30: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_send_4a773f523104d75e: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.send(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_set_binaryType_41994c453b95bdd2: function(arg0, arg1) {
            arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
        },
        __wbg_set_onclose_13787fb31ae8aefd: function(arg0, arg1) {
            arg0.onclose = arg1;
        },
        __wbg_set_onmessage_9c6b4cb14e244b7f: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onopen_db452f4233e99d7d: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_static_accessor_GLOBAL_9d53f2689e622ca1: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_a1a35cec07001a8a: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_4c59f6c7ea29a144: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_e70ae9f2eb052253: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_4aa221f6a4f5ab22: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 223, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h9120712498c08fc8);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 223, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h9120712498c08fc8_1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
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

function wasm_bindgen__convert__closures_____invoke__h9120712498c08fc8(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h9120712498c08fc8(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h9120712498c08fc8_1(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h9120712498c08fc8_1(arg0, arg1, arg2);
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];
const ChatPeerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_chatpeer_free(ptr, 1));
const ConsoleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_console_free(ptr, 1));
const DevcontainerImageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_devcontainerimage_free(ptr, 1));
const LinuxVmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_linuxvm_free(ptr, 1));
const MlsChangeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mlschange_free(ptr, 1));
const MlsChannelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mlschannel_free(ptr, 1));
const ObjectStoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_objectstore_free(ptr, 1));
const StreamingVmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_streamingvm_free(ptr, 1));
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

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
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
