const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "build", "gemihub-skk-lite");
const DICTIONARY_FILE = path.join(ROOT, "compiled", "dictionary.json");

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function indent(source, spaces) {
  const prefix = " ".repeat(spaces);
  return source.split("\n").map((line) => prefix + line).join("\n");
}

function pluginSource(engineSource, contentSource) {
  return `"use strict";

module.exports = class GemiHubSkkLitePlugin {
  async onload(api) {
    if (!api.storage) throw new Error("SKK Lite requires the storage permission.");

    const dictionaryBytes = await api.assets.fetch("dictionary.json");
    const dictionary = JSON.parse(new TextDecoder().decode(dictionaryBytes));
    const values = { ...(await api.storage.getAll()) };
    const runtimeListeners = new Set();
    const storageListeners = new Set();
    const documentListeners = [];
    const createdElements = new Set();
    const realDocument = globalThis.document;

    const pluginDocument = new Proxy(realDocument, {
      get(target, property) {
        if (property === "addEventListener") {
          return (type, listener, options) => {
            documentListeners.push({ type, listener, options });
            target.addEventListener(type, listener, options);
          };
        }
        if (property === "removeEventListener") {
          return target.removeEventListener.bind(target);
        }
        if (property === "createElement") {
          return (...args) => {
            const element = target.createElement(...args);
            createdElements.add(element);
            return element;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });

    const notifyStorageChanged = (changes) => {
      for (const listener of storageListeners) listener(changes, "local");
    };
    const pluginChrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          let response = { ok: true };
          if (message?.type === "lookup") {
            response = { candidates: dictionary[message.kana] || [] };
          } else if (message?.type !== "warmup") {
            for (const listener of runtimeListeners) {
              listener(message, {}, (nextResponse) => { response = nextResponse; });
            }
          }
          queueMicrotask(() => callback?.(response));
          return Promise.resolve(response);
        },
        onMessage: {
          addListener(listener) { runtimeListeners.add(listener); },
          removeListener(listener) { runtimeListeners.delete(listener); }
        }
      },
      storage: {
        local: {
          get(keys, callback) {
            const names = Array.isArray(keys) ? keys : Object.keys(keys || values);
            const result = Object.fromEntries(names.map((key) => [key, values[key]]));
            queueMicrotask(() => callback(result));
          },
          set(nextValues, callback) {
            const changes = {};
            const writes = [];
            for (const [key, value] of Object.entries(nextValues || {})) {
              changes[key] = { oldValue: values[key], newValue: value };
              values[key] = value;
              writes.push(api.storage.set(key, value));
            }
            Promise.all(writes).then(() => {
              notifyStorageChanged(changes);
              callback?.();
            }).catch((error) => {
              console.error("[SKK-LITE] Failed to save plugin storage:", error);
              callback?.();
            });
          }
        },
        onChanged: {
          addListener(listener) { storageListeners.add(listener); },
          removeListener(listener) { storageListeners.delete(listener); }
        }
      }
    };

    const previousEngine = globalThis.SkkEngine;
    let installedEngine;
    this.cleanup = () => {
      for (const listener of runtimeListeners) {
        listener({ type: "deactivate", source: "plugin-unload" }, {}, () => {});
      }
      for (const { type, listener, options } of documentListeners) {
        realDocument.removeEventListener(type, listener, options);
      }
      for (const element of createdElements) {
        if (element.isConnected) element.remove();
      }
      runtimeListeners.clear();
      storageListeners.clear();
      documentListeners.length = 0;
      createdElements.clear();
      if (installedEngine && globalThis.SkkEngine === installedEngine) {
        globalThis.SkkEngine = previousEngine;
      }
    };
${indent(engineSource, 4)}
    installedEngine = globalThis.SkkEngine;
    try {
      ((chrome, document) => {
${indent(contentSource, 6)}
      })(pluginChrome, pluginDocument);
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  onunload() {
    this.cleanup?.();
    this.cleanup = null;
  }
};
`;
}

function main() {
  if (!fs.existsSync(DICTIONARY_FILE)) {
    throw new Error("Missing compiled/dictionary.json. Run node build_extension.js first.");
  }
  const extensionManifest = JSON.parse(read("manifest.json"));
  const dictionary = fs.readFileSync(DICTIONARY_FILE);
  const releaseTag = `v${extensionManifest.version}`;
  const manifest = {
    id: "skk-lite",
    name: "SKK Lite",
    version: extensionManifest.version,
    minAppVersion: "0.15.3",
    description: "SKK-style Japanese input for GemiHub text fields.",
    author: "takeshy",
    permissions: ["storage"],
    assets: [{
      name: "dictionary.json",
      url: `https://github.com/takeshy/chrome-skk-lite/releases/download/${releaseTag}/dictionary.json`,
      sha256: sha256(dictionary)
    }]
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(OUTPUT_DIR, "main.js"), pluginSource(read("skk_engine.js"), read("content.js")));
  fs.copyFileSync(DICTIONARY_FILE, path.join(OUTPUT_DIR, "dictionary.json"));
  console.log(`Built GemiHub plugin in ${OUTPUT_DIR}`);
}

if (require.main === module) main();

module.exports = { pluginSource };
