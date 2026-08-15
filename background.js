const COMPILED_DICTIONARY = "compiled/dictionary.json";
const CLIPBOARD_INPUT_URL = "skk_clipboard.html";
const TOGGLE_SKK_COMMAND = "toggle-skk-kana";
const OPEN_CLIPBOARD_INPUT_COMMAND = "open-clipboard-input";

let dict = Object.create(null);
let loadPromise = null;
let entryCount = 0;
let clipboardInputWindowId = null;
let clipboardInputWindowPromise = null;

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

async function createOrFocusClipboardInputWindow() {
  const url = chrome.runtime.getURL(CLIPBOARD_INPUT_URL);

  if (clipboardInputWindowId != null) {
    try {
      const existing = await chrome.windows.get(clipboardInputWindowId);
      if (existing) {
        await chrome.windows.update(clipboardInputWindowId, { focused: true });
        return;
      }
    } catch {
      clipboardInputWindowId = null;
    }
  }

  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: 560,
    height: 260,
    focused: true
  });
  clipboardInputWindowId = created?.id ?? null;
}

function openClipboardInputWindow() {
  // Commands can arrive again while chrome.windows.create/get is still pending.
  // Share that operation so rapid Ctrl+Shift+K presses cannot create one popup
  // per command.
  if (clipboardInputWindowPromise) return clipboardInputWindowPromise;

  clipboardInputWindowPromise = createOrFocusClipboardInputWindow().finally(() => {
    clipboardInputWindowPromise = null;
  });
  return clipboardInputWindowPromise;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    if (tabId == null) {
      resolve(false);
      return;
    }

    chrome.tabs.sendMessage(tabId, message, () => {
      if (chrome.runtime.lastError) {
        console.debug("SKK command could not reach this tab:", chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

async function activateSkkInActiveTab(commandTab) {
  // Chrome consumes registered extension shortcuts before the extension page can
  // receive a keydown event. Route Ctrl+J back to the clipboard input window
  // when that window has focus.
  const isClipboardInput =
    commandTab?.windowId === clipboardInputWindowId ||
    commandTab?.url === chrome.runtime.getURL(CLIPBOARD_INPUT_URL);
  if (isClipboardInput) {
    try {
      const maybePromise = chrome.runtime.sendMessage({
        type: "clipboard-toggle-skk",
        source: "command"
      });
      if (maybePromise?.catch) maybePromise.catch(() => {});
    } catch (e) {
      console.debug("SKK command could not reach the clipboard input window:", e);
    }
    return;
  }

  warmupDictionaries();

  if (await sendTabMessage(commandTab?.id, { type: "toggle", source: "command" })) {
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await sendTabMessage(activeTab?.id, { type: "toggle", source: "command" });
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

chrome.runtime.onInstalled.addListener(() => {
  warmupDictionaries();
});

chrome.runtime.onStartup.addListener(() => {
  warmupDictionaries();
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === TOGGLE_SKK_COMMAND) {
    void activateSkkInActiveTab(tab).catch((e) => {
      console.error("Failed to run SKK command:", e);
    });
    return;
  }

  if (command !== OPEN_CLIPBOARD_INPUT_COMMAND) return;
  warmupDictionaries();
  void openClipboardInputWindow().catch((e) => {
    console.error("Failed to open SKK clipboard input:", e);
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === clipboardInputWindowId) {
    clipboardInputWindowId = null;
  }
});

warmupDictionaries();
