import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { createKuadrantServer } from "./server.mjs";

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
      this.localDescription = null;
      this.remoteDescription = null;
      connections.push(this);
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
      return Promise.resolve();
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
    "        renderRoster();\n        if (invitationRoomId",
    `        globalThis.__gameTest = {
          applyNetworkSnapshot,
          createPeerAdapter,
          createGameState,
          createInviteUrl,
          serializeNetworkState,
          setSelectedMode,
          stepMultiplayerGame,
          getSelectedMode: () => selectedMode,
          getState: () => state,
        };
        renderRoster();
        if (invitationRoomId`
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
      "game",
      "choose-again",
      "copy-invite",
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
    'meta[name="kuadrant-signaling-url"]': { content: "" },
    'meta[name="kuadrant-ice-servers"]': {
      content: '[{"urls":"stun:example.invalid:3478"}]',
    },
  };
  const origin = options.origin || "https://clash.example.test";
  const location = {
    href: `${origin}/${search}`,
    origin,
    search,
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
    URL,
    URLSearchParams,
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

test("multiplayer mode is selected by an invitation link", async () => {
  const { api } = await loadGame(
    "?mode=multiplayer&room=abcdefghijklmnopqrstuvwx"
  );
  assert.equal(api.getSelectedMode(), "multiplayer");
});

test("challenge links carry the room and mode", async () => {
  const { api } = await loadGame();
  const invitation = new URL(
    api.createInviteUrl("abcdefghijklmnopqrstuvwx")
  );
  assert.equal(invitation.searchParams.get("mode"), "multiplayer");
  assert.equal(
    invitation.searchParams.get("room"),
    "abcdefghijklmnopqrstuvwx"
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
    x: 400,
    y: 300,
    velocityX: -400,
    size: 10,
  });
  const snapshot = api.serializeNetworkState(state);
  assert.equal(snapshot.projectiles[0].ownerSide, "cpu");
  assert.equal(api.applyNetworkSnapshot(snapshot), true);
  assert.equal(api.getState().projectiles[0].owner, api.getState().cpu);
});

test("two peer adapters connect through the relay and exchange both channels", async () => {
  const server = createKuadrantServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const RTCPeerConnection = createFakeRtcNetwork();
  const [{ api: hostApi }, { api: guestApi }] = await Promise.all([
    loadGame("", { origin, RTCPeerConnection }),
    loadGame("", { origin, RTCPeerConnection }),
  ]);
  const roomId = "peeradapterintegrationroom";
  const hostControl = [];
  const guestControl = [];
  const guestState = [];
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
    roomId,
    onControl: (message) => hostControl.push(message),
    onState() {},
  });
  const guest = guestApi.createPeerAdapter({
    ...callbacks,
    role: "guest",
    roomId,
    onControl: (message) => guestControl.push(message),
    onState: (message) => guestState.push(message),
  });

  try {
    await Promise.all([host.start(), guest.start()]);
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
    await new Promise((resolve) => server.close(resolve));
  }
});
