let token = localStorage.getItem("rhodes_token") || "";

export function setToken(t) {
  token = t;
  localStorage.setItem("rhodes_token", t);
}
export function clearToken() {
  token = "";
  localStorage.removeItem("rhodes_token");
}
export function hasToken() {
  return !!token;
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("rhodes-logout"));
    throw new Error("Signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Photos come back from the server as Google resource "names" (e.g.
// "places/ABC.../photos/XYZ"), not URLs — this builds the proxy URL that
// serves the actual bytes without exposing the API key to the browser.
// The login token rides along as a query param because <img> tags
// can't send Authorization headers.
export function photoUrl(name) {
  return `/api/photo/${encodeURIComponent(name)}?t=${token}`;
}

export const api = {
  login: (password) => request("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  placeDetails: (placeId) => request(`/api/place-details/${encodeURIComponent(placeId)}`),
  getPlaces: () => request("/api/places"),
  addPlace: (place) => request("/api/places", { method: "POST", body: JSON.stringify(place) }),
  updatePlace: (id, patch) => request(`/api/places/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePlace: (id) => request(`/api/places/${id}`, { method: "DELETE" }),
  getFolders: () => request("/api/folders"),
  addFolder: (name) => request("/api/folders", { method: "POST", body: JSON.stringify({ name }) }),
  renameFolder: (id, name) => request(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteFolder: (id) => request(`/api/folders/${id}`, { method: "DELETE" }),
  getTrip: () => request("/api/trip"),
  setTrip: (startDate, endDate) =>
    request("/api/trip", { method: "PUT", body: JSON.stringify({ startDate, endDate }) }),
  getDays: () => request("/api/days"),
  saveDay: (date, stops, defaultMode) =>
    request(`/api/days/${date}`, { method: "PUT", body: JSON.stringify({ stops, defaultMode }) }),
};

// ---- travel time with localStorage cache (works offline once seen) ----
const ROUTE_CACHE_KEY = "rhodes_routes_v1";
let routeCache = {};
try {
  routeCache = JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY) || "{}");
} catch {}

function saveRouteCache() {
  try {
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(routeCache));
  } catch {}
}

export async function getRoute(from, to, mode) {
  const key = `${mode}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  if (routeCache[key]) return routeCache[key];
  try {
    const data = await request(
      `/api/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}&mode=${mode}`
    );
    routeCache[key] = data;
    saveRouteCache();
    return data;
  } catch {
    // Offline with no cache: rough straight-line estimate
    const R = 6371;
    const dLat = ((to.lat - from.lat) * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3;
    const speed = mode === "car" ? 40 : 4.5;
    return { km: Math.round(km * 10) / 10, minutes: Math.max(1, Math.round((km / speed) * 60)), source: "estimate" };
  }
}
