#!/usr/bin/env bash
# Build the repro for native + wasm32-wasi, run BOTH on the same disk, and diff the
# traces — the first differing record is the instruction the wasm32 backend
# mis-compiles (the NEON/codegen frontier). Run via WSL.
set -e
. "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.wasmtime/bin:$PATH"
REPRO=/mnt/c/Users/pavel/Desktop/hologram-os/crates/arm64-repro
cd "$REPRO"
export CARGO_TARGET_DIR=$HOME/rtarget

echo "=== build native ==="
cargo build --release 2>&1 | tail -2
echo "=== build wasm32-wasip1 ==="
cargo build --release --target wasm32-wasip1 2>&1 | tail -2

cd ~/diff
echo "=== NATIVE run → native.trace ==="
timeout 240 "$HOME/rtarget/release/arm64-repro" Image rootfs.ext4 native.trace 12 2>&1 | grep -aE "DIAG-|repro|UNAME" | head -12

echo "=== WASM (wasmtime) run → wasm.trace ==="
WASM=$HOME/rtarget/wasm32-wasip1/release/arm64-repro.wasm
timeout 900 wasmtime run --dir "$HOME/diff::/d" "$WASM" /d/Image /d/rootfs.ext4 /d/wasm.trace 12 2>&1 | grep -aE "DIAG-|repro|UNAME" | head -12

echo "=== sizes ==="
ls -l ~/diff/native.trace ~/diff/wasm.trace
echo "=== DIFF ==="
python3 "$REPRO/diff-trace.py" ~/diff/native.trace ~/diff/wasm.trace
