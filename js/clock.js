/* clock.js — pure punch-card maths, shared by the page and the node test.
 * An event is {k: "in"|"out", t: epoch ms, source?, reviewed?}. Derived:
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
    function push(start, end, punches) {
      punches = punches || [];
      var s = { start: start, end: end, ms: 0, open: false, stale: false, orphan: start == null, sources: punches.map(function (e) { return e.reviewed ? "reviewed" : e.source; }), origins: punches.map(function (e) { return e.source; }) };
      if (start != null && end != null) s.ms = Math.max(0, end - start);
      else if (start != null) {
        s.open = true;
        if (dayKey(start) === today) s.ms = Math.max(0, now - start);
        else s.stale = true;
      }
      out.push(s);
    }
    sorted.forEach(function (e) {
      if (e.k === "in") { if (open) push(open.t, null, [open]); open = e; }
      else if (open && dayKey(open.t) === dayKey(e.t)) { push(open.t, e.t, [open, e]); open = null; }
      else { if (open) push(open.t, null, [open]); open = null; push(null, e.t, [e]); }
    });
    if (open) push(open.t, null, [open]);
    return out;
  }

  // Group sessions by the day they started (an orphan "out" by its own day).
  // Newest day first. breaks = gaps between consecutive closed sessions.
  // marks: {dayKey: "off"|"half"}; a marked day exists even without punches,
  // so it shows in the history and counts in the balance.
  function fromKey(k) { var p = k.split("-"); return new Date(+p[0], p[1] - 1, +p[2]).getTime(); }
  function days(events, now, marks) {
    var byDay = {};
    function day(key, t) { return byDay[key] || (byDay[key] = { key: key, start: dayStart(t), sessions: [], ms: 0, breaks: 0, open: false, stale: false }); }
    sessions(events, now).forEach(function (s) {
      var t = s.start != null ? s.start : s.end, d = day(dayKey(t), t);
      var prev = d.sessions[d.sessions.length - 1];
      if (prev && prev.end != null && s.start != null && s.start > prev.end) d.breaks += s.start - prev.end;
      d.sessions.push(s);
      d.ms += s.ms;
      d.open = d.open || s.open;
      d.stale = d.stale || s.stale;
    });
    Object.keys(marks || {}).forEach(function (k) { day(k, fromKey(k)).mark = marks[k]; });
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
  // Today is left out until tomorrow (its progress is the "leave at" hint).
  // A day without work costs nothing: holidays, leave and sick days need no
  // bookkeeping. A day marked "half" expects half the target, and counts even
  // with no work since the other half was due; a day marked "off" expects
  // nothing, so any work on it is all extra.
  function delta(dayList, dailyMs, now) {
    var today = dayKey(now), ms = 0, n = 0;
    dayList.forEach(function (d) {
      if (d.key === today) return;
      var want = d.mark === "off" ? 0 : d.mark === "half" ? dailyMs / 2 : dailyMs;
      if (d.ms > 0 || d.mark === "half") { ms += d.ms - want; n++; }
    });
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
    if (clockedIn(events, now)) return [{ k: "out", t: lastEvent(events).t < end ? end : now, source: lastEvent(events).t < end && end < now ? "capped" : "recorded" }];
    var today = dayKey(now);
    var anyToday = events.some(function (e) { return dayKey(e.t) === today; });
    if (!anyToday && now >= atHour(now, LUNCH_IN))
      return [{ k: "in", t: atHour(now, START), source: "typical" }, { k: "out", t: atHour(now, LUNCH_OUT), source: "typical" }, { k: "in", t: atHour(now, LUNCH_IN), source: "typical" }, { k: "out", t: end, source: end < now ? "capped" : "recorded" }];
    return [{ k: "in", t: now, source: "recorded" }];
  }

  // Calendar arithmetic preserves local midnight and wall time across DST.
  function shiftDays(t, n) { var d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
  function reasons(d) {
    var out = [];
    if (d.stale) out.push("Missing clock-out");
    if (d.sessions.some(function (s) { return s.orphan; })) out.push("Missing clock-in");
    var sources = [].concat.apply([], d.sessions.map(function (s) { return s.sources; }));
    if (sources.indexOf("typical") >= 0) out.push("Typical-day estimate");
    if (sources.indexOf("capped") >= 0) out.push("Capped clock-out");
    if (sources.indexOf("manual") >= 0) out.push("Added times to check");
    if (!d.breaks && d.ms > 6 * 3600000 && !sources.every(function (source) { return source === "reviewed"; })) out.push("No break?");
    return out;
  }
  function sumDays(list) { return list.reduce(function (n, d) { return n + d.ms; }, 0); }
  // Monday–Friday schedule; missing days are unknown, never inferred leave.
  function expected(start, end, daily, marks) {
    var ms = 0;
    for (var t = dayStart(start); t < end; t = shiftDays(t, 1)) {
      if (new Date(t).getDay() === 0 || new Date(t).getDay() === 6) continue;
      var mark = (marks || {})[dayKey(t)];
      ms += mark === "off" ? 0 : mark === "half" ? daily / 2 : daily;
    }
    return ms;
  }
  function statistics(dayList, now, count) {
    var end = weekStart(now), start = shiftDays(end, -7 * count);
    var list = dayList.filter(function (d) { return d.start >= start && d.start < end; });
    var worked = list.filter(function (d) { return d.ms > 0; });
    var clean = worked.filter(function (d) { return !d.open && !reasons(d).length; });
    function median(values) {
      if (!values.length) return null;
      values.sort(function (a, b) { return a - b; });
      var mid = Math.floor(values.length / 2);
      return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }
    function minute(t) { var d = new Date(t); return d.getHours() * 60 + d.getMinutes(); }
    var recordedWeeks = weeks(worked).length, total = sumDays(list);
    var previousDays = dayList.filter(function (d) { return d.start >= shiftDays(start, -7 * count) && d.start < start; });
    var previous = sumDays(previousDays);
    return { start: start, end: end, total: total, previous: previous, hasPrevious: previousDays.some(function (d) { return d.sessions.length; }), difference: total - previous, calendarAverage: total / count,
      recordedAverage: recordedWeeks ? total / recordedWeeks : null, recordedWeeks: recordedWeeks,
      dayAverage: worked.length ? total / worked.length : null, workedDays: worked.length,
      review: list.filter(function (d) { return reasons(d).length; }), patternDays: clean.length,
      typicalStart: median(clean.map(function (d) { return minute(d.sessions[0].start); })),
      typicalFinish: median(clean.map(function (d) { return minute(d.sessions[d.sessions.length - 1].end); })),
      typicalBreak: median(clean.map(function (d) { return d.breaks; })) };
  }
  function weeklyReview(events, now, daily, marks) {
    var start = weekStart(now), previous = shiftDays(start, -7), elapsed = shiftDays(now, -7);
    var daysNow = days(events, now, marks).filter(function (d) { return d.start >= start && d.start <= now; });
    // Recompute at the equivalent wall time, clipping sessions that ended later.
    var priorEvents = events.filter(function (e) { return e.t >= previous && e.t <= elapsed; });
    var prior = days(priorEvents, elapsed, marks).filter(function (d) { return d.start >= previous && d.start <= elapsed; });
    var total = sumDays(daysNow), want = expected(start, shiftDays(start, 7), daily, marks);
    return { start: start, total: total, target: want, remaining: Math.max(0, want - total),
      previous: sumDays(prior), hasPrevious: priorEvents.length > 0, difference: total - sumDays(prior),
      review: daysNow.filter(function (d) { return reasons(d).length; }) };
  }

  return { DAY: DAY, END: END, LUNCH_OUT: LUNCH_OUT, LUNCH_IN: LUNCH_IN, dayKey: dayKey, dayStart: dayStart, weekStart: weekStart, fmt: fmt, sfmt: sfmt, hhmm: hhmm,
    shiftDays: shiftDays, reasons: reasons, statistics: statistics, weeklyReview: weeklyReview, expected: expected, sessions: sessions, days: days, weeks: weeks, delta: delta, clockedIn: clockedIn, punch: punch };
})();
if (typeof module !== "undefined") module.exports = TCM;
