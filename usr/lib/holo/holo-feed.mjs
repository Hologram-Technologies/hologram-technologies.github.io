// holo-feed.mjs — Stage-9: THE SOVEREIGN FEED, composed (not invented). A social network where your posts live
// on YOUR signed source chain, distribute peer-to-peer with no server, and you see a verified, chronological feed
// of people you follow. It adds NO engine — it is a thin layer of verbs over what already exists:
//   • a POST     = an ad4m Expression (content-addressed, idempotent: same content ⇒ same κ) + a "posted" Link on
//                  your Perspective (a holo-strand). Authorship + time live on the LINK (signed by you, on your chain).
//   • FOLLOW/LIKE/REPOST = Links {you, predicate, target} on your chain.
//   • DISTRIBUTION = an ad4m Neighbourhood (the VERIFIED UNION of members' strands — verify-before-adopt, no server,
//                    no DHT, no consensus). Your feed = the "posted" Links whose author is you or someone you follow.
//   • DELETE     = a tombstone (removeLink) — your peers honour it; history stays intact (append-only).
//
// NO engagement algorithm, NO ads, NO ranking-for-time-on-app: the default order is CHRONOLOGICAL. Any reordering
// is the caller's on-device Q, transparent and optional. Content resolves by κ from the substrate (the Neighbourhood
// carries the signed Links; the content κ is fetched from the shared κ-store — modelled here by ad4m's store).
//
// makeFeed({ ad4m, perspective, neighbourhood, me, now }) → the feed verbs. Pure composition; node-testable.

export function makeFeed({ ad4m, perspective, neighbourhood = null, me, now = () => "1970-01-01T00:00:00Z" } = {}) {
  if (!ad4m || !perspective || !me) throw new Error("makeFeed needs { ad4m, perspective, me }");
  const surface = neighbourhood || perspective;                 // writes always go to YOUR perspective (neighbourhood.addLink == perspective.addLink)
  const allLinks = () => (neighbourhood ? neighbourhood.sharedLinks() : perspective.links());   // the merged graph (you + everyone you've adopted)

  // POST → seal the content as an Expression (its url IS its κ), then record "you posted it, now" on your chain.
  async function post(content = {}) {
    const data = { type: "holo:post", kind: content.kind || "post", text: content.text || "", media: content.media || null, link: content.link || null, at: now() };
    const { url } = ad4m.createExpression("literal", data);     // idempotent, content-addressed
    const rec = await surface.addLink({ source: me, predicate: "posted", target: url });
    return { post: url, link: rec.kappa };                      // post κ (content) + link κ (for delete)
  }
  const follow = (agentKappa) => surface.addLink({ source: me, predicate: "follows", target: agentKappa });
  const like = (postKappa) => surface.addLink({ source: me, predicate: "likes", target: postKappa });
  const repost = (postKappa) => surface.addLink({ source: me, predicate: "reposted", target: postKappa });
  const unfollow = (followLinkKappa) => perspective.removeLink(followLinkKappa);   // tombstone the follows-Link
  const remove = (postedLinkKappa) => perspective.removeLink(postedLinkKappa);     // delete your post (tombstone)

  // who you follow (your own follows-Links only — following is YOUR choice, not adopted from peers)
  function following() { const s = new Set(); for (const l of allLinks()) if (l.predicate === "follows" && l.author === me) s.add(l.target); return s; }

  // FEED — the verified, chronological merge of posts by you + the people you follow.
  function feed({ limit = 100, includeSelf = true, audience = null } = {}) {
    // With a Neighbourhood (the merged P2P graph), gate posts to you + people you follow. WITHOUT one (your own
    // single-user perspective), every "posted" Link is yours by definition → show them all (also survives the
    // per-load ephemeral key, where an old post's author κ differs from the current `me`).
    const localOnly = !neighbourhood;
    const aud = audience ? new Set(audience) : following(); if (includeSelf) aud.add(me);
    const likes = new Map(), reposts = new Map();
    for (const l of allLinks()) {
      if (l.predicate === "likes") likes.set(l.target, (likes.get(l.target) || 0) + 1);
      else if (l.predicate === "reposted") reposts.set(l.target, (reposts.get(l.target) || 0) + 1);
    }
    const seen = new Set(), out = [];
    for (const l of allLinks()) {
      if (l.predicate !== "posted" || (!localOnly && !aud.has(l.author))) continue;   // gate only applies on a merged feed
      if (seen.has(l.kappa)) continue; seen.add(l.kappa);
      const expr = ad4m.getExpression(l.target);                       // resolve content by κ (Law L5 — verified or null)
      if (!expr) continue;
      const d = expr["ad4m:data"] || {};
      out.push({ kappa: l.target, link: l.kappa, author: l.author, at: l.at, kind: d.kind, text: d.text, media: d.media, url: d.link, likes: likes.get(l.target) || 0, reposts: reposts.get(l.target) || 0 });
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.kappa).localeCompare(String(a.kappa)));   // chronological (newest first), deterministic tiebreak
    return out.slice(0, limit);
  }
  const myPosts = () => feed({ includeSelf: true, audience: [me] });

  return { post, follow, unfollow, like, repost, remove, feed, myPosts, following };
}
