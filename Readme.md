# React + jsforce Platform Events (Hello World)

A minimal full‑stack starter that logs into Salesforce with **jsforce**, subscribes to a **Platform Event** channel in real time, and streams events to a **React** UI.

This starter gives you a tiny React frontend and a Node.js backend that authenticates to Salesforce, subscribes to a Platform Event channel via the Streaming API (CometD/Bayeux), and relays events to the browser in real time using Server‑Sent Events (SSE).

> ✅ This is for quick prototyping. For production, prefer OAuth/JWT flows, refresh tokens, retry & backoff, and stricter CORS.

## Overview

**Flow:**

```
[Salesforce Platform Event] --(CometD)--> [Node server]
                                      \
                                       --(SSE /stream)--> [React app]
```

Why SSE? It’s simple, built‑in to browsers (via `EventSource`), and perfect for one‑way event streams.

---

## 1) Project structure

```
platform-events-starter/
├─ server/               # Server (Node + Express + jsforce + SSE) Back End Application
│  ├─ index.js
│  ├─ package.json
│  └─ .env               
└─ client/
   ├─ index.html         # Client (React + Vite) Front End Application
   ├─ package.json
   └─ src/
      ├─ main.jsx
      └─ App.jsx
```

---

## 2) Server (Node + Express + jsforce + SSE)

### `server/package.json`

```json
{
  "name": "sf-platform-events-server",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "NODE_OPTIONS=--watch node index.js"
  },
  "dependencies": {
    "@jsforce/jsforce-node": "^3.10.8",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^5.1.0",
    "jsforce": "^3.10.8"
  }
}
```

### `server/.env`

```
# --- Salesforce login (quick start: username+password+token) ---
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=gerae.martinez379@agentforce.com
SF_PASSWORD=agentforce2025
SF_TOKEN=

# The Platform Event API name, e.g. Agentforce_Custom_Event__e
SF_PLATFORM_EVENT_API_NAME=Agentforce_Custom_Event__e

# Server config
PORT=4000
CORS_ORIGIN=http://localhost:5173
```

> Copy to `server/.env` and fill with your values. For sandboxes use `https://test.salesforce.com`.

### `server/index.js`

```js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jsforce from "jsforce";

import { StreamingExtension } from "jsforce/lib/api/streaming.js";


dotenv.config();

const {
  SF_LOGIN_URL = "https://login.salesforce.com",
  SF_USERNAME,
  SF_PASSWORD,
  SF_TOKEN,
  SF_PLATFORM_EVENT_API_NAME = "Agentforce_Custom_Event__e",
  PORT = 4000,
  CORS_ORIGIN = "http://localhost:5173",
} = process.env;

if (!SF_USERNAME || !SF_PASSWORD || !SF_TOKEN) {
  console.error("Missing Salesforce creds in .env (SF_USERNAME, SF_PASSWORD, SF_TOKEN)");
  process.exit(1);
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.use(express.json());

// Maintain SSE subscribers
const sseClients = new Set();

app.get("/events", (req, res) => {
  // Server-Sent Events headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Add client
  sseClients.add(res);

  // Keep-alive ping every 25 seconds (Heroku/Proxies timeouts workaround)
  const ping = setInterval(() => {
    res.write(`:ping\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Broadcast helper
function broadcastEvent(evt) {
  const data = JSON.stringify(evt);
  for (const res of sseClients) {
    res.write(`event: platformEvent\n`);
    res.write(`data: ${data}\n\n`);
  }
}

// --- jsforce connection and subscription ---
const conn = new jsforce.Connection({ loginUrl: SF_LOGIN_URL });

async function start() {
  try {
    console.log("Logging into Salesforce...");
    await conn.login(SF_USERNAME, SF_PASSWORD + SF_TOKEN);
    console.log("Logged in as", SF_USERNAME);

    // Subscribe to Platform Event channel: /event/<API_NAME>
    const channel = `/event/${SF_PLATFORM_EVENT_API_NAME}`;
    console.log("Subscribing to", channel);

    // Specify the replay ID. 
    // -2 requests all retained events. 
    // -1 requests only new events.
    // A specific ID requests events from that point onwards.
    
    const replayId = -1; // -2 is all retained events
    const replayExt = new StreamingExtension.Replay(channel, replayId);
    const fayeClient = conn.streaming.createClient([ replayExt ]);
   

    const subscription = fayeClient.subscribe(channel, data => {
        console.log('topic received data', data);
        broadcastEvent(data);
    });

    subscription.then(function() {
        console.log('Successfully subscribed to channel:', channel);
    }, function(error) {
        console.error('Error subscribing to channel:', channel, error);
    });

    // Optionally, you can handle client-level errors
    fayeClient.on('transport:failure', function(error) {
        console.error('CometD transport failure:', error);
    });

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });

  } catch (e) {
    console.error("Startup failed:", e);
    process.exit(1);
  }
}

start();
```

> Notes:
>
> * Uses **SSE** (Server‑Sent Events) to push messages to the browser without extra deps.
> * For **OAuth/JWT**, swap the `conn.login(...)` block with your preferred auth flow.
> * The CometD client auto‑reconnects. In production, add backoff and alerting.

---

## 3) Client (React + Vite)

### `client/package.json`

```json
{
  "name": "sf-platform-events-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

### `client/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Platform Events – Hello World</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### `client/src/main.jsx`

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### `client/src/App.jsx`

```jsx
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
```

> If you prefer a dev proxy (avoiding hardcoding `http://localhost:4000`), add a Vite proxy in `vite.config.js` to forward `/events` to your server.

---

## 4) Run it locally

```bash
# 1) Start the server
cd server
# edit .env with your creds & event API name
npm i
npm run start

# 2) Start the client in a new terminal
cd ../client
npm i
npm run dev
# open the printed URL (usually http://localhost:5173)
```

Publish a Platform Event from Salesforce (e.g., via **Workbench**, **Developer Console**, **Apex**, or **Flows**). You should see it appear immediately in the UI.

---

## 5) Tips & variations

* **Sandbox**: set `SF_LOGIN_URL=https://test.salesforce.com`.
* **OAuth/JWT**: replace `conn.login(...)` with OAuth/JWT. Store/refresh tokens securely. (jsforce supports OAuth 2.0 flows.)
* **Replay from last event**: jsforce/CometD supports replay ext. To fetch missed events, configure a replay extension and store `replayId`.
* **Multiple events**: run multiple `conn.streaming.channel('/event/Another__e')` subscriptions and broadcast with different SSE event types.
* **Access control**: put the server behind auth and restrict `CORS_ORIGIN`.
* **Deployment**: keep the SSE endpoint on the same host as the client and use a reverse proxy for sticky connections.

---

## 6) Quick sanity checks

* Server logs "Logged in as …" and "Subscribing to /event/".
* `GET http://localhost:4000/health` returns `{ ok: true }`.
* In the client, the status chip flips to **Connected**.
* Publishing a Platform Event results in a new list item with the **payload** JSON.

---

## 7) Apex test code to publish Platform Events

You can manually publish test events using Anonymous Apex in the Developer Console → Execute Anonymous Window:

```java
// Example Apex to publish a test Platform Event
Agentforce_Custom_Event__e evt = new Agentforce_Custom_Event__e(
    Action_Performed__c = 'Reset Passoword!',
    Customer_Id__c = 'USER UUID 1234',
    Initiated_By_User_Id__c= 'USER UUID 4567'
);
Database.SaveResult sr = EventBus.publish(evt);
System.debug('Publish result: ' + sr.isSuccess());
```

Replace field names (Message__c, User__c) with the fields defined on your Platform Event. This code can also be placed in a test class to automate event generation.

## 8) FAQ

**Why not subscribe directly from the browser?** Direct CometD from the browser to Salesforce complicates CORS and token handling; a tiny Node middle‑tier keeps secrets server‑side and streams to the UI.

**Can I use WebSockets instead of SSE?** Yes. SSE is simpler for one‑way pushes. If you need bidirectional comms, swap SSE for WebSockets (e.g., `ws`).

**Do I have to use username+password?** No. It’s just the fastest to demo. Prefer OAuth/JWT in real apps.


