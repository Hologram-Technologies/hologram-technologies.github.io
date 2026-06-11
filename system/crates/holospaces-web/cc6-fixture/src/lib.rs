//! CC-6 mailbox-ABI conformance guest — the **executable spec** of the contract
//! `UserlandWorkspace` (crates/holospaces-web/src/lib.rs) drives. Imports
//! **nothing** (a self-contained CC-6 userland, so `validate_userland` accepts
//! it); exports `memory` + `hg_mailbox`/`hg_init`/`hg_event`/`hg_suspend`/
//! `hg_resume`. A tiny interactive "machine": prints a boot banner, echoes typed
//! input with line editing, runs a few built-ins, and keeps **all** state in
//! linear memory so `suspend` (= a linear-memory dump) → `resume` round-trips —
//! the O(1) warm-resume. **NOT QEMU**: QEMU is the full C port that satisfies
//! THIS same ABI. See web/QEMU-HOLOSPACE.md.
#![no_std]
#![allow(static_mut_refs)]

use core::panic::PanicInfo;
use core::ptr::addr_of_mut;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}

/// Mailbox magic — the ASCII bytes `HOLO` read as a little-endian `u32`.
const MAGIC: u32 = 0x4F4C_4F48;

// The mailbox header + the cfg/in/out regions live in linear memory (.bss), so
// their addresses are fixed at link and the host reaches them via `hg_mailbox()`.
static mut MBX: [u8; 48] = [0; 48];
static mut CFG: [u8; 65536] = [0; 65536];
static mut INB: [u8; 4096] = [0; 4096];
static mut OUT: [u8; 65536] = [0; 65536];

// Machine state — also in linear memory, so the snapshot captures it.
static mut LINE: [u8; 256] = [0; 256];
static mut LINE_LEN: usize = 0;
static mut OUT_LEN: usize = 0;
static mut BANNER: bool = false;
static mut RESUMED: bool = false;
static mut CMDS: u32 = 0;

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

/// Return the mailbox base offset, filling its header (magic + region pointers).
#[no_mangle]
pub extern "C" fn hg_mailbox() -> i32 {
    unsafe {
        wr32(0, MAGIC);
        wr32(4, 1); // abi version
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

/// Build the machine from the cfg region (argv + disk). The banner prints on the
/// first `hg_event` (the host does not drain the console after init).
#[no_mangle]
pub extern "C" fn hg_init() -> i32 {
    0
}

/// Nothing to flush before the linear-memory snapshot.
#[no_mangle]
pub extern "C" fn hg_suspend() -> i32 {
    0
}

/// After linear memory is restored, note the resume so the next slice shows it.
#[no_mangle]
pub extern "C" fn hg_resume() -> i32 {
    unsafe {
        RESUMED = true;
    }
    0
}

/// Subscription/continuation delivery (spec §4.4). Required by the container-ABI
/// validator ([`surface::CONTAINER_ABI`]); unused by the mailbox model, so a stub.
#[no_mangle]
pub extern "C" fn hg_callback(_id: i32, _ptr: i32, _len: i32) -> i32 {
    0
}

/// One cooperative slice: emit the banner once, drain stdin (echo + line edit +
/// commands), publish the console it produced. `budget` is honored trivially —
/// this machine completes its work each call.
#[no_mangle]
pub extern "C" fn hg_event(_budget: i32) -> i32 {
    unsafe {
        OUT_LEN = 0;
        if !BANNER {
            BANNER = true;
            emits(b"\r\n\x1b[1;32mCC-6 guest fixture\x1b[0m \x1b[90m\xe2\x80\x94 booting on the UserlandWorkspace mailbox ABI\x1b[0m\r\n");
            emits(b"\x1b[90mthe executable ABI contract; real QEMU is the C port that satisfies it.\x1b[0m\r\n");
            emits(b"type \x1b[1mhelp\x1b[0m.\r\n\r\n$ ");
        }
        if RESUMED {
            RESUMED = false;
            emits(b"\r\n\x1b[33m[resumed from \xce\xba snapshot \xe2\x80\x94 state preserved, O(1)]\x1b[0m\r\n$ ");
            let p = addr_of_mut!(LINE) as *const u8;
            for i in 0..LINE_LEN {
                emit(*p.add(i)); // re-echo the in-progress line
            }
        }
        let inlen = rd32(28) as usize;
        let ip = addr_of_mut!(INB) as *const u8;
        for i in 0..inlen.min(4096) {
            let b = *ip.add(i);
            match b {
                b'\r' | b'\n' => {
                    emits(b"\r\n");
                    process_line();
                    LINE_LEN = 0;
                    emits(b"$ ");
                }
                0x08 | 0x7f => {
                    if LINE_LEN > 0 {
                        LINE_LEN -= 1;
                        emits(b"\x08 \x08");
                    }
                }
                0x20..=0x7e => {
                    if LINE_LEN < 256 {
                        *(addr_of_mut!(LINE) as *mut u8).add(LINE_LEN) = b;
                        LINE_LEN += 1;
                    }
                    emit(b);
                }
                _ => {}
            }
        }
        wr32(28, 0); // input consumed
        wr32(40, OUT_LEN as u32); // out_len produced this slice
        0
    }
}

unsafe fn line_eq(s: &[u8]) -> bool {
    if LINE_LEN != s.len() {
        return false;
    }
    let p = addr_of_mut!(LINE) as *const u8;
    for i in 0..s.len() {
        if *p.add(i) != s[i] {
            return false;
        }
    }
    true
}
unsafe fn line_starts(s: &[u8]) -> bool {
    if LINE_LEN < s.len() {
        return false;
    }
    let p = addr_of_mut!(LINE) as *const u8;
    for i in 0..s.len() {
        if *p.add(i) != s[i] {
            return false;
        }
    }
    true
}

unsafe fn process_line() {
    if LINE_LEN == 0 {
        return;
    }
    CMDS += 1;
    if line_eq(b"help") {
        emits(b"commands: help \xc2\xb7 uname \xc2\xb7 echo <text> \xc2\xb7 count \xc2\xb7 poweroff\r\n");
    } else if line_eq(b"uname") {
        emits(b"Hologram CC-6 guest (mailbox ABI) x86-64\r\n");
    } else if line_eq(b"count") {
        emits(b"commands run: ");
        emit_u32(CMDS);
        emits(b"\r\n");
    } else if line_starts(b"echo ") {
        let p = addr_of_mut!(LINE) as *const u8;
        for i in 5..LINE_LEN {
            emit(*p.add(i));
        }
        emits(b"\r\n");
    } else if line_eq(b"poweroff") || line_eq(b"exit") {
        emits(b"\x1b[90mmachine powered off.\x1b[0m\r\n");
        wr32(44, 1); // halted
    } else {
        emits(b"unknown command (try 'help')\r\n");
    }
}

unsafe fn emit_u32(mut v: u32) {
    if v == 0 {
        emit(b'0');
        return;
    }
    let mut buf = [0u8; 10];
    let mut n = 0;
    while v > 0 {
        buf[n] = b'0' + (v % 10) as u8;
        v /= 10;
        n += 1;
    }
    while n > 0 {
        n -= 1;
        emit(buf[n]);
    }
}
