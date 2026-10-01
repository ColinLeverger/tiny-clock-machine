// node tests/sync.test.js — the sha handshake is what stops two devices from
// silently overwriting each other's punches, so it gets the check.
const assert = require("node:assert/strict");

const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.addEventListener = () => {};
const calls = [];
let remoteFile = null, failPut = 0;
globalThis.fetch = async (url, init) => {
  calls.push(init.method + (init.body ? ":" + (JSON.parse(init.body).sha || "nosha") : ""));
  if (init.method === "GET") return remoteFile ? { status: 200, ok: true, json: async () => remoteFile } : { status: 404, ok: false, json: async () => ({}) };
  if (failPut) return { status: failPut, ok: false, json: async () => ({ message: "sha mismatch" }) };
  remoteFile = { sha: "sha" + calls.length, content: JSON.parse(init.body).content };
  return { status: 200, ok: true, json: async () => ({ content: { sha: remoteFile.sha } }) };
};
const TCMSync = require("../js/sync.js");

let events = [{ k: "in", t: 1000 }], statuses = [];
const sync = TCMSync.create({ getEvents: () => events, setEvents: l => { events = l; }, onStatus: (k, t) => statuses.push(k) });

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

  // another device moved the file: push is refused, nothing is lost
  failPut = 409;
  events.push({ k: "out", t: 4000 });
  await sync.push(false);
  assert.equal(statuses.pop(), "conflict");
  assert.equal(events.length, 4);

  // force push re-reads the sha first
  failPut = 0;
  await sync.push(true);
  assert.deepEqual(calls.slice(-2).map(c => c.split(":")[0]), ["GET", "PUT"]);
  assert.equal(JSON.parse(atob(remoteFile.content)).length, 4);

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
  // dirty browser never refreshes (its own push settles it)
  events.push({ k: "out", t: 6000 }); sync.changed();
  remoteFile.sha = "moved-again";
  await sync.start();
  assert.ok(!sync.config().dirty, "dirty -> pushed, not pulled");
  assert.equal(events.length, 6);

  sync.disconnect();
  assert.equal(store["tcm-sync"], undefined);
  console.log("sync tests passed");
})().catch(e => { console.error(e); process.exit(1); });
