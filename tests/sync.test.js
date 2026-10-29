// node tests/sync.test.js — the sha handshake is what stops two devices from
// silently overwriting each other's punches, so it gets the check.
const assert = require("node:assert/strict");

const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.addEventListener = () => {};
const calls = [];
let remoteFile = null, failPuts = 0, duringPut = null;
globalThis.fetch = async (url, init) => {
  calls.push(init.method + (init.body ? ":" + (JSON.parse(init.body).sha || "nosha") : ""));
  if (init.method === "GET") return remoteFile ? { status: 200, ok: true, json: async () => remoteFile } : { status: 404, ok: false, json: async () => ({}) };
  if (failPuts) { failPuts--; return { status: 409, ok: false, json: async () => ({ message: "sha mismatch" }) }; }
  if (duringPut) { duringPut(); duringPut = null; }
  remoteFile = { sha: "sha" + calls.length, content: JSON.parse(init.body).content };
  return { status: 200, ok: true, json: async () => ({ content: { sha: remoteFile.sha } }) };
};
const TCMSync = require("../js/sync.js");

let events = [{ k: "in", t: 1000 }], statuses = [], extra = { settings: {}, days: {} };
const sync = TCMSync.create({ getEvents: () => events, setEvents: l => { events = l; }, getExtra: () => extra, setExtra: x => { extra = x; }, onStatus: (k, t) => statuses.push(k) });

(async () => {
  await assert.rejects(sync.connect("bad repo", "tok"), /owner\/name/);

  // first connect: GitHub already holds an older copy -> both merged, then pushed with its sha
  remoteFile = { sha: "old", content: btoa(JSON.stringify([{ k: "in", t: 1000 }, { k: "out", t: 2000 }])) };
  await sync.connect("me/private-repo", "tok");
  assert.deepEqual(events.map(e => e.t), [1000, 2000]);
  assert.equal(calls.pop(), "PUT:old");
  assert.equal(statuses.pop(), "ok");
  const shaAfterConnect = sync.config().sha;

  // a change pushes with the known sha
  events.push({ k: "in", t: 3000 });
  sync.changed();
  assert.ok(sync.config().dirty);
  await sync.push(false);
  assert.equal(calls.pop(), "PUT:" + shaAfterConnect);
  assert.ok(!sync.config().dirty);

  // another device moved the file and the merged retry is refused too: conflict, nothing is lost
  failPuts = 2;
  events.push({ k: "out", t: 4000 });
  await sync.push(false);
  assert.equal(statuses.pop(), "conflict");
  assert.equal(events.length, 4);

  // force push re-reads the sha first
  await sync.push(true);
  assert.deepEqual(calls.slice(-2).map(c => c.split(":")[0]), ["GET", "PUT"]);
  assert.equal(JSON.parse(atob(remoteFile.content)).events.length, 4);

  // empty browser pulls on start
  events = [];
  sync.start();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(events.length, 4);
  assert.equal(statuses.pop(), "ok");

  // clean browser, GitHub moved on (another device punched): take it on start
  remoteFile = { sha: "elsewhere", content: btoa(JSON.stringify([{ k: "in", t: 1000 }, { k: "out", t: 2000 }, { k: "in", t: 3000 }, { k: "out", t: 4000 }, { k: "in", t: 5000 }])) };
  await sync.start();
  assert.equal(events.length, 5);
  assert.equal(sync.config().sha, "elsewhere");
  // same sha again: nothing fetched beyond the GET, nothing changed
  const before = calls.length;
  await sync.start();
  assert.equal(calls.length - before, 1);
  assert.equal(events.length, 5);
  // flush() returns the push, so a caller can wait for it before closing the tab
  events.push({ k: "in", t: 5500 }); sync.changed();
  const flushed = sync.flush();
  assert.ok(flushed instanceof Promise, "dirty -> flush returns the push");
  await flushed;
  assert.ok(!sync.config().dirty);
  assert.equal(sync.flush(), undefined, "clean -> nothing to flush");
  // dirty browser never refreshes (its own push settles it)
  events.push({ k: "out", t: 6000 }); sync.changed();
  remoteFile.sha = "moved-again";
  await sync.start();
  assert.ok(!sync.config().dirty, "dirty -> pushed, not pulled");
  assert.equal(events.length, 7);

  // refused push: the other device deleted 2000 and added 7000 while this one
  // moved 6000 to 6300. Three-way merge against the last pushed copy keeps all
  // three intents, then the retry goes through with the fresh sha.
  const base = events.map(e => ({ ...e }));
  remoteFile = { sha: "theirs", content: btoa(JSON.stringify(base.filter(e => e.t !== 2000).concat([{ k: "in", t: 7000 }]))) };
  events = base.map(e => e.t === 6000 ? { k: "out", t: 6300 } : e); sync.changed();
  failPuts = 1;
  await sync.push(false);
  const merged = [1000, 3000, 4000, 5000, 5500, 7000, 6300];
  assert.deepEqual(events.map(e => e.t), merged);
  assert.deepEqual(JSON.parse(atob(remoteFile.content)).events.map(e => e.t), merged);
  assert.deepEqual(calls.slice(-3).map(c => c.split(":")[0]), ["PUT", "GET", "PUT"]);
  assert.equal(calls.at(-1), "PUT:theirs", "retry carries the sha GitHub has now");
  assert.equal(statuses.pop(), "ok");
  assert.ok(!sync.config().dirty);
  assert.equal(sync.config().sha, remoteFile.sha);
  assert.deepEqual(sync.config().base.map(e => e.t), merged, "the merge is the next base");
  // a punch made while the PUT is in flight is not in what GitHub got: the
  // device stays dirty and pushes again instead of calling itself saved.
  duringPut = () => { events.push({ k: "in", t: 8000 }); sync.changed(); };
  await sync.push(false);
  assert.ok(sync.config().dirty, "change during flight -> still dirty");
  assert.equal(JSON.parse(atob(remoteFile.content)).events.length, 7);
  await sync.push(false);
  assert.ok(!sync.config().dirty);
  assert.equal(JSON.parse(atob(remoteFile.content)).events.length, 8);

  // settings and day marks travel in the file: pushed with the punches, taken
  // from GitHub when this browser is clean, merged per key on a refused push.
  extra = { settings: { target: 37.5, end: "18:00", since: 0 }, days: { "2026-10-05": "half" } }; sync.changed();
  await sync.push(false);
  const file = JSON.parse(atob(remoteFile.content));
  assert.deepEqual(file.settings, extra.settings); assert.deepEqual(file.days, extra.days);
  // the other device set 35h and marked Oct 6 off; this one kept 37.5 and marked Oct 7 off
  remoteFile = { sha: "theirs2", content: btoa(JSON.stringify({ events: file.events, settings: { target: 35, end: "18:00", since: 0 }, days: { "2026-10-05": "half", "2026-10-06": "off" } })) };
  extra = { settings: { target: 37.5, end: "18:00", since: 0 }, days: { "2026-10-05": "half", "2026-10-07": "off" } }; sync.changed();
  failPuts = 1;
  await sync.push(false);
  assert.deepEqual(extra.days, { "2026-10-05": "half", "2026-10-06": "off", "2026-10-07": "off" }, "marks merge per key");
  assert.equal(extra.settings.target, 37.5, "local settings win a refused push");
  assert.deepEqual(JSON.parse(atob(remoteFile.content)).days, extra.days);
  // a clean browser takes the GitHub copy, settings and marks included
  remoteFile = { sha: "theirs3", content: btoa(JSON.stringify({ events: file.events, settings: { target: 40, end: "17:30", since: 0 }, days: {} })) };
  await sync.start();
  assert.equal(extra.settings.target, 40); assert.deepEqual(extra.days, {});
  // junk in the file is dropped, a bare list still parses
  assert.deepEqual(TCMSync.parse(JSON.stringify({ events: [], settings: { target: -1, end: "25h" }, days: { "nope": "off", "2026-10-08": "sick" } })).extra, { settings: {}, days: {} });
  assert.deepEqual(TCMSync.parse("[]"), { events: [], extra: { settings: {}, days: {} } });
  assert.throws(() => TCMSync.parse('{"nope":1}'), /not a punch log/);

  sync.disconnect();
  assert.equal(store["tcm-sync"], undefined);
  console.log("sync tests passed");
})().catch(e => { console.error(e); process.exit(1); });
