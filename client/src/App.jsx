import React, { createContext, useCallback, useEffect, useState } from "react";
import { api, hasToken, setToken, clearToken } from "./api.js";
import SearchPage from "./components/SearchPage.jsx";
import FoldersPage from "./components/FoldersPage.jsx";
import MapPage from "./components/MapPage.jsx";
import PlannerPage from "./components/PlannerPage.jsx";
import OverviewPage from "./components/OverviewPage.jsx";
import PlaceDetail from "./components/PlaceDetail.jsx";

export const Store = createContext(null);

const TABS = [
  ["search", "Search"],
  ["folders", "Folders"],
  ["map", "Map"],
  ["planner", "Planner"],
  ["overview", "Overview"],
];

function Login({ onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!pw) return;
    setBusy(true);
    setErr("");
    try {
      const { token } = await api.login(pw);
      setToken(token);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-card">
        <h1>Rhodes Planner</h1>
        <p>Enter your password to open the trip.</p>
        <input
          type="password"
          value={pw}
          placeholder="Password"
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p className="error">{err}</p>}
        <button className="btn" style={{ width: "100%" }} onClick={submit} disabled={busy}>
          {busy ? "Signing in..." : "Open planner"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [tab, setTab] = useState("search");
  const [places, setPlaces] = useState([]);
  const [folders, setFolders] = useState([]);
  const [trip, setTrip] = useState(null);
  const [days, setDays] = useState([]);
  const [detail, setDetail] = useState(null); // { placeOrResult, savedId? }
  const [toast, setToast] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    const goOn = () => setOffline(false);
    const goOff = () => setOffline(true);
    window.addEventListener("rhodes-logout", onLogout);
    window.addEventListener("online", goOn);
    window.addEventListener("offline", goOff);
    return () => {
      window.removeEventListener("rhodes-logout", onLogout);
      window.removeEventListener("online", goOn);
      window.removeEventListener("offline", goOff);
    };
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }, []);

  const refreshPlaces = useCallback(async () => setPlaces(await api.getPlaces()), []);
  const refreshFolders = useCallback(async () => setFolders(await api.getFolders()), []);
  const refreshTrip = useCallback(async () => setTrip(await api.getTrip()), []);
  const refreshDays = useCallback(async () => setDays(await api.getDays()), []);

  useEffect(() => {
    if (!authed) return;
    Promise.all([refreshPlaces(), refreshFolders(), refreshTrip(), refreshDays()]).catch(() => {});
  }, [authed, refreshPlaces, refreshFolders, refreshTrip, refreshDays]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const store = {
    places,
    folders,
    trip,
    days,
    refreshPlaces,
    refreshFolders,
    refreshTrip,
    refreshDays,
    setDetail,
    showToast,
    setTab,
  };

  return (
    <Store.Provider value={store}>
      <div className="app">
        {offline && <div className="offline-note">Offline — showing your last saved plan</div>}
        <header className="topbar">
          <h1>
            Rhodes <span className="sub">planner</span>
          </h1>
          <nav className="tabs">
            {TABS.map(([id, label]) => (
              <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
            <button
              onClick={() => {
                clearToken();
                setAuthed(false);
              }}
            >
              Sign out
            </button>
          </nav>
        </header>
        <main className="main">
          {tab === "search" && <SearchPage />}
          {tab === "folders" && <FoldersPage />}
          {tab === "map" && <MapPage />}
          {tab === "planner" && <PlannerPage />}
          {tab === "overview" && <OverviewPage />}
        </main>
        {detail && <PlaceDetail data={detail} onClose={() => setDetail(null)} />}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </Store.Provider>
  );
}
