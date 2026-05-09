const statusEl = document.getElementById("status");
const enableButton = document.getElementById("enable");
const disableButton = document.getElementById("disable");
const optionsButton = document.getElementById("options");

let activeTabId = null;

function setUnavailable() {
  statusEl.textContent = "Unavailable on this page.";
  enableButton.disabled = true;
  disableButton.disabled = true;
}

function setStatus(status) {
  if (!status) {
    setUnavailable();
    return;
  }

  statusEl.textContent = status.text || (status.enabled ? "SKK enabled" : "SKK OFF");
  enableButton.disabled = !!status.enabled;
  disableButton.disabled = !status.enabled;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

async function sendToActiveTab(message) {
  if (!activeTabId) {
    activeTabId = await getActiveTabId();
  }
  if (!activeTabId) {
    throw new Error("No active tab.");
  }
  return chrome.tabs.sendMessage(activeTabId, message);
}

async function refreshStatus() {
  try {
    activeTabId = await getActiveTabId();
    const status = await sendToActiveTab({ type: "get-state", source: "popup" });
    setStatus(status);
  } catch {
    setUnavailable();
  }
}

enableButton.addEventListener("click", async () => {
  try {
    const status = await sendToActiveTab({ type: "activate", source: "popup" });
    setStatus(status);
  } catch {
    setUnavailable();
  }
});

disableButton.addEventListener("click", async () => {
  try {
    const status = await sendToActiveTab({ type: "deactivate", source: "popup" });
    setStatus(status);
  } catch {
    setUnavailable();
  }
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void refreshStatus();
