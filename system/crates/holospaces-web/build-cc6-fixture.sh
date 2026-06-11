#!/usr/bin/env bash
# build-cc6-fixture.sh — build the CC-6 mailbox-ABI conformance guest to wasm32
# and stage it as web/cc6-fixture.wasm.
#
# This is the **executable spec** of the container ABI `UserlandWorkspace`
# (src/lib.rs) drives: a tiny, zero-import CC-6 Wasm guest that boots through the
# whole pipeline (boot → run slices → live console → input echo → κ-snapshot
# suspend/resume) so it can be tested end-to-end in any browser today — before the
# real `qemu-system-x86_64` C port exists. It is NOT QEMU; QEMU is the full C port
# that satisfies this same ABI (web/QEMU-HOLOSPACE.md).
#
# Needs: rustup + the wasm32-unknown-unknown target (`rustup target add
# wasm32-unknown-unknown`). On the Windows dev box use the GNU toolchain
# (RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu) — see the build-loop memo.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"            # crates/holospaces-web
CRATE="$HERE/cc6-fixture"
OUT="$HERE/../../os/cc6-fixture.wasm"

echo "== building the CC-6 ABI conformance guest (wasm32) =="
cargo build --manifest-path "$CRATE/Cargo.toml" --target wasm32-unknown-unknown --release
cp "$CRATE/target/wasm32-unknown-unknown/release/cc6_fixture.wasm" "$OUT"
echo "   staged: $OUT ($(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT") bytes)"
echo "   open  qemu.html?module=./cc6-fixture.wasm  to boot it through UserlandWorkspace"
echo "   witness: node userland-witness.mjs"
