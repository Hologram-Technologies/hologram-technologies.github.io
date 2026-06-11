#!/usr/bin/env bash
# Regenerate the deterministic DIAG rootfs.ext4 + confirm the NATIVE arm64 baseline
# (DIAG-UNAME:aarch64 + clean halt) with the current engine. Run via WSL.
set -e
. "$HOME/.cargo/env" 2>/dev/null || true
export CARGO_TARGET_DIR=$HOME/htarget
cd /mnt/c/Users/pavel/Desktop/hologram-os/holospaces
echo "=== building debian_arm64_diff (native) ==="
cargo build -p holospaces --example debian_arm64_diff --release 2>&1 | tail -3
BIN=$HOME/htarget/release/examples/debian_arm64_diff
cd ~/diff
echo "=== native baseline (diag mode → regenerates rootfs.ext4) ==="
timeout 180 "$BIN" Image layer.tar.gz rootfs.ext4 diag 2>&1 | grep -aE "DIAG-|harness|HANG|halted" | head -20
