import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createKuadrantServer } from "./server.mjs";

let baseUrl;
let server;
const hostClient = "hostclientabcdefghijklmn";
const guestClient = "guestclientabcdefghijk";

before(async () => {
  server = createKuadrantServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test("serves the game and health endpoint", async () => {
  const health = await fetch(`${baseUrl}/health`).then((response) =>
    response.json()
  );
  assert.deepEqual(health, { ok: true });

  const page = await fetch(baseUrl).then((response) => response.text());
  assert.match(page, /Kuadrant Clash/);
});

test("queues signalling messages for the intended peer", async () => {
  const room = "abcdefghijklmnopqrstuvwx";
  const payload = { type: "description", description: { type: "offer" } };
  const sent = await fetch(`${baseUrl}/signal/${room}/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "host", clientId: hostClient, payload }),
  });
  assert.equal(sent.status, 202);

  const received = await fetch(
    `${baseUrl}/signal/${room}/guest?after=0&client=${guestClient}`
  ).then((response) => response.json());
  assert.equal(received.messages.length, 1);
  assert.deepEqual(received.messages[0].payload, payload);
});

test("delivers a message to an open long poll", async () => {
  const room = "zyxwvutsrqponmlkjihgfedc";
  const receiving = fetch(
    `${baseUrl}/signal/${room}/host?after=0&client=${hostClient}`
  ).then(
    (response) => response.json()
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  await fetch(`${baseUrl}/signal/${room}/host`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: "guest",
      clientId: guestClient,
      payload: { type: "candidate", candidate: "x" },
    }),
  });
  const received = await receiving;
  assert.equal(received.messages.length, 1);
  assert.equal(received.messages[0].payload.type, "candidate");
});

test("allows only one browser to claim each peer position", async () => {
  const room = "singleguestclaimabcdefgh";
  await fetch(
    `${baseUrl}/signal/${room}/guest?after=0&client=${guestClient}`,
    { signal: AbortSignal.timeout(5) }
  ).catch(() => {});
  const intruder = await fetch(
    `${baseUrl}/signal/${room}/guest?after=0&client=intruderclientabcdefghij`
  );
  assert.equal(intruder.status, 409);
});

test("rejects malformed room identifiers and oversized assumptions", async () => {
  const response = await fetch(`${baseUrl}/signal/nope/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: "host",
      clientId: hostClient,
      payload: { type: "candidate" },
    }),
  });
  assert.equal(response.status, 404);
});
