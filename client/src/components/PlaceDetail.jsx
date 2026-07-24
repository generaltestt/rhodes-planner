import React, { useContext, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, photoUrl } from "../api.js";
import { Store } from "../App.jsx";

// data: { result } (fresh from search) OR { place } (already saved)
export default function PlaceDetail({ data, onClose }) {
  const { folders, places, refreshPlaces, refreshFolders, showToast } = useContext(Store);
  const saved = data.place || (data.result && places.find((p) => p.placeId === data.result.placeId)) || null;
  const base = saved || data.result;

  const [full, setFull] = useState(base);
  const [note, setNote] = useState(saved?.note || "");
  const [selected, setSelected] = useState(saved?.folderIds || []);
  const [newFolder, setNewFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const mapDiv = useRef(null);

  // Pull full details (tips, more photos) for API places
  useEffect(() => {
    let live = true;
    const placeId = base.placeId;
    if (placeId && (!base.tips || base.tips.length === 0)) {
      api
        .placeDetails(placeId)
        .then((d) => live && setFull((f) => ({ ...f, ...d, name: f.name || d.name })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapDiv.current || !full.lat) return;
    const map = L.map(mapDiv.current, { zoomControl: false, attributionControl: false }).setView(
      [full.lat, full.lng],
      15
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    L.marker([full.lat, full.lng]).addTo(map);
    return () => map.remove();
  }, [full.lat, full.lng]);

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const f = await api.addFolder(name);
      await refreshFolders();
      setSelected((s) => [...s, f.id]);
      setNewFolder("");
    } catch (e) {
      showToast(e.message);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      if (saved) {
        await api.updatePlace(saved.id, { note, folderIds: selected });
        showToast("Updated");
      } else {
        await api.addPlace({
          placeId: full.placeId,
          name: full.name,
          address: full.address,
          lat: full.lat,
          lng: full.lng,
          rating: full.rating,
          category: full.category,
          photos: full.photos || [],
          tips: full.tips || [],
          note,
          source: "api",
          folderIds: selected,
        });
        showToast("Saved to your places");
      }
      await Promise.all([refreshPlaces(), refreshFolders()]);
      onClose();
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    if (!confirm(`Remove "${saved.name}" from your places? It will also come off any day plans.`)) return;
    await api.deletePlace(saved.id);
    await Promise.all([refreshPlaces(), refreshFolders()]);
    showToast("Removed");
    onClose();
  };

  const photos = full.photos || [];
  const tips = full.tips || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{full.name}</h2>
            <div className="hint" style={{ marginTop: 4 }}>
              {[full.category, full.address].filter(Boolean).join(" · ")}
              {full.rating != null && (
                <>
                  {" "}
                  <span className="rating-chip">{Number(full.rating).toFixed(1)} / 5</span>
                </>
              )}
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {photos.length > 0 && (
            <div className="photo-strip">
              {photos.map((name, i) => (
                <img key={i} src={photoUrl(name)} alt="" loading="lazy" />
              ))}
            </div>
          )}

          {tips.length > 0 && (
            <>
              <h3>What people say</h3>
              {tips.slice(0, 6).map((t, i) => (
                <div className="tip" key={i}>{t}</div>
              ))}
            </>
          )}

          <h3>On the map</h3>
          <div ref={mapDiv} className="mini-map" />

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
          <div className="new-folder-row">
            <input
              placeholder="New folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
            />
            <button className="btn ghost small" onClick={createFolder}>Create</button>
          </div>

          <h3>Your note</h3>
          <textarea
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Best at sunset, book ahead"
          />

          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={save} disabled={busy}>
              {saved ? "Save changes" : "Save place"}
            </button>
            {saved && (
              <button className="btn danger" onClick={remove}>Remove place</button>
            )}
            <button className="btn ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
