// holo-pm.mjs — THE one source of Holo Product Manager (ADR-0066): the canonical full-cycle product-
// management framework for Hologram-native products, STRICTLY adhering to the Pragmatic Framework
// (pragmaticinstitute.com/product/framework) — 37 activities ("boxes") in 7 categories, a clear path
// from great ideas to great products. It sits ABOVE Holo Product (the foundation a product is built
// on): Holo Product is WHAT you build with; Holo Product Manager is HOW you take it full-cycle from a
// real market problem to a scalable, supported product. Each activity that Hologram already realizes
// is WIRED to the tool that does it (Holo UX · UI · Product · Share-to-Run · Own · App · the gate),
// so the framework is executed on the substrate, not just described. The market/business judgment
// boxes stay the PM's job (realizedBy null) — the framework is honest about what no tool can do.
//
// Mints nothing reusable: the Pragmatic categories + boxes are cited verbatim; the wiring binds
// existing κ-objects by content address. Pure + isomorphic; the witness re-derives every
// materialization from here so nothing drifts.

// ── the central principle + the Pragmatic mantras (cited) ──
export const PRINCIPLE = "A clear and simple path from great ideas to great products — driven by market evidence, not opinion. The bridge that turns ideas into scalable, enterprise-grade products that solve real pain points.";
export const MANTRAS = [
  "NIHITO — Nothing Important Happens In The Office: the truth is in the market, not the building.",
  "Your job is to be the expert on your market and your buyer.",
  "Buyer is not User — design for both, distinctly.",
  "Build what sells, not just what's asked — an outside-in product.",
];

// ── the 7 categories, on the strategic → tactical axis (market-facing vs product-facing) ──
export const CATEGORIES = [
  { id: "market", label: "Market", axis: "strategic", facing: "market", blurb: "Be the expert on the market: real problems, evidence, competitors, assets." },
  { id: "focus", label: "Focus", axis: "strategic", facing: "market", blurb: "Decide where to play: the market you serve, the portfolio, the roadmap." },
  { id: "business", label: "Business", axis: "strategic", facing: "product", blurb: "Make it a business: the plan, pricing, build-vs-buy, profitability, innovation." },
  { id: "planning", label: "Planning", axis: "strategic", facing: "product", blurb: "Plan the product: positioning, personas, requirements, scenarios — the bridge to build." },
  { id: "programs", label: "Programs", axis: "tactical", facing: "market", blurb: "Go to market: launch, awareness, nurturing, advocacy, growth, measurement." },
  { id: "enablement", label: "Enablement", axis: "tactical", facing: "market", blurb: "Enable the channel: sales alignment, content, tools, training." },
  { id: "support", label: "Support", axis: "tactical", facing: "product", blurb: "Sustain it: support programs, operations, events, channels." },
];

// ── the 37 boxes. Each: [id, label, realizedBy, obligation]. realizedBy = the Hologram tool that
// executes it (an os/-relative path or a sealed κ-object), or null when it is the PM's market/business
// judgment (no tool can own it — NIHITO). Counts per category: 5·4·5·7·8·4·4 = 37 (strict). ──
const BOXES = {
  market: [
    ["market-problems", "Market Problems", null, "Find the real, urgent, pervasive pain — the product exists to solve it (the bridge's input). NIHITO: evidence from the market, not the office."],
    ["win-loss-analysis", "Win/Loss Analysis", null, "Learn from every won and lost deal why buyers chose or didn't — feed it back into Focus + Planning."],
    ["distinctive-competencies", "Distinctive Competencies", "usr/lib/holo/holo-uor.mjs", "Name the unfair advantage. Hologram's is the substrate: content-addressed, self-verifying, serverless (κ = H(content), Law L5) — time-to-value ≈ 0."],
    ["competitive-landscape", "Competitive Landscape", null, "Know the alternatives (including 'do nothing'); position against them on the buyer's terms."],
    ["asset-assessment", "Asset Assessment", "usr/lib/holo/holo-atlas.js", "Inventory what you already have to reuse (Law L3 dedup): the κ corpus mapped by Holo Atlas."],
  ],
  focus: [
    ["market-definition", "Market Definition", null, "Define the specific market segment you will win — narrow enough to dominate."],
    ["distribution-strategy", "Distribution Strategy", "usr/lib/holo/holo-share-chrome.js", "Reach: distribution is a content-addressed link (holo://κ) — serverless, no app store, share-to-run."],
    ["product-portfolio", "Product Portfolio", "usr/lib/holo/holo-atlas.js", "Manage the whole portfolio of holospaces as one map (Holo Atlas) — by content truth, not popularity."],
    ["product-roadmap", "Product Roadmap", "etc/holo-product/product.uor.json", "Sequence the work themes-first; the Holo Product method (discover→deliver) is the cadence."],
  ],
  business: [
    ["business-plan", "Business Plan", null, "The case: the problem, the solution, the market, the model — why this is worth doing now."],
    ["pricing", "Pricing", "usr/lib/holo/holo-own.mjs", "Capture value: pricing settles against PROVEN work/ownership (Holo Own · Settle), human-approved (Law L4)."],
    ["buy-build-partner", "Buy, Build or Partner", "usr/lib/holo/holo-app.mjs", "Decide make-vs-reuse: compose by content address (build·run·share) — link an existing κ rather than rebuild."],
    ["product-profitability", "Product Profitability", "usr/lib/holo/holo-own.mjs", "Know the unit economics; value moves only through the verifiable Own/Settle rail, never a parallel ledger."],
    ["innovation", "Innovation", "usr/lib/holo/holo-app.mjs", "Create the new: a build is a re-derivable κ-transform (verifiable, serverless) — innovate without a server."],
  ],
  planning: [
    ["positioning", "Positioning", "etc/holo-product/product.uor.json", "Own a clear place in the buyer's mind; the product's look + experience are the canonical Holo Product foundation."],
    ["buyer-experience", "Buyer Experience", "etc/holo-ux/doctrine.uor.json", "Design the whole journey to value; the Holo UX doctrine makes it native, familiar, effortless (time-to-value ≈ 0)."],
    ["buyer-personas", "Buyer Personas", null, "Model who decides to buy (≠ the user). The PM's market expertise — no tool can own it."],
    ["user-personas", "User Personas", "usr/lib/holo/holo-capability.mjs", "Model who uses it; the experience meets the REAL user + device (capability tiers resolved, not assumed)."],
    ["requirements", "Requirements", "etc/holo-product/product.uor.json", "Capture market-driven requirements as a recorded decision (the Holo Product Define phase · DECISION.md/ADR)."],
    ["use-scenarios", "Use Scenarios", "usr/lib/holo/holo-voice.mjs", "Tell the story of use (why → how → what) in the plain voice — self-descriptive, jargon-free."],
    ["stakeholder-comm", "Stakeholder Comm.", "usr/lib/holo/holo-voice.mjs", "Communicate clearly to every stakeholder in the one plain register — signal over noise."],
  ],
  programs: [
    ["marketing-plan", "Marketing Plan", null, "The orchestrated plan of programs that takes the product to market."],
    ["revenue-growth", "Revenue Growth", "usr/lib/holo/holo-own.mjs", "Grow value via verifiable ownership + settlement (Own · Settle) — new title, real value."],
    ["revenue-retention", "Revenue Retention", "usr/lib/holo/holo-own.mjs", "Keep value: ownership is durable + self-verifying; a tampered title pays nothing."],
    ["launch", "Launch", "usr/lib/holo/holo-share-chrome.js", "Ship to the world: a shared link lands a guest LIVE in the running product (Holo Share-to-Run)."],
    ["awareness", "Awareness", "usr/lib/holo/holo-share-chrome.js", "Be discovered: the native loop is share-to-run-to-remix — every output carries 'Made on Hologram'."],
    ["nurturing", "Nurturing", "usr/lib/holo/holo-atlas.js", "Stay in the consideration set; the community map (Atlas) keeps products discoverable by content truth."],
    ["advocacy", "Advocacy", "usr/lib/holo/holo-share-chrome.js", "Turn users into advocates: one-tap Remix forks your work into theirs (verifiable PROV-O/Title lineage)."],
    ["measurement", "Measurement", "usr/lib/holo/holo-object.mjs", "Measure what matters and prove it: done is proven by re-derivation (verify the κ, Law L5) and the witnessed gate — evidence, not opinion."],
  ],
  enablement: [
    ["sales-alignment", "Sales Alignment", null, "Align sales + marketing + product on one message and one motion."],
    ["content", "Content", "usr/lib/holo/holo-scaffold.js", "Equip with content + ready products: the SDK scaffolder generates new holospaces on the foundation."],
    ["sales-tools", "Sales Tools", "usr/lib/holo/holo-sdk.js", "Give the channel working tools: the Holo SDK is the one front door (@hologram/sdk) every product binds."],
    ["channel-training", "Channel Training", null, "Train the channel to sell + support — the human enablement the PM drives."],
  ],
  support: [
    ["support-programs", "Programs", null, "Run the support programs that keep customers successful after the sale."],
    ["operations", "Operations", "usr/lib/holo/holo-conscience.js", "Keep it safe + within bounds: the fail-closed conscience gate admits only conformant, constitutional products."],
    ["events", "Events", null, "Engage the market through events + community moments."],
    ["channels", "Channels", null, "Manage the support + delivery channels the product reaches customers through."],
  ],
};

// flatten → the 37 activities, each tagged with its category.
export const ACTIVITIES = CATEGORIES.flatMap((c) => BOXES[c.id].map(([id, label, realizedBy, obligation]) => ({ id, cat: c.id, label, realizedBy, obligation })));

export const TOTAL = ACTIVITIES.length;                 // 37 (strict)
export const wiredActivities = () => ACTIVITIES.filter((a) => a.realizedBy);

// ── materialize the dereferenceable hospm: ontology + the SKOS framework scheme (ns/pm.jsonld) ──
const NS = "https://hologram.os/ns/pm";
export function toOntology() {
  const term = (id, type, label, comment, extra = {}) => ({ "@id": `hospm:${id}`, "@type": type, label, comment, isDefinedBy: NS, ...extra });
  return {
    "@context": {
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      owl: "http://www.w3.org/2002/07/owl#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      skos: "http://www.w3.org/2004/02/skos/core#",
      dcterms: "http://purl.org/dc/terms/",
      schema: "https://schema.org/",
      hospm: "https://hologram.os/ns/pm#",
      label: "rdfs:label", comment: "rdfs:comment",
      isDefinedBy: { "@id": "rdfs:isDefinedBy", "@type": "@id" },
      inScheme: { "@id": "skos:inScheme", "@type": "@id" },
      broader: { "@id": "skos:broader", "@type": "@id" },
      prefLabel: "skos:prefLabel", definition: "skos:definition",
      axis: "hospm:axis", facing: "hospm:facing", realizedBy: "hospm:realizedBy", obligation: "hospm:obligation",
    },
    "@id": NS,
    "@type": "owl:Ontology",
    label: "Hologram OS — Holo Product Manager framework (hospm:)",
    comment: "The canonical full-cycle product-management framework (ADR-0066), strictly adhering to the Pragmatic Framework — 37 activities in 7 categories. Mints only the new framework terms (Category · Activity · axis · facing · realizedBy · obligation); the Pragmatic categories + boxes are cited verbatim and each realizable activity is wired to the κ-object that executes it. Re-derived from holo-pm.mjs (no drift).",
    "dcterms:source": "https://www.pragmaticinstitute.com/product/framework/",
    "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
    "@graph": [
      term("Framework", "rdfs:Class", "PM Framework", "The full-cycle product-management framework.", { "@type": "rdfs:Class" }),
      term("Category", "rdfs:Class", "Framework Category", "One of the 7 Pragmatic categories (Market … Support).", { "rdfs:subClassOf": { "@id": "skos:Concept" } }),
      term("Activity", "rdfs:Class", "Framework Activity", "One of the 37 Pragmatic 'boxes' — a product-management activity.", { "rdfs:subClassOf": { "@id": "skos:Concept" } }),
      term("axis", "rdf:Property", "axis", "strategic | tactical — where the activity sits on the Pragmatic axis.", { range: "xsd:string" }),
      term("facing", "rdf:Property", "facing", "market | product — which way the activity faces.", { range: "xsd:string" }),
      term("realizedBy", "rdf:Property", "realized by", "The Hologram κ-object/tool that executes this activity, or absent when it is the PM's judgment.", {}),
      term("obligation", "rdf:Property", "obligation", "How the activity is done (the checkable rule, or the PM's responsibility).", { range: "xsd:string" }),
      { "@id": `${NS}#framework`, "@type": ["skos:ConceptScheme", "hospm:Framework"],
        prefLabel: "Holo Product Manager — the Pragmatic Framework on the substrate (ADR-0066)",
        comment: PRINCIPLE, "dcterms:source": "https://www.pragmaticinstitute.com/product/framework/",
        "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/" },
      ...CATEGORIES.map((c) => ({ "@id": `hospm:${c.id}`, "@type": ["skos:Concept", "hospm:Category"],
        prefLabel: c.label, definition: c.blurb, axis: c.axis, facing: c.facing, inScheme: `${NS}#framework` })),
      ...ACTIVITIES.map((a) => ({ "@id": `hospm:${a.id}`, "@type": ["skos:Concept", "hospm:Activity"],
        prefLabel: a.label, broader: `hospm:${a.cat}`, obligation: a.obligation,
        ...(a.realizedBy ? { realizedBy: a.realizedBy } : {}), inScheme: `${NS}#framework` })),
    ],
  };
}

if (typeof globalThis !== "undefined") globalThis.HoloPM = { PRINCIPLE, MANTRAS, CATEGORIES, ACTIVITIES, BOXES, TOTAL, wiredActivities, toOntology };
