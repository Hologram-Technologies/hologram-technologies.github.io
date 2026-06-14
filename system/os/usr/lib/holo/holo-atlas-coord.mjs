// holo-atlas-coord.mjs — every UOR object's deterministic, self-verifying coordinate in the finite
// Φ-Atlas-12288 torus. The SPACE is verbatim upstream (UOR-Foundation/atlas-12288, carried by the
// sealed E8·ATLAS96 object did:holo:sha256:f82435da… and its resonator-geometry.js): T² = ℤ₄₈ × ℤ₂₅₆
// = 12,288 cells; Φ(p,b) = (p << 8) | b; R96 = b % 96 (96 = 3·2⁵). An object's POSITION is a PURE
// function of its content address (κ) — attribute-derived, re-derivable by anyone from the κ alone
// (self-verifying), and always inside the finite torus.
//
// Fractal, not recursive: the embedding is content→cell and content-addressing is ACYCLIC (an object's
// κ cannot appear among its own descendants), so an object is BOTH a point in its parent's atlas AND
// itself an atlas for its sub-objects — finite per level (12,288), unbounded depth, no cycles. This is
// a canonical, interpretable COORDINATE NAMESPACE over the object graph; it is NOT an isolation,
// storage, compute, or quantum layer (isolation = the W3C sandbox + Law-L5 verify + the conscience).

export const ATLAS = Object.freeze({                         // verbatim Φ-Atlas-12288 invariants
  object: "did:holo:sha256:f82435dab0215aa6695797d5e9ef4809f1905c015c419f085b2d42346441aad0",
  space: "Φ-Atlas-12288", pages: 48, bytes: 256, cells: 12288, classes: 96,
});
export const phiEncode = (p, b) => (p << 8) | b;             // Φ(p,b) = (p<<8)|b — verbatim
export const phiPage = (c) => c >> 8;                        // verbatim
export const phiByte = (c) => c & 0xff;                      // verbatim
export const r96 = (b) => b % 96;                            // R96 = b % 96 — verbatim

// atlasCoord(κ) — the object's self-verifying coordinate, derived PURELY from its content address.
// κ may be a did:holo:<axis>:<hex>, an <axis>:<hex>, or a bare hex; only the hex (the content) is used.
export function atlasCoord(kappa) {
  const hex = String(kappa).split(":").pop().toLowerCase();
  if (!/^[0-9a-f]{8,}$/.test(hex)) throw new Error("atlasCoord: not a content address: " + kappa);
  const cell = Number(BigInt("0x" + hex) % BigInt(ATLAS.cells));   // uniform content → torus embedding
  const page = phiPage(cell), byte = phiByte(cell);
  return Object.freeze({ space: ATLAS.space, within: ATLAS.object, cell, page, byte, r96: r96(byte), phi: phiEncode(page, byte) });
}

// a coordinate is well-formed iff it sits inside the finite torus and Φ round-trips (self-consistent)
export const inTorus = (c) => Number.isInteger(c.cell) && c.cell >= 0 && c.cell < ATLAS.cells
  && c.page >= 0 && c.page < ATLAS.pages && c.byte >= 0 && c.byte < ATLAS.bytes
  && c.r96 >= 0 && c.r96 < ATLAS.classes && phiEncode(c.page, c.byte) === c.cell;
