/* sync.js — GitHub Contents API backup of the punch log.
 * One JSON file in a private repo. Pushed after every change (with the file
 * sha, so two devices cannot silently overwrite each other), pulled back when
 * this browser has nothing. First connect merges both copies; a refused push
 * (another device wrote in between) is merged three ways and retried. */
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
  function keys(list) { var s = {}; list.forEach(function (e) { s[e.k + e.t] = 1; }); return s; }
  // Three-way merge of punch lists. `base` is the copy GitHub last acknowledged
  // from this device: base − local is what this device deleted (an edit is a
  // delete plus an add), local − base what it added, and the other device's
  // deletes are simply absent from `remote`. Punches are a set, so no clocks.
  // ponytail: both devices moving the same punch keeps both times; the extra
  // one shows up as an open or orphan row in the history, to fix by hand.
  function merge(base, local, remote) {
    var inBase = keys(base), inLocal = keys(local);
    var kept = remote.filter(function (e) { return !(inBase[e.k + e.t] && !inLocal[e.k + e.t]); });
    return union(kept, local.filter(function (e) { return !inBase[e.k + e.t]; }));
  }

  // opts: getEvents() -> list, setEvents(list) (persist without re-syncing), onStatus(kind, text)
  function create(opts) {
    var cfg = load(), timer = null, busy = false, rev = 0;
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
    function conflict(e) { return e.status === 409 || e.status === 422; }
    function fail(e) {
      if (conflict(e)) status("conflict", "GitHub copy changed elsewhere: ⬆ overwrite it or ⬇ take it");
      else status("error", e.message);
    }
    // GitHub now holds `list`: it is the base of the next merge.
    function acked(sha, list) { cfg.sha = sha; cfg.base = union(list, []); cfg.at = Date.now(); save(); }
    async function put(sha, keepalive) {
      var list = union(opts.getEvents(), []);
      var body = { message: "Punch log", content: btoa(JSON.stringify(list)), branch: BRANCH };
      if (sha) body.sha = sha;
      var res = await api("PUT", body, keepalive);
      acked(res.content.sha, list);
    }

    async function push(force, keepalive) {
      if (!cfg || busy) return;
      busy = true; clearTimeout(timer); status("syncing", "Saving to GitHub…");
      try {
        var r0 = rev, sha = cfg.sha, r;
        if (force) { r = await remote(); sha = r && r.sha; }
        try { await put(sha, keepalive); }
        catch (e) {
          if (force || !conflict(e)) throw e;
          // Another device wrote in between: merge against what this device
          // last pushed and retry with the fresh sha. A second refusal is a
          // real race and lands in fail(), where ⬆ / ⬇ settle it by hand.
          r = await remote();
          opts.setEvents(merge(cfg.base || [], opts.getEvents(), r ? r.events : []));
          await put(r && r.sha, keepalive);
        }
        // A punch made while the PUT was in flight is not in what GitHub got.
        if (rev !== r0) return changed();
        cfg.dirty = false; save();
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
        var list = union(r.events, []);
        opts.setEvents(list);
        cfg.dirty = false; acked(r.sha, list);
        status("ok", "Loaded from GitHub " + when(cfg.at));
      } catch (e) { fail(e); }
      finally { busy = false; }
    }
    // Local is clean and GitHub moved on (another device punched): take it.
    // Nothing local can be lost, everything here was already acknowledged.
    async function refresh() {
      if (!cfg || busy || cfg.dirty) return;
      busy = true;
      try {
        var r = await remote();
        if (r && r.sha !== cfg.sha) {
          var list = union(r.events, []);
          opts.setEvents(list);
          acked(r.sha, list);
          status("ok", "Loaded from GitHub " + when(cfg.at));
        }
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
      if (r) { opts.setEvents(union(opts.getEvents(), r.events)); cfg.sha = r.sha; cfg.base = union(r.events, []); save(); }
      return push(false);
    }
    function disconnect() { clearTimeout(timer); cfg = null; save(); status("off", "Not connected"); }
    function changed() {
      if (!cfg) return;
      rev++; cfg.dirty = true; save(); status("dirty", "Waiting to save…");
      clearTimeout(timer); timer = setTimeout(function () { push(false); }, 2000);
    }
    function flush() { if (cfg && cfg.dirty && !busy) return push(false, true); }
    function start() {
      root.addEventListener("pagehide", flush);
      root.addEventListener("online", flush);
      if (root.document) root.document.addEventListener("visibilitychange", function () { if (root.document.hidden) flush(); else refresh(); });
      if (!cfg) { status("off", "Not connected"); return; }
      if (!opts.getEvents().length) return pull();
      if (cfg.dirty) return push(false);
      status("ok", "Saved to GitHub" + (cfg.at ? " " + when(cfg.at) : ""));
      return refresh();
    }
    return { config: function () { return cfg; }, connect: connect, disconnect: disconnect, changed: changed,
      push: push, pull: pull, flush: flush, start: start };
  }
  return { create: create, union: union, merge: merge, PATH: PATH };
})(typeof window !== "undefined" ? window : globalThis);
if (typeof module !== "undefined") module.exports = TCMSync;
