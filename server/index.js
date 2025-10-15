import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jsforce from "jsforce";

import { StreamingExtension } from "jsforce/lib/api/streaming.js";


dotenv.config();

const {
  SF_LOGIN_URL = "https://test.salesforce.com",
  SF_USERNAME,
  SF_PASSWORD,
  SF_TOKEN,
  SF_PLATFORM_EVENT_API_NAME = "Session_Event__e",
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
console.log("SF_LOGIN_URL: ", SF_LOGIN_URL);
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