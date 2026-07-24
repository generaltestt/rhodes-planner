# Rhodes Planner

A personal trip planner for Rhodes. Search places (reviews, photos, ratings via Google), organise them into folders, see everything on a map, then drag places onto days in a calendar-style planner that calculates walking/driving time between stops and warns you when a day is too tight. Works offline on your iPhone as a PWA once installed.

## Stack

- **Backend:** Node.js built-ins only — `node:http` + `node:sqlite`. Zero server dependencies.
- **Frontend:** React + Vite, Leaflet + OpenStreetMap (map), dnd-kit (drag and drop).
- **Data sources:** Google Places API New (search/reviews/photos), FOSSGIS OSRM (walking/driving times, with automatic straight-line estimates as fallback).
- **Storage:** single SQLite file in `data/` (or `DATA_DIR`).

Requires **Node 22+** (for built-in SQLite).

## Setup (on your Mac)

```bash
npm install          # installs frontend build deps only
cp .env.example .env # then edit .env:
```

1. Set `APP_PASSWORD` to whatever you want the login screen to accept.
2. Get a **Google Places API key** - see "Google Cloud setup" below. Paste it as `GOOGLE_PLACES_API_KEY`.
3. Set `APP_SECRET` to any random string.

The server reads `.env` automatically (no dotenv package needed). Then:

```bash
npm run build
npm start
# open http://localhost:3000
```

The Node 22 SQLite warning ("SQLite is an experimental feature") on startup is expected and harmless.

## Google Cloud setup

Google's Places API is genuinely free for basic search, but reviews and photos live in a paid tier - there's no way around a card on file with any provider that has real reviews/photos (we checked). The good news: personal, single-user usage for a week-long trip stays inside Google's free monthly call allowances in every realistic scenario, so the actual bill should land at $0, with a hard ceiling nowhere near what you'd notice.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (top-left project picker -> New Project).
2. **Enable billing** on that project: menu -> Billing -> link a card. This is required to use the API at all, even within the free allowance.
3. Enable the API: search for **"Places API (New)"** in the top search bar -> Enable.
4. Create a key: menu -> APIs & Services -> Credentials -> Create Credentials -> API Key.
5. **Restrict the key** (click into it after creating): under "API restrictions" choose "Restrict key" and select only Places API (New). This stops the key being usable for anything else if it ever leaks.
6. Copy the key into `.env` as `GOOGLE_PLACES_API_KEY`.

**Cost safety net (2 minutes, worth doing):** Billing -> Budgets & alerts -> Create budget. Set it to $10, with an email alert at 50%/90%/100%. This won't stop calls automatically, but you'll know immediately if anything unexpected is happening instead of finding out weeks later.

Why it should cost ~$0: Google gives free monthly call allowances per pricing tier - 10,000 for basic fields, 5,000 for richer fields, 1,000 for the reviews/photos tier. A solo trip's worth of searching and browsing places (realistically well under 200 total calls across the week) sits entirely inside that 1,000-call free tier for reviews/photos, and inside the 10,000/5,000 tiers for everything else.

## Deploying (so your iPhone can reach it)

Either Railway or Render works. The shape is the same:

1. Push this folder to a **private** GitHub repo.
2. Create a new web service from that repo.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
3. Add environment variables in the dashboard: `APP_PASSWORD`, `GOOGLE_PLACES_API_KEY`, `APP_SECRET`, and `DATA_DIR=/data`.
4. Attach a **persistent volume** mounted at `/data` (Railway: service -> Volumes; Render: Disks). Without this the SQLite file is wiped on every redeploy.
5. Deploy. You'll get a public URL - that's what you open on both Mac and iPhone.

## iPhone offline setup

1. Open the deployed URL in Safari and log in.
2. Share button -> **Add to Home Screen**. This installs it as a PWA.
3. Open it once with signal each morning: the itinerary, travel times you've already viewed, and cached photos/tiles then work with no connection. Offline is read-only by design; planning happens on the Mac.

## How travel times work

- **Walk / drive:** calculated via the public FOSSGIS OSRM routing servers. When those are unreachable, the app falls back to a straight-line estimate (marked with `~` in the UI) at 4.5 km/h walking or 40 km/h driving with a 1.3x route factor.
- **Bus:** no free routing data exists for Rhodes' KTEL network, so you type your own estimate into the connector.
- Results are cached (server memory + browser localStorage), so once seen they work offline.

## Project layout

```
server/index.js   HTTP server, auth, API, Google Places + OSRM proxies
server/db.js      SQLite schema + seed (trip dates default 25 Jul - 1 Aug 2026, editable in-app)
client/           React app (Vite root)
  src/components/   Search, PlaceDetail, Folders, Map, Planner, Overview
  public/sw.js      Service worker: offline caching
dist/             Built frontend (created by npm run build)
data/rhodes.db    Your data (gitignore this)
```

## Notes

- Uses Google's current **Places API (New)** (`places.googleapis.com/v1`), not the deprecated legacy Places API. Field masks are kept tight per call (see `server/index.js`) specifically to avoid tripping into a pricier SKU tier than each screen needs - search stays out of the reviews tier, only the single per-place detail call pays for reviews.
- The login is a simple single-password gate suitable for a personal app. Don't reuse a password you use elsewhere.
- Photos are served through `/api/photo/...`, a small proxy that hides your API key from the browser and caches images in server memory so re-viewing a place doesn't trigger a fresh billable call each time.
- To back up your trip, just copy `data/rhodes.db` (or download it from your host's volume).
