// _shared/holo-resolve.js — Holo Resolve (ADR-037): the UNIVERSAL RESOLVER. The one search bar that
// turns ANY internet identifier or query into a self-verifying UOR object — a content-addressed window
// onto the open web's object universe. Type a paper (DOI), a book (ISBN), an entity (Wikidata Q-id or a
// name), a place (coords / a place name), a CID, an ENS name, a URL — and it resolves to one canonical,
// self-verifying linked-data node (did:holo, schema.org), no AI, no API keys, from any browser.
//
// This is a connector framework turned OUTWARD: the reference design normalised many private sources into one
// internal record; here every PUBLIC source normalises into the UOR object envelope the OS already
// speaks. The "intelligence" is federation + reconciliation + verification, not generation — which is
// why it needs no model, and is MORE trustworthy than one (every fact re-derives, Law L5).
//
// Pure + isomorphic (browser + Node). This module is the deterministic core: classify the input, and
// normalise a fetched response into canonical UOR props (a pure response→object function). The fetch
// (live, opt-in) and the UOR sealing live in holo-resolve.mjs (Node) / holo-object.js (browser); the
// content-addressed kinds (did:holo / κ / IPFS / Ethereum) delegate to the modules that already verify
// them (holo-object, holo-ipfs, holo-eth). Untrusted input is screened by the immune perimeter first.

import { assess } from "./holo-immune.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

// classify(input) → { kind, id }: a DETERMINISTIC classifier mapping any input to a resolver kind.
// Content-addressed kinds (holo/kappa/ipfs/eth-*) are already self-verifying and delegate to their
// engines; the open-data kinds resolve over public APIs; freetext is treated as an entity lookup.
export function classify(input) {
  const s = str(input).trim();
  if (!s) return { kind: "empty", id: "" };
  if (/^did:holo:sha256:[0-9a-f]{64}$/i.test(s)) return { kind: "holo", id: s };
  if (/^sha256:[0-9a-f]{64}$/i.test(s)) return { kind: "kappa", id: s };
  if (/^10\.\d{4,9}\/\S+$/.test(s)) return { kind: "doi", id: s };                        // a DOI
  const orcid = s.match(/^(?:https?:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dxX])$/);
  if (orcid) return { kind: "orcid", id: orcid[1].toUpperCase() };                         // an ORCID iD (bare or full URL)
  if (/^https?:\/\//i.test(s)) return { kind: "url", id: s };                             // a URL → mint a κ on fetch
  const isbn = s.replace(/[-\s]/g, "");
  if (/^(?:97[89])?\d{9}[\dxX]$/.test(isbn)) return { kind: "isbn", id: isbn };           // an ISBN-10/13
  if (/^Q\d+$/.test(s)) return { kind: "wikidata", id: s };                               // a Wikidata Q-id
  if (/^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(s)) return { kind: "geo", id: s.replace(/\s+/g, "") }; // lat,lon
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: "eth-address", id: s };
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return { kind: "eth-tx", id: s };
  if (/\.eth$/i.test(s)) return { kind: "ens", id: s.toLowerCase() };
  if (/^(bafy|bafk|Qm)[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s)) return { kind: "ipfs", id: s };
  if (/^@[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/.test(s)) return { kind: "activitypub", id: s.replace(/^@/, "") };  // a fediverse handle
  const gbif = s.match(/^gbif:(.+)$/i); if (gbif) return { kind: "gbif", id: gbif[1].trim() };                // a species (prefixed)
  const chem = s.match(/^chem:(.+)$/i); if (chem) return { kind: "pubchem", id: chem[1].trim() };             // a chemical (prefixed)
  const openalex = s.match(/^openalex:(.+)$/i); if (openalex) return { kind: "openalex", id: openalex[1].trim() };  // a scholarly work
  const pypi = s.match(/^pypi:(.+)$/i); if (pypi) return { kind: "pypi", id: pypi[1].trim() };                // a Python package
  const npm = s.match(/^npm:(.+)$/i); if (npm) return { kind: "npm", id: npm[1].trim() };                     // a JS package
  const mb = s.match(/^(?:mbid|music):(.+)$/i); if (mb) return { kind: "musicbrainz", id: mb[1].trim() };     // a music artist
  const country = s.match(/^country:(.+)$/i); if (country) return { kind: "country", id: country[1].trim() }; // a country
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) return { kind: "github", id: s };                         // an owner/repo
  if (/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(s)) return { kind: "dns", id: s.toLowerCase() };         // a domain (DNS / DNSLink)
  return { kind: "freetext", id: s };                                                     // a name / topic → entity lookup
}

// the resolver for a kind: the open-data kinds map to a public source; the content-addressed kinds
// delegate to an existing engine (no fetch, already self-verifying).
export const KIND_RESOLVER = { doi: "crossref", isbn: "openlibrary", wikidata: "wikidata", geo: "osm", freetext: "wikipedia",
  github: "github", gbif: "gbif", pubchem: "pubchem", dns: "dns", activitypub: "activitypub",
  orcid: "orcid", openalex: "openalex", pypi: "pypi", npm: "npm", musicbrainz: "musicbrainz", country: "restcountries" };
export const DELEGATED = { holo: "holo-object", kappa: "holo-object", ipfs: "holo-ipfs", "eth-address": "holo-eth", "eth-tx": "holo-eth", ens: "holo-eth", url: "browser-mint" };

// RESOLVERS — each open-data source: how to fetch it, and a PURE normalize(response, id) → canonical
// UOR props + a Wikidata reconcile key + related edges (the object graph). Mint nothing: every property
// is schema.org. normalize never fetches and is deterministic, so its output is content-addressable.
export const RESOLVERS = {
  wikipedia: {
    source: "Wikipedia (REST v1 summary)", schemaType: "schema:Article",
    endpoint: (title) => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, "_"))}`,
    normalize: (r) => ({
      props: { "schema:name": str(r.title), "schema:description": str(r.description), "schema:abstract": str(r.extract),
        "schema:url": str(r.content_urls?.desktop?.page), "schema:inLanguage": str(r.lang) },
      reconcile: r.wikibase_item || null, related: [],
    }),
  },
  wikidata: {
    source: "Wikidata (wbgetentities)", schemaType: "schema:Thing",
    endpoint: (id) => `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels%7Cdescriptions%7Caliases%7Csitelinks/urls&languages=en&format=json`,
    normalize: (r, id) => { const e = r.entities?.[id] || Object.values(r.entities || {})[0] || {}; return {
      props: { "schema:name": str(e.labels?.en?.value), "schema:description": str(e.descriptions?.en?.value),
        "schema:identifier": str(e.id), "schema:url": str(e.sitelinks?.enwiki?.url),
        "schema:alternateName": (e.aliases?.en || []).map((a) => str(a.value)).filter(Boolean) },
      reconcile: e.id || null, related: [] }; },
  },
  crossref: {
    source: "Crossref (works)", schemaType: "schema:ScholarlyArticle",
    endpoint: (doi) => `https://api.crossref.org/works/${doi}`,
    normalize: (r) => { const m = r.message || {}; const dp = (m.published?.["date-parts"] || m["published-print"]?.["date-parts"] || [[]])[0] || []; return {
      props: { "schema:name": str((m.title || [])[0]), "schema:datePublished": dp.join("-"),
        "schema:isPartOf": str((m["container-title"] || [])[0]), "schema:identifier": str(m.DOI),
        "schema:url": m.DOI ? `https://doi.org/${m.DOI}` : "",
        "schema:author": (m.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean) },
      reconcile: null,
      related: (m.reference || []).filter((x) => x.DOI).map((x) => ({ rel: "schema:citation", kind: "doi", id: x.DOI })) }; },
  },
  openlibrary: {
    source: "Open Library (ISBN)", schemaType: "schema:Book",
    endpoint: (isbn) => `https://openlibrary.org/isbn/${isbn}.json`,
    normalize: (r) => ({
      props: { "schema:name": str(r.title), "schema:datePublished": str(r.publish_date),
        "schema:numberOfPages": typeof r.number_of_pages === "number" ? r.number_of_pages : undefined,
        "schema:isbn": str((r.isbn_13 || [])[0]), "schema:url": r.works?.[0]?.key ? `https://openlibrary.org${r.works[0].key}` : "" },
      reconcile: null, related: [] }),
  },
  osm: {
    source: "OpenStreetMap (Nominatim)", schemaType: "schema:Place",
    endpoint: (q) => `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=1`,
    normalize: (r) => { const p = Array.isArray(r) ? r[0] || {} : r; return {
      props: { "schema:name": str(p.name || p.display_name), "schema:description": str(p.display_name),
        "schema:latitude": p.lat != null ? Number(p.lat) : undefined, "schema:longitude": p.lon != null ? Number(p.lon) : undefined,
        "schema:additionalType": str(p.type || p.category) },
      reconcile: null, related: [] }; },
  },
  github: {
    source: "GitHub (repositories)", schemaType: "schema:SoftwareSourceCode",
    endpoint: (id) => `https://api.github.com/repos/${id}`,
    normalize: (r) => ({ props: { "schema:name": str(r.full_name), "schema:description": str(r.description),
      "schema:url": str(r.html_url), "schema:programmingLanguage": str(r.language),
      "schema:author": [str(r.owner && (r.owner.login || r.owner))].filter(Boolean),
      "schema:license": str(r.license && (r.license.spdx_id || r.license)) }, reconcile: null, related: [] }),
  },
  gbif: {
    source: "GBIF (species)", schemaType: "schema:Thing",
    endpoint: (id) => `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(id)}`,
    normalize: (r) => ({ props: { "schema:name": str(r.scientificName || r.canonicalName),
      "schema:alternateName": [str(r.canonicalName)].filter(Boolean), "schema:additionalType": str(r.rank),
      "schema:description": [str(r.kingdom), str(r.rank)].filter(Boolean).join(" · "),
      "schema:identifier": r.usageKey != null ? String(r.usageKey) : "" }, reconcile: null, related: [] }),
  },
  pubchem: {
    source: "PubChem (compounds)", schemaType: "schema:ChemicalSubstance",
    endpoint: (id) => `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(id)}/property/MolecularFormula,IUPACName,MolecularWeight/JSON`,
    normalize: (r, id) => { const p = (r.PropertyTable && r.PropertyTable.Properties || [])[0] || {}; return {
      props: { "schema:name": str(p.IUPACName) || str(id), "schema:identifier": p.CID != null ? `CID ${p.CID}` : "",
        "schema:description": [str(p.MolecularFormula), p.MolecularWeight ? `${p.MolecularWeight} g/mol` : ""].filter(Boolean).join(" · "),
        "schema:url": p.CID != null ? `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}` : "" }, reconcile: null, related: [] }; },
  },
  dns: {
    source: "DNS over HTTPS (Google)", schemaType: "schema:Thing",
    endpoint: (id) => `https://dns.google/resolve?name=${encodeURIComponent(id)}&type=TXT`,
    normalize: (r, id) => { const txt = (r.Answer || []).map((a) => str(a.data).replace(/^"|"$/g, "")); const dnslink = txt.find((t) => /^dnslink=/.test(t)); return {
      props: { "schema:name": str(id), "schema:description": txt.slice(0, 3).join(" · ") || "(no TXT records)",
        ...(dnslink ? { "schema:url": dnslink.replace(/^dnslink=/, "") } : {}) }, reconcile: null, related: [] }; },
  },
  activitypub: {
    source: "ActivityPub (WebFinger)", schemaType: "schema:Person",
    endpoint: (id) => `https://${id.split("@")[1]}/.well-known/webfinger?resource=acct:${encodeURIComponent(id)}`,
    normalize: (r) => { const self = (r.links || []).find((l) => l.rel === "self"); return {
      props: { "schema:name": str(r.subject).replace(/^acct:/, ""), "schema:url": str(self && self.href), "schema:identifier": str(r.subject) }, reconcile: null, related: [] }; },
  },
  orcid: {
    source: "ORCID (researcher profiles)", schemaType: "schema:Person",
    endpoint: (id) => `https://pub.orcid.org/v3.0/${id}/person`,
    normalize: (r, id) => { const nm = r.name || {}; const given = str(nm["given-names"]?.value), family = str(nm["family-name"]?.value);
      const name = str(nm["credit-name"]?.value) || [given, family].filter(Boolean).join(" "); return {
      props: { "schema:name": name || str(id), "schema:givenName": given, "schema:familyName": family,
        "schema:identifier": str(id), "schema:url": `https://orcid.org/${id}` }, reconcile: null, related: [] }; },
  },
  openalex: {
    source: "OpenAlex (scholarly works)", schemaType: "schema:ScholarlyArticle",
    endpoint: (id) => `https://api.openalex.org/works/${id}?select=id,doi,display_name,publication_year,primary_location,authorships`,
    normalize: (r) => ({ props: { "schema:name": str(r.display_name),
      "schema:datePublished": r.publication_year != null ? String(r.publication_year) : "",
      "schema:isPartOf": str(r.primary_location?.source?.display_name), "schema:identifier": str(r.id),
      "schema:url": str(r.doi || r.id), "schema:author": (r.authorships || []).map((a) => str(a.author?.display_name)).filter(Boolean) },
      reconcile: null, related: [] }),
  },
  pypi: {
    source: "PyPI (Python packages)", schemaType: "schema:SoftwareApplication",
    endpoint: (id) => `https://pypi.org/pypi/${id}/json`,
    normalize: (r) => { const i = r.info || {}; const pu = i.project_urls || {}; return {
      props: { "schema:name": str(i.name), "schema:description": str(i.summary), "schema:softwareVersion": str(i.version),
        "schema:url": str(i.home_page || pu.Homepage || pu.Documentation || pu.Source),
        "schema:author": [str(i.author)].filter(Boolean), "schema:license": str(i.license) }, reconcile: null, related: [] }; },
  },
  npm: {
    source: "npm (JavaScript packages)", schemaType: "schema:SoftwareSourceCode",
    endpoint: (id) => `https://registry.npmjs.org/${id}/latest`,
    normalize: (r) => ({ props: { "schema:name": str(r.name), "schema:description": str(r.description),
      "schema:softwareVersion": str(r.version), "schema:url": str(r.homepage), "schema:license": str(r.license),
      "schema:author": [str(r.author && (r.author.name || r.author))].filter(Boolean) }, reconcile: null, related: [] }),
  },
  musicbrainz: {
    source: "MusicBrainz (music)", schemaType: "schema:MusicGroup",
    endpoint: (id) => `https://musicbrainz.org/ws/2/artist/${id}?fmt=json`,
    normalize: (r, id) => { const ls = r["life-span"] || {}; return {
      props: { "schema:name": str(r.name), "schema:description": str(r.disambiguation), "schema:additionalType": str(r.type),
        "schema:identifier": str(r.id || id), "schema:url": `https://musicbrainz.org/artist/${r.id || id}`,
        "schema:foundingDate": str(ls.begin), ...(ls.ended ? { "schema:dissolutionDate": str(ls.end) } : {}) }, reconcile: null, related: [] }; },
  },
  restcountries: {
    source: "REST Countries", schemaType: "schema:Country",
    endpoint: (id) => /^[A-Za-z]{2,3}$/.test(String(id)) ? `https://restcountries.com/v3.1/alpha/${id}` : `https://restcountries.com/v3.1/name/${encodeURIComponent(id)}`,
    normalize: (r) => { const c = Array.isArray(r) ? r[0] || {} : r; const cap = (c.capital || [])[0]; return {
      props: { "schema:name": str(c.name?.common), "schema:alternateName": [str(c.name?.official), str(c.cca2)].filter(Boolean),
        "schema:description": [str(c.region), str(c.subregion), cap ? `capital ${cap}` : "", c.population != null ? `pop ${c.population}` : ""].filter(Boolean).join(" · "),
        "schema:identifier": str(c.cca3) }, reconcile: null, related: [] }; },
  },
};

// reconcileKey(obj) → the canonical Wikidata Q-id an object reconciles to (from schema:sameAs), or null.
// sameEntity(a,b): two objects from DIFFERENT sources are the SAME entity iff they reconcile to one Q-id
// — the open web's universal join (entity resolution — the unified-model idea — as an open standard).
export const reconcileKey = (obj) => { const m = String(obj?.["schema:sameAs"] || "").match(/Q\d+$/); return m ? m[0] : null; };
export const sameEntity = (a, b) => { const k = reconcileKey(a); return !!k && k === reconcileKey(b); };

// screen(input) → the perimeter verdict over the untrusted query, BEFORE it is resolved (the immune
// layer governs the resolver's input). Observe-only by default (records, never blocks).
export const screen = (input, opts = {}) => assess(str(input), opts);

if (typeof window !== "undefined") window.HoloResolve = { classify, KIND_RESOLVER, DELEGATED, RESOLVERS, reconcileKey, sameEntity, screen };
