import React, { useContext, useState } from "react";
import { api, photoUrl } from "../api.js";
import { Store } from "../App.jsx";

function PlaceCard({ place, onOpen }) {
  return (
    <button className="place-card" onClick={onOpen}>
      {place.photos?.[0] ? (
        <img className="thumb" src={photoUrl(place.photos[0])} alt="" loading="lazy" />
      ) : (
        <div className="thumb empty">📍</div>
      )}
      <div className="body">
        <div className="name">{place.name}</div>
        <div className="meta">{[place.category, place.address].filter(Boolean).join(" · ")}</div>
        {place.note && <div className="note">"{place.note}"</div>}
      </div>
    </button>
  );
}

export default function FoldersPage() {
  const { folders, places, refreshFolders, refreshPlaces, setDetail, showToast } = useContext(Store);
  const [open, setOpen] = useState(null); // folder id
  const [newName, setNewName] = useState("");

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.addFolder(name);
      await refreshFolders();
      setNewName("");
    } catch (e) {
      showToast(e.message);
    }
  };

  const rename = async (f) => {
    const name = prompt("Rename folder", f.name);
    if (!name || name.trim() === f.name) return;
    await api.renameFolder(f.id, name.trim());
    await refreshFolders();
  };

  const remove = async (f) => {
    if (!confirm(`Delete folder "${f.name}"? The places inside stay saved.`)) return;
    await api.deleteFolder(f.id);
    await Promise.all([refreshFolders(), refreshPlaces()]);
    if (open === f.id) setOpen(null);
  };

  if (open != null) {
    const folder = folders.find((f) => f.id === open);
    if (!folder) {
      setOpen(null);
      return null;
    }
    const inFolder = places.filter((p) => p.folderIds.includes(open));
    return (
      <div>
        <button className="breadcrumb" onClick={() => setOpen(null)}>← All folders</button>
        <h2 className="section-title" style={{ marginTop: 0 }}>{folder.name}</h2>
        {inFolder.length === 0 ? (
          <p className="hint">Nothing in here yet. Save places from the Search tab.</p>
        ) : (
          <div className="card-grid">
            {inFolder.map((p) => (
              <PlaceCard key={p.id} place={p} onOpen={() => setDetail({ place: p })} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="new-folder-row" style={{ marginBottom: 16 }}>
        <input
          placeholder="New folder (e.g. Beaches, Things to Do)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn small" onClick={create}>Create</button>
      </div>
      <div className="folder-list">
        {folders.map((f) => (
          <div key={f.id} className="folder-row" style={{ cursor: "default" }}>
            <button
              style={{ background: "none", border: "none", textAlign: "left", flex: 1, padding: 0, cursor: "pointer" }}
              onClick={() => setOpen(f.id)}
            >
              <div className="fname">{f.name}</div>
              <div className="fcount">{f.count} place{f.count === 1 ? "" : "s"}</div>
            </button>
            <button className="btn ghost small" onClick={() => rename(f)}>Rename</button>
            <button className="btn danger small" onClick={() => remove(f)}>Delete</button>
          </div>
        ))}
      </div>
      {folders.length === 0 && <p className="hint">No folders yet — create one above.</p>}
    </div>
  );
}
