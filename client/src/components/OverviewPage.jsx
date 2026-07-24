import React, { useContext, useMemo } from "react";
import { Store } from "../App.jsx";

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default function OverviewPage() {
  const { places, folders, trip, days, setTab } = useContext(Store);

  const plannedIds = useMemo(() => {
    const s = new Set();
    for (const d of days) for (const st of d.stops) s.add(st.placeId);
    return s;
  }, [days]);

  const daysWithStops = days.filter((d) => d.stops.length > 0);
  const totalDays = trip
    ? Math.round((new Date(trip.endDate) - new Date(trip.startDate)) / 86400000) + 1
    : 0;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat">
          <div className="num">{places.length}</div>
          <div className="lbl">places saved</div>
        </div>
        <div className="stat">
          <div className="num">{plannedIds.size}</div>
          <div className="lbl">on the plan</div>
        </div>
        <div className="stat">
          <div className="num">{places.length - plannedIds.size}</div>
          <div className="lbl">still to place</div>
        </div>
        <div className="stat">
          <div className="num">
            {daysWithStops.length}/{totalDays}
          </div>
          <div className="lbl">days planned</div>
        </div>
        <div className="stat">
          <div className="num">{folders.length}</div>
          <div className="lbl">folders</div>
        </div>
      </div>

      <h2 className="section-title">Day by day</h2>
      {daysWithStops.length === 0 ? (
        <p className="hint">
          No days planned yet.{" "}
          <button className="breadcrumb" onClick={() => setTab("planner")}>Open the planner →</button>
        </p>
      ) : (
        daysWithStops
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((d) => (
            <div key={d.date} className="folder-row" style={{ marginBottom: 8 }}>
              <div>
                <div className="fname">{fmtDay(d.date)}</div>
                <div className="fcount">
                  {d.stops
                    .map((s) => places.find((p) => p.id === s.placeId)?.name)
                    .filter(Boolean)
                    .join(" → ")}
                </div>
              </div>
            </div>
          ))
      )}
    </div>
  );
}
