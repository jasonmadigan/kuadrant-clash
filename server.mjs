import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROOM_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const CLIENT_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const PEERS = new Set(["host", "guest"]);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_PEER = 256;
const MAX_ROOMS = 1000;
const MAX_WAITERS_PER_PEER = 4;
const ROOM_TTL_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_MS = 20 * 1000;

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/README.md", "README.md"],
]);

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

function createRoom() {
  return {
    nextMessageId: 1,
    updatedAt: Date.now(),
    queues: { host: [], guest: [] },
    claims: { host: null, guest: null },
    waiters: { host: new Set(), guest: new Set() },
  };
}

function takeMessages(room, peer, after) {
  return room.queues[peer].filter((message) => message.id > after);
}

function removeWaiter(room, peer, waiter) {
  clearTimeout(waiter.timer);
  room.waiters[peer].delete(waiter);
}

function flushWaiters(room, peer) {
  for (const waiter of room.waiters[peer]) {
    const messages = takeMessages(room, peer, waiter.after);
    if (messages.length === 0) continue;
    removeWaiter(room, peer, waiter);
    json(waiter.response, 200, { messages });
  }
}

function queueMessage(room, peer, payload) {
  const message = { id: room.nextMessageId, payload };
  room.nextMessageId += 1;
  room.updatedAt = Date.now();
  room.queues[peer].push(message);
  if (room.queues[peer].length > MAX_MESSAGES_PER_PEER) {
    room.queues[peer].splice(
      0,
      room.queues[peer].length - MAX_MESSAGES_PER_PEER
    );
  }
  flushWaiters(room, peer);
  return message.id;
}

function parseSignalPath(pathname) {
  const match = pathname.match(/^\/signal\/([^/]+)\/(host|guest)$/);
  if (!match) return null;
  const [, roomId, peer] = match;
  if (!ROOM_PATTERN.test(roomId) || !PEERS.has(peer)) return null;
  return { roomId, peer };
}

function claimPeer(room, peer, clientId) {
  if (!CLIENT_PATTERN.test(clientId || "")) return false;
  if (room.claims[peer] && room.claims[peer] !== clientId) return false;
  room.claims[peer] = clientId;
  return true;
}

export function createKuadrantServer() {
  const rooms = new Map();

  function ensureRoom(roomId) {
    const existingRoom = rooms.get(roomId);
    if (existingRoom) return existingRoom;
    if (rooms.size >= MAX_ROOMS) {
      const oldestRoomId = [...rooms.entries()].sort(
        ([, left], [, right]) => left.updatedAt - right.updatedAt
      )[0]?.[0];
      if (oldestRoomId) rooms.delete(oldestRoomId);
    }
    const room = createRoom();
    rooms.set(roomId, room);
    return room;
  }

  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [roomId, room] of rooms) {
      if (room.updatedAt >= cutoff) continue;
      for (const peer of PEERS) {
        for (const waiter of room.waiters[peer]) {
          removeWaiter(room, peer, waiter);
          json(waiter.response, 200, { messages: [] });
        }
      }
      rooms.delete(roomId);
    }
  }, 60 * 1000);
  cleanupTimer.unref();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
        "access-control-allow-origin": "*",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }

    if (url.pathname === "/health") {
      json(response, 200, { ok: true });
      return;
    }

    const signalTarget = parseSignalPath(url.pathname);
    if (signalTarget && request.method === "POST") {
      try {
        const body = await readJson(request);
        const sender = body?.from;
        const expectedSender = signalTarget.peer === "host" ? "guest" : "host";
        if (
          sender !== expectedSender ||
          typeof body.payload !== "object" ||
          !body.payload
        ) {
          json(response, 400, { error: "A valid sender and payload are required" });
          return;
        }
        const room = ensureRoom(signalTarget.roomId);
        if (!claimPeer(room, sender, body.clientId)) {
          json(response, 409, { error: "That peer position is already claimed" });
          return;
        }
        const id = queueMessage(room, signalTarget.peer, body.payload);
        json(response, 202, { id });
      } catch (error) {
        json(response, error.status || 500, { error: error.message });
      }
      return;
    }

    if (signalTarget && request.method === "GET") {
      const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
      const room = ensureRoom(signalTarget.roomId);
      if (!claimPeer(room, signalTarget.peer, url.searchParams.get("client"))) {
        json(response, 409, { error: "That peer position is already claimed" });
        return;
      }
      room.updatedAt = Date.now();
      const messages = takeMessages(room, signalTarget.peer, after);
      if (messages.length > 0) {
        json(response, 200, { messages });
        return;
      }
      if (room.waiters[signalTarget.peer].size >= MAX_WAITERS_PER_PEER) {
        json(response, 429, { error: "Too many open polls for this peer" });
        return;
      }

      const waiter = { after, response, timer: null };
      waiter.timer = setTimeout(() => {
        removeWaiter(room, signalTarget.peer, waiter);
        json(response, 200, { messages: [] });
      }, POLL_TIMEOUT_MS);
      room.waiters[signalTarget.peer].add(waiter);
      response.on("close", () => {
        if (
          !response.writableEnded &&
          room.waiters[signalTarget.peer].has(waiter)
        ) {
          removeWaiter(room, signalTarget.peer, waiter);
        }
      });
      return;
    }

    const staticFile = staticFiles.get(url.pathname);
    if (staticFile && (request.method === "GET" || request.method === "HEAD")) {
      try {
        const contents = await readFile(join(ROOT, staticFile));
        const contentType =
          extname(staticFile) === ".html"
            ? "text/html; charset=utf-8"
            : "text/markdown; charset=utf-8";
        response.writeHead(200, {
          "cache-control": "no-cache",
          "content-length": contents.length,
          "content-type": contentType,
        });
        response.end(request.method === "HEAD" ? undefined : contents);
      } catch {
        json(response, 500, { error: "Unable to read application file" });
      }
      return;
    }

    json(response, 404, { error: "Not found" });
  });

  server.on("close", () => clearInterval(cleanupTimer));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || "127.0.0.1";
  const server = createKuadrantServer();
  server.listen(port, host, () => {
    console.log(`Kuadrant Clash listening on http://${host}:${port}`);
  });
}
