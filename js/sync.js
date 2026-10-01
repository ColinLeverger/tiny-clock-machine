/* sync.js — GitHub Contents API backup of the punch log.
 * One JSON file in a private repo. Pushed after every change (with the file
 * sha, so two devices cannot silently overwrite each other), pulled back when
 * this browser has nothing. First connect merges both copies. */
var TCMSync = (function (root) {
  var KEY = "tcm-sync", PATH = "tiny-clock.json";
  // ponytail: branch is always main; add an input if a repo ever needs another.
  var BRANCH = "main";

  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
  function union(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (e) {
      if (!e || (e.k !== "in" && e.k !== "out") || typeof e.t !== "number") return;
      if (!seen[e.k + e.t]) { seen[e.k + e.t] = 1; out.push({ k: e.k, t: e.t }); }
    });
    return out;
  }

  // opts: getEvents() -> list, setEvents(list) (persist without re-syncing), onStatus(kind, text)
  function create(opts) {
    var cfg = load(), timer = null, busy = false;
    function save() { if (cfg) root.localStorage.setItem(KEY, JSON.stringify(cfg)); else root.localStorage.removeItem(KEY); }
    function status(kind, text) { opts.onStatus(kind, text); }
    function when(t) { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

    async function api(method, body, keepalive) {
      var url = "https://api.github.com/repos/" + cfg.repo + "/contents/" + PATH + (method === "GET" ? "?ref=" + BRANCH : "");
      var headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + cfg.token, "X-GitHub-Api-Version": "2022-11-28" };
      if (body) headers["Content-Type"] = "application/json";
      var r = await root.fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", keepalive: !!keepalive });
      if (r.status === 404) return null;
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) { var e = new Error(data.message || "GitHub returned " + r.status); e.status = r.status; throw e; }
      return data;
    }
    async function remote() {
      var f = await api("GET");
      if (!f) return null;
      var ev = JSON.parse(atob(f.content.replace(/\s/g, "")));
      if (!Array.isArray(ev)) throw new Error(PATH + " on GitHub is not a punch list");
      return { sha: f.sha, events: ev };
    }
    function fail(e) {
      if (e.status === 409 || e.status === 422) status("conflict", "GitHub copy changed elsewhere: ⬆ overwrite it or ⬇ take it");
      else status("error", e.message);
    }

    async function push(force, keepalive) {
      if (!cfg || busy) return;
      busy = true; clearTimeout(timer); status("syncing", "Saving to GitHub…");
      try {
        var sha = cfg.sha;
        if (force) { var r = await remote(); sha = r && r.sha; }
        var body = { message: "Punch log", content: btoa(JSON.stringify(opts.getEvents())), branch: BRANCH };
        if (sha) body.sha = sha;
        var res = await api("PUT", body, keepalive);
        cfg.sha = res.content.sha; cfg.dirty = false; cfg.at = Date.now(); save();
        status("ok", "Saved to GitHub " + when(cfg.at));
      } catch (e) { fail(e); }
      finally { busy = false; }
    }
    async function pull() {
      if (!cfg || busy) return;
      busy = true; clearTimeout(timer); status("syncing", "Loading from GitHub…");
      try {
        var r = await remote();
        if (!r) { status("error", "No " + PATH + " on GitHub yet, push first"); return; }
        opts.setEvents(union(r.events, []));
        cfg.sha = r.sha; cfg.dirty = false; cfg.at = Date.now(); save();
        status("ok", "Loaded from GitHub " + when(cfg.at));
      } catch (e) { fail(e); }
      finally { busy = false; }
    }
    // First connection: merge both copies, then push the result.
    async function connect(repo, token) {
      repo = (repo || "").trim(); token = (token || "").trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Repository must be owner/name");
      if (!token) throw new Error("Token is required");
      cfg = { repo: repo, token: token, sha: null, dirty: true }; save();
      busy = true; status("syncing", "Connecting…");
      var r;
      try { r = await remote(); } catch (e) { cfg = null; save(); fail(e); throw e; }
      finally { busy = false; }
      if (r) { opts.setEvents(union(opts.getEvents(), r.events)); cfg.sha = r.sha; save(); }
      return push(false);
    }
    function disconnect() { clearTimeout(timer); cfg = null; save(); status("off", "Not connected"); }
    function changed() {
      if (!cfg) return;
      cfg.dirty = true; save(); status("dirty", "Waiting to save…");
      clearTimeout(timer); timer = setTimeout(function () { push(false); }, 2000);
    }
    function flush() { if (cfg && cfg.dirty && !busy) push(false, true); }
    function start() {
      root.addEventListener("pagehide", flush);
      root.addEventListener("online", flush);
      if (root.document) root.document.addEventListener("visibilitychange", function () { if (root.document.hidden) flush(); });
      if (!cfg) { status("off", "Not connected"); return; }
      if (!opts.getEvents().length) return pull();
      if (cfg.dirty) return push(false);
      status("ok", "Saved to GitHub" + (cfg.at ? " " + when(cfg.at) : ""));
    }
    return { config: function () { return cfg; }, connect: connect, disconnect: disconnect, changed: changed,
      push: push, pull: pull, start: start };
  }
  return { create: create, union: union, PATH: PATH };
})(typeof window !== "undefined" ? window : globalThis);
if (typeof module !== "undefined") module.exports = TCMSync;
