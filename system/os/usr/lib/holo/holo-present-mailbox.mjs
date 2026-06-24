// holo-present-mailbox.mjs — the lock-free PRODUCE→PRESENT frame handoff, lifted from the game emulator
// (holo-retro-engine/holo-present-mailbox.js) into the projection substrate so EVERY producer — a game
// core, a QEMU framebuffer, the browser OSR origin — decouples its produce rate from the panel's refresh.
// (Named -mailbox to avoid the existing holo-present.mjs, which is credential disclosure.)
//
// The load-bearing structure for high FPS. A producer renders at its own rate (a console's 60 Hz, a VM's
// variable rate, a web page's paint rate — deterministic and sacred); the present loop runs at the PANEL's
// refresh — faster, and never the same (120–500 Hz). They must hand frames across WITHOUT either blocking:
//   • the producer must never stall waiting for the consumer (produce timing is sacred),
//   • the consumer must always get the LATEST complete frame, never a torn one, and re-present its held
//     frame when nothing newer exists (so present can run FASTER than produce — the extra frames are
//     reprojections, see holo-reproject) — latest-wins, not a FIFO.
//
// A classic lock-free TRIPLE BUFFER (swap chain): three slots, one atomic control word. With three buffers
// the producer's back-buffer and the consumer's front-buffer are ALWAYS distinct slots, so a frame is never
// read while written — no lock, no tearing, no blocking. Backed by a SharedArrayBuffer so producer and
// consumer can be different Workers; usable single-thread too (two handles over one SAB).
//
// Control word (i32[0]):  bits 0-1 = slot index parked at the swap point; bit 2 = DIRTY (fresh frame waiting).

const DIRTY = 4;
const IDX = 3;
const HEADER = 4;          // one i32 control word

export class FrameMailbox {
  constructor(sab, frameBytes, role = "") {
    this.ctrl = new Int32Array(sab, 0, 1);
    this.frameBytes = frameBytes;
    this.slots = [0, 1, 2].map((i) => new Uint8Array(sab, HEADER + i * frameBytes, frameBytes));
    this._back = 1;        // producer's private write buffer
    this._front = 0;       // consumer's private read buffer
    this.role = role;      // "producer" | "consumer" (informational)
    this.stats = { published: 0, acquired: 0, missed: 0, repeats: 0 };
    this._lastSeen = -1;
  }

  static create(frameBytes) { return new SharedArrayBuffer(HEADER + 3 * frameBytes); }
  static init(sab) { new Int32Array(sab, 0, 1)[0] = 2; }   // slot 2 parked at the swap point, not dirty

  // producer: copy a frame into the back buffer and publish it. Never blocks. An unconsumed previous frame
  // is simply overwritten by the next publish (latest-wins) — produce timing is never held hostage.
  publish(frame) {
    this.slots[this._back].set(frame);
    const old = Atomics.exchange(this.ctrl, 0, this._back | DIRTY);   // swap back ↔ swap-point, mark fresh
    this._back = old & IDX;
    this.stats.published++;
  }

  // consumer: take the latest complete frame, or null if nothing new since last acquire (the consumer then
  // re-presents its held front — the mechanism that lets present out-pace produce). The returned view is
  // stable until the next acquire().
  acquire() {
    if ((Atomics.load(this.ctrl, 0) & DIRTY) === 0) { this.stats.repeats++; return null; }
    const old = Atomics.exchange(this.ctrl, 0, this._front);          // give back our clean front, take the fresh slot
    this._front = old & IDX;
    this.stats.acquired++;
    return this.slots[this._front];
  }

  front() { return this.slots[this._front]; }                         // the frame currently on screen (for reprojection)
  backSlot() { return this._back; }                                    // witness helper: the slot the producer writes next
  frontSlot() { return this._front; }                                  // witness helper: the slot the consumer reads

  // witness bookkeeping: record drops when the producer outran the consumer (frames produced but never shown)
  noteFrameIndex(idx) {
    if (this._lastSeen >= 0 && idx > this._lastSeen + 1) this.stats.missed += idx - this._lastSeen - 1;
    this._lastSeen = idx;
  }
}

// makeFrameMailbox(frameBytes) — convenience for single-thread use or a witness: one SAB, two handles that
// share it exactly as two Workers would. Across Workers, post the `.sab` and construct a FrameMailbox each side.
export function makeFrameMailbox(frameBytes) {
  const sab = FrameMailbox.create(frameBytes);
  FrameMailbox.init(sab);
  return { sab, producer: new FrameMailbox(sab, frameBytes, "producer"), consumer: new FrameMailbox(sab, frameBytes, "consumer") };
}

export default { FrameMailbox, makeFrameMailbox };
