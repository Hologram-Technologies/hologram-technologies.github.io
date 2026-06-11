#!/usr/bin/env python3
"""Find the first differing trace record (24 bytes: pc, x_digest, v_digest LE).
record[i] is the architectural state BEFORE step i, so the first record that
differs means the instruction at record[i-1].pc emulated divergently."""
import sys, struct

def load(path):
    data = open(path, "rb").read()
    n = len(data) // 24
    return [struct.unpack_from("<QQQ", data, i * 24) for i in range(n)]

a = load(sys.argv[1])
b = load(sys.argv[2])
m = min(len(a), len(b))
print(f"native records: {len(a)}   wasm records: {len(b)}   common: {m}")
for i in range(m):
    if a[i] != b[i]:
        print(f"\nFIRST DIVERGENCE at record index {i}\n")
        for j in range(max(0, i - 2), min(m, i + 2)):
            d = "  <== DIFFERS" if a[j] != b[j] else ""
            which = []
            if a[j][0] != b[j][0]: which.append("pc")
            if a[j][1] != b[j][1]: which.append("xdig")
            if a[j][2] != b[j][2]: which.append("vdig")
            print(f"[{j}] native pc={a[j][0]:#018x} x={a[j][1]:#018x} v={a[j][2]:#018x}")
            print(f"     wasm   pc={b[j][0]:#018x} x={b[j][1]:#018x} v={b[j][2]:#018x}{d} {' '.join(which)}")
        culprit = a[i - 1][0] if i > 0 else a[0][0]
        same = (a[i - 1][0] == b[i - 1][0]) if i > 0 else True
        print(f"\n=> mis-emulated instruction is at PC {culprit:#018x}")
        print(f"   (pre-state matched at record {i-1}: pc identical = {same}; the step from there diverged)")
        sys.exit(0)
print(f"\nNo divergence in the common prefix of {m} records.")
print("  (native and wasm agree for every traced step — the hang is elsewhere, or wasm matched.)")
