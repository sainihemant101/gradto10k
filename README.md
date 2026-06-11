# 10K Build — 12-Week Training Tracker (PWA)

A progressive web app for tracking a 12-week 10K training block. Static frontend hosted on GitHub Pages, performance data stored in Firebase Firestore, installable and offline-capable on your phone.

## Architecture

```
GitHub Pages (static hosting)
 ├─ index.html / styles.css / app.js     app shell
 ├─ plan.json                            the 12-week plan (reference data)
 ├─ sw.js + manifest.webmanifest         PWA install + offline shell
 └─ firebase-config.js                   your Firebase keys (you fill in)

Google Sheet (optional, read-only)
 └─ published CSV → app refreshes plan.json content on load

Firebase
 ├─ Auth: anonymous sign-in (one tap-free identity per device)
 └─ Firestore: users/{uid}/logs/{taskId}  ← your performance entries
```

## Key design decision: plan and results are stored separately

You asked whether results should go into the training-program data or a separate store. **They are separate, deliberately:**

| | Plan | Results |
|---|---|---|
| Nature | Fixed reference data (96 tasks, known up front) | User-generated, grows daily |
| Storage | `plan.json` in the repo (optionally refreshed from the published sheet CSV) | Firestore `users/{uid}/logs/{taskId}` |
| Writes | Never written by the app | Written every time you log |

Why this wins over merging results into the plan rows:

1. **Re-syncing the plan can never destroy your logs.** If you tweak the sheet (move a run, change a distance), the app picks up the new plan while every logged result survives, joined back by `taskId` (`YYYY-MM-DD_run`).
2. **No Firestore reads for the plan** — it ships with the app and works offline instantly. You only pay reads/writes for logs, which keeps you comfortably inside the free tier (~1 write/day).
3. **Analytics is one query**: stream the `logs` collection once, join to the in-memory plan, compute everything client-side.

A log document looks like:

```json
{
  "taskId": "2026-06-16_run",
  "date": "2026-06-16",
  "week": 1,
  "type": "run",
  "runType": "Intervals",
  "plannedKm": 4.3,
  "status": "done | partial | skipped",
  "distanceKm": 4.5,
  "timeMin": 32,
  "difficulty": 6,
  "completionPct": 100,
  "loggedAt": "...", "serverLoggedAt": "<server timestamp>"
}
```

The doc ID **is** the taskId, so logging twice simply updates the same entry (no duplicates, edit = overwrite).

## Features

**Today page** — date stepper (backfill missed days), one race-bib card per task (Wednesdays show both the run and the lift), and a flashcard logger that asks one question at a time: completed? → distance → time → difficulty (1–10) → completion % (for partials) → save.

**Analytics page** — runs only:
1. % of runs completed of all planned runs
2. Consistency strip: of the last 5/10/15/20 due runs, which were done/partial/skipped, plus your current consecutive streak
3. Total distance logged (vs the 324 km in the plan)
4. Total runs completed (of 60)
5. % and count of runs left to go
6. Bonus: 12-week lane progress bar and weekly km done-vs-planned bars

**Offline** — service worker caches the shell; Firestore's persistent local cache queues writes made offline and syncs when you're back online. If Firebase isn't configured yet, logs fall back to localStorage so you can start using it immediately.

## Setup (one-time, ~15 minutes)

### 1. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics optional).
2. **Build → Authentication → Sign-in method → Anonymous → Enable.**
3. **Build → Firestore Database → Create database** (production mode, region `asia-south1` for Bengaluru).
4. **Rules** tab → paste and publish:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/logs/{logId} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. Project settings → **Your apps → Web (</>)** → register → copy the `firebaseConfig` object into `firebase-config.js`.

> Anonymous auth ties data to the device/browser profile. If you later want the same data on two devices, upgrade the anonymous account to Google sign-in — the uid (and data) carries over.

### 2. GitHub Pages

1. Create a repo, push all files to `main` (root).
2. Repo → **Settings → Pages → Source: Deploy from a branch → main / root**.
3. Your app is at `https://<username>.github.io/<repo>/`. Open it on your phone → browser menu → **Add to Home Screen**.

### 3. (Optional) Live plan from the Google Sheet

GitHub Pages is static, so the app reads the sheet via its public CSV feed:

1. In the sheet: **File → Share → Publish to web** → select the plan tab → **CSV** → publish, copy the URL.
2. Paste it into `SHEET_CSV_URL` in `firebase-config.js`.

On every load the app tries the sheet first and falls back to the bundled `plan.json` (and the cached copy) if you're offline. Column headers and the `15-Jun-2026` date format must stay as they are.

If you'd rather not publish the sheet, skip this — `plan.json` already contains the full 12 weeks. To regenerate it after editing the sheet: download the tab as CSV and rerun the converter (any CSV→JSON step that produces the same fields).

## Local development

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

(Service workers and ES modules need http://, not file://.)

## File map

| File | Purpose |
|---|---|
| `index.html` | App shell: Today view, Analytics view, flashcard overlay, tab bar |
| `styles.css` | Race-bib / split-timer visual system |
| `app.js` | Plan loading, Firebase sync, flashcards, analytics math |
| `plan.json` | All 96 tasks (60 runs, 324.4 km) generated from your sheet |
| `firebase-config.js` | Your keys + optional sheet CSV URL |
| `sw.js` | Offline caching |
| `manifest.webmanifest`, `icons/` | Installability |
