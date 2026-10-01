# ⏱ Tiny Clock Machine

https://colinleverger.github.io/tiny-clock-machine/

A tiny **static** punch clock (no backend). One button: clock in when you
arrive, clock out and back in around lunch, clock out when you leave. It
keeps the punches in your browser and shows how long you actually worked —
today, this week, the last few weeks, all time.

Sibling of [Tiny Tab Maker](https://github.com/ColinLeverger/tiny-tab-maker):
same recipe, plain HTML/CSS/JS, hosted on **GitHub Pages**, installable as a
**PWA**, works offline after the first visit.

## ⚠️ Honest disclaimer

It is shaped around one person's day (mine): day shifts, one lunch break,
no night work. A session **never crosses midnight** on purpose, so a
forgotten clock-out does not swallow the next morning: it shows up as
"⚠ open" in the history and you type the time you actually left.

It is a weekend tool, not a product. Fork it, bend it.

## Quick start

No build step.

```bash
python3 -m http.server 8000      # then http://localhost:8000
# or just open index.html
```

On a phone: open the Pages URL, **Add to Home Screen**. That is the PWA.

## Using it

- **Clock in / Clock out** — the big button. It is green when you are out,
  red when you are in. The line under it shows since when and today's total.
- **Tiles** — today (with the break length), this week, average of the last
  four full weeks, all-time average per worked day. "Day" means a day with
  at least one closed session.
- **History** — one block per week (Monday start), one row per session.
  Every time is an `<input type="time">`: tap it to correct a punch. `×`
  deletes a session. **+ Add day** inserts a 09:00–17:00 session on the
  chosen date for days you forgot entirely, then fix the times.
- **Export / Import JSON** — the whole log as `[{ "k": "in"|"out", "t": ms }]`.
  Import merges and de-duplicates, it never wipes what is already there.

## Privacy

Punches live in `localStorage` of the browser you use, nothing leaves the
device, nothing is committed here (`.gitignore` covers the export filename).
A browser that clears site data clears your timesheet: **export now and
then**. Safari evicts storage of web pages not used for a week, an installed
home-screen app is exempt.

## Layout

```
index.html            page, styles and app code (one file)
js/clock.js           pure maths: events -> sessions -> days -> weeks
tests/clock.test.js   node tests/clock.test.js
sw.js                 offline cache, stamped with the commit SHA on deploy
manifest.webmanifest  PWA install
icons/                app icons
.github/workflows     runs the test, deploys to GitHub Pages on push to main
```

## Licence

MIT, see [LICENSE](LICENSE).
