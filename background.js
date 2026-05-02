const COMPILED_DICTIONARY = "compiled/dictionary.json";

let dict = Object.create(null);
let loadPromise = null;
let entryCount = 0;

async function loadDictionaries() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    console.log("Loading compiled dictionary...");
    const response = await fetch(chrome.runtime.getURL(COMPILED_DICTIONARY));
    if (!response.ok) {
      throw new Error(`Compiled dictionary unavailable: ${response.status} ${response.statusText}`);
    }
    const compiled = await response.json();
    dict = compiled || Object.create(null);
    entryCount = Object.keys(dict).length;
    console.log(`Loaded compiled dictionary: ${entryCount} entries.`);
  })();

  return loadPromise;
}

function warmupDictionaries() {
  void loadDictionaries().catch((e) => {
    console.error("Dictionary warmup failed:", e);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "warmup") {
    warmupDictionaries();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "lookup") {
    loadDictionaries()
      .then(() => {
        const candidates = dict[message.kana] || [];
        sendResponse({ candidates });
      })
      .catch((e) => {
        console.error("Dictionary lookup failed:", e);
        sendResponse({ candidates: [] });
      });
    return true; // async
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-skk") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "toggle", source: "command" }).catch(err => {
          console.warn("Could not send toggle message to tab. Is the content script loaded?", err);
        });
      }
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  warmupDictionaries();
});

chrome.runtime.onStartup.addListener(() => {
  warmupDictionaries();
});

warmupDictionaries();
