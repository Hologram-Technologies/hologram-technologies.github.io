//! wasm32-vs-native differential repro for the AArch64 **NEON/codegen frontier**.
//!
//! Boots the SAME Debian arm64 disk on the AArch64 core. Once the failing exec
//! (`/usr/bin/uname`, the dynamic-glibc path that hangs in-browser) begins, it
//! single-steps and logs `(pc, x_digest, v_digest)` per instruction to a trace
//! file. Build + run this BOTH natively and as wasm32-wasi (wasmtime): the first
//! trace record that differs pinpoints the instruction whose emulation the wasm32
//! backend mis-compiles. If wasmtime reproduces the hang, the bug is in the LLVM
//! wasm bytecode (not V8).
//!
//! Usage: arm64-repro <kernel-raw> <rootfs.ext4> <out.trace> [cap_million]
use holospaces::emulator::aarch64::{Cpu, Halt};
use std::io::{BufReader, Read, Write};

const RAM_BYTES: usize = 512 * 1024 * 1024;
const BOOTARGS: &str = "console=ttyAMA0 root=/dev/vda rw init=/init nokaslr norandmaps";

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 4 {
        eprintln!("usage: {} <kernel-raw> <rootfs.ext4> <out.trace> [cap_million]", a[0]);
        std::process::exit(2);
    }
    let kernel = std::fs::read(&a[1]).expect("kernel image (raw)");
    // Stream the rootfs sector-by-sector (a sequential BufReader) into an in-memory
    // κ-store — `from_sectors` reads 0..sector_count IN ORDER, so this never holds the
    // whole 325 MiB image in one Vec (which wasm32-wasi's allocator refuses).
    let rootfs_len = std::fs::metadata(&a[2]).expect("rootfs.ext4 (DIAG init)").len();
    let sector_count = rootfs_len / 512;
    let mut reader = BufReader::new(std::fs::File::open(&a[2]).expect("open rootfs"));
    let read = move |_i: u64, buf: &mut [u8]| {
        let _ = reader.read_exact(buf); // short read at EOF leaves the tail zero (sparse)
    };
    let cap: u64 = a.get(4).and_then(|s| s.parse().ok()).unwrap_or(12) * 1_000_000;
    eprintln!(
        "[repro] booting: kernel {} B, rootfs {} B ({} sectors), trace cap {} steps",
        kernel.len(),
        rootfs_len,
        sector_count,
        cap
    );

    let store = Box::new(hologram_store_mem::MemKappaStore::new());
    let mut cpu = Cpu::boot_linux_disk_streamed(RAM_BYTES, &kernel, BOOTARGS, store, sector_count, read);

    // ── Phase 1: run in chunks until the failing exec begins ("DIAG-UNAME:"). ──
    let mut last = 0usize;
    let mut total: u64 = 0;
    loop {
        let halted = !matches!(cpu.run(1_000_000), Halt::OutOfBudget);
        total += 1_000_000;
        let con = cpu.console();
        if con.len() > last {
            print!("{}", String::from_utf8_lossy(&con[last..]));
            std::io::stdout().flush().ok();
            last = con.len();
            if String::from_utf8_lossy(con).contains("DIAG-UNAME:") {
                break;
            }
        }
        if halted {
            eprintln!("\n[repro] halted before the exec — no repro");
            return;
        }
        if total > 4_000_000_000 {
            eprintln!("\n[repro] never reached DIAG-UNAME (boot diverged?)");
            return;
        }
    }

    // ── Phase 2: single-step + trace the exec until halt, hang, or the cap. ────
    eprintln!("\n[repro] DIAG-UNAME: at {total} insns — tracing the exec…");
    let mut tf = std::io::BufWriter::new(std::fs::File::create(&a[3]).expect("trace file"));
    let mut steps: u64 = 0;
    let mut last_con = cpu.console().len();
    let mut stall: u64 = 0;
    let mut outcome = "CAP";
    while steps < cap {
        // Record the architectural state BEFORE the step (so the first record that
        // differs ⇒ the *previous* instruction's emulation diverged).
        let mut rec = [0u8; 24];
        rec[0..8].copy_from_slice(&cpu.pc().to_le_bytes());
        rec[8..16].copy_from_slice(&cpu.x_digest().to_le_bytes());
        rec[16..24].copy_from_slice(&cpu.v_digest().to_le_bytes());
        tf.write_all(&rec).unwrap();

        if !matches!(cpu.run(1), Halt::OutOfBudget) {
            outcome = "HALTED";
            break;
        }
        steps += 1;
        let cl = cpu.console().len();
        if cl > last_con {
            last_con = cl;
            stall = 0;
        } else {
            stall += 1;
        }
        if stall > 30_000_000 {
            outcome = "HANG";
            break;
        }
    }
    tf.flush().ok();
    let con = cpu.console();
    if con.len() > last {
        print!("{}", String::from_utf8_lossy(&con[last..]));
    }
    eprintln!("\n[repro] traced {steps} steps → {} (outcome: {outcome})", a[3]);
}
