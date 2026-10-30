# ⏱ Tiny Clock Machine

https://colinleverger.github.io/tiny-clock-machine/

A tiny **static** punch clock (no backend). One button: clock in when you
arrive, clock out and back in around lunch, clock out when you leave. It
keeps the punches in your browser and shows how long you actually worked —
today, this week, the last few weeks, all time.

Sibling of [Tiny Tab Maker](https://github.com/ColinLeverger/tiny-tab-maker):
same recipe, plain HTML/CSS/JS, hosted on **GitHub Pages**, installable as a
**PWA**, works offline after the first visit, follows the system's light or
dark mode.

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

- **Clock in / Clock out** — the big button stays at the bottom, within thumb
  reach and above the iPhone home indicator. It is green when you are out,
  red when you are in. Today's total is the main number, with your current
  state and the time you can **leave** to meet the daily target. The button
  moves out of the way while a form input is focused. Forgot the whole day? The
  first press after **14:00** (device local time) records a typical day —
  09:00–12:00, 14:00–now — so that press is your evening clock-out. The button
  says **Record typical day** and shows the hours before you tap. A day
  never ends after the **Day ends** time (in *⚙ Settings*, 18:30 by
  default): a press at 20:40 says **Clock out at 18:30**. A forgotten
  clock-out is not two extra hours. Fix the times in the day editor if they
  were off.
  Every press shows what it recorded for a few seconds, with an **Undo**
  button: a mis-tap, or the whole typical day, comes back out in one tap.
- **Tiles** — this week (with its ± against the target), and the **balance**:
  hours worked minus the target, summed over every closed day with work.
  "Day" means a day with at least one closed session. Tap the balance tile
  to count it from today on, and again to go back to all time: an all-time
  balance stops meaning anything after a year.
- **Trends** — expand to see the average of the last four full weeks and
  twelve weeks as bars, with the weekly target as a dashed line and the
  running week lighter. Tap a bar, use Enter/Space, or pick a week from the
  dropdown to show its numbers.
- **Target** — hours per week, in *⚙ Settings* (default 39). A fifth of it
  is the daily target behind *leave at*, the week's ± and the balance. Today
  is left out of the balance while it runs. A day without work costs
  nothing, so holidays and sick days need no bookkeeping — the balance
  answers "do I work more than a normal day on the days I work", not "how
  many days off have I banked".
- **Half day / Day off** — expand *Add a day / mark time off*, pick a date,
  press one of them (again to unmark).
  A *half day* expects half the daily target, so four hours on it count
  +0h06 instead of −3h48, and it counts even with no work: the other half
  was due. A *day off* expects nothing, so any work on it is all extra. A
  marked day shows in the history even without punches.
- **● Badge on icon** (in *⚙ Settings*) — a dot on the home-screen icon (and in the tab title)
  while you are clocked in, so a glance at the phone at 21:00 says you
  forgot. Installed app only; iOS and Android draw it once you allow
  notifications, which is all that button asks.
- **Today's sessions / History** — today's sessions appear first, followed
  by earlier days grouped by week (Monday start), one row per session.
  Each day has a bar from 06:00 to 20:00, one block per session: a long
  single block is a forgotten lunch, hatched is still open, the thin tick is
  the day-end cap.
  Tap **Edit** on a day to correct times using native time inputs; changes
  save automatically. **Done** closes the editor. **Delete** removes a
  session after confirmation. **Add lunch break** clocks you out at 12:00
  and back in at 14:00, then fix the times. Editors and focus stay in place
  during the 30-second counter refresh. A day of six
  hours or more with no break is flagged *no break?*, since that is nearly
  always a forgotten lunch. **+ Add day** inserts a 09:00–17:00 session on
  the chosen date for days you forgot entirely, then fix the times.
- **⇅ Export / import** — JSON is everything: `{ "events": [{ "k": "in"|"out",
  "t": ms }], "settings": { "target", "end", "since" }, "days": { "YYYY-MM-DD":
  "off"|"half" } }`. Import merges and de-duplicates, it never wipes what is
  already there; an older export that is a bare list still imports. CSV is
  one row per day (date, mark, first in, last out, break, worked, vs target)
  with hours as decimals, for a spreadsheet.
- **☁ GitHub backup** — see below. The footer tells you how many punches the
  browser holds, whether they are backed up, and when you last exported.

## Punch from a tag or a shortcut

Opening the app with `?punch` in the URL presses the button once and drops
the parameter:

    https://colinleverger.github.io/tiny-clock-machine/?punch

Write that URL on an NFC tag stuck to the desk, make it an iOS Shortcut
(*Open URLs*, then Siri or a location automation), or on Android long-press
the installed icon: it has a **Punch** shortcut. A second open within a
minute is treated as a double tap and ignored. The tab shows the result for
a second, pushes the backup, then **closes itself** — in Chromium browsers
(Brave, Chrome, Edge) and Firefox, which let a page close a tab that has no
history; Safari keeps it open.

Which browser opens the URL is a phone setting, not the app's: the tag and
*Open URLs* use the **default browser** (Settings → your browser → Default
Browser App on iOS). To force one from a Shortcut regardless, open
`brave://open-url?url=https://colinleverger.github.io/tiny-clock-machine/?punch`
(same idea for `googlechrome://` or `firefox://open-url?url=`).

The browser that opens the URL must be the one holding your punches, or
share them through the backup. On iOS a Shortcut or a tag never opens the
home-screen app, and the browser and the app have separate storage: connect
both to the GitHub backup below, the browser pushes the punch and the app
takes it the next time it comes to the front.

## GitHub backup (free, no server)

Browser storage is a strong default, not a guarantee: deleting the
home-screen icon, replacing the phone, or clearing Safari data loses it. The
backup pushes the log, the settings and the day marks to one file in a
**private** repository you own, using the GitHub Contents API, after every
change.

1. Create a private repository (initialise it with a README so `main` exists).
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   restricted to that repository with **Contents: read and write**, nothing else.
   Give it the longest expiry GitHub allows (one year): once it expires every
   push fails, and the warning under the button is the only thing that says
   so. Reconnect with a new token when that happens.
3. In the app, open *☁ GitHub backup*, enter `owner/repository` and the
   token, **Connect**. If the repo already has a `tiny-clock.json` the two
   copies are merged.

From then on each change is pushed two seconds later (or when the app goes to
the background) as a commit to `tiny-clock.json`. A fresh browser with the
same repo and token **loads the file back on start**. A browser with nothing
unsaved checks GitHub whenever it comes to the front and takes the newer
copy, so punches from another device show up by themselves. The file sha is sent
with every push. If another device wrote in between, the push is refused and
the two copies are merged three ways against the copy this device last
pushed: punches added on either side are kept, a punch deleted or moved on
one side stays deleted or moved, and the merge is pushed. If both devices
moved the same punch, both times are kept and the extra one shows up as an
open or orphan row to fix by hand. Settings and day marks have no history:
on a refused push this device's values win per key, otherwise the copy taken
from GitHub wins. **⬆ Push** (overwrite GitHub with this
device) and **⬇ Pull** (replace this device with GitHub) stay for the rare
case where the retry is refused too. When a push has been failing for a
day, or never worked, a warning appears under the button with GitHub's
answer.

The token lives in this browser's localStorage, next to the punches. It can
only touch that one repository. Revoke it on GitHub if the phone goes
missing. One caveat: localStorage is per origin, and GitHub Pages serves
every project of an account from the same origin (`user.github.io`), so a
script running on any other page of that account, including third-party
libraries those pages load from a CDN, can read the token. What it gets is
read and write access to that one private repository and its punch log,
which the git history restores. If that is too much, serve the app from a
domain of your own (a `CNAME` file in the repo) so it gets its own origin.

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

## UI checks

Run `node --test tests/clock.test.js tests/sync.test.js` for clock and sync
logic. With the local server running, open `http://localhost:8000/tests/ui.html`
for browser checks covering punches, Undo, time edits, lunch splits, deletion,
focus preservation, chart selection, narrow widths and larger text. Fixtures
use in-memory storage and leave your punches untouched. Check the installed
PWA on a real iPhone for safe areas, the native time picker and keyboard behavior.

## Licence

MIT, see [LICENSE](LICENSE).
