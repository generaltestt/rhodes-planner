import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
} from "@dnd-kit/core";
import { api, getRoute } from "../api.js";
import { Store } from "../App.jsx";

const MODES = [
  ["foot", "🚶 walk"],
  ["car", "🚗 drive"],
  ["transit", "🚌 bus"],
];

function dateRange(start, end) {
  const out = [];
  const d = new Date(start + "T00:00:00");
  const stop = new Date(end + "T00:00:00");
  const fmt = (x) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  while (d <= stop && out.length < 60) {
    out.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor((total % 1440) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function minutesBetween(fromHHMM, toHHMM) {
  const [h1, m1] = fromHHMM.split(":").map(Number);
  const [h2, m2] = toHHMM.split(":").map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}

function TrayItem({ place, dayDates, onAddToDay }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tray-${place.id}`,
    data: { placeId: place.id, from: "tray" },
  });
  return (
    <div ref={setNodeRef} className={`tray-item ${isDragging ? "dragging" : ""}`} {...attributes} {...listeners}>
      <span className="tname">{place.name}</span>
      <select
        value=""
        onChange={(e) => e.target.value && onAddToDay(place.id, e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Add ${place.name} to a day`}
      >
        <option value="">Add to…</option>
        {dayDates.map((d) => (
          <option key={d} value={d}>{fmtDay(d)}</option>
        ))}
      </select>
    </div>
  );
}

function Connector({ from, to, mode, manualMin, onModeChange, onManualChange, dayDefault }) {
  const [route, setRoute] = useState(null);
  const effectiveMode = mode || dayDefault;

  useEffect(() => {
    let live = true;
    if (effectiveMode === "transit") {
      setRoute(null);
      return;
    }
    setRoute(null);
    getRoute({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, effectiveMode).then(
      (r) => live && setRoute(r)
    );
    return () => {
      live = false;
    };
  }, [from.lat, from.lng, to.lat, to.lng, effectiveMode]);

  return (
    <div className="connector">
      <select value={mode || ""} onChange={(e) => onModeChange(e.target.value || null)} aria-label="Travel mode">
        <option value="">{MODES.find(([m]) => m === dayDefault)?.[1]} (day default)</option>
        {MODES.map(([m, label]) => (
          <option key={m} value={m}>{label}</option>
        ))}
      </select>
      {effectiveMode === "transit" ? (
        <span className="cbadge">
          🚌
          <input
            className="manual-min"
            type="number"
            min="0"
            placeholder="min"
            value={manualMin ?? ""}
            onChange={(e) => onManualChange(e.target.value === "" ? null : Number(e.target.value))}
            aria-label="Bus time in minutes"
          />
          min (your estimate)
        </span>
      ) : route ? (
        <span className={`cbadge ${route.source === "estimate" ? "estimate" : ""}`}>
          {effectiveMode === "car" ? "🚗" : "🚶"} {route.minutes} min · {route.km} km
          {route.source === "estimate" ? " ~" : ""}
        </span>
      ) : (
        <span className="cbadge estimate">…</span>
      )}
    </div>
  );
}

function DayColumn({ date, day, placesById, onChange, travelTimes }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data: { date } });
  const stops = day?.stops || [];
  const defaultMode = day?.defaultMode || "foot";

  const patchStop = (i, patch) => {
    const next = stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(date, next, defaultMode);
  };
  const removeStop = (i) => onChange(date, stops.filter((_, idx) => idx !== i), defaultMode);
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(date, next, defaultMode);
  };

  // A stop's end time: prefer the explicit endTime; fall back to old-style
  // startTime + durationMin data if any exists from before this change.
  const stopEnd = (s) =>
    s.endTime || (s.startTime && s.durationMin != null ? addMinutes(s.startTime, s.durationMin) : null);

  // Conflict + summary computation
  let totalStopMin = 0;
  let totalTravelMin = 0;
  const conflicts = [];
  for (let i = 0; i < stops.length; i++) {
    const cur = stops[i];
    const curEnd = stopEnd(cur);
    if (cur.startTime && curEnd) {
      const d = minutesBetween(cur.startTime, curEnd);
      if (d > 0) totalStopMin += d;
    }
    if (i < stops.length - 1) {
      const t = travelTimes[`${date}:${i}`];
      const mode = cur.modeToNext || defaultMode;
      const travel = mode === "transit" ? cur.manualTravelMin || 0 : t?.minutes || 0;
      totalTravelMin += travel;
      const nxt = stops[i + 1];
      if (curEnd && nxt.startTime) {
        const arrive = addMinutes(curEnd, travel);
        if (arrive > nxt.startTime) conflicts.push({ index: i + 1, arrive });
      }
    }
  }

  return (
    <div ref={setNodeRef} className={`day-col ${isOver ? "drag-over" : ""}`}>
      <header>
        <span className="dname">{fmtDay(date)}</span>
        <label className="dmode">
          default{" "}
          <select value={defaultMode} onChange={(e) => onChange(date, stops, e.target.value)}>
            {MODES.map(([m, label]) => (
              <option key={m} value={m}>{label}</option>
            ))}
          </select>
        </label>
      </header>
      <div className="day-summary">
        {stops.length} stop{stops.length === 1 ? "" : "s"} · {Math.floor(totalStopMin / 60)}h
        {String(totalStopMin % 60).padStart(2, "0")} planned · {totalTravelMin} min travel
      </div>

      {stops.length === 0 && <div className="empty-day">Drag a place here, or use "Add to…"</div>}

      {stops.map((s, i) => {
        const place = placesById[s.placeId];
        if (!place) return null;
        const conflict = conflicts.find((c) => c.index === i);
        return (
          <React.Fragment key={`${s.placeId}-${i}`}>
            <div className={`stop ${conflict ? "conflict" : ""}`}>
              <div className="sname">{place.name}</div>
              <div className="srow">
                <input
                  type="time"
                  value={s.startTime || ""}
                  onChange={(e) => patchStop(i, { startTime: e.target.value || null })}
                  aria-label="From time"
                />
                <span className="unit">→</span>
                <input
                  type="time"
                  value={stopEnd(s) || ""}
                  onChange={(e) => patchStop(i, { endTime: e.target.value || null, durationMin: null })}
                  aria-label="To time"
                />
                {s.startTime && stopEnd(s) && minutesBetween(s.startTime, stopEnd(s)) > 0 && (
                  <span className="unit">
                    {Math.floor(minutesBetween(s.startTime, stopEnd(s)) / 60)}h
                    {String(minutesBetween(s.startTime, stopEnd(s)) % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
              {s.startTime && stopEnd(s) && minutesBetween(s.startTime, stopEnd(s)) <= 0 && (
                <div className="conflict-msg">End time is before start time.</div>
              )}
              {conflict && (
                <div className="conflict-msg">
                  Too tight — leaving the previous stop, you'd arrive around {conflict.arrive}, after this slot starts.
                </div>
              )}
              <div className="stop-actions">
                <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button onClick={() => removeStop(i)} aria-label="Remove">✕</button>
              </div>
            </div>
            {i < stops.length - 1 && placesById[stops[i + 1].placeId] && (
              <Connector
                from={place}
                to={placesById[stops[i + 1].placeId]}
                mode={s.modeToNext || null}
                manualMin={s.manualTravelMin}
                dayDefault={defaultMode}
                onModeChange={(m) => patchStop(i, { modeToNext: m })}
                onManualChange={(v) => patchStop(i, { manualTravelMin: v })}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function PlannerPage() {
  const { trip, days, places, refreshTrip, refreshDays, showToast } = useContext(Store);
  const [dates, setDates] = useState({ start: "", end: "" });
  const [dragName, setDragName] = useState(null);
  const [travelTimes, setTravelTimes] = useState({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  useEffect(() => {
    if (trip) setDates({ start: trip.startDate, end: trip.endDate });
  }, [trip]);

  const placesById = useMemo(() => Object.fromEntries(places.map((p) => [p.id, p])), [places]);
  const daysByDate = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d])), [days]);
  const dayDates = trip ? dateRange(trip.startDate, trip.endDate) : [];

  const scheduledIds = useMemo(() => {
    const s = new Set();
    for (const d of days) for (const st of d.stops) s.add(st.placeId);
    return s;
  }, [days]);
  const unscheduled = places.filter((p) => !scheduledIds.has(p.id));

  // Pre-compute travel times used for summaries/conflicts
  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      for (const d of days) {
        const stops = d.stops || [];
        for (let i = 0; i < stops.length - 1; i++) {
          const a = placesById[stops[i].placeId];
          const b = placesById[stops[i + 1].placeId];
          const mode = stops[i].modeToNext || d.defaultMode || "foot";
          if (!a || !b || mode === "transit") continue;
          const r = await getRoute({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }, mode);
          out[`${d.date}:${i}`] = r;
        }
      }
      if (live) setTravelTimes(out);
    })();
    return () => {
      live = false;
    };
  }, [days, placesById]);

  const saveDay = async (date, stops, defaultMode) => {
    try {
      await api.saveDay(date, stops, defaultMode);
      await refreshDays();
    } catch (e) {
      showToast(e.message);
    }
  };

  const addToDay = (placeId, date) => {
    const day = daysByDate[date];
    const stops = [...(day?.stops || []), { placeId, startTime: null, endTime: null, modeToNext: null, manualTravelMin: null }];
    saveDay(date, stops, day?.defaultMode || "foot");
  };

  const saveTrip = async () => {
    try {
      await api.setTrip(dates.start, dates.end);
      await refreshTrip();
      showToast("Dates updated");
    } catch (e) {
      showToast(e.message);
    }
  };

  const onDragStart = (e) => {
    const pid = e.active?.data?.current?.placeId;
    setDragName(placesById[pid]?.name || null);
  };
  const onDragEnd = (e) => {
    setDragName(null);
    const pid = e.active?.data?.current?.placeId;
    const overDate = e.over?.data?.current?.date;
    if (pid && overDate) addToDay(pid, overDate);
  };

  if (!trip) return <p className="hint">Loading trip…</p>;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="trip-bar">
        <span style={{ fontWeight: 600 }}>Trip dates</span>
        <input type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} />
        <span>→</span>
        <input type="date" value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} />
        {(dates.start !== trip.startDate || dates.end !== trip.endDate) && (
          <button className="btn small" onClick={saveTrip}>Save dates</button>
        )}
        <span className="hint" style={{ marginLeft: "auto" }}>
          Times marked ~ are rough estimates (no live route data).
        </span>
      </div>

      <div className="planner-layout">
        <aside className="tray">
          <h3>Not yet planned ({unscheduled.length})</h3>
          {unscheduled.length === 0 && <p className="hint">Everything saved is on a day. Nice.</p>}
          {unscheduled.map((p) => (
            <TrayItem key={p.id} place={p} dayDates={dayDates} onAddToDay={addToDay} />
          ))}
        </aside>

        <div className="day-strip">
          {dayDates.map((date) => (
            <DayColumn
              key={date}
              date={date}
              day={daysByDate[date]}
              placesById={placesById}
              onChange={saveDay}
              travelTimes={travelTimes}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {dragName ? <div className="tray-item" style={{ width: 200 }}><span className="tname">{dragName}</span></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
