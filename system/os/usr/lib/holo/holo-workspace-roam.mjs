// holo-workspace-roam.mjs — SEAMLESS ANY-DEVICE (Phase E, the reconcile logic). A window is its own
// source chain; "following you to another device" is just carrying that chain's head κ + entries over
// the existing peer seam (advertise / receive / fetchPeer) and re-mounting it THERE — verify-before-mount.
// This module is the device-side brain that decides what to do with a remote chain for the same app:
//
//   • verify-before-trust FIRST (holo-strand-admit) — a broken/forged remote is ignored (fail-closed).
//   • fast-forward when the remote strictly EXTENDS this device's chain (the window roamed forward).
//   • local-ahead  when this device strictly extends the remote (we're newer — keep ours).
//   • DIVERGED when both edited concurrently after a shared ancestor → KEEP BOTH LINEAGES. The chain is
//     append-only (monotonic law) — we never merge-destroy; the "loser" stays a rewind point you can pick.
//
// "Following, not syncing": your space is present because identity is your κ, not a device — there is no
// mutable blob to reconcile, only hash-linked histories to compare. Transport (WebRTC κ-rendezvous /
// IPFS pubsub) is out-of-band; this is the pure, witnessable decision core. Pure assembly, no new crypto.

import { admitChain } from "./holo-strand-admit.mjs";

// commonPrefix(a,b) → count of leading entries with identical κ (their shared ancestry).
function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length); let i = 0;
  while (i < n && a[i] && b[i] && a[i].id === b[i].id) i++;
  return i;
}

// reconcileRemote(localEntries, remoteBundle, { ruleset, immunity }) → a decision; NEVER mutates input,
// NEVER destroys local history. Outcomes: in-sync · fast-forward (adopt remote) · local-ahead (keep
// local) · diverged (keep both lineages) · unrelated (different genesis) · rejected (remote failed L5).
export async function reconcileRemote(localEntries = [], remoteBundle = {}, opts = {}) {
  const remote = (remoteBundle && Array.isArray(remoteBundle.entries)) ? remoteBundle.entries : [];
  const localHead = localEntries.length ? localEntries[localEntries.length - 1].id : null;
  if (!remote.length) return { outcome: "in-sync", adopt: null, head: localHead };

  const a = await admitChain(remote, opts);                                   // verify-before-trust
  if (!a.ok) return { outcome: "rejected", why: a.why, stage: a.stage, adopt: null, head: localHead };
  const remoteHead = remote[remote.length - 1].id;

  if (remoteHead === localHead) return { outcome: "in-sync", adopt: null, head: localHead };
  if (!localEntries.length) return { outcome: "fast-forward", adopt: remote, head: remoteHead };

  const cp = commonPrefix(localEntries, remote);
  if (cp === 0) return { outcome: "unrelated", adopt: null, head: localHead };           // no shared genesis
  if (cp === localEntries.length && remote.length > localEntries.length) return { outcome: "fast-forward", adopt: remote, head: remoteHead };
  if (cp === remote.length && localEntries.length > remote.length) return { outcome: "local-ahead", adopt: null, head: localHead };
  // diverged: shared ancestor at index cp-1, then each has unique entries → keep BOTH (no destructive merge)
  return {
    outcome: "diverged", adopt: null, ancestorAt: cp - 1,
    lineages: [{ which: "local", head: localHead }, { which: "remote", head: remoteHead, entries: remote }],
  };
}

if (typeof window !== "undefined") window.HoloWorkspaceRoam = { reconcileRemote };
