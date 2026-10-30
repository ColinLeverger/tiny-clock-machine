/* sync.js — GitHub Contents API backup of the punch log.
 * One JSON file in a private repo: {events, settings, days} (an older file
 * that is a bare punch list still loads). Pushed after every change with the
 * file sha, so two devices cannot silently overwrite each other; pulled back
 * when this browser has nothing. First connect merges both copies; a refused
 * push (another device wrote in between) is merged three ways and retried. */
var TCMSync = (function (root) {
  var KEY = "tcm-sync", PATH = "tiny-clock.json";
  // ponytail: branch is always main; add an input if a repo ever needs another.
  var BRANCH = "main";

  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
  function union(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (e) {
      if (!e || (e.k !== "in" && e.k !== "out") || typeof e.t !== "number" || !isFinite(e.t)) return;
      var key = e.k + e.t, old = seen[key];
      var source = /^(recorded|typical|capped|manual|reviewed)$/.test(e.source) ? e.source : null;
      if (!old) { old = { k: e.k, t: e.t }; seen[key] = old; out.push(old); }
      // A reviewed timestamp wins; an older client without metadata cannot erase its origin.
      if (source && old.source !== "reviewed") old.source = source;
      if (e.reviewed === true) old.reviewed = true;
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
    var inBase = keys(base), inLocal = keys(local), inRemote = keys(remote);
    var baseSource = {}; base.forEach(function (e) { baseSource[e.k + e.t] = [e.source, !!e.reviewed].join(":"); });
    var kept = remote.filter(function (e) { return !(inBase[e.k + e.t] && !inLocal[e.k + e.t]); });
    return union(kept, local.filter(function (e) { return !inBase[e.k + e.t] || (inRemote[e.k + e.t] && [e.source, !!e.reviewed].join(":") !== baseSource[e.k + e.t]); }));
  }
  // What travels with the punches: settings {target, end, since} and day
  // marks {dayKey: "off"|"half"}. Anything odd is dropped.
  function cleanExtra(x) {
    x = x || {};
    var s = x.settings || {}, d = x.days || {}, out = { settings: {}, days: {} };
    if (s.target > 0) out.settings.target = +s.target;
    if (/^\d\d:\d\d$/.test(s.end)) out.settings.end = s.end;
    if (s.since >= 0) out.settings.since = +s.since;
    Object.keys(d).forEach(function (k) { if (/^\d{4}-\d\d-\d\d$/.test(k) && (d[k] === "off" || d[k] === "half")) out.days[k] = d[k]; });
    return out;
  }
  // Per key, b wins. ponytail: no history for settings and marks, so a mark
  // removed on one device while the other had unsaved changes comes back.
  function mergeExtra(a, b) {
    return { settings: Object.assign({}, a.settings, b.settings), days: Object.assign({}, a.days, b.days) };
  }
  // The file: {events, settings, days}, or a bare punch list from before.
  function parse(json) {
    var x = JSON.parse(json);
    if (Array.isArray(x)) return { events: x, extra: cleanExtra() };
    if (!x || !Array.isArray(x.events)) throw new Error("not a punch log");
    return { events: x.events, extra: cleanExtra(x) };
  }
  function serialize(events, extra) { return JSON.stringify({ events: events, settings: extra.settings, days: extra.days }); }

  // opts: getEvents() -> list, setEvents(list) (persist without re-syncing),
  //       getExtra() -> {settings, days}, setExtra(extra), onStatus(kind, text)
  function create(opts) {
    var cfg = load(), timer = null, busy = false, rev = 0;
    function save() { if (cfg) root.localStorage.setItem(KEY, JSON.stringify(cfg)); else root.localStorage.removeItem(KEY); }
    function status(kind, text) { opts.onStatus(kind, text); }
    function when(t) { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    function extra() { return cleanExtra(opts.getExtra()); }

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
      var doc = parse(atob(f.content.replace(/\s/g, "")));
      return { sha: f.sha, events: doc.events, extra: doc.extra };
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
      var body = { message: "Punch log", content: btoa(serialize(list, extra())), branch: BRANCH };
      if (sha) body.sha = sha;
      var res = await api("PUT", body, keepalive);
      acked(res.content.sha, list);
    }
    function take(r) {
      var list = union(r.events, []);
      opts.setEvents(list);
      opts.setExtra(r.extra);
      acked(r.sha, list);
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
          opts.setExtra(mergeExtra(r ? r.extra : cleanExtra(), extra()));
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
        cfg.dirty = false; take(r);
        status("ok", "Loaded from GitHub " + when(cfg.at));
      } catch (e) { fail(e); }
      finally { busy = false; }
    }
    // Local is clean and GitHub moved on (another device wrote): take it.
    // Nothing local can be lost, everything here was already acknowledged.
    async function refresh() {
      if (!cfg || busy || cfg.dirty) return;
      busy = true;
      try {
        var r = await remote();
        if (r && r.sha !== cfg.sha) { take(r); status("ok", "Loaded from GitHub " + when(cfg.at)); }
      } catch (e) { fail(e); }
      finally { busy = false; }
    }
    // First connection: merge both copies (GitHub's settings and marks win,
    // the usual case being a new device with defaults), then push the result.
    async function connect(repo, token) {
      repo = (repo || "").trim(); token = (token || "").trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Repository must be owner/name");
      if (!token) throw new Error("Token is required");
      cfg = { repo: repo, token: token, sha: null, dirty: true }; save();
      busy = true; status("syncing", "Connecting…");
      var r;
      try { r = await remote(); } catch (e) { cfg = null; save(); fail(e); throw e; }
      finally { busy = false; }
      if (r) {
        opts.setEvents(union(opts.getEvents(), r.events));
        opts.setExtra(mergeExtra(extra(), r.extra));
        cfg.sha = r.sha; cfg.base = union(r.events, []); save();
      }
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
  return { create: create, union: union, merge: merge, cleanExtra: cleanExtra, mergeExtra: mergeExtra, parse: parse, serialize: serialize, PATH: PATH };
})(typeof window !== "undefined" ? window : globalThis);
if (typeof module !== "undefined") module.exports = TCMSync;
