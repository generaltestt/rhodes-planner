import React, { useContext, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api.js";
import { Store } from "../App.jsx";

function ManualAdd({ onClose }) {
  const { folders, refreshPlaces, refreshFolders, showToast } = useContext(Store);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [pos, setPos] = useState(null);
  const [selected, setSelected] = useState([]);
  const mapRef = useRef(null);
  const divRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    const map = L.map(divRef.current).setView([36.4441, 28.2226], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    map.on("click", (e) => {
      setPos({ lat: e.latlng.lat, lng: e.latlng.lng });
      if (markerRef.current) markerRef.current.setLatLng(e.latlng);
      else markerRef.current = L.marker(e.latlng).addTo(map);
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  const save = async () => {
    if (!name.trim() || !pos) return showToast("Add a name and tap the map to pin it");
    await api.addPlace({
      name: name.trim(),
      note,
      lat: pos.lat,
      lng: pos.lng,
      source: "manual",
      folderIds: selected,
    });
    await Promise.all([refreshPlaces(), refreshFolders()]);
    showToast("Place saved");
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add a place by hand</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <input
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid var(--line)", borderRadius: 8, marginBottom: 10, background: "var(--card)" }}
            placeholder="Name (e.g. Viewpoint above St Paul's Bay)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <h3>Tap the map to drop the pin</h3>
          <div ref={divRef} className="mini-map" style={{ height: 240 }} />
          <h3>Your note</h3>
          <textarea className="note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this place?" />
          <h3>Folders</h3>
          <div className="folder-picker">
            {folders.map((f) => (
              <label key={f.id} className={selected.includes(f.id) ? "checked" : ""}>
                <input
                  type="checkbox"
                  checked={selected.includes(f.id)}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, f.id] : selected.filter((x) => x !== f.id))
                  }
                />
                {f.name}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="btn" onClick={save}>Save place</button>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const { setDetail, places } = useContext(Store);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState(false);

  const savedIds = new Set(places.map((p) => p.placeId).filter(Boolean));

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setErr("");
    try {
      const { results } = await api.search(query);
      setResults(results);
    } catch (e) {
      setErr(e.message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search Rhodes — beaches, tavernas, the Acropolis of Lindos..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "..." : "Search"}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="hint">Results are biased to Rhodes island.</span>
        <button className="btn ghost small" onClick={() => setManual(true)}>+ Add by hand</button>
      </div>

      {err && <p className="conflict-msg">{err}</p>}
      {results && results.length === 0 && <p className="hint">Nothing found for that. Try a broader term.</p>}

      <div className="result-list">
        {(results || []).map((r) => (
          <button key={r.placeId} className="result-card" onClick={() => setDetail({ result: r })}>
            <div>
              <div className="name">
                {r.name} {savedIds.has(r.placeId) && <span className="tag">saved</span>}
              </div>
              <div className="meta">
                {[r.category, r.address].filter(Boolean).join(" · ")}
              </div>
            </div>
            {r.rating != null && <span className="rating-chip">{Number(r.rating).toFixed(1)}</span>}
          </button>
        ))}
      </div>

      {manual && <ManualAdd onClose={() => setManual(false)} />}
    </div>
  );
}
