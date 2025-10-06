import { useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("");
  const sourceRef = useRef(null);

  useEffect(() => {
    // Connect to SSE stream on the Node server
    const source = new EventSource("http://localhost:4000/events");
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.addEventListener("platformEvent", (e) => {
      try {
        const message = JSON.parse(e.data);
        // Normalize shape for display
        const payload = message?.data?.payload ?? message?.payload ?? message;
        const evtMeta = message?.data?.event ?? {};
        setEvents((prev) => [
          {
            id: evtMeta?.replayId ?? crypto.randomUUID(),
            payload,
            meta: {
              createdDate: evtMeta?.createdDate,
              type: message?.channel,
              schema: message?.data?.schema,
            },
            raw: message,
          },
          ...prev,
        ].slice(0, 200)); // keep last 200
      } catch (err) {
        console.error("Bad event payload", err);
      }
    });

    return () => source.close();
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return events;
    return events.filter((e) => JSON.stringify(e.payload).toLowerCase().includes(filter.toLowerCase()));
  }, [events, filter]);

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Salesforce Platform Events – Hello World</h1>
        <span style={{
          marginLeft: "auto",
          padding: "4px 10px",
          borderRadius: 999,
          background: connected ? "#DEF7EC" : "#FDE8E8",
          color: connected ? "#03543F" : "#9B1C1C",
          border: "1px solid #E5E7EB"
        }}>{connected ? "Connected" : "Disconnected"}</span>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Filter by payload text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #E5E7EB" }}
        />
        <button onClick={() => setEvents([])} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>Clear</button>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "#6B7280" }}>No events yet. Publish a Platform Event in Salesforce to see messages stream in.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {filtered.map((e) => (
            <li key={e.id} style={{ border: "1px solid #E5E7EB", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, color: "#6B7280", display: "flex", gap: 8, alignItems: "center" }}>
                <span>Channel: <code>{e.meta.type}</code></span>
                {e.meta.createdDate && <span>• Created: {new Date(e.meta.createdDate).toLocaleString()}</span>}
                {e.meta.schema && <span>• Schema: <code>{e.meta.schema.slice(0, 8)}…</code></span>}
              </div>
              <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#F9FAFB", padding: 12, borderRadius: 8 }}>
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}