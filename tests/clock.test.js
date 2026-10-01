// node tests/clock.test.js — the pairing logic is the only thing that can
// silently lie about hours worked, so it gets the one check.
const assert = require("node:assert/strict");
const TCM = require("../js/clock.js");

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 10, 1, 15, 0);           // Thu 1 Oct 2026, 15:00

const events = [
  { k: "in",  t: at(2026, 9, 29, 8, 30) },     // Tue: 8:30 -> 12:00, 12:45 -> 17:15 = 8h00, break 45m
  { k: "out", t: at(2026, 9, 29, 12, 0) },
  { k: "in",  t: at(2026, 9, 29, 12, 45) },
  { k: "out", t: at(2026, 9, 29, 17, 15) },
  { k: "in",  t: at(2026, 9, 30, 9, 0) },      // Wed: forgot to clock out -> stale, worth 0
  { k: "out", t: at(2026, 10, 1, 7, 0) },      // Thu: orphan out (no matching in), worth 0
  { k: "in",  t: at(2026, 10, 1, 13, 0) },     // Thu: open since 13:00, now 15:00 -> 2h00
  { k: "in",  t: at(2026, 9, 21, 9, 0) },      // previous week Mon: 9 -> 17 = 8h
  { k: "out", t: at(2026, 9, 21, 17, 0) },
];

const days = TCM.days(events, now);
assert.deepEqual(days.map(d => d.key), ["2026-10-01", "2026-09-30", "2026-09-29", "2026-09-21"]);

const [thu, wed, tue, mon] = days;
assert.equal(TCM.fmt(tue.ms), "8h00");
assert.equal(TCM.fmt(tue.breaks), "0h45");
assert.equal(wed.ms, 0); assert.ok(wed.stale);
assert.equal(TCM.fmt(thu.ms), "2h00"); assert.ok(thu.open); assert.ok(!thu.stale);
assert.ok(thu.sessions[0].orphan && thu.sessions[0].ms === 0);
assert.equal(mon.ms, 8 * 3600000);

const weeks = TCM.weeks(days);
assert.equal(weeks.length, 2);
assert.equal(weeks[0].start, at(2026, 9, 28, 0, 0));
assert.equal(TCM.fmt(weeks[0].ms), "10h00");
assert.equal(weeks[0].days.length, 3);

assert.ok(TCM.clockedIn(events, now));
assert.ok(!TCM.clockedIn(events, at(2026, 10, 2, 9, 0)), "yesterday's open in is not clocked-in today");
assert.equal(TCM.fmt(59 * 60000 + 29000), "0h59");
assert.equal(TCM.fmt(59 * 60000 + 31000), "1h00");

// punch(): first press of the day after 14:00 records a typical day ending now.
const late = at(2026, 10, 2, 16, 30);
assert.deepEqual(TCM.punch([], late), [
  { k: "in", t: at(2026, 10, 2, 9, 0) }, { k: "out", t: at(2026, 10, 2, 12, 0) },
  { k: "in", t: at(2026, 10, 2, 14, 0) }, { k: "out", t: late },
]);
assert.deepEqual(TCM.punch([], at(2026, 10, 2, 13, 59)), [{ k: "in", t: at(2026, 10, 2, 13, 59) }], "before 14:00 -> plain in");
assert.deepEqual(TCM.punch(events, now), [{ k: "out", t: now }], "clocked in -> plain out");
assert.deepEqual(TCM.punch([{ k: "in", t: at(2026, 10, 2, 8, 0) }, { k: "out", t: at(2026, 10, 2, 12, 0) }], late),
  [{ k: "in", t: late }], "already punched today -> plain in");
assert.equal(TCM.fmt(TCM.days(TCM.punch([], late), late)[0].ms), "5h30");

// A day ends at 19:00 at the latest: a late press clocks out at 19:00, both
// for a plain out and for the typical-day fill. An in after 19:00 is kept as is.
const night = at(2026, 10, 2, 20, 40), seven = at(2026, 10, 2, 19, 0);
assert.deepEqual(TCM.punch([{ k: "in", t: at(2026, 10, 2, 9, 0) }], night), [{ k: "out", t: seven }], "late out -> capped at 19:00");
assert.deepEqual(TCM.punch([{ k: "in", t: at(2026, 10, 2, 19, 30) }], night), [{ k: "out", t: night }], "in after 19:00 -> out now");
assert.deepEqual(TCM.punch([], night).pop(), { k: "out", t: seven }, "late typical day ends 19:00");
assert.deepEqual(TCM.punch([{ k: "in", t: at(2026, 10, 2, 9, 0) }], seven - 60000), [{ k: "out", t: seven - 60000 }], "18:59 -> out now");

// delta(): worked days vs a daily target, today excluded while it runs.
const H = 3600000;
assert.deepEqual(TCM.delta(days, 7 * H, now), { ms: 2 * H, n: 2 }, "Tue + Mon at 8h vs 7h; Thu (today) and stale Wed skipped");
assert.deepEqual(TCM.delta(weeks[0].days, 7 * H, now), { ms: 1 * H, n: 1 });
assert.equal(TCM.sfmt(75 * 60000), "+1h15");
assert.equal(TCM.sfmt(-30 * 60000), "\u22120h30");
assert.equal(TCM.sfmt(20000), "0h00");

console.log("clock tests passed");
