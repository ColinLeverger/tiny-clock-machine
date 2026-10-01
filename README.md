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
  red when you are in. The line under it shows since when, today's total and
  when you can **leave** to meet the daily target. Forgot the whole day? The
  first press after **14:00** (device local time) records a typical day —
  09:00–12:00, 14:00–now — so that press is your evening clock-out. A day
  never ends after **19:00**: a press at 20:40 clocks you out at 19:00, a
  forgotten clock-out is not two extra hours. Fix the times in the history
  if they were off.
- **Tiles** — today (with the break length), this week (with its ± against
  the target), average of the last four full weeks, and the **balance**:
  hours worked minus the target, summed over every closed day with work.
  "Day" means a day with at least one closed session.
- **Target** — hours per week, bottom of the page (default 39). A fifth of it
  is the daily target behind *leave at*, the week's ± and the balance. Today
  is left out of the balance while it runs. A day without work costs
  nothing, so holidays and sick days need no bookkeeping — the balance
  answers "do I work more than a normal day on the days I work", not "how
  many days off have I banked".
- **● Badge on icon** — a dot on the home-screen icon (and in the tab title)
  while you are clocked in, so a glance at the phone at 21:00 says you
  forgot. Installed app only; iOS and Android draw it once you allow
  notifications, which is all that button asks.
- **History** — one block per week (Monday start), one row per session.
  Every time is an `<input type="time">`: tap it to correct a punch. `×`
  deletes a session. **+ Add day** inserts a 09:00–17:00 session on the
  chosen date for days you forgot entirely, then fix the times.
- **Export / Import JSON** — the whole log as `[{ "k": "in"|"out", "t": ms }]`.
  Import merges and de-duplicates, it never wipes what is already there.
- **☁ GitHub backup** — see below. The footer tells you how many punches the
  browser holds, whether they are backed up, and when you last exported.

## Punch from a tag or a shortcut

Opening the app with `?punch` in the URL presses the button once and drops
the parameter:

    https://colinleverger.github.io/tiny-clock-machine/?punch

Write that URL on an NFC tag stuck to the desk, make it an iOS Shortcut
(*Open URLs*, then Siri or a location automation), or on Android long-press
the installed icon: it has a **Punch** shortcut. A second open within a
minute is treated as a double tap and ignored.

On iOS a Shortcut or a tag opens **Safari**, not the home-screen app, and the
two have separate storage. Connect both to the GitHub backup below: Safari
pushes the punch, the app takes it the next time it comes to the front.

## GitHub backup (free, no server)

Browser storage is a strong default, not a guarantee: deleting the
home-screen icon, replacing the phone, or clearing Safari data loses it. The
backup pushes the log to one file in a **private** repository you own, using
the GitHub Contents API, after every punch.

1. Create a private repository (initialise it with a README so `main` exists).
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   restricted to that repository with **Contents: read and write**, nothing else.
3. In the app, open *☁ GitHub backup*, enter `owner/repository` and the
   token, **Connect**. If the repo already has a `tiny-clock.json` the two
   copies are merged.

From then on each punch is pushed two seconds later (or when the app goes to
the background) as a commit to `tiny-clock.json`. A fresh browser with the
same repo and token **loads the file back on start**. A browser with nothing
unsaved checks GitHub whenever it comes to the front and takes the newer
copy, so punches from another device show up by themselves. The file sha is sent
with every push, so if another device wrote in between the push is refused
and the status says so: **⬆ Push** overwrites GitHub with this device,
**⬇ Pull** replaces this device with GitHub.

The token lives in this browser's localStorage, next to the punches. It can
only touch that one repository. Revoke it on GitHub if the phone goes
missing.

## Privacy

Punches live in `localStorage` of the browser you use. Nothing leaves the
device unless you connect the GitHub backup, and then only to your own
private repository. Nothing is committed here (`.gitignore` covers the
export filename). Safari evicts storage of web pages not used for a week;
an installed home-screen app is exempt from that rule, but not from a
deleted icon or a lost phone. Connect the backup, or export now and then.

## Layout

```
index.html            page, styles and app code (one file)
js/clock.js           pure maths: events -> sessions -> days -> weeks
js/sync.js            GitHub Contents API backup (push after change, pull when empty)
tests/                node tests/clock.test.js && node tests/sync.test.js
sw.js                 offline cache, stamped with the commit SHA on deploy
manifest.webmanifest  PWA install
icons/                app icons
.github/workflows     runs the test, deploys to GitHub Pages on push to main
```

## Licence

MIT, see [LICENSE](LICENSE).
