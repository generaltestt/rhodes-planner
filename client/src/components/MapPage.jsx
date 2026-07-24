import React, { useContext, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { Store } from "../App.jsx";

const COLORS = ["#2E7D9A", "#C9973F", "#3D7A52", "#B4452C", "#6B4E9B", "#1C5A73", "#8A6D3B"];

function pinIcon(color) {
  return L.divIcon({
    className: "",
    html: `<svg width="26" height="36" viewBox="0 0 26 36"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 23 13 23s13-13.3 13-23C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5.5" fill="#FAF7F1"/></svg>`,
    iconSize: [26, 36],
    iconAnchor: [13, 36],
    popupAnchor: [0, -34],
  });
}

export default function MapPage() {
  const { places, folders, days, setDetail } = useContext(Store);
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const plannedIds = useMemo(() => {
    const s = new Set();
    for (const d of days) for (const st of d.stops) s.add(st.placeId);
    return s;
  }, [days]);

  const folderColor = useMemo(() => {
    const m = new Map();
    folders.forEach((f, i) => m.set(f.id, COLORS[i % COLORS.length]));
    return m;
  }, [folders]);

  useEffect(() => {
    const map = L.map(divRef.current).setView([36.25, 28.05], 10);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => map.remove();
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    const bounds = [];
    for (const p of places) {
      const color = folderColor.get(p.folderIds[0]) || "#5B6B73";
      const marker = L.marker([p.lat, p.lng], { icon: pinIcon(color) });
      const planned = plannedIds.has(p.id) ? " · planned ✓" : "";
      marker.bindPopup(
        `<strong>${p.name}</strong><br/><span style="color:#5B6B73;font-size:12px">${p.category || ""}${planned}</span><br/><button id="open-${p.id}" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid #2E7D9A;background:none;color:#1C5A73;cursor:pointer">Open details</button>`
      );
      marker.on("popupopen", () => {
        const btn = document.getElementById(`open-${p.id}`);
        if (btn) btn.onclick = () => setDetail({ place: p });
      });
      marker.addTo(layer);
      bounds.push([p.lat, p.lng]);
    }
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [places, folderColor, plannedIds, setDetail]);

  return (
    <div>
      <div ref={divRef} className="map-full" />
      <div className="map-legend">
        {folders.map((f) => (
          <span className="item" key={f.id}>
            <span className="dot" style={{ background: folderColor.get(f.id) }} /> {f.name}
          </span>
        ))}
        {places.length === 0 && <span className="hint">Save some places and they will appear here.</span>}
      </div>
    </div>
  );
}
