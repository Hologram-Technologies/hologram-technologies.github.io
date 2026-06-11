/* @ts-self-types="./prism_btc_wasm.d.ts" */

/**
 * JavaScript-visible block address — the result of addressing a mined
 * block header.
 *
 * The nonce is not exposed — it is an internal wire-format detail.
 * Callers receive the 32-byte block hash (the `sha256d` content address)
 * plus its triadic coordinates (stratum, spectrum).
 */
export class JsBlockAddress {
    static __wrap(ptr) {
        const obj = Object.create(JsBlockAddress.prototype);
        obj.__wbg_ptr = ptr;
        JsBlockAddressFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsBlockAddressFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsblockaddress_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get spectrum() {
        const ret = wasm.__wbg_get_jsblockaddress_spectrum(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get stratum() {
        const ret = wasm.__wbg_get_jsblockaddress_stratum(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The 32-byte block hash as a Uint8Array.
     * @returns {Uint8Array}
     */
    hash() {
        const ret = wasm.jsblockaddress_hash(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} arg0
     */
    set spectrum(arg0) {
        wasm.__wbg_set_jsblockaddress_spectrum(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set stratum(arg0) {
        wasm.__wbg_set_jsblockaddress_stratum(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) JsBlockAddress.prototype[Symbol.dispose] = JsBlockAddress.prototype.free;

/**
 * JavaScript-visible block header input.
 *
 * `wasm-bindgen` requires `pub` struct fields to be `Copy`. `Vec<u8>` is not Copy,
 * so we use private fields with explicit getter methods for the byte arrays.
 */
export class JsBlockHeader {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsBlockHeaderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsblockheader_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get bits() {
        const ret = wasm.__wbg_get_jsblockheader_bits(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get timestamp() {
        const ret = wasm.__wbg_get_jsblockheader_timestamp(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get version() {
        const ret = wasm.__wbg_get_jsblockheader_version(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint8Array}
     */
    get merkle_root() {
        const ret = wasm.jsblockheader_merkle_root(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} version
     * @param {Uint8Array} prev_hash
     * @param {Uint8Array} merkle_root
     * @param {number} timestamp
     * @param {number} bits
     */
    constructor(version, prev_hash, merkle_root, timestamp, bits) {
        const ptr0 = passArray8ToWasm0(prev_hash, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(merkle_root, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.jsblockheader_new(version, ptr0, len0, ptr1, len1, timestamp, bits);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        JsBlockHeaderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint8Array}
     */
    get prev_hash() {
        const ret = wasm.jsblockheader_prev_hash(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} arg0
     */
    set bits(arg0) {
        wasm.__wbg_set_jsblockheader_bits(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set timestamp(arg0) {
        wasm.__wbg_set_jsblockheader_timestamp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set version(arg0) {
        wasm.__wbg_set_jsblockheader_version(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) JsBlockHeader.prototype[Symbol.dispose] = JsBlockHeader.prototype.free;

/**
 * Result of a **bounded** nonce sweep — the unit of work a host (the
 * holospace worker) drives slice-by-slice so the UI stays responsive
 * and a winning candidate is *submittable*.
 *
 * Unlike [`JsBlockAddress`], this surfaces the winning `nonce` — the
 * load-bearing field a host needs to splice into the wire-format header
 * and hand to `submitblock`. When the slice exhausts without admission,
 * `found` is `false` and the fields describe the **best** (closest to
 * the target) candidate the slice observed — the receiver-side typed
 * lens at slice granularity (`best_zero_bits` / `stratum` / `spectrum`).
 */
export class JsMineResult {
    static __wrap(ptr) {
        const obj = Object.create(JsMineResult.prototype);
        obj.__wbg_ptr = ptr;
        JsMineResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsMineResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsmineresult_free(ptr, 0);
    }
    /**
     * How many candidates this slice actually evaluated.
     * @returns {number}
     */
    get attempts() {
        const ret = wasm.__wbg_get_jsmineresult_attempts(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Leading zero **bits** of the reported digest (big-endian display
     * order) — the difficulty actually reached. A monotone progress /
     * "closest approach" observable across slices.
     * @returns {number}
     */
    get best_zero_bits() {
        const ret = wasm.__wbg_get_jsmineresult_best_zero_bits(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `true` iff a candidate in the slice satisfied `digest ≤ target`.
     * @returns {boolean}
     */
    get found() {
        const ret = wasm.__wbg_get_jsmineresult_found(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The winning nonce (when `found`), else the best candidate's nonce.
     * @returns {number}
     */
    get nonce() {
        const ret = wasm.__wbg_get_jsmineresult_nonce(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Triadic `spectrum` coordinate of the reported digest (UOR lens).
     * @returns {number}
     */
    get spectrum() {
        const ret = wasm.__wbg_get_jsmineresult_spectrum(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Triadic `stratum` coordinate of the reported digest (UOR lens).
     * @returns {number}
     */
    get stratum() {
        const ret = wasm.__wbg_get_jsmineresult_stratum(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The reported 32-byte digest (display order) as a `Uint8Array` —
     * the winning block hash when `found`, else the best digest seen.
     * @returns {Uint8Array}
     */
    hash() {
        const ret = wasm.jsmineresult_hash(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The reported digest as a lowercase hex string (display order) —
     * i.e. the conventional Bitcoin block-hash rendering. The κ-label is
     * `"sha256d:" + hash_hex()`.
     * @returns {string}
     */
    hash_hex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsmineresult_hash_hex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * How many candidates this slice actually evaluated.
     * @param {number} arg0
     */
    set attempts(arg0) {
        wasm.__wbg_set_jsmineresult_attempts(this.__wbg_ptr, arg0);
    }
    /**
     * Leading zero **bits** of the reported digest (big-endian display
     * order) — the difficulty actually reached. A monotone progress /
     * "closest approach" observable across slices.
     * @param {number} arg0
     */
    set best_zero_bits(arg0) {
        wasm.__wbg_set_jsmineresult_best_zero_bits(this.__wbg_ptr, arg0);
    }
    /**
     * `true` iff a candidate in the slice satisfied `digest ≤ target`.
     * @param {boolean} arg0
     */
    set found(arg0) {
        wasm.__wbg_set_jsmineresult_found(this.__wbg_ptr, arg0);
    }
    /**
     * The winning nonce (when `found`), else the best candidate's nonce.
     * @param {number} arg0
     */
    set nonce(arg0) {
        wasm.__wbg_set_jsmineresult_nonce(this.__wbg_ptr, arg0);
    }
    /**
     * Triadic `spectrum` coordinate of the reported digest (UOR lens).
     * @param {number} arg0
     */
    set spectrum(arg0) {
        wasm.__wbg_set_jsmineresult_spectrum(this.__wbg_ptr, arg0);
    }
    /**
     * Triadic `stratum` coordinate of the reported digest (UOR lens).
     * @param {number} arg0
     */
    set stratum(arg0) {
        wasm.__wbg_set_jsmineresult_stratum(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) JsMineResult.prototype[Symbol.dispose] = JsMineResult.prototype.free;

/**
 * Mine a block header from JavaScript — the **wasm protocol layer**'s
 * PoW search over the kernel's κ-derivation primitive.
 *
 * The kernel (`prism_btc::address_block`) emits κ-labels for canonical
 * block headers; admission is a host-side observation. This bridge
 * walks the 32-bit nonce space, derives each candidate's κ, compares
 * the digest to the target, and returns the receiver-side coordinates
 * of the first candidate that admits.
 *
 * Returns a `JsBlockAddress` on success, or throws a JS error string
 * when the nonce space exhausts without admission (vary the template
 * — timestamp / extranonce — and retry).
 *
 * # Arguments
 * * `js_header` — block header fields (version, prev_hash, merkle_root, timestamp, bits)
 * * `nbits`     — compact target encoding (e.g. `0x1d00ffff` for genesis)
 * @param {JsBlockHeader} js_header
 * @param {number} nbits
 * @returns {JsBlockAddress}
 */
export function mine_block(js_header, nbits) {
    _assertClass(js_header, JsBlockHeader);
    const ret = wasm.mine_block(js_header.__wbg_ptr, nbits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return JsBlockAddress.__wrap(ret[0]);
}

/**
 * Mine a **bounded** slice of the nonce space — the holospace worker's
 * unit of work.
 *
 * This is the sliceable counterpart to [`mine_block`]: it evaluates
 * nonces `[start_nonce, start_nonce + count)` (clamped at `u32::MAX`),
 * derives each candidate's `sha256d` digest — the kernel's L5 σ-axis
 * re-derivation, the exact bytes `prism_btc::address_block` folds the
 * carrier through — and compares it to the target. The first admitting
 * nonce is returned with `found = true`; the winning 80-byte wire header
 * is then passed once through the kernel (`address_block`) so the
 * returned address is substrate-sealed (Law L4). If the slice exhausts
 * without admission, `found = false` and the result describes the
 * **best** (most leading-zero-bits) candidate observed — so the host can
 * surface live "closest approach" progress between slices.
 *
 * Returning the winning `nonce` (which [`mine_block`] deliberately
 * hides) is what makes the in-browser miner *submittable*: the host
 * splices it into the wire header and hands the block to `submitblock`.
 *
 * # Arguments
 * * `js_header`   — block-header fields (version, prev_hash, merkle_root, timestamp, bits)
 * * `nbits`       — compact target encoding (e.g. `0x1d00ffff`)
 * * `start_nonce` — first nonce of the slice
 * * `count`       — number of nonces to evaluate this slice (`0` ⇒ to `u32::MAX`)
 * @param {JsBlockHeader} js_header
 * @param {number} nbits
 * @param {number} start_nonce
 * @param {number} count
 * @returns {JsMineResult}
 */
export function mine_range(js_header, nbits, start_nonce, count) {
    _assertClass(js_header, JsBlockHeader);
    const ret = wasm.mine_range(js_header.__wbg_ptr, nbits, start_nonce, count);
    return JsMineResult.__wrap(ret);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
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
        "./prism_btc_wasm_bg.js": import0,
    };
}

const JsBlockAddressFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsblockaddress_free(ptr, 1));
const JsBlockHeaderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsblockheader_free(ptr, 1));
const JsMineResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsmineresult_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
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

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
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

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
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
        module_or_path = new URL('prism_btc_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
