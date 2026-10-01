/* clock.js — pure punch-card maths, shared by the page and the node test.
 * An event is {k: "in"|"out", t: epoch ms}. Everything else is derived:
 * events -> sessions (in/out pairs) -> days -> weeks. Local time throughout. */
var TCM = (function () {
  var DAY = 86400000;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  // Monday 00:00 of the week containing t.
  function weekStart(t) {
    var d = new Date(dayStart(t));
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d.getTime();
  }
  function fmt(ms) {
    var m = Math.round(ms / 60000);
    return Math.floor(m / 60) + "h" + pad(m % 60);
  }
  // Signed, for deltas against a target: "+1h15", "−0h30", "0h00".
  function sfmt(ms) {
    var m = Math.round(ms / 60000);
    return (m < 0 ? "\u2212" : m > 0 ? "+" : "") + fmt(Math.abs(m) * 60000);
  }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // Pair events into sessions. An "in" with no "out" is open: it counts up to
  // `now` only if it started today, otherwise it is a stale session worth 0
  // until the user fixes it. An "out" with no "in" is an orphan worth 0.
  // ponytail: a session never spans midnight (a forgotten clock-out must not
  // swallow the next morning). Night shifts would need a configurable day cut.
  function sessions(events, now) {
    var sorted = events.slice().sort(function (a, b) { return a.t - b.t; });
    var out = [], open = null, today = dayKey(now);
    function push(start, end) {
      var s = { start: start, end: end, ms: 0, open: false, stale: false, orphan: start == null };
      if (start != null && end != null) s.ms = Math.max(0, end - start);
      else if (start != null) {
        s.open = true;
        if (dayKey(start) === today) s.ms = Math.max(0, now - start);
        else s.stale = true;
      }
      out.push(s);
    }
    sorted.forEach(function (e) {
      if (e.k === "in") { if (open) push(open.t, null); open = e; }
      else if (open && dayKey(open.t) === dayKey(e.t)) { push(open.t, e.t); open = null; }
      else { if (open) push(open.t, null); open = null; push(null, e.t); }
    });
    if (open) push(open.t, null);
    return out;
  }

  // Group sessions by the day they started (an orphan "out" by its own day).
  // Newest day first. breaks = gaps between consecutive closed sessions.
  function days(events, now) {
    var byDay = {};
    sessions(events, now).forEach(function (s) {
      var key = dayKey(s.start != null ? s.start : s.end);
      var d = byDay[key] || (byDay[key] = { key: key, start: dayStart(s.start != null ? s.start : s.end), sessions: [], ms: 0, breaks: 0, open: false, stale: false });
      var prev = d.sessions[d.sessions.length - 1];
      if (prev && prev.end != null && s.start != null && s.start > prev.end) d.breaks += s.start - prev.end;
      d.sessions.push(s);
      d.ms += s.ms;
      d.open = d.open || s.open;
      d.stale = d.stale || s.stale;
    });
    return Object.keys(byDay).sort().reverse().map(function (k) { return byDay[k]; });
  }

  // Group days by ISO-ish week (Monday start). Newest first.
  function weeks(dayList) {
    var byWeek = {};
    dayList.forEach(function (d) {
      var ws = weekStart(d.start);
      var w = byWeek[ws] || (byWeek[ws] = { start: ws, days: [], ms: 0 });
      w.days.push(d);
      w.ms += d.ms;
    });
    return Object.keys(byWeek).map(Number).sort(function (a, b) { return b - a; }).map(function (k) { return byWeek[k]; });
  }

  // Worked time minus a daily target, summed over closed days with work.
  // Today is left out while it runs (its progress is the "leave at" hint).
  // A day without work costs nothing: holidays, leave and sick days need no
  // bookkeeping. ponytail: if a day off should consume banked hours instead,
  // add leave entries.
  function delta(dayList, dailyMs, now) {
    var today = dayKey(now), ms = 0, n = 0;
    dayList.forEach(function (d) { if (d.ms > 0 && d.key !== today) { ms += d.ms - dailyMs; n++; } });
    return { ms: ms, n: n };
  }

  function lastEvent(events) { return events.slice().sort(function (a, b) { return a.t - b.t; }).pop(); }
  // True when the latest event is an "in" that happened today.
  function clockedIn(events, now) {
    var last = lastEvent(events);
    return !!last && last.k === "in" && dayKey(last.t) === dayKey(now);
  }

  function atHour(t, h) { var d = new Date(t); d.setHours(h, 0, 0, 0); return d.getTime(); }
  function atMin(t, m) { var d = new Date(t); d.setHours(0, m, 0, 0); return d.getTime(); }
  // The typical day, device local time. A day never ends after `endMin`
  // (minutes since midnight, default END): a press at 20:40 means the
  // clock-out was forgotten, so it is recorded at the cap.
  // ponytail: fixed typical hours; make them settings if a second schedule shows up.
  var START = 9, LUNCH_OUT = 12, LUNCH_IN = 14, END = 18 * 60 + 30;

  // What one press of the button records. Normally it toggles in/out, with
  // the clock-out capped at endMin (unless the clock-in itself came later).
  // The first press of the day after 14:00 means the whole day went
  // unpunched: record a typical day (09:00-12:00, 14:00-now) so that press is
  // the evening clock-out, then fix the times in the history if they were off.
  function punch(events, now, endMin) {
    var end = Math.min(now, atMin(now, endMin == null ? END : endMin));
    if (clockedIn(events, now)) return [{ k: "out", t: lastEvent(events).t < end ? end : now }];
    var today = dayKey(now);
    var anyToday = events.some(function (e) { return dayKey(e.t) === today; });
    if (!anyToday && now >= atHour(now, LUNCH_IN))
      return [{ k: "in", t: atHour(now, START) }, { k: "out", t: atHour(now, LUNCH_OUT) }, { k: "in", t: atHour(now, LUNCH_IN) }, { k: "out", t: end }];
    return [{ k: "in", t: now }];
  }

  return { DAY: DAY, END: END, dayKey: dayKey, dayStart: dayStart, weekStart: weekStart, fmt: fmt, sfmt: sfmt, hhmm: hhmm,
    sessions: sessions, days: days, weeks: weeks, delta: delta, clockedIn: clockedIn, punch: punch };
})();
if (typeof module !== "undefined") module.exports = TCM;
