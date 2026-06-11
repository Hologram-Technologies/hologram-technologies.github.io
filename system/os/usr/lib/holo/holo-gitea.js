// holo-gitea.js — the Gitea API layer of the Holo Git holospace.
//
// One client surface, two interchangeable backends (the idiom of holo-jellyfin's
// native()/server() and holo-subsonic):
//
//   • native(...)  — a complete, serverless forge that runs ENTIRELY in the browser:
//       code  → holo-git objects in the κ-store (content-addressed, deduped, L5).
//       forge → issues · pull requests · reviews · comments · labels · releases ·
//               stars, as a convergent CvRDT (LWW map + ordered RGA over holo-collab),
//               so many users edit the SAME forge live with no server and no conflicts.
//       refs  → mutable name→κ pointers, themselves convergent (last-writer-wins).
//     Everything moves over the repo's content-blind κ pub/sub — clone/fetch/push is
//     "fetch the reachable oids I lack" (holo-git transfer); the relay sees only
//     ciphertext on an unguessable topic.
//
//   • server(baseUrl, token) — a faithful CLIENT of the real Gitea REST API v1
//     (Authorization: token …). The SAME UI therefore also drives a live Gitea
//     instance — proof the native backend conforms to Gitea's actual contract, not a
//     look-alike. Endpoints below are Gitea's documented Swagger routes.
//
// Both return Gitea-shaped objects (Repository · User · Branch · Commit ·
// ContentsResponse · GitTreeResponse · Issue · Comment · PullRequest · Label ·
// Release), so the UI and the witness treat them identically.
//
// Depends only on holo-git.js (+ holo-collab.js when a live session is supplied).
// Pure, dependency-free; runs in the browser and in the Node witness.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloGitea) return;
  const HoloGit = G.HoloGit || (typeof require !== "undefined" ? require("./holo-git.js") : null);

  const te = new TextEncoder(), td = new TextDecoder();
  const nowISO = () => new Date().toISOString();
  const rid = () => (G.crypto && G.crypto.getRandomValues ? Array.from(G.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("") : Math.random().toString(16).slice(2));
  const b64encode = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const b64decode = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  // ── tiny convergent document store (the forge's metadata layer) ─────────────────
  // A `db` is { kv, seq } over named collections. memDb is pure/in-memory (+optional
  // localStorage); collabDb maps the same calls onto a holo-collab Session so every
  // mutation is a sealed, content-addressed CvRDT delta that converges across peers.
  function memDb(persistKey) {
    const data = { kv: {}, order: {} };
    const load = () => { try { if (persistKey && G.localStorage) Object.assign(data, JSON.parse(G.localStorage.getItem(persistKey) || "{}")); } catch {} };
    const save = () => { try { if (persistKey && G.localStorage) G.localStorage.setItem(persistKey, JSON.stringify(data)); } catch {} };
    load();
    const ck = (c, id) => c + "/" + id;
    return {
      backend: "mem",
      get: (c, id) => data.kv[ck(c, id)] || null,
      put: (c, id, obj) => { data.kv[ck(c, id)] = obj; save(); return obj; },
      patch: (c, id, fields) => { const o = data.kv[ck(c, id)] || {}; Object.assign(o, fields); data.kv[ck(c, id)] = o; save(); return o; },
      del: (c, id) => { delete data.kv[ck(c, id)]; save(); },
      list: (c) => Object.entries(data.kv).filter(([k]) => k.startsWith(c + "/")).map(([, v]) => v),
      append: (seqName, obj) => { (data.order[seqName] = data.order[seqName] || []).push(obj); save(); return obj; },
      seq: (seqName) => (data.order[seqName] || []).slice(),
      onchange: () => {},
    };
  }
  // collab-backed db: kv → LWWMap "forge"; ordered lists → RGA per seqName.
  function collabDb(session, onchange) {
    const ck = (c, id) => c + "/" + id;
    return {
      backend: "collab", session,
      get: (c, id) => session.val("forge", ck(c, id)) || null,
      put: (c, id, obj) => { session.set("forge", ck(c, id), obj); return obj; },
      patch: (c, id, fields) => { const o = { ...(session.val("forge", ck(c, id)) || {}), ...fields }; session.set("forge", ck(c, id), o); return o; },
      del: (c, id) => session.set("forge", ck(c, id), null),
      list: (c) => session.mapKeys("forge").filter((k) => k.startsWith(c + "/")).map((k) => session.val("forge", k)).filter((v) => v),
      append: (seqName, obj) => { session.insert("seq:" + seqName, session.seqVals("seq:" + seqName).length, [obj]); return obj; },
      seq: (seqName) => session.seqVals("seq:" + seqName),
      onchange: onchange || (() => {}),
    };
  }

  // ── Gitea shape builders ─────────────────────────────────────────────────────────
  const userShape = (u) => ({ id: u.id || u.login, login: u.login, full_name: u.full_name || u.name || u.login, email: u.email || "", avatar_url: u.avatar_url || "", login_name: u.login });
  function repoShape(r) {
    return {
      id: r.id, name: r.name, full_name: r.owner + "/" + r.name, owner: userShape({ login: r.owner, full_name: r.ownerFull || r.owner }),
      description: r.description || "", empty: !!r.empty, private: !!r.private, fork: !!r.fork, mirror: false,
      default_branch: r.default_branch || "main", html_url: r.html_url || `holo://repo/${r.owner}/${r.name}`,
      clone_url: r.clone_url || `holo://repo/${r.owner}/${r.name}.git`, ssh_url: "",
      created_at: r.created_at || nowISO(), updated_at: r.updated_at || nowISO(),
      stars_count: r.stars_count || 0, forks_count: r.forks_count || 0, watchers_count: r.watchers_count || 0,
      open_issues_count: r.open_issues_count || 0, open_pr_counter: r.open_pr_counter || 0, size: r.size || 0,
      object_format_name: r.algo || "sha256", topics: r.topics || [], holo: r.holo || null,
    };
  }
  const personFromSig = (s) => ({ name: s.name, email: s.email, date: new Date((s.when || 0) * 1000).toISOString() });
  function commitShape(owner, repo, oid, c) {
    const author = c.author ? personFromSig(c.author) : null, committer = c.committer ? personFromSig(c.committer) : null;
    return {
      sha: oid, url: `holo://repo/${owner}/${repo}/commit/${oid}`, html_url: `holo://repo/${owner}/${repo}/commit/${oid}`,
      commit: { message: c.message || "", tree: { sha: c.tree }, author, committer },
      author: author ? userShape({ login: author.name, full_name: author.name, email: author.email }) : null,
      committer: committer ? userShape({ login: committer.name, full_name: committer.name, email: committer.email }) : null,
      parents: (c.parents || []).map((p) => ({ sha: p })),
    };
  }
  const issueShape = (i) => ({
    id: i.id, number: i.number, title: i.title, body: i.body || "", state: i.state || "open",
    user: userShape(i.user || { login: i.author || "anon" }), labels: i.labels || [], assignees: i.assignees || [],
    milestone: i.milestone || null, comments: i.comments || 0, created_at: i.created_at, updated_at: i.updated_at || i.created_at,
    closed_at: i.closed_at || null, pull_request: i.pull_request || null,
    html_url: i.html_url || "",
  });
  const commentShape = (c) => ({ id: c.id, body: c.body, user: userShape(c.user || { login: c.author || "anon" }), created_at: c.created_at, updated_at: c.updated_at || c.created_at, html_url: c.html_url || "" });
  const labelShape = (l) => ({ id: l.id, name: l.name, color: l.color || "#cccccc", description: l.description || "", url: "" });
  const prShape = (p) => ({
    ...issueShape(p), merged: !!p.merged, mergeable: p.mergeable !== false, merged_at: p.merged_at || null,
    head: p.head || null, base: p.base || null, diff_url: "", patch_url: "", comments: p.comments || 0,
    additions: p.additions || 0, deletions: p.deletions || 0, changed_files: p.changed_files || 0,
    draft: !!p.draft, merge_commit_sha: p.merge_commit_sha || null, merged_by: p.merged_by || null, merge_method: p.merge_method || null,
  });
  const releaseShape = (r) => ({ id: r.id, tag_name: r.tag_name, target_commitish: r.target || "main", name: r.name || r.tag_name, body: r.body || "", draft: !!r.draft, prerelease: !!r.prerelease, created_at: r.created_at, published_at: r.published_at || r.created_at, author: userShape(r.user || { login: "anon" }) });
  const reviewShape = (r) => ({ id: r.id, user: userShape(r.user || { login: r.author || "anon" }), state: r.state || "COMMENT", body: r.body || "", commit_id: r.commit_id || "", submitted_at: r.created_at });
  const milestoneShape = (m) => ({ id: m.id, title: m.title, description: m.description || "", state: m.state || "open", due_on: m.due_on || null, open_issues: m.open_issues || 0, closed_issues: m.closed_issues || 0 });

  // ─────────────────────────────────────────────────────────────────────────────────
  // NATIVE BACKEND — a serverless, content-addressed Gitea, in the browser.
  // ─────────────────────────────────────────────────────────────────────────────────
  function native(opts = {}) {
    const db = opts.db || memDb(opts.persistKey || "holo-git-forge");
    const algo = opts.algo || "sha256";
    const store = opts.store || new HoloGit.KStore({ algo, sync: opts.sync, topic: opts.topic, dir: opts.dir || "holo-git" });
    const user = userShape(opts.user || { login: "you", full_name: "You" });
    const repoCache = new Map();           // repoId → HoloGit.Repo (refs hydrated from db)
    const refKey = (repoId, name) => repoId + ":" + name;

    const repoId = (owner, name) => owner + "/" + name;
    const getRepoRec = (owner, name) => db.get("repos", repoId(owner, name));

    async function gitRepo(owner, name) {
      const rec = getRepoRec(owner, name); if (!rec) throw new Error("repo not found: " + repoId(owner, name));
      const id = rec.id; let r = repoCache.get(id);
      if (!r) { r = new HoloGit.Repo({ algo: rec.algo || algo, store, name }); r.setHeadBranch(rec.default_branch || "main"); repoCache.set(id, r); }
      // hydrate refs from db (they are the convergent source of truth)
      r.refs.clear();
      for (const ref of db.list("refs")) if (ref && ref.repoId === id) r.setRef(ref.name, ref.oid);
      return { r, rec };
    }
    const saveRef = (id, name, oid) => db.put("refs", refKey(id, name), { repoId: id, name, oid, updated_at: nowISO() });

    function recount(rec) {
      const issues = db.list("issues").filter((i) => i.repoId === rec.id);
      rec.open_issues_count = issues.filter((i) => !i.pull_request && i.state === "open").length;
      rec.open_pr_counter = issues.filter((i) => i.pull_request && i.state === "open").length;
      db.put("repos", rec.id, rec);
    }

    return {
      backend: "native", db, store, user, algo,
      async me() { return user; },

      async listRepos() { return db.list("repos").map(repoShape).sort((a, b) => (b.updated_at < a.updated_at ? -1 : 1)); },
      async getRepo(owner, name) { const r = getRepoRec(owner, name); return r ? repoShape(r) : null; },
      async searchRepos(q) { q = (q || "").toLowerCase(); return (await this.listRepos()).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q)); },

      async createRepo(o) {
        const owner = o.owner || user.login, name = o.name; const id = repoId(owner, name);
        if (getRepoRec(owner, name)) throw new Error("repo already exists");
        const rec = { id, owner, ownerFull: user.full_name, name, description: o.description || "", private: !!o.private, default_branch: o.default_branch || "main", algo: o.algo || algo, created_at: nowISO(), updated_at: nowISO(), empty: true, stars_count: 0 };
        db.put("repos", id, rec);
        if (o.auto_init) {
          const r = new HoloGit.Repo({ algo: rec.algo, store, name }); r.setHeadBranch(rec.default_branch);
          const readme = `# ${name}\n\n${o.description || ""}\n`;
          const oid = await r.commit(rec.default_branch, { "README.md": te.encode(readme) }, { message: "Initial commit", author: { name: user.full_name, email: user.email || (user.login + "@holo") } });
          repoCache.set(id, r); saveRef(id, "refs/heads/" + rec.default_branch, oid); rec.empty = false; db.put("repos", id, rec);
        }
        return repoShape(rec);
      },
      async deleteRepo(owner, name) { const id = repoId(owner, name); db.del("repos", id); for (const ref of db.list("refs")) if (ref.repoId === id) db.del("refs", refKey(id, ref.name)); return true; },
      async setStar(owner, name, on) { const rec = getRepoRec(owner, name); if (!rec) return; rec.stars_count = Math.max(0, (rec.stars_count || 0) + (on ? 1 : -1)); rec.starred = on; db.put("repos", rec.id, rec); db.onchange(); return repoShape(rec); },
      async setWatch(owner, name, on) { const rec = getRepoRec(owner, name); if (!rec) return; rec.watchers_count = Math.max(0, (rec.watchers_count || 0) + (on ? 1 : -1)); rec.watching = on; db.put("repos", rec.id, rec); db.onchange(); return repoShape(rec); },
      async setTopics(owner, name, topics) { const rec = getRepoRec(owner, name); if (!rec) return; rec.topics = topics; db.put("repos", rec.id, rec); db.onchange(); return repoShape(rec); },
      async fork(owner, name) {
        const src = getRepoRec(owner, name); if (!src) throw new Error("repo not found");
        if (getRepoRec(user.login, name)) throw new Error("you already have a repo named " + name);
        const manifest = await this.repoRefsManifest(owner, name);
        const r = await this.clone(owner, name, manifest, { owner: user.login, name, description: src.description, default_branch: src.default_branch });
        const rec = getRepoRec(user.login, name); rec.fork = true; rec.parent = src.id; db.put("repos", rec.id, rec);
        src.forks_count = (src.forks_count || 0) + 1; db.put("repos", src.id, src); db.onchange(); return repoShape(rec);
      },

      // ── git data ────────────────────────────────────────────────────────────────
      async listBranches(owner, name) {
        const { r } = await gitRepo(owner, name);
        return Promise.all(r.branches().map(async (b) => { const c = await r.readCommit(b.oid); return { name: b.name, commit: { id: b.oid, message: c ? c.message : "" }, protected: false }; }));
      },
      async listTags(owner, name) {
        const { r } = await gitRepo(owner, name);
        return r.tags().map((t) => ({ name: t.name, id: t.oid, commit: { sha: t.oid } }));
      },
      async resolveRef(owner, name, ref) {
        const { r } = await gitRepo(owner, name);
        return r.getRef("refs/heads/" + ref) || r.getRef("refs/tags/" + ref) || (/^[0-9a-f]{7,64}$/.test(ref || "") ? ref : null) || r.resolveHead();
      },
      async getCommit(owner, name, sha) { const { r } = await gitRepo(owner, name); const c = await r.readCommit(sha); return c ? commitShape(owner, name, sha, c) : null; },
      async listCommits(owner, name, q = {}) {
        const { r, rec } = await gitRepo(owner, name);
        const tip = q.sha ? await this.resolveRef(owner, name, q.sha) : r.getRef("refs/heads/" + rec.default_branch);
        if (!tip) return []; const log = await r.log(tip, q.limit || 50);
        return log.map((c) => commitShape(owner, name, c.oid, c));
      },
      async getTree(owner, name, sha, q = {}) {
        const { r } = await gitRepo(owner, name);
        let treeOid = sha; const t = await r.objectType(sha);
        if (t === "commit") treeOid = (await r.readCommit(sha)).tree;
        if (q.recursive) {
          const flat = await r.listTree(treeOid);
          const tree = Object.entries(flat).map(([path, e]) => ({ path, mode: e.mode, type: "blob", sha: e.oid, size: 0 }));
          return { sha: treeOid, tree, truncated: false };
        }
        const entries = await r.readTree(treeOid) || [];
        return { sha: treeOid, tree: entries.map((e) => ({ path: e.name, mode: e.mode, type: e.type, sha: e.oid })), truncated: false };
      },
      // GET /repos/{o}/{r}/contents/{path} — a file (base64) or a dir listing.
      async getContents(owner, name, path, q = {}) {
        const { r, rec } = await gitRepo(owner, name);
        const tip = await this.resolveRef(owner, name, q.ref || rec.default_branch); if (!tip) return null;
        const commit = await r.readCommit(tip); if (!commit) return null;
        const entry = path ? await r.pathEntry(commit.tree, path) : { mode: HoloGit.MODE.tree, oid: commit.tree, type: "tree", name: "" };
        if (!entry) return null;
        if (entry.type === "tree") {
          const entries = await r.readTree(entry.oid) || [];
          return entries.map((e) => ({ name: e.name, path: (path ? path + "/" : "") + e.name, sha: e.oid, type: e.mode === HoloGit.MODE.tree ? "dir" : "file", size: 0, encoding: null, content: null }));
        }
        const bytes = await r.readBlob(entry.oid) || new Uint8Array();
        return { name: path.split("/").pop(), path, sha: entry.oid, type: "file", size: bytes.length, encoding: "base64", content: b64encode(bytes) };
      },
      async getRaw(owner, name, path, q = {}) {
        const c = await this.getContents(owner, name, path, q);
        return c && c.encoding === "base64" ? b64decode(c.content) : null;
      },
      // PUT /repos/{o}/{r}/contents/{path} — create/update a file (a real commit).
      async putContents(owner, name, path, o) {
        const { r, rec } = await gitRepo(owner, name); const branch = o.branch || rec.default_branch;
        const content = o.contentBytes || (o.content != null ? b64decode(o.content) : te.encode(o.text || ""));
        const oid = await r.commit(branch, { [path]: content }, { message: o.message || `Update ${path}`, author: { name: (o.author && o.author.name) || user.full_name, email: (o.author && o.author.email) || user.email || user.login + "@holo" } });
        saveRef(rec.id, "refs/heads/" + branch, r.getRef("refs/heads/" + branch)); rec.empty = false; rec.updated_at = nowISO(); db.put("repos", rec.id, rec);
        const commit = await r.readCommit(oid);
        return { content: await this.getContents(owner, name, path, { ref: branch }), commit: commitShape(owner, name, oid, commit) };
      },
      async deleteContents(owner, name, path, o = {}) {
        const { r, rec } = await gitRepo(owner, name); const branch = o.branch || rec.default_branch;
        const oid = await r.commit(branch, { [path]: null }, { message: o.message || `Delete ${path}`, author: { name: user.full_name, email: user.email || user.login + "@holo" } });
        saveRef(rec.id, "refs/heads/" + branch, oid); return { commit: commitShape(owner, name, oid, await r.readCommit(oid)) };
      },
      async createBranch(owner, name, newName, from) {
        const { r, rec } = await gitRepo(owner, name); const src = await this.resolveRef(owner, name, from || rec.default_branch);
        if (!src) throw new Error("source ref not found"); r.setRef("refs/heads/" + newName, src); saveRef(rec.id, "refs/heads/" + newName, src);
        db.onchange(); return { name: newName, commit: { id: src } };
      },
      async deleteBranch(owner, name, branch) { const { r, rec } = await gitRepo(owner, name); if (branch === rec.default_branch) throw new Error("cannot delete the default branch"); r.deleteRef("refs/heads/" + branch); db.del("refs", refKey(rec.id, "refs/heads/" + branch)); db.onchange(); return true; },
      async deleteTag(owner, name, tag) { const { r, rec } = await gitRepo(owner, name); r.deleteRef("refs/tags/" + tag); db.del("refs", refKey(rec.id, "refs/tags/" + tag)); db.onchange(); return true; },
      async fileHistory(owner, name, path, q = {}) {
        const { r, rec } = await gitRepo(owner, name); const tip = await this.resolveRef(owner, name, q.ref || rec.default_branch); if (!tip) return [];
        return (await r.logByPath(tip, path, q.limit || 50)).map((c) => commitShape(owner, name, c.oid, c));
      },
      async createTag(owner, name, tag, target, message) {
        const { r, rec } = await gitRepo(owner, name); const oid = await this.resolveRef(owner, name, target || rec.default_branch);
        if (message) { const tagOid = await r.writeTag({ object: oid, type: "commit", tag, tagger: { name: user.full_name, email: user.email || user.login + "@holo" }, message }); r.setRef("refs/tags/" + tag, tagOid); saveRef(rec.id, "refs/tags/" + tag, tagOid); return { name: tag, id: tagOid }; }
        r.setRef("refs/tags/" + tag, oid); saveRef(rec.id, "refs/tags/" + tag, oid); return { name: tag, id: oid };
      },

      // ── issues ────────────────────────────────────────────────────────────────────
      _nextNumber(repoRec) { repoRec.counter = (repoRec.counter || 0) + 1; db.put("repos", repoRec.id, repoRec); return repoRec.counter; },
      async listIssues(owner, name, q = {}) {
        const rec = getRepoRec(owner, name); if (!rec) return [];
        let arr = db.list("issues").filter((i) => i.repoId === rec.id && !i.pull_request);
        if (q.state && q.state !== "all") arr = arr.filter((i) => i.state === q.state);
        if (q.q) arr = arr.filter((i) => (i.title + " " + (i.body || "")).toLowerCase().includes(q.q.toLowerCase()));
        if (q.labels) { const want = (Array.isArray(q.labels) ? q.labels : String(q.labels).split(",")).filter(Boolean); if (want.length) arr = arr.filter((i) => (i.labels || []).some((l) => want.includes(l.name))); }
        if (q.milestone) arr = arr.filter((i) => i.milestone && i.milestone.title === q.milestone);
        const sort = q.sort || "newest";
        arr.sort((a, b) => sort === "oldest" ? a.number - b.number : sort === "mostcomment" ? (b.comments || 0) - (a.comments || 0) : sort === "recentupdate" ? (a.updated_at < b.updated_at ? 1 : -1) : b.number - a.number);
        return arr.map(issueShape);
      },
      async getIssue(owner, name, number) { const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); return i ? (i.pull_request ? prShape(i) : issueShape(i)) : null; },
      async createIssue(owner, name, o) {
        const rec = getRepoRec(owner, name); const number = this._nextNumber(rec); const id = rid();
        const i = { id, repoId: rec.id, number, title: o.title, body: o.body || "", state: "open", author: user.login, user, labels: o.labels || [], comments: 0, created_at: nowISO(), updated_at: nowISO() };
        db.put("issues", id, i); recount(rec); db.onchange(); return issueShape(i);
      },
      async editIssue(owner, name, number, fields) {
        const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return null;
        Object.assign(i, fields, { updated_at: nowISO() }); if (fields.state === "closed") i.closed_at = nowISO();
        if (i.pull_request && "title" in fields) i.draft = /^\s*(WIP:|\[WIP\])/i.test(i.title || "");   // Gitea recomputes draft from the title
        db.put("issues", i.id, i); recount(rec); db.onchange(); return i.pull_request ? prShape(i) : issueShape(i);
      },
      async listComments(owner, name, number) {
        const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return [];
        return db.seq("comments:" + i.id).map(commentShape);
      },
      async createComment(owner, name, number, body) {
        const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return null;
        const c = { id: rid(), body, author: user.login, user, created_at: nowISO() };
        db.append("comments:" + i.id, c); i.comments = (i.comments || 0) + 1; i.updated_at = nowISO(); db.put("issues", i.id, i); db.onchange();
        return commentShape(c);
      },

      // ── labels ──────────────────────────────────────────────────────────────────
      async listLabels(owner, name) { const rec = getRepoRec(owner, name); return db.list("labels").filter((l) => l.repoId === rec.id).map(labelShape); },
      async createLabel(owner, name, o) { const rec = getRepoRec(owner, name); const l = { id: rid(), repoId: rec.id, name: o.name, color: o.color || "#cccccc", description: o.description || "" }; db.put("labels", l.id, l); db.onchange(); return labelShape(l); },
      async updateLabel(owner, name, id, fields) { const l = db.get("labels", id); if (!l) return null; Object.assign(l, fields); db.put("labels", id, l); db.onchange(); return labelShape(l); },
      async deleteLabel(owner, name, id) { const rec = getRepoRec(owner, name); db.del("labels", id); for (const i of db.list("issues")) if (i.repoId === rec.id && (i.labels || []).some((x) => x.id === id)) { i.labels = i.labels.filter((x) => x.id !== id); db.put("issues", i.id, i); } db.onchange(); return true; },
      async setIssueLabels(owner, name, number, labelIds) { const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return null; const all = db.list("labels").filter((l) => l.repoId === rec.id); i.labels = all.filter((l) => labelIds.includes(l.id)).map(labelShape); i.updated_at = nowISO(); db.put("issues", i.id, i); db.onchange(); return (i.pull_request ? prShape : issueShape)(i); },
      async setAssignees(owner, name, number, logins) { const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return null; i.assignees = logins.map((l) => userShape({ login: l })); i.updated_at = nowISO(); db.put("issues", i.id, i); db.onchange(); return (i.pull_request ? prShape : issueShape)(i); },

      // ── reactions (👍 👎 😄 🎉 😕 ❤️ 🚀 👀) — toggle the current user's reaction ─────
      reactions(owner, name, targetType, targetId) { const r = db.get("reactions", targetType + ":" + targetId); return (r && r.map) || {}; },
      async react(owner, name, targetType, targetId, content) {
        const key = targetType + ":" + targetId; const r = db.get("reactions", key) || { id: key, map: {} };
        const arr = r.map[content] = r.map[content] || []; const me = user.login; const at = arr.indexOf(me);
        if (at >= 0) arr.splice(at, 1); else arr.push(me); if (!arr.length) delete r.map[content];
        db.put("reactions", key, r); db.onchange(); return r.map;
      },

      // ── milestones (basic) ────────────────────────────────────────────────────────
      async listMilestones(owner, name) { const rec = getRepoRec(owner, name); return db.list("milestones").filter((m) => m.repoId === rec.id).map(milestoneShape); },
      async createMilestone(owner, name, o) { const rec = getRepoRec(owner, name); const m = { id: rid(), repoId: rec.id, title: o.title, description: o.description || "", state: "open", due_on: o.due_on || null }; db.put("milestones", m.id, m); db.onchange(); return milestoneShape(m); },

      // ── pull requests ─────────────────────────────────────────────────────────────
      async listPulls(owner, name, q = {}) {
        const rec = getRepoRec(owner, name); if (!rec) return [];
        let arr = db.list("issues").filter((i) => i.repoId === rec.id && i.pull_request);
        if (q.state && q.state !== "all") arr = arr.filter((i) => i.state === q.state);
        return arr.sort((a, b) => b.number - a.number).map(prShape);
      },
      async getPull(owner, name, number) { return this.getIssue(owner, name, number); },
      async createPull(owner, name, o) {
        const { r, rec } = await gitRepo(owner, name); const number = this._nextNumber(rec); const id = rid();
        const headOid = await this.resolveRef(owner, name, o.head), baseOid = await this.resolveRef(owner, name, o.base);
        const draft = !!o.draft || /^\s*(WIP:|\[WIP\])/i.test(o.title || "");
        const i = { id, repoId: rec.id, number, title: o.title, body: o.body || "", state: "open", author: user.login, user, labels: [], comments: 0,
          created_at: nowISO(), updated_at: nowISO(), pull_request: { merged: false }, draft,
          head: { ref: o.head, label: o.head, sha: headOid }, base: { ref: o.base, label: o.base, sha: baseOid }, merged: false };
        const base = await r.mergeBase(baseOid, headOid);
        const files = await r.diffCommits(base, headOid);
        i.changed_files = files.length; i.additions = files.reduce((a, f) => a + (f.patch.additions || 0), 0); i.deletions = files.reduce((a, f) => a + (f.patch.deletions || 0), 0);
        // pre-flight mergeability (3-way conflict check) so the UI can warn
        try { const m = await r._mergeTrees(base, baseOid, headOid); i.mergeable = (m.conflicts || []).length === 0; i.conflict_files = m.conflicts || []; } catch { i.mergeable = true; }
        db.put("issues", id, i); recount(rec); db.onchange(); return prShape(i);
      },
      async listPullCommits(owner, name, number) {
        const { r } = await gitRepo(owner, name); const i = db.list("issues").find((x) => x.repoId === getRepoRec(owner, name).id && x.number === +number); if (!i || !i.head) return [];
        const base = await r.mergeBase(i.base.sha, i.head.sha);
        return (await r._commitsBetween(base, i.head.sha)).map((c) => commitShape(owner, name, c.oid, c));
      },
      async listReviews(owner, name, number) { const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return []; return db.seq("reviews:" + i.id).map(reviewShape); },
      async createReview(owner, name, number, o) {
        const rec = getRepoRec(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i) return null;
        const review = { id: rid(), repoId: rec.id, prNumber: +number, state: (o.event || o.state || "COMMENT").toUpperCase(), body: o.body || "", commit_id: i.head && i.head.sha, author: user.login, user, created_at: nowISO() };
        db.append("reviews:" + i.id, review); i.updated_at = nowISO(); db.put("issues", i.id, i); db.onchange(); return reviewShape(review);
      },
      async commitDiff(owner, name, sha) {
        const { r } = await gitRepo(owner, name); const c = await r.readCommit(sha); if (!c) return [];
        const base = (c.parents && c.parents[0]) || null;
        const files = await r.diffCommits(base, sha);
        return files.map((f) => ({ filename: f.path, status: { A: "added", M: "changed", D: "deleted" }[f.status], additions: f.patch.additions, deletions: f.patch.deletions, patch: f.patch }));
      },
      async getPullFiles(owner, name, number) {
        const { r } = await gitRepo(owner, name); const i = db.list("issues").find((x) => x.repoId === getRepoRec(owner, name).id && x.number === +number); if (!i || !i.head) return [];
        const base = await r.mergeBase(i.base.sha, i.head.sha);
        const files = await r.diffCommits(base, i.head.sha);
        return files.map((f) => ({ filename: f.path, status: { A: "added", M: "changed", D: "deleted" }[f.status], additions: f.patch.additions, deletions: f.patch.deletions, patch: f.patch }));
      },
      async mergePull(owner, name, number, o = {}) {
        const { r, rec } = await gitRepo(owner, name); const i = db.list("issues").find((x) => x.repoId === rec.id && x.number === +number); if (!i || !i.head) throw new Error("PR not found");
        if (i.draft) throw new Error("this pull request is a work in progress and cannot be merged");
        const method = ({ merge: "merge", "merge-commit": "merge", squash: "squash", rebase: "rebase", "rebase-merge": "rebase" })[o.Do || o.method || "merge"] || "merge";
        const msg = o.message || (method === "squash" ? `${i.title} (#${number})` : `Merge pull request #${number} (${i.head.ref} → ${i.base.ref})`);
        const res = await r.merge(i.base.ref, i.head.sha, { message: msg, author: { name: user.full_name, email: user.email || user.login + "@holo" } }, { method });
        saveRef(rec.id, "refs/heads/" + i.base.ref, r.getRef("refs/heads/" + i.base.ref));
        i.state = "closed"; i.merged = true; i.merged_at = nowISO(); i.pull_request.merged = true; i.merge_commit_sha = res.oid; i.merged_by = user; i.merge_method = method; i.updated_at = nowISO();
        if (o.delete_branch && i.head.ref !== rec.default_branch) { try { r.deleteRef("refs/heads/" + i.head.ref); db.del("refs", refKey(rec.id, "refs/heads/" + i.head.ref)); } catch {} }
        db.put("issues", i.id, i); recount(rec); db.onchange();
        return { merged: true, sha: res.oid, method, conflicts: res.conflicts || [] };
      },

      // ── releases ──────────────────────────────────────────────────────────────────
      async listReleases(owner, name) { const rec = getRepoRec(owner, name); return db.list("releases").filter((x) => x.repoId === rec.id).map(releaseShape).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); },
      async createRelease(owner, name, o) {
        const rec = getRepoRec(owner, name); await this.createTag(owner, name, o.tag_name, o.target, o.body && o.draft ? null : o.name);
        const rel = { id: rid(), repoId: rec.id, tag_name: o.tag_name, name: o.name || o.tag_name, body: o.body || "", target: o.target || rec.default_branch, draft: !!o.draft, prerelease: !!o.prerelease, user, created_at: nowISO() };
        db.put("releases", rel.id, rel); return releaseShape(rel);
      },

      // ── serverless transfer (clone / fetch / push over the κ pub/sub) ───────────────
      async clone(srcOwner, srcName, refs, dest) {
        // create the dest repo, hydrate refs, fetch every reachable object by κ (L5).
        const owner = (dest && dest.owner) || user.login, name = (dest && dest.name) || srcName;
        const rec = { id: repoId(owner, name), owner, ownerFull: user.full_name, name, description: dest && dest.description || "", private: false, default_branch: dest && dest.default_branch || "main", algo, created_at: nowISO(), updated_at: nowISO() };
        db.put("repos", rec.id, rec);
        const { r } = await gitRepo(owner, name);
        let n = 0;
        for (const [refName, oid] of Object.entries(refs || {})) { n += await r.fetchReachable(oid); r.setRef(refName, oid); saveRef(rec.id, refName, oid); }
        rec.empty = n === 0; db.put("repos", rec.id, rec);
        return { repo: repoShape(rec), objects: n };
      },
      async push(owner, name) { const { r } = await gitRepo(owner, name); return r.push(); },
      async repoRefsManifest(owner, name) { const { r } = await gitRepo(owner, name); const m = {}; for (const { name: n, oid } of r.listRefs()) m[n] = oid; return m; },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────────
  // SERVER BACKEND — a faithful client of the real Gitea REST API v1.
  // Documented Swagger routes (https://try.gitea.io/api/swagger). Auth: token header.
  // ─────────────────────────────────────────────────────────────────────────────────
  function server(baseUrl, token) {
    const base = String(baseUrl).replace(/\/+$/, "") + "/api/v1";
    const H = () => { const h = { "Accept": "application/json" }; if (token) h["Authorization"] = "token " + token; return h; };
    async function api(method, path, body) {
      const opt = { method, headers: H() };
      if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
      const res = await fetch(base + path, opt);
      if (res.status === 204) return null;
      const txt = await res.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
      if (!res.ok) throw Object.assign(new Error((data && data.message) || res.statusText), { status: res.status, data });
      return data;
    }
    const enc = encodeURIComponent;
    const qs = (o) => { const p = new URLSearchParams(); for (const k in o) if (o[k] != null && o[k] !== "") p.set(k, o[k]); const s = p.toString(); return s ? "?" + s : ""; };
    return {
      backend: "server", baseUrl: base, raw: api,
      me: () => api("GET", "/user"),
      listRepos: () => api("GET", "/user/repos"),
      searchRepos: (q) => api("GET", "/repos/search" + qs({ q })).then((r) => r.data || r),
      getRepo: (o, n) => api("GET", `/repos/${enc(o)}/${enc(n)}`),
      createRepo: (b) => api("POST", "/user/repos", b),
      deleteRepo: (o, n) => api("DELETE", `/repos/${enc(o)}/${enc(n)}`),
      listBranches: (o, n) => api("GET", `/repos/${enc(o)}/${enc(n)}/branches`),
      listTags: (o, n) => api("GET", `/repos/${enc(o)}/${enc(n)}/tags`),
      getCommit: (o, n, sha) => api("GET", `/repos/${enc(o)}/${enc(n)}/git/commits/${enc(sha)}`),
      commitDiff: (o, n, sha) => api("GET", `/repos/${enc(o)}/${enc(n)}/git/commits/${enc(sha)}`).then((c) => (c.files || []).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions || 0, deletions: f.deletions || 0, patch: null }))).catch(() => []),
      listCommits: (o, n, q = {}) => api("GET", `/repos/${enc(o)}/${enc(n)}/commits` + qs({ sha: q.sha, path: q.path, limit: q.limit })),
      getTree: (o, n, sha, q = {}) => api("GET", `/repos/${enc(o)}/${enc(n)}/git/trees/${enc(sha)}` + qs({ recursive: q.recursive ? "true" : "" })),
      getContents: (o, n, path, q = {}) => api("GET", `/repos/${enc(o)}/${enc(n)}/contents/${path.split("/").map(enc).join("/")}` + qs({ ref: q.ref })),
      getRaw: (o, n, path, q = {}) => fetch(base + `/repos/${enc(o)}/${enc(n)}/raw/${path.split("/").map(enc).join("/")}` + qs({ ref: q.ref }), { headers: H() }).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      putContents: (o, n, path, b) => api("PUT", `/repos/${enc(o)}/${enc(n)}/contents/${path.split("/").map(enc).join("/")}`, b),
      listIssues: (o, n, q = {}) => api("GET", `/repos/${enc(o)}/${enc(n)}/issues` + qs({ state: q.state, type: q.type, q: q.q })),
      getIssue: (o, n, i) => api("GET", `/repos/${enc(o)}/${enc(n)}/issues/${i}`),
      createIssue: (o, n, b) => api("POST", `/repos/${enc(o)}/${enc(n)}/issues`, b),
      editIssue: (o, n, i, b) => api("PATCH", `/repos/${enc(o)}/${enc(n)}/issues/${i}`, b),
      listComments: (o, n, i) => api("GET", `/repos/${enc(o)}/${enc(n)}/issues/${i}/comments`),
      createComment: (o, n, i, body) => api("POST", `/repos/${enc(o)}/${enc(n)}/issues/${i}/comments`, { body }),
      listLabels: (o, n) => api("GET", `/repos/${enc(o)}/${enc(n)}/labels`),
      createLabel: (o, n, b) => api("POST", `/repos/${enc(o)}/${enc(n)}/labels`, b),
      updateLabel: (o, n, id, b) => api("PATCH", `/repos/${enc(o)}/${enc(n)}/labels/${id}`, b),
      deleteLabel: (o, n, id) => api("DELETE", `/repos/${enc(o)}/${enc(n)}/labels/${id}`),
      setIssueLabels: (o, n, i, labelIds) => api("PUT", `/repos/${enc(o)}/${enc(n)}/issues/${i}/labels`, { labels: labelIds }),
      setAssignees: (o, n, i, assignees) => api("PATCH", `/repos/${enc(o)}/${enc(n)}/issues/${i}`, { assignees }),
      react: (o, n, targetType, id, content) => api("POST", `/repos/${enc(o)}/${enc(n)}/${targetType === "comment" ? "issues/comments" : "issues"}/${id}/reactions`, { content }),
      reactions: () => ({}),
      listMilestones: (o, n) => api("GET", `/repos/${enc(o)}/${enc(n)}/milestones`),
      createMilestone: (o, n, b) => api("POST", `/repos/${enc(o)}/${enc(n)}/milestones`, b),
      createBranch: (o, n, newName, from) => api("POST", `/repos/${enc(o)}/${enc(n)}/branches`, { new_branch_name: newName, old_branch_name: from }),
      deleteBranch: (o, n, b) => api("DELETE", `/repos/${enc(o)}/${enc(n)}/branches/${enc(b)}`),
      fileHistory: (o, n, path, q = {}) => api("GET", `/repos/${enc(o)}/${enc(n)}/commits` + qs({ path, sha: q.ref, limit: q.limit })),
      listPulls: (o, n, q = {}) => api("GET", `/repos/${enc(o)}/${enc(n)}/pulls` + qs({ state: q.state })),
      getPull: (o, n, i) => api("GET", `/repos/${enc(o)}/${enc(n)}/pulls/${i}`),
      createPull: (o, n, b) => api("POST", `/repos/${enc(o)}/${enc(n)}/pulls`, b),
      getPullFiles: (o, n, i) => api("GET", `/repos/${enc(o)}/${enc(n)}/pulls/${i}/files`),
      listPullCommits: (o, n, i) => api("GET", `/repos/${enc(o)}/${enc(n)}/pulls/${i}/commits`),
      listReviews: (o, n, i) => api("GET", `/repos/${enc(o)}/${enc(n)}/pulls/${i}/reviews`),
      createReview: (o, n, i, b) => api("POST", `/repos/${enc(o)}/${enc(n)}/pulls/${i}/reviews`, { event: (b.event || b.state || "COMMENT"), body: b.body || "" }),
      mergePull: (o, n, i, b = {}) => api("POST", `/repos/${enc(o)}/${enc(n)}/pulls/${i}/merge`, { Do: b.Do || b.method || "merge", ...b }),
      listReleases: (o, n) => api("GET", `/repos/${enc(o)}/${enc(n)}/releases`),
      createRelease: (o, n, b) => api("POST", `/repos/${enc(o)}/${enc(n)}/releases`, b),
    };
  }

  G.HoloGitea = { native, server, memDb, collabDb, shapes: { userShape, repoShape, commitShape, issueShape, commentShape, prShape, labelShape, releaseShape, reviewShape, milestoneShape }, b64encode, b64decode };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloGitea;
})();
