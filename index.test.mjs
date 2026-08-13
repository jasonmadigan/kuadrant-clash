import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.classList = { add() {}, remove() {} };
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(child) {
    this.children.push(child);
  }

  click() {
    for (const listener of this.listeners.get("click") || []) {
      listener({ cancelable: true, preventDefault() {} });
    }
  }

  replaceChildren(...children) {
    this.children = children;
  }

  scrollIntoView() {}

  select() {}

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setPointerCapture() {}
}

function createCanvasContext() {
  return new Proxy(
    {
      createLinearGradient: () => ({ addColorStop() {} }),
      measureText: (text) => ({ width: String(text).length * 9 }),
    },
    {
      get(target, property) {
        return property in target ? target[property] : () => {};
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    }
  );
}

function createFakeRtcNetwork() {
  const connections = [];

  class FakeDataChannel {
    constructor(label) {
      this.label = label;
      this.bufferedAmount = 0;
      this.readyState = "connecting";
    }

    close() {
      this.readyState = "closed";
      this.onclose?.();
    }

    open() {
      this.readyState = "open";
      this.onopen?.();
    }

    send(data) {
      queueMicrotask(() => this.counterpart?.onmessage?.({ data }));
    }
  }

  return class FakeRTCPeerConnection {
    constructor() {
      this.channels = [];
      this.connectionState = "new";
      this.iceGatheringState = "new";
      this.localDescription = null;
      this.listeners = new Map();
      this.remoteDescription = null;
      connections.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    addIceCandidate() {
      return Promise.resolve();
    }

    close() {
      this.connectionState = "closed";
    }

    createAnswer() {
      return Promise.resolve({ type: "answer", sdp: "fake-answer" });
    }

    createDataChannel(label) {
      const channel = new FakeDataChannel(label);
      this.channels.push(channel);
      return channel;
    }

    createOffer() {
      return Promise.resolve({ type: "offer", sdp: "fake-offer" });
    }

    setLocalDescription(description) {
      this.localDescription = description;
      this.iceGatheringState = "gathering";
      setTimeout(() => {
        this.localDescription = {
          ...description,
          sdp: `${description.sdp}\na=candidate:fake`,
        };
        this.iceGatheringState = "complete";
        for (const listener of
          this.listeners.get("icegatheringstatechange") || []) {
          listener();
        }
      }, 0);
      return Promise.resolve();
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    setRemoteDescription(description) {
      this.remoteDescription = description;
      if (description.type === "offer") {
        const host = connections.find(
          (connection) => connection.localDescription?.type === "offer"
        );
        for (const hostChannel of host.channels) {
          const guestChannel = new FakeDataChannel(hostChannel.label);
          hostChannel.counterpart = guestChannel;
          guestChannel.counterpart = hostChannel;
          this.channels.push(guestChannel);
          this.ondatachannel?.({ channel: guestChannel });
        }
      } else if (description.type === "answer") {
        const guest = connections.find(
          (connection) => connection.remoteDescription?.type === "offer"
        );
        this.connectionState = "connected";
        guest.connectionState = "connected";
        for (const connection of [this, guest]) {
          for (const channel of connection.channels) channel.open();
          connection.onconnectionstatechange?.();
        }
      }
      return Promise.resolve();
    }
  };
}

async function loadGame(search = "", options = {}) {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  let source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  source = source.replace(
    "        renderRoster();\n        if (invitationCode",
    `        globalThis.__gameTest = {
          applyNetworkSnapshot,
          createPeerAdapter,
          createGameState,
          createInviteUrl,
          decodeSessionDescription,
          encodeSessionDescription,
          serializeNetworkState,
          setSelectedMode,
          stepMultiplayerGame,
          getSelectedMode: () => selectedMode,
          getState: () => state,
        };
        renderRoster();
        if (invitationCode`
  );

  const ids = Object.fromEntries(
    [
      "select-screen",
      "multiplayer-lobby",
      "game-screen",
      "roster",
      "mode-description",
      "bout-label",
      "round-action",
      "connection-status",
      "invite-block",
      "invite-link",
      "answer-block",
      "answer-code",
      "answer-entry-block",
      "answer-input",
      "game",
      "choose-again",
      "copy-invite",
      "copy-answer",
      "connect-answer",
      "cancel-lobby",
    ].map((id) => [id, new FakeElement()])
  );
  ids.game.getContext = () => createCanvasContext();

  const touchButtons = [
    "left",
    "right",
    "jump",
    "duck",
    "punch",
    "kick",
    "special",
  ].map((control) => {
    const button = new FakeElement();
    button.dataset.control = control;
    return button;
  });
  const modeButtons = ["quick", "tournament", "multiplayer"].map((mode) => {
    const button = new FakeElement();
    button.dataset.mode = mode;
    return button;
  });
  const meta = {
    'meta[name="kuadrant-ice-servers"]': {
      content: '[{"urls":"stun:example.invalid:3478"}]',
    },
  };
  const origin = options.origin || "https://clash.example.test";
  const pageUrl = new URL(search || "/", `${origin}/`);
  const location = {
    href: pageUrl.href,
    origin: pageUrl.origin,
    search: pageUrl.search,
    hash: pageUrl.hash,
  };
  const windowListeners = new Map();
  const document = {
    hidden: false,
    addEventListener() {},
    createElement: () => new FakeElement(),
    querySelector(selector) {
      return meta[selector] || ids[selector.slice(1)];
    },
    querySelectorAll(selector) {
      if (selector === ".touch-button") return touchButtons;
      if (selector === ".mode-button") return modeButtons;
      return [];
    },
  };
  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    crypto: globalThis.crypto,
    history: { replaceState() {} },
    location,
  };
  const context = {
    AbortController,
    console,
    document,
    fetch,
    Image: class {
      constructor() {
        this.complete = true;
        this.naturalWidth = 128;
      }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    performance,
    RTCPeerConnection: options.RTCPeerConnection,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    window,
    cancelAnimationFrame() {},
    requestAnimationFrame: () => 1,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return { api: context.__gameTest, ids };
}

test("multiplayer mode is selected by a static invitation link", async () => {
  const { api: encoder } = await loadGame();
  const offer = encoder.encodeSessionDescription({
    type: "offer",
    sdp: "fake-offer",
  });
  const { api } = await loadGame(`?mode=multiplayer#offer=${offer}`);
  assert.equal(api.getSelectedMode(), "multiplayer");
});

test("challenge links carry the offer in the URL fragment", async () => {
  const { api } = await loadGame();
  const description = { type: "offer", sdp: "fake-offer" };
  const invitation = new URL(api.createInviteUrl(description));
  assert.equal(invitation.searchParams.get("mode"), "multiplayer");
  assert.equal(invitation.searchParams.get("room"), null);
  assert.equal(invitation.searchParams.get("signal"), null);
  const encodedOffer = new URLSearchParams(invitation.hash.slice(1)).get(
    "offer"
  );
  const decodedOffer = api.decodeSessionDescription(encodedOffer, "offer");
  assert.equal(decodedOffer.type, description.type);
  assert.equal(decodedOffer.sdp, description.sdp);
  assert.equal(invitation.href.includes("fake-offer"), false);
});

test("static multiplayer has no signalling API dependency", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /kuadrant-signaling-url|\/signal\//);
});

test("session descriptions reject malformed and mismatched codes", async () => {
  const { api } = await loadGame();
  const offer = api.encodeSessionDescription({
    type: "offer",
    sdp: "fake-offer",
  });
  assert.throws(
    () => api.decodeSessionDescription(offer, "answer"),
    /Invalid WebRTC answer code/
  );
  assert.throws(
    () => api.decodeSessionDescription("not-a-code", "answer"),
    /Invalid WebRTC answer code/
  );
});

test("the host-authoritative multiplayer step accepts both players' inputs", async () => {
  const { api } = await loadGame();
  const state = api.createGameState(0, 1, {
    cpuPortraitIndex: 2,
    mode: "multiplayer",
  });
  const hostStart = state.player.x;
  const guestStart = state.cpu.x;
  api.stepMultiplayerGame(
    state,
    { left: false, right: true },
    { left: true, right: false },
    50,
    0.05
  );
  assert(state.player.x > hostStart);
  assert(state.cpu.x < guestStart);
});

test("network snapshots preserve projectile ownership", async () => {
  const { api } = await loadGame();
  const state = api.createGameState(0, 1, {
    cpuPortraitIndex: 2,
    mode: "multiplayer",
  });
  state.projectiles.push({
    owner: state.cpu,
    kind: "shard",
    x: 400,
    y: 300,
    velocityX: -400,
    spawnAt: 10,
    createdAt: 0,
    size: 10,
  });
  const snapshot = api.serializeNetworkState(state);
  snapshot.sequence = 0;
  assert.equal(snapshot.projectiles[0].ownerSide, "cpu");
  assert.equal(api.applyNetworkSnapshot(snapshot), true);
  assert.equal(api.getState().projectiles[0].owner, api.getState().cpu);
  assert.equal(api.applyNetworkSnapshot(snapshot), false);
});

test("network snapshots reject malformed state without consuming sequence", async () => {
  const { api } = await loadGame();
  const state = api.createGameState(0, 1, {
    cpuPortraitIndex: 2,
    mode: "multiplayer",
  });
  const snapshot = api.serializeNetworkState(state);
  snapshot.sequence = 41;

  assert.equal(
    api.applyNetworkSnapshot({
      ...snapshot,
      player: { ...snapshot.player, portraitIndex: 999 },
    }),
    false
  );
  assert.equal(
    api.applyNetworkSnapshot({ ...snapshot, projectiles: [null] }),
    false
  );
  assert.equal(api.applyNetworkSnapshot(snapshot), true);
  assert.equal(api.getState().player.portraitIndex, 1);
});

test("snapshot sequences remain monotonic across multiplayer rematches", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const hostMatch = html.match(
    /function beginNetworkHostMatch\(\) \{([\s\S]*?)\n        \}/
  )[1];
  const rematchStart = html.match(
    /message\.type === "rematch-start"\) \{([\s\S]*?)\n          \}/
  )[1];
  assert.doesNotMatch(hostMatch, /networkSnapshotSequence\s*=\s*0/);
  assert.doesNotMatch(
    rematchStart,
    /lastAppliedNetworkSnapshotSequence\s*=\s*-1/
  );
});

test("two peer adapters connect through a manual offer and answer", async () => {
  const RTCPeerConnection = createFakeRtcNetwork();
  const [{ api: hostApi }, { api: guestApi }] = await Promise.all([
    loadGame("", { RTCPeerConnection }),
    loadGame("", { RTCPeerConnection }),
  ]);
  const hostControl = [];
  const guestControl = [];
  const guestState = [];
  let hostOffer;
  let guestAnswer;
  let readyCount = 0;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const markReady = () => {
    readyCount += 1;
    if (readyCount === 2) resolveReady();
  };
  const callbacks = {
    onReady: markReady,
    onStatus() {},
    onError(error) {
      throw error;
    },
  };
  const host = hostApi.createPeerAdapter({
    ...callbacks,
    role: "host",
    onLocalDescription: (description) => {
      hostOffer = description;
    },
    onControl: (message) => hostControl.push(message),
    onState() {},
  });
  const guest = guestApi.createPeerAdapter({
    ...callbacks,
    role: "guest",
    onLocalDescription: (description) => {
      guestAnswer = description;
    },
    onControl: (message) => guestControl.push(message),
    onState: (message) => guestState.push(message),
  });

  try {
    await host.start();
    assert.equal(hostOffer.type, "offer");
    assert.match(hostOffer.sdp, /candidate:fake/);
    await guest.start(hostOffer);
    assert.equal(guestAnswer.type, "answer");
    assert.match(guestAnswer.sdp, /candidate:fake/);
    await host.acceptAnswer(guestAnswer);
    await Promise.race([
      ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Peer adapters did not connect")),
          2000
        )
      ),
    ]);
    host.sendControl({ type: "fighter", portraitIndex: 1 });
    guest.sendControl({ type: "input", input: { left: true } });
    host.sendState({ type: "snapshot", state: { status: "fighting" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(guestControl[0].type, "fighter");
    assert.equal(hostControl[0].type, "input");
    assert.equal(guestState[0].type, "snapshot");
  } finally {
    host.close();
    guest.close();
  }
});
