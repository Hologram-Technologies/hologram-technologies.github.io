/* tslint:disable */
/* eslint-disable */

/**
 * JavaScript-visible block address — the result of addressing a mined
 * block header.
 *
 * The nonce is not exposed — it is an internal wire-format detail.
 * Callers receive the 32-byte block hash (the `sha256d` content address)
 * plus its triadic coordinates (stratum, spectrum).
 */
export class JsBlockAddress {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The 32-byte block hash as a Uint8Array.
     */
    hash(): Uint8Array;
    spectrum: number;
    stratum: number;
}

/**
 * JavaScript-visible block header input.
 *
 * `wasm-bindgen` requires `pub` struct fields to be `Copy`. `Vec<u8>` is not Copy,
 * so we use private fields with explicit getter methods for the byte arrays.
 */
export class JsBlockHeader {
    free(): void;
    [Symbol.dispose](): void;
    constructor(version: number, prev_hash: Uint8Array, merkle_root: Uint8Array, timestamp: number, bits: number);
    bits: number;
    timestamp: number;
    version: number;
    readonly merkle_root: Uint8Array;
    readonly prev_hash: Uint8Array;
}

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
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The reported 32-byte digest (display order) as a `Uint8Array` —
     * the winning block hash when `found`, else the best digest seen.
     */
    hash(): Uint8Array;
    /**
     * The reported digest as a lowercase hex string (display order) —
     * i.e. the conventional Bitcoin block-hash rendering. The κ-label is
     * `"sha256d:" + hash_hex()`.
     */
    hash_hex(): string;
    /**
     * How many candidates this slice actually evaluated.
     */
    attempts: number;
    /**
     * Leading zero **bits** of the reported digest (big-endian display
     * order) — the difficulty actually reached. A monotone progress /
     * "closest approach" observable across slices.
     */
    best_zero_bits: number;
    /**
     * `true` iff a candidate in the slice satisfied `digest ≤ target`.
     */
    found: boolean;
    /**
     * The winning nonce (when `found`), else the best candidate's nonce.
     */
    nonce: number;
    /**
     * Triadic `spectrum` coordinate of the reported digest (UOR lens).
     */
    spectrum: number;
    /**
     * Triadic `stratum` coordinate of the reported digest (UOR lens).
     */
    stratum: number;
}

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
 */
export function mine_block(js_header: JsBlockHeader, nbits: number): JsBlockAddress;

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
 */
export function mine_range(js_header: JsBlockHeader, nbits: number, start_nonce: number, count: number): JsMineResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_jsblockaddress_spectrum: (a: number) => number;
    readonly __wbg_get_jsblockaddress_stratum: (a: number) => number;
    readonly __wbg_get_jsblockheader_bits: (a: number) => number;
    readonly __wbg_get_jsblockheader_timestamp: (a: number) => number;
    readonly __wbg_get_jsblockheader_version: (a: number) => number;
    readonly __wbg_get_jsmineresult_attempts: (a: number) => number;
    readonly __wbg_get_jsmineresult_best_zero_bits: (a: number) => number;
    readonly __wbg_get_jsmineresult_found: (a: number) => number;
    readonly __wbg_get_jsmineresult_nonce: (a: number) => number;
    readonly __wbg_get_jsmineresult_spectrum: (a: number) => number;
    readonly __wbg_get_jsmineresult_stratum: (a: number) => number;
    readonly __wbg_jsblockaddress_free: (a: number, b: number) => void;
    readonly __wbg_jsblockheader_free: (a: number, b: number) => void;
    readonly __wbg_jsmineresult_free: (a: number, b: number) => void;
    readonly __wbg_set_jsblockaddress_spectrum: (a: number, b: number) => void;
    readonly __wbg_set_jsblockaddress_stratum: (a: number, b: number) => void;
    readonly __wbg_set_jsblockheader_bits: (a: number, b: number) => void;
    readonly __wbg_set_jsblockheader_timestamp: (a: number, b: number) => void;
    readonly __wbg_set_jsblockheader_version: (a: number, b: number) => void;
    readonly __wbg_set_jsmineresult_attempts: (a: number, b: number) => void;
    readonly __wbg_set_jsmineresult_best_zero_bits: (a: number, b: number) => void;
    readonly __wbg_set_jsmineresult_found: (a: number, b: number) => void;
    readonly __wbg_set_jsmineresult_nonce: (a: number, b: number) => void;
    readonly __wbg_set_jsmineresult_spectrum: (a: number, b: number) => void;
    readonly __wbg_set_jsmineresult_stratum: (a: number, b: number) => void;
    readonly jsblockaddress_hash: (a: number) => [number, number];
    readonly jsblockheader_merkle_root: (a: number) => [number, number];
    readonly jsblockheader_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly jsblockheader_prev_hash: (a: number) => [number, number];
    readonly jsmineresult_hash: (a: number) => [number, number];
    readonly jsmineresult_hash_hex: (a: number) => [number, number];
    readonly mine_block: (a: number, b: number) => [number, number, number];
    readonly mine_range: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
