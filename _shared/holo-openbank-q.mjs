// holo-openbank-q.mjs — Q turns the 90-day reconfirm chore into ONE calm pill and ONE biometric.
//
// The 90-day SCA reconfirmation is the only recurring friction in bank aggregation (first connect aside).
// Q's job is to make it feel like nothing: watch every consent's reconfirmAt, and when any fall due, surface
// a SINGLE "Needs you" notification (holo-notify category:"action") — never one pill per bank. Tapping it runs
// every due reconfirm in one pass; because each is an authority-class step-up (holo-stepup), the gate's trust
// window means the FIRST one prompts a biometric and the rest stand on it — N banks, ONE motion.
//
// Pure + decoupled: this module holds no UI and no gate. reconfirmDigest reads openbank.dueForReconfirm();
// toNotification shapes a holo-notify payload (the wallet hands it to holo.notify); runBatchReconfirm drives
// openbank.reconfirm (whose injected gate is the real holo-stepup-gate in the browser, a counter in the witness).

const prettyBank = (id) => String(id).replace(/^[a-z]{2}-/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const niceList = (banks) => {
  const n = banks.map(prettyBank);
  if (n.length <= 1) return n[0] || "";
  if (n.length === 2) return n[0] + " and " + n[1];
  return n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
};

// reconfirmDigest(openbank) -> null | { count, ids, banks, soonest } — the due set collapsed to one concern.
export async function reconfirmDigest(openbank) {
  const { due } = await openbank.dueForReconfirm();
  if (!due || due.length === 0) return null;
  const banks = due.map((d) => d.bankId);
  const soonest = due.map((d) => d.expiresAt).sort()[0];
  return { "@type": "BankReconfirmDigest", count: due.length, ids: due.map((d) => d.id), banks, soonest };
}

// toNotification(digest) -> a holo.notify payload. STABLE id "bank-reconfirm" so it is ONE living pill that
// updates (3 → 1 → gone), never a pile (holo-notify concernKey collapses on id). category:"action" = "Needs you".
export function toNotification(digest) {
  if (!digest) return null;
  const n = digest.count;
  return {
    id: "bank-reconfirm",
    sender: "Q",
    category: "action",
    severity: "warn",
    title: `Reconfirm ${n} bank ${n === 1 ? "connection" : "connections"}`,
    body: `One quick check keeps ${niceList(digest.banks)} connected — no bank login needed.`,
    actions: [{ label: n === 1 ? "Reconfirm" : "Reconfirm all" }],
    deepLink: { kind: "bank.reconfirm", value: "all" },   // the shell routes the tap → runBatchReconfirm(ids)
  };
}

// runBatchReconfirm(openbank, ids) -> { ok, reconfirmed:[{from,to}], failed:[{id,reason}] }. One pass; the
// gate's trust window makes it ONE biometric. Fail-closed: a denied/cancelled gate leaves that consent untouched.
export async function runBatchReconfirm(openbank, ids, { caller = { kind: "human" }, ctx = {} } = {}) {
  const reconfirmed = [], failed = [];
  for (const id of ids) {
    const r = await openbank.reconfirm(id, { caller, ctx });
    if (r && r.ok) reconfirmed.push({ from: id, to: r.id });
    else failed.push({ id, reason: (r && r.reason) || "refused" });
  }
  return { ok: failed.length === 0, reconfirmed, failed };
}

export { prettyBank, niceList };
export default { reconfirmDigest, toNotification, runBatchReconfirm };
