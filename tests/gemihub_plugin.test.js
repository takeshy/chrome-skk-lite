const assert = require("node:assert/strict");
const { pluginSource } = require("../scripts/build_gemihub_plugin.js");

const documentListeners = new Map();
const documentElement = {
  appendChild(element) {
    element.isConnected = true;
    element.parentNode = this;
  }
};
const fakeDocument = {
  documentElement,
  body: null,
  addEventListener(type, listener) {
    documentListeners.set(type, listener);
  },
  removeEventListener(type, listener) {
    if (documentListeners.get(type) === listener) documentListeners.delete(type);
  },
  createElement() {
    return {
      isConnected: false,
      remove() {
        this.isConnected = false;
        this.parentNode = null;
      }
    };
  }
};

const engineSource = "globalThis.SkkEngine = { installed: true };";
const contentSource = `(() => {
  globalThis.__gemihubSkkTest = { deactivated: 0, stored: null, lookup: null };
  chrome.storage.local.get(["existing"], (data) => {
    globalThis.__gemihubSkkTest.existing = data.existing;
  });
  chrome.storage.onChanged.addListener((changes) => {
    globalThis.__gemihubSkkTest.stored = changes.learned.newValue;
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "deactivate") globalThis.__gemihubSkkTest.deactivated += 1;
    respond({ ok: true });
  });
  chrome.runtime.sendMessage({ type: "lookup", kana: "かな" }, (response) => {
    globalThis.__gemihubSkkTest.lookup = response.candidates;
  });
  chrome.storage.local.set({ learned: ["仮名"] });
  document.addEventListener("keydown", () => {});
  document.documentElement.appendChild(document.createElement("div"));
})();`;

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

(async () => {
  const originalDocument = globalThis.document;
  const originalEngine = { original: true };
  globalThis.document = fakeDocument;
  globalThis.SkkEngine = originalEngine;
  const writes = {};
  const api = {
    assets: {
      async fetch(name) {
        assert.equal(name, "dictionary.json");
        return new TextEncoder().encode(JSON.stringify({ "かな": ["仮名"] })).buffer;
      }
    },
    storage: {
      async getAll() { return { existing: "value" }; },
      async set(key, value) { writes[key] = value; }
    }
  };
  const module = { exports: {} };
  new Function("module", "exports", pluginSource(engineSource, contentSource))(
    module,
    module.exports
  );
  const plugin = new module.exports();
  await plugin.onload(api);
  await flush();

  assert.equal(globalThis.__gemihubSkkTest.existing, "value");
  assert.deepEqual(globalThis.__gemihubSkkTest.lookup, ["仮名"]);
  assert.deepEqual(writes.learned, ["仮名"]);
  assert.deepEqual(globalThis.__gemihubSkkTest.stored, ["仮名"]);
  assert.equal(documentListeners.has("keydown"), true);
  assert.equal(globalThis.SkkEngine.installed, true);

  plugin.onunload();
  assert.equal(globalThis.__gemihubSkkTest.deactivated, 1);
  assert.equal(documentListeners.size, 0);
  assert.equal(globalThis.SkkEngine, originalEngine);

  delete globalThis.__gemihubSkkTest;
  globalThis.document = originalDocument;
  delete globalThis.SkkEngine;
  console.log("ok - GemiHub plugin adapter lifecycle");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
