import "./env.js";
import http from "http";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "rhodes2026";
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const SECRET = process.env.APP_SECRET || "rhodes-planner-local-secret";
const TOKEN = crypto.createHash("sha256").update(APP_PASSWORD + SECRET).digest("hex");

// Bounding rectangle around the whole of Rhodes island (with a small margin)
const RHODES_SW_LAT = 35.8;
const RHODES_SW_LNG = 27.6;
const RHODES_NE_LAT = 36.55;
const RHODES_NE_LNG = 28.35;

// ---------- tiny helpers ----------
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function rowToPlace(row) {
  if (!row) return null;
  const folderIds = db
    .prepare("SELECT folder_id FROM place_folders WHERE place_id = ?")
    .all(row.id)
    .map((r) => r.folder_id);
  return {
    id: row.id,
    placeId: row.place_id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    rating: row.rating,
    category: row.category,
    photos: JSON.parse(row.photos || "[]"),
    tips: JSON.parse(row.tips || "[]"),
    note: row.note,
    source: row.source,
    folderIds,
  };
}

// ---------- Google Places API (New) ----------
// Field masks are kept deliberately tight per call to avoid tripping into a
// pricier SKU tier than each screen actually needs. See README for the cost
// breakdown. Docs: https://developers.google.com/maps/documentation/places/web-service/data-fields
const GOOGLE_BASE = "https://places.googleapis.com/v1";

// Search results list only needs enough to render a row + dedupe -
// this stays out of the reviews tier (Enterprise+Atmosphere) on purpose,
// since search fires far more often than opening a detail view.
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
  "places.photos",
].join(",");

// Full detail view - this is the one call per place that pulls reviews,
// so it's the only place we pay the Enterprise+Atmosphere rate.
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "rating",
  "photos",
  "reviews",
  "editorialSummary",
].join(",");

function normalizeGooglePlace(p) {
  const photos = (p.photos || [])
    .slice(0, 8)
    .map((ph) => ph.name)
    .filter(Boolean);
  const tips = (p.reviews || [])
    .slice(0, 8)
    .map((r) => r.text?.text || r.originalText?.text)
    .filter(Boolean);
  const summary = p.editorialSummary?.text;
  return {
    placeId: p.id || null,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    category: (p.types || [])[0]?.replace(/_/g, " ") || "",
    rating: p.rating ?? null,
    photos, // photo resource "names" - fetched through our own /api/photo proxy
    tips: summary ? [summary, ...tips] : tips,
  };
}

async function handleSearch(req, res, url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json(res, 200, { results: [] });
  if (!GOOGLE_API_KEY)
    return json(res, 400, { error: "No Google Places API key set. Add GOOGLE_PLACES_API_KEY to your .env file." });
  try {
    const r = await fetch(`${GOOGLE_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: q,
        // Hard restriction (not bias): only return results inside this
        // rectangle around Rhodes island. A soft bias lets world-famous
        // namesakes elsewhere outrank the local place you actually meant.
        locationRestriction: {
          rectangle: {
            low: { latitude: RHODES_SW_LAT, longitude: RHODES_SW_LNG },
            high: { latitude: RHODES_NE_LAT, longitude: RHODES_NE_LNG },
          },
        },
        maxResultCount: 15,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      return json(res, 502, { error: `Google error ${r.status}`, detail: body.slice(0, 400) });
    }
    const data = await r.json();
    const results = (data.places || []).map(normalizeGooglePlace).filter((p) => p.lat && p.lng);
    json(res, 200, { results });
  } catch (e) {
    json(res, 502, { error: "Search failed: " + e.message });
  }
}

async function handlePlaceDetails(req, res, placeId) {
  if (!GOOGLE_API_KEY) return json(res, 400, { error: "No Google Places API key set." });
  try {
    const r = await fetch(`${GOOGLE_BASE}/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": GOOGLE_API_KEY, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
    });
    if (!r.ok) {
      const body = await r.text();
      return json(res, 502, { error: `Google error ${r.status}`, detail: body.slice(0, 400) });
    }
    const data = await r.json();
    json(res, 200, normalizeGooglePlace(data));
  } catch (e) {
    json(res, 502, { error: "Details failed: " + e.message });
  }
}

// Photo proxy: hides the API key from the browser and caches bytes in memory
// so re-viewing a place (or the offline PWA cache) doesn't trigger a fresh
// billable Photo call every time.
const photoCache = new Map(); // name -> { contentType, buffer, ts }
const PHOTO_CACHE_MAX = 400;

async function handlePhoto(req, res, encodedName) {
  if (!GOOGLE_API_KEY) return json(res, 400, { error: "No Google Places API key set." });
  const name = decodeURIComponent(encodedName);
  if (photoCache.has(name)) {
    const { contentType, buffer } = photoCache.get(name);
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=604800" });
    return res.end(buffer);
  }
  try {
    const r = await fetch(
      `${GOOGLE_BASE}/${name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}&skipHttpRedirect=false`,
      { redirect: "follow" }
    );
    if (!r.ok) return json(res, 502, { error: `Photo fetch failed ${r.status}` });
    const buffer = Buffer.from(await r.arrayBuffer());
    const contentType = r.headers.get("content-type") || "image/jpeg";
    if (photoCache.size >= PHOTO_CACHE_MAX) {
      const oldest = [...photoCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) photoCache.delete(oldest[0]);
    }
    photoCache.set(name, { contentType, buffer, ts: Date.now() });
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=604800" });
    res.end(buffer);
  } catch (e) {
    json(res, 502, { error: "Photo fetch failed: " + e.message });
  }
}

// ---------- routing (OSRM via FOSSGIS, offline-safe estimate fallback) ----------
const routeCache = new Map();
const OSRM_SERVERS = { foot: "routed-foot", car: "routed-car" };

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateRoute(lat1, lng1, lat2, lng2, mode) {
  const km = haversineKm(lat1, lng1, lat2, lng2) * 1.3;
  const speedKmh = mode === "car" ? 40 : 4.5;
  return {
    km: Math.round(km * 10) / 10,
    minutes: Math.max(1, Math.round((km / speedKmh) * 60)),
    source: "estimate",
  };
}

async function handleRoute(req, res, url) {
  const m = url.searchParams.get("mode") === "car" ? "car" : "foot";
  const [lat1, lng1] = (url.searchParams.get("from") || "").split(",").map(Number);
  const [lat2, lng2] = (url.searchParams.get("to") || "").split(",").map(Number);
  if ([lat1, lng1, lat2, lng2].some((n) => !Number.isFinite(n)))
    return json(res, 400, { error: "from and to must be lat,lng" });

  const key = `${m}:${lat1.toFixed(5)},${lng1.toFixed(5)}:${lat2.toFixed(5)},${lng2.toFixed(5)}`;
  if (routeCache.has(key)) return json(res, 200, routeCache.get(key));

  try {
    const osrmUrl = `https://routing.openstreetmap.de/${OSRM_SERVERS[m]}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(osrmUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "rhodes-planner-personal" },
    });
    clearTimeout(timer);
    if (r.ok) {
      const data = await r.json();
      const route = data.routes?.[0];
      if (route) {
        const result = {
          km: Math.round((route.distance / 1000) * 10) / 10,
          minutes: Math.max(1, Math.round(route.duration / 60)),
          source: "osrm",
        };
        routeCache.set(key, result);
        return json(res, 200, result);
      }
    }
  } catch {}
  const fallback = estimateRoute(lat1, lng1, lat2, lng2, m);
  routeCache.set(key, fallback);
  json(res, 200, fallback);
}

// ---------- static files ----------
const dist = path.join(__dirname, "..", "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function serveStatic(req, res, pathname) {
  let filePath = path.normalize(path.join(dist, pathname));
  if (!filePath.startsWith(dist)) return json(res, 403, { error: "Forbidden" });
  if (pathname === "/" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(dist, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Frontend not built yet. Run: npm run build");
  }
  const ext = path.extname(filePath);
  const isAsset = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
}

// ---------- request router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  const method = req.method;

  try {
    if (!p.startsWith("/api/")) return serveStatic(req, res, p);

    // login (no auth)
    if (p === "/api/login" && method === "POST") {
      const { password } = await readBody(req);
      if (password === APP_PASSWORD) return json(res, 200, { token: TOKEN });
      return json(res, 401, { error: "Wrong password" });
    }

    // auth for everything else under /api
    // (the photo route also accepts the token as ?t= because <img> tags
    // can't send Authorization headers)
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : p.startsWith("/api/photo/")
        ? url.searchParams.get("t") || ""
        : "";
    if (token !== TOKEN) return json(res, 401, { error: "Not signed in" });

    // ---- search / details / photo / route ----
    if (p === "/api/search" && method === "GET") return handleSearch(req, res, url);
    let m;
    if ((m = p.match(/^\/api\/place-details\/(.+)$/)) && method === "GET")
      return handlePlaceDetails(req, res, decodeURIComponent(m[1]));
    if ((m = p.match(/^\/api\/photo\/(.+)$/)) && method === "GET")
      return handlePhoto(req, res, m[1]);
    if (p === "/api/route" && method === "GET") return handleRoute(req, res, url);

    // ---- places ----
    if (p === "/api/places" && method === "GET") {
      const rows = db.prepare("SELECT * FROM places ORDER BY created_at DESC, id DESC").all();
      return json(res, 200, rows.map(rowToPlace));
    }
    if (p === "/api/places" && method === "POST") {
      const b = await readBody(req);
      if (!b.name || typeof b.lat !== "number" || typeof b.lng !== "number")
        return json(res, 400, { error: "name, lat and lng are required" });
      if (b.placeId) {
        const existing = db.prepare("SELECT * FROM places WHERE place_id = ?").get(b.placeId);
        if (existing) {
          for (const fid of b.folderIds || []) {
            db.prepare("INSERT OR IGNORE INTO place_folders (place_id, folder_id) VALUES (?, ?)").run(existing.id, fid);
          }
          return json(res, 200, rowToPlace(db.prepare("SELECT * FROM places WHERE id = ?").get(existing.id)));
        }
      }
      const info = db
        .prepare(
          `INSERT INTO places (place_id, name, address, lat, lng, rating, category, photos, tips, note, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          b.placeId || null,
          b.name,
          b.address || "",
          b.lat,
          b.lng,
          b.rating ?? null,
          b.category || "",
          JSON.stringify(b.photos || []),
          JSON.stringify(b.tips || []),
          b.note || "",
          b.source || "api"
        );
      const newId = Number(info.lastInsertRowid);
      for (const fid of b.folderIds || []) {
        db.prepare("INSERT OR IGNORE INTO place_folders (place_id, folder_id) VALUES (?, ?)").run(newId, fid);
      }
      return json(res, 200, rowToPlace(db.prepare("SELECT * FROM places WHERE id = ?").get(newId)));
    }
    if ((m = p.match(/^\/api\/places\/(\d+)$/)) && method === "PATCH") {
      const id = Number(m[1]);
      const row = db.prepare("SELECT * FROM places WHERE id = ?").get(id);
      if (!row) return json(res, 404, { error: "Place not found" });
      const b = await readBody(req);
      if (typeof b.note === "string") db.prepare("UPDATE places SET note = ? WHERE id = ?").run(b.note, id);
      if (Array.isArray(b.folderIds)) {
        db.prepare("DELETE FROM place_folders WHERE place_id = ?").run(id);
        for (const fid of b.folderIds) {
          db.prepare("INSERT OR IGNORE INTO place_folders (place_id, folder_id) VALUES (?, ?)").run(id, fid);
        }
      }
      return json(res, 200, rowToPlace(db.prepare("SELECT * FROM places WHERE id = ?").get(id)));
    }
    if ((m = p.match(/^\/api\/places\/(\d+)$/)) && method === "DELETE") {
      const id = Number(m[1]);
      db.prepare("DELETE FROM place_folders WHERE place_id = ?").run(id);
      db.prepare("DELETE FROM places WHERE id = ?").run(id);
      const days = db.prepare("SELECT * FROM days").all();
      for (const d of days) {
        const stops = JSON.parse(d.stops || "[]");
        const filtered = stops.filter((s) => s.placeId !== id);
        if (filtered.length !== stops.length) {
          db.prepare("UPDATE days SET stops = ? WHERE date = ?").run(JSON.stringify(filtered), d.date);
        }
      }
      return json(res, 200, { ok: true });
    }

    // ---- folders ----
    if (p === "/api/folders" && method === "GET") {
      const rows = db.prepare("SELECT * FROM folders ORDER BY created_at ASC, id ASC").all();
      return json(
        res,
        200,
        rows.map((f) => ({
          id: f.id,
          name: f.name,
          count: db.prepare("SELECT COUNT(*) AS c FROM place_folders WHERE folder_id = ?").get(f.id).c,
        }))
      );
    }
    if (p === "/api/folders" && method === "POST") {
      const b = await readBody(req);
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Folder needs a name" });
      try {
        const info = db.prepare("INSERT INTO folders (name) VALUES (?)").run(name);
        return json(res, 200, { id: Number(info.lastInsertRowid), name, count: 0 });
      } catch {
        return json(res, 400, { error: "A folder with that name already exists" });
      }
    }
    if ((m = p.match(/^\/api\/folders\/(\d+)$/)) && method === "PATCH") {
      const b = await readBody(req);
      const name = (b.name || "").trim();
      if (!name) return json(res, 400, { error: "Folder needs a name" });
      db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, Number(m[1]));
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/folders\/(\d+)$/)) && method === "DELETE") {
      const id = Number(m[1]);
      db.prepare("DELETE FROM place_folders WHERE folder_id = ?").run(id);
      db.prepare("DELETE FROM folders WHERE id = ?").run(id);
      return json(res, 200, { ok: true });
    }

    // ---- trip + days ----
    if (p === "/api/trip" && method === "GET") {
      const t = db.prepare("SELECT * FROM trip WHERE id = 1").get();
      return json(res, 200, { startDate: t.start_date, endDate: t.end_date });
    }
    if (p === "/api/trip" && method === "PUT") {
      const b = await readBody(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(b.endDate || ""))
        return json(res, 400, { error: "Dates must be YYYY-MM-DD" });
      if (b.endDate < b.startDate) return json(res, 400, { error: "End date is before start date" });
      db.prepare("UPDATE trip SET start_date = ?, end_date = ? WHERE id = 1").run(b.startDate, b.endDate);
      return json(res, 200, { startDate: b.startDate, endDate: b.endDate });
    }
    if (p === "/api/days" && method === "GET") {
      const rows = db.prepare("SELECT * FROM days").all();
      return json(
        res,
        200,
        rows.map((d) => ({ date: d.date, defaultMode: d.default_mode, stops: JSON.parse(d.stops || "[]") }))
      );
    }
    if ((m = p.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})$/)) && method === "PUT") {
      const date = m[1];
      const b = await readBody(req);
      const existing = db.prepare("SELECT * FROM days WHERE date = ?").get(date);
      const newStops = JSON.stringify(Array.isArray(b.stops) ? b.stops : []);
      const mode = b.defaultMode || existing?.default_mode || "foot";
      if (existing) {
        db.prepare("UPDATE days SET stops = ?, default_mode = ? WHERE date = ?").run(newStops, mode, date);
      } else {
        db.prepare("INSERT INTO days (date, default_mode, stops) VALUES (?, ?, ?)").run(date, mode, newStops);
      }
      return json(res, 200, { date, defaultMode: mode, stops: JSON.parse(newStops) });
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: "Server error: " + e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Rhodes Planner running on http://0.0.0.0:${PORT}`));