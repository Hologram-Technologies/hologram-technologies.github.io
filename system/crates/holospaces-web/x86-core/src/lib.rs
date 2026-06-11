//! A real (minimal) **8086 real-mode CPU core** as a CC-6 guest. It executes
//! actual x86 machine code — a real boot sector loaded at `0x7c00` — through the
//! `UserlandWorkspace` mailbox ABI, and forwards COM1 (port `0x3f8`) writes to the
//! holospace console. The same *kind* of thing as QEMU's TCG (an instruction
//! interpreter), only minimal: it decodes the opcodes a serial boot sector uses.
//! **NOT QEMU** — QEMU is the full-system C port that satisfies this same ABI.
//! Zero imports; exports `memory` + `hg_*`. See web/QEMU-HOLOSPACE.md.
#![no_std]
#![allow(static_mut_refs)]

use core::panic::PanicInfo;
use core::ptr::addr_of_mut;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}

const MAGIC: u32 = 0x4F4C_4F48; // "HOLO"

// Mailbox + regions (host↔guest I/O lives only in linear memory).
static mut MBX: [u8; 48] = [0; 48];
static mut CFG: [u8; 65536] = [0; 65536];
static mut INB: [u8; 4096] = [0; 4096];
static mut OUT: [u8; 65536] = [0; 65536];
static mut OUT_LEN: usize = 0;

// The machine: 64 KiB of RAM + the 16-bit register file. All in linear memory, so
// the κ snapshot captures the whole machine (CC-30) — suspend/resume is exact.
static mut RAM: [u8; 65536] = [0; 65536];
static mut REG: [u16; 8] = [0; 8]; // AX,CX,DX,BX,SP,BP,SI,DI
static mut IP: u16 = 0;
static mut ZF: bool = false;
static mut RUNNING: bool = false;
static mut BOOTED: bool = false;

#[inline]
unsafe fn wr32(off: usize, v: u32) {
    let p = addr_of_mut!(MBX) as *mut u8;
    let b = v.to_le_bytes();
    *p.add(off) = b[0];
    *p.add(off + 1) = b[1];
    *p.add(off + 2) = b[2];
    *p.add(off + 3) = b[3];
}
#[inline]
unsafe fn rd32(off: usize) -> u32 {
    let p = addr_of_mut!(MBX) as *const u8;
    u32::from_le_bytes([*p.add(off), *p.add(off + 1), *p.add(off + 2), *p.add(off + 3)])
}
#[inline]
unsafe fn emit(b: u8) {
    if OUT_LEN < 65536 {
        *(addr_of_mut!(OUT) as *mut u8).add(OUT_LEN) = b;
        OUT_LEN += 1;
    }
}
unsafe fn emits(s: &[u8]) {
    for &b in s {
        emit(b);
    }
}
#[inline]
unsafe fn ram(i: u16) -> u8 {
    *(addr_of_mut!(RAM) as *const u8).add(i as usize)
}
#[inline]
unsafe fn fetch() -> u8 {
    let b = ram(IP);
    IP = IP.wrapping_add(1);
    b
}
// 8-bit register read (AL,CL,DL,BL,AH,CH,DH,BH).
#[inline]
unsafe fn reg8(i: u8) -> u8 {
    let r = REG[(i & 3) as usize];
    if i < 4 {
        (r & 0xff) as u8
    } else {
        (r >> 8) as u8
    }
}
#[inline]
unsafe fn set_reg8(i: u8, v: u8) {
    let idx = (i & 3) as usize;
    if i < 4 {
        REG[idx] = (REG[idx] & 0xff00) | v as u16;
    } else {
        REG[idx] = (REG[idx] & 0x00ff) | ((v as u16) << 8);
    }
}

#[no_mangle]
pub extern "C" fn hg_mailbox() -> i32 {
    unsafe {
        wr32(0, MAGIC);
        wr32(4, 1);
        wr32(8, addr_of_mut!(CFG) as u32);
        wr32(12, 65536);
        wr32(16, 0);
        wr32(20, addr_of_mut!(INB) as u32);
        wr32(24, 4096);
        wr32(28, 0);
        wr32(32, addr_of_mut!(OUT) as u32);
        wr32(36, 65536);
        wr32(40, 0);
        wr32(44, 0);
        addr_of_mut!(MBX) as i32
    }
}

/// Load the boot sector from the cfg region (the driver writes `argv\0..\0\0`,
/// then a `u32` disk length, then the disk bytes) into RAM at `0x7c00`, point IP
/// there, and start the machine.
#[no_mangle]
pub extern "C" fn hg_init() -> i32 {
    unsafe {
        let cfg = addr_of_mut!(CFG) as *const u8;
        let cfg_len = rd32(16) as usize;
        // Skip argv: scan to the first double-NUL (argv terminator).
        let mut i = 0usize;
        while i + 1 < cfg_len {
            if *cfg.add(i) == 0 && *cfg.add(i + 1) == 0 {
                break;
            }
            i += 1;
        }
        let mut p = i + 2; // past the double-NUL
        let mut disklen = 0usize;
        if p + 4 <= cfg_len {
            disklen = u32::from_le_bytes([*cfg.add(p), *cfg.add(p + 1), *cfg.add(p + 2), *cfg.add(p + 3)]) as usize;
            p += 4;
        }
        // Load the disk image at 0x7c00 (the BIOS boot convention).
        let ram = addr_of_mut!(RAM) as *mut u8;
        let n = disklen.min(cfg_len.saturating_sub(p)).min(0x10000 - 0x7c00);
        for k in 0..n {
            *ram.add(0x7c00 + k) = *cfg.add(p + k);
        }
        REG = [0; 8];
        IP = 0x7c00;
        ZF = false;
        RUNNING = true;
        BOOTED = false;
        0
    }
}

#[no_mangle]
pub extern "C" fn hg_suspend() -> i32 {
    0
}

#[no_mangle]
pub extern "C" fn hg_resume() -> i32 {
    0
}

#[no_mangle]
pub extern "C" fn hg_callback(_id: i32, _ptr: i32, _len: i32) -> i32 {
    0
}

/// Execute up to `budget` instructions (a cooperative slice — returns to the host
/// when the budget runs out or the machine halts), forwarding COM1 to the console.
#[no_mangle]
pub extern "C" fn hg_event(budget: i32) -> i32 {
    unsafe {
        OUT_LEN = 0;
        if !BOOTED {
            BOOTED = true;
            emits(b"\x1b[90m[x86 core] executing real machine code from the boot sector via the CC-6 pipeline\x1b[0m\r\n");
        }
        // Honor the host budget but CAP each cooperative slice small: the engine's
        // `wasmi` interpreter (beta) accumulates host stack per guest call executed
        // within a single `.call`, so a multi-hundred-instruction slice overflows.
        // The worker pumps hg_event repeatedly, so total work is unbounded across
        // calls while each `.call` stays short (also ~one-frame input latency).
        // This ceiling is a real constraint for any long-running CC-6 guest on the
        // browser engine — the future QEMU module slices the same way.
        const MAX_SLICE: u32 = 64;
        let mut steps = (budget.max(1) as u32).min(MAX_SLICE);
        while RUNNING && steps > 0 {
            step();
            steps -= 1;
        }
        if !RUNNING {
            wr32(44, 1); // halted
        }
        wr32(40, OUT_LEN as u32);
        0
    }
}

/// One instruction. Decodes the real-mode opcodes a serial boot sector needs;
/// an unknown opcode is surfaced (not silently skipped) and halts the machine.
unsafe fn step() {
    let op = fetch();
    match op {
        0x90 => {} // nop
        0xFA | 0xFB => {} // cli / sti — flags we don't model
        0xF4 => {
            // hlt
            RUNNING = false;
        }
        0xB0..=0xB7 => {
            // mov r8, imm8
            let imm = fetch();
            set_reg8(op - 0xB0, imm);
        }
        0xB8..=0xBF => {
            // mov r16, imm16
            let lo = fetch() as u16;
            let hi = fetch() as u16;
            REG[(op - 0xB8) as usize] = lo | (hi << 8);
        }
        0xAC => {
            // lodsb: AL = DS:[SI]; SI += 1  (DS = 0 in this minimal core)
            let v = ram(REG[6]);
            set_reg8(0, v);
            REG[6] = REG[6].wrapping_add(1);
        }
        0x84 => {
            // test r/m8, r8  (register-direct, mod=11)
            let modrm = fetch();
            let a = reg8((modrm >> 3) & 7);
            let b = reg8(modrm & 7);
            ZF = (a & b) == 0;
        }
        0x74 => {
            // jz rel8
            let rel = fetch() as i8 as i16;
            if ZF {
                IP = (IP as i16).wrapping_add(rel) as u16;
            }
        }
        0x75 => {
            // jnz rel8
            let rel = fetch() as i8 as i16;
            if !ZF {
                IP = (IP as i16).wrapping_add(rel) as u16;
            }
        }
        0xEB => {
            // jmp rel8
            let rel = fetch() as i8 as i16;
            IP = (IP as i16).wrapping_add(rel) as u16;
        }
        0xE9 => {
            // jmp rel16
            let lo = fetch() as i16;
            let hi = fetch() as i16;
            let rel = lo | (hi << 8);
            IP = (IP as i16).wrapping_add(rel) as u16;
        }
        0xEE => {
            // out dx, al  → the 16550 UART at COM1 (0x3f8)
            if REG[2] == 0x3f8 {
                emit(reg8(0));
            }
        }
        0xE6 => {
            // out imm8, al
            let port = fetch();
            if port == 0xf8 {
                emit(reg8(0));
            }
        }
        other => {
            emits(b"\r\n\x1b[31m[x86 core] unknown opcode 0x");
            emit_hex(other);
            emits(b"]\x1b[0m\r\n");
            RUNNING = false;
        }
    }
}

unsafe fn emit_hex(b: u8) {
    let hex = b"0123456789ABCDEF";
    emit(hex[(b >> 4) as usize]);
    emit(hex[(b & 0xf) as usize]);
}
