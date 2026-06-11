// holo-ux-doctrine.mjs — THE one source of the Holo UX doctrine (ADR-0062): the canonical
// upstream UX parameters every holospace binds, the experience analogue of the Holo UI token
// contract. It is data, not prose: a set of TENETS (each a checkable obligation), the native-OS
// profile AXES, and the materializers that emit the dereferenceable hosux: ontology (ns/ux.jsonld)
// and feed the sealed doctrine object (etc/holo-ux/doctrine.uor.json). Pure + isomorphic +
// dependency-free: the witness re-derives every materialization from here, so nothing can drift
// (the same no-drift discipline as holo-voice.mjs → holo-voice-lexicon.jsonld).
//
// Mint-nothing (ADR-024): the genuinely-new UX terms live in the scoped hosux: namespace; every
// near-equivalent declares skos:closeMatch to a ratified authority (WCAG, RAIL, UA Client Hints,
// UOR-ADDR). Descriptive metadata reuses skos / schema.org / dcterms / prov unchanged.

// ── the doctrine: 13 tenets — the user's 5 founding principles + Steve Jobs's 8 UX lessons ──
// Each tenet is ONE checkable rule. `id` is its hosux: concept slug; `principle` is the plain-voice
// statement (the WHY); `obligation` is the canonical, conformable rule a holospace is held to (the
// WHAT a per-app conformance ratchet binds); `match` is the ratified equivalent it extends, never forks.
export const TENETS = [
  // — the founding five (the user's brief) —
  {
    id: "native-adaptive", group: "founding",
    label: "Native by autodetection",
    principle: "The system detects the host OS — Windows, macOS, iOS, iPadOS, Android, ChromeOS, Linux — and wears its native feel, so it is familiar and effortless on every machine the first second it opens.",
    obligation: "Resolve the host platform from the one resolver (holo-platform.js) and bind its native profile — modifier key, window-control side, font, accent, shortcuts (data-holo-platform) — dynamically; never hardcode one OS's idiom.",
    match: "https://www.w3.org/TR/ua-client-hints/",
  },
  {
    id: "familiar-effortless", group: "founding",
    label: "Familiar and effortless",
    principle: "Use conventions a person already knows, so nothing needs a manual; the easy path is the obvious one.",
    obligation: "Reuse the host OS's established patterns and the canonical Holo UI tokens (--holo-*); introduce no bespoke interaction where a native one already exists.",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html",
  },
  {
    id: "moments-of-magic", group: "founding",
    label: "Magic on curiosity's terms",
    principle: "Let power reveal itself when the user reaches for it — self-described, never forced, never a guided tour; curiosity guides the discovery.",
    obligation: "Surface advanced capability through progressive disclosure; every surface is self-descriptive (a clear label/affordance, not a tutorial); no forced interruption of the user's flow.",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html",
  },
  {
    id: "sacred-resources", group: "founding",
    label: "Treat time, attention, money, compute and energy as sacred",
    principle: "Always seek more with less; the lightest path that does the job honours what the user spends to be here.",
    obligation: "Hold the declared tier-aware resource budget (cold-start, interaction ≤100ms, bytes-per-surface, memory, maxDpr — holo-perf-budget.json); add no work the task does not require.",
    match: "https://www.w3.org/TR/2024/WD-rail-20240101/",
  },
  {
    id: "signal-over-noise", group: "founding",
    label: "Maximize signal, minimize noise",
    principle: "No clutter, no wall of text, no attention-grabbing colour, no distraction; the content leads and the chrome recedes.",
    obligation: "Route colour through the canonical palette (no attention-grabbing hardcodes — ADR-0057), respect the readability floor, and keep the plain voice (concise, jargon-free, why→how→what — holo-voice.mjs).",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
  },
  // — Steve Jobs's eight UX lessons —
  {
    id: "design-is-how-it-works", group: "jobs",
    label: "Design is how it works",
    principle: "Design is the whole interaction, not the surface; how it works and how it feels are one thing.",
    obligation: "Conformance is behavioural, not skin-deep: a holospace binds the experience parameters (this doctrine), and its content address commits function and form together.",
    match: "https://www.w3.org/TR/did-core/",
  },
  {
    id: "simplicity-is-the-work", group: "jobs",
    label: "Simplicity, ruthlessly refined",
    principle: "Simple can be harder than complex; refine until the obvious thing is the only thing.",
    obligation: "Prefer the fewest controls and an obvious default; an action a first-time user cannot guess is a fault, not a feature.",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html",
  },
  {
    id: "user-first", group: "jobs",
    label: "The user first, end to end",
    principle: "Stand in the user's shoes and own the whole experience, from the first paint to the last action.",
    obligation: "The experience is one continuous flow (boot → shell → app); no app is an island — every surface binds the one canonical doctrine.",
    match: "https://www.w3.org/TR/html-design-principles/",
  },
  {
    id: "focus-say-no", group: "jobs",
    label: "Focus — say no to protect great",
    principle: "Eliminate the non-essential; concentrate on what truly matters by cutting what does not.",
    obligation: "Each surface does one thing well; secondary actions are disclosed on demand, not displayed by default.",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html",
  },
  {
    id: "attention-to-detail", group: "jobs",
    label: "Detail in the unseen, too",
    principle: "Obsess over every detail, visible and invisible; the parts no one sees are crafted with the same care.",
    obligation: "The parameters reach a surface's chrome honestly and say where they cannot (pixel-only guests: VM/canvas/video); nothing is left half-finished behind the visible edge.",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html",
  },
  {
    id: "think-different", group: "jobs",
    label: "Redefine the question",
    principle: "Do not copy conventions; build what the user does not yet know they need — substrate-native: self-verifying, serverless, content-addressed.",
    obligation: "The experience is a re-derivable κ-object (Law L5), not a config file trusted by its location; verify by re-derivation, refuse a tampered byte.",
    match: "https://github.com/uor-foundation/uor-addr",
  },
  {
    id: "seamless-integration", group: "jobs",
    label: "Seamless, integrated experience",
    principle: "Make a single whole where the parts work together intuitively, not a pile of separate features.",
    obligation: "One source (this doctrine) propagates to every surface over the postMessage tree; changing it re-flows the whole system live, with no rebuild and no restart.",
    match: "https://html.spec.whatwg.org/multipage/web-messaging.html",
  },
  {
    id: "emotional-delight", group: "jobs",
    label: "It just works — and delights",
    principle: "Create something that just works and feels magical, human-centred, worth being grateful for.",
    obligation: "Defaults are beautiful and correct out of the box (bind the κ, do not re-implement); reduced-motion and accessibility are honoured so delight never costs comfort.",
    match: "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html",
  },
];

// ── the native-OS profile axes — the experience the autodetect adjusts, by host OS ──
// The host set the doctrine spans (the same seven HoloPlatform resolves). The seal tool drives the
// real resolver (holo-platform.js · profileFor) over these synthesized navigators to embed the
// faithful profile matrix into the sealed object, and the witness re-derives it identically.
export const PLATFORM_OSES = ["windows", "macos", "ios", "ipados", "android", "chromeos", "linux"];

// navFor(os) → a minimal, deterministic navigator-like object that resolves to `os` through the
// real profileFor() — so the embedded matrix is the LIVE resolver's output, never a restatement.
export function navFor(os) {
  switch (os) {
    case "windows":  return { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", userAgentData: { platform: "Windows", mobile: false }, maxTouchPoints: 0 };
    case "macos":    return { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", userAgentData: { platform: "macOS", mobile: false }, maxTouchPoints: 0 };
    case "ios":      return { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 };
    case "ipados":   return { userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", maxTouchPoints: 5 };
    case "android":  return { userAgent: "Mozilla/5.0 (Linux; Android 14)", userAgentData: { platform: "Android", mobile: true }, maxTouchPoints: 5 };
    case "chromeos": return { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)", userAgentData: { platform: "Chrome OS", mobile: false }, maxTouchPoints: 0 };
    default:         return { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", userAgentData: { platform: "Linux", mobile: false }, maxTouchPoints: 0 };
  }
}

// ── materialize the dereferenceable hosux: ontology + the SKOS doctrine scheme (ns/ux.jsonld) ──
// The same shape as ns/conformance.jsonld (hosc:): an owl:Ontology header, the minted classes +
// properties, then the doctrine as a skos:ConceptScheme of skos:Concepts. The witness re-derives
// this and refuses any drift from the on-disk file.
const NS = "https://hologram.os/ns/ux";
export function toOntology() {
  const term = (id, type, label, comment, extra = {}) => ({ "@id": `hosux:${id}`, "@type": type, label, comment, isDefinedBy: NS, ...extra });
  return {
    "@context": {
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      owl: "http://www.w3.org/2002/07/owl#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      skos: "http://www.w3.org/2004/02/skos/core#",
      dcterms: "http://purl.org/dc/terms/",
      schema: "https://schema.org/",
      hosux: "https://hologram.os/ns/ux#",
      label: "rdfs:label",
      comment: "rdfs:comment",
      domain: { "@id": "rdfs:domain", "@type": "@id" },
      range: { "@id": "rdfs:range", "@type": "@id" },
      subClassOf: { "@id": "rdfs:subClassOf", "@type": "@id" },
      closeMatch: { "@id": "skos:closeMatch", "@type": "@id" },
      inScheme: { "@id": "skos:inScheme", "@type": "@id" },
      topConceptOf: { "@id": "skos:topConceptOf", "@type": "@id" },
      isDefinedBy: { "@id": "rdfs:isDefinedBy", "@type": "@id" },
      prefLabel: "skos:prefLabel",
      definition: "skos:definition",
      obligation: "hosux:obligation",
    },
    "@id": NS,
    "@type": "owl:Ontology",
    label: "Hologram OS — Holo UX doctrine vocabulary (hosux:)",
    comment: "The canonical, upstream UX parameters of Hologram OS (ADR-0062): the doctrine every holospace binds — the experience analogue of the Holo UI token contract. Mints only the genuinely-new UX terms (Tenet · obligation · the native-OS profile · capability tier · voice register · resource budget); every near-equivalent declares skos:closeMatch to its ratified authority (WCAG · RAIL · UA Client Hints · UOR-ADDR). This document is itself valid JSON-LD, and is re-derived from holo-ux-doctrine.mjs (no drift).",
    "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
    "@graph": [
      term("Doctrine", "rdfs:Class", "UX Doctrine", "The one canonical set of UX tenets a holospace binds. A specialization of a SKOS concept scheme.", { subClassOf: "skos:ConceptScheme" }),
      term("Tenet", "rdfs:Class", "UX Tenet", "One canonical UX principle expressed as a checkable obligation a holospace conforms to. A specialization of a SKOS concept.", { subClassOf: "skos:Concept" }),
      term("PlatformProfile", "rdfs:Class", "Native Platform Profile", "The native-feel profile resolved for a host OS — modifier key, window-control side, font, accent, shortcuts — that the experience adapts to at boot."),
      term("obligation", "rdf:Property", "obligation", "The canonical, conformable rule a Tenet places on a holospace — the WHAT a per-app conformance ratchet binds. OS-specific UX term, no W3C equivalent.", { domain: "hosux:Tenet", range: "xsd:string" }),
      term("capabilityTier", "rdf:Property", "capability tier", "The resolved device tier (lean · standard · rich) the experience optimizes to; a deterministic function of the hardware probe.", { range: "xsd:string", closeMatch: "schema:processorRequirements" }),
      term("voiceRegister", "rdf:Property", "voice register", "The plain authoring voice (jargon-free, why→how→what, concise) every user-facing description holds.", { range: "xsd:string" }),
      term("resourceBudget", "rdf:Property", "resource budget", "The declared, tier-aware budget for the resources a holospace spends (time · compute · memory · bytes · energy).", { closeMatch: "schema:Quantity" }),
      {
        "@id": `${NS}#doctrine`,
        "@type": ["skos:ConceptScheme", "hosux:Doctrine"],
        prefLabel: "Holo UX doctrine — the canonical upstream UX parameters (ADR-0062)",
        "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
        comment: "Thirteen tenets: the five founding principles of Hologram OS and the eight UX lessons of Steve Jobs, each a checkable obligation every holospace native app binds.",
      },
      ...TENETS.map((t) => ({
        "@id": `hosux:${t.id}`,
        "@type": ["skos:Concept", "hosux:Tenet"],
        prefLabel: t.label,
        definition: t.principle,
        obligation: t.obligation,
        ...(t.match ? { closeMatch: t.match } : {}),
        inScheme: `${NS}#doctrine`,
        topConceptOf: `${NS}#doctrine`,
        "schema:category": t.group,
      })),
    ],
  };
}

if (typeof globalThis !== "undefined") globalThis.HoloUXDoctrine = { TENETS, PLATFORM_OSES, navFor, toOntology };
