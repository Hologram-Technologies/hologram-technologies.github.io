#!/usr/bin/env bash
# build-x86-core.sh — build the minimal x86 CPU core (a CC-6 guest) to wasm32 and
# generate the boot-sector disk it runs. Together they prove REAL x86 machine code
# executing through the UserlandWorkspace pipeline:
#     qemu.html?module=./x86-core.wasm&disk=./x86boot.img.gz
# NOT QEMU — QEMU is the full-system C port that satisfies this same ABI.
#
# Needs rustup + the wasm32-unknown-unknown target + node. On the Windows dev box
# use the GNU toolchain (RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"   # crates/holospaces-web
CRATE="$HERE/x86-core"

echo "== building the minimal x86 core (wasm32) =="
cargo build --manifest-path "$CRATE/Cargo.toml" --target wasm32-unknown-unknown --release
cp "$CRATE/target/wasm32-unknown-unknown/release/x86_core.wasm" "$HERE/../../os/x86-core.wasm"
echo "   staged: os/x86-core.wasm"

echo "== generating the boot-sector disk =="
( cd "$HERE/../../os" && node make-x86boot.mjs )

echo "== DONE =="
echo "   open  qemu.html?module=./x86-core.wasm&disk=./x86boot.img.gz"
