(() => {
  "use strict";

  const engine = globalThis.SkkEngine;
  if (!engine) {
    console.error("[SKK-LITE] Missing skk_engine.js");
    return;
  }

  // SKK Lite:
  // - Ctrl+J: toggle enabled/disabled in the current focused input.
  // - /: enter Abbrev mode from an empty kana buffer.
  // - l: return to ASCII mode.
  // - L: enter full-width ASCII mode.
  // - Hiragana mode: roman input -> kana.
  // - Shift+letter at beginning of a word: start conversion buffer.
  // - Space: convert current kana buffer using tiny dictionary.
  // - x: move back through candidates.
  // - Enter: commit current candidate.
  // - Escape: cancel conversion/preedit or close register modal.
  //
  // This is not a real OS IME. It only manipulates input/textarea/contenteditable
  // fields in web pages via a Chrome content script.

  let userDict = {};
  let candidateHistory = {};
  const lookupCache = new Map();
  let indicatorBadge = null;
  let registerModal = null;
  let registerModalEls = null;
  const EDITABLE_INPUT_TYPES = new Set(["text", "search", "tel", "url", "email"]);

  const state = {
    enabled: false,
    mode: engine.STATE.SKK_KANA,
    wideAscii: false,
    roman: "",
    abbrev: "",
    composing: false,
    kana: "",
    okuriKey: "",
    okuriKana: "",
    candidates: [],
    candidateIndex: 0,
    showingCandidate: false,
    modalOpen: false,
    modalContext: null,
    replacedLength: 0,
    renderStart: null,
    renderEnd: null,
    targetElement: null,
    lastKeyToggleAt: 0,
    lastCommandToggleAt: 0
  };

  const TOGGLE_DEDUPE_MS = 300;
  const Z_COMMANDS = {
    h: "←",
    j: "↓",
    k: "↑",
    l: "→",
    " ": "　"
  };

  function syncUserDict(nextUserDict) {
    userDict = nextUserDict || {};
    lookupCache.clear();
  }

  function syncCandidateHistory(nextCandidateHistory) {
    candidateHistory = nextCandidateHistory || {};
    lookupCache.clear();
  }

  chrome.storage?.local?.get(["userDict", "candidateHistory"], (data) => {
    syncUserDict(data.userDict);
    syncCandidateHistory(data.candidateHistory);
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.userDict) {
      syncUserDict(changes.userDict.newValue);
    }
    if (changes.candidateHistory) {
      syncCandidateHistory(changes.candidateHistory.newValue);
    }
  });

  function ensureIndicator() {
    if (indicatorBadge) return indicatorBadge;

    const parent = document.documentElement || document.body;
    if (!parent) return null;

    const host = document.createElement("div");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "right: 12px",
      "bottom: 12px",
      "z-index: 2147483647",
      "pointer-events: none"
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .badge {
        box-sizing: border-box;
        min-width: 72px;
        padding: 5px 8px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 6px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
        color: #fff;
        font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-weight: 700;
        letter-spacing: 0;
        text-align: center;
        white-space: nowrap;
        user-select: none;
      }
      .badge[data-mode="off"] {
        background: rgba(72, 79, 91, 0.92);
      }
      .badge[data-mode="kana"] {
        background: rgba(20, 111, 171, 0.92);
      }
      .badge[data-mode="wide-ascii"] {
        background: rgba(96, 85, 155, 0.92);
      }
      .badge[data-mode="abbrev"] {
        background: rgba(117, 82, 31, 0.94);
      }
      .badge[data-mode="compose"] {
        background: rgba(173, 93, 20, 0.94);
      }
      .badge[data-mode="candidate"] {
        background: rgba(42, 126, 80, 0.94);
      }
    `;

    indicatorBadge = document.createElement("div");
    indicatorBadge.className = "badge";
    shadow.append(style, indicatorBadge);
    parent.appendChild(host);
    return indicatorBadge;
  }

  function ensureRegisterModal() {
    if (registerModal) return registerModal;

    const parent = document.documentElement || document.body;
    if (!parent) return null;

    const host = document.createElement("div");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "pointer-events: none"
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.38);
        pointer-events: auto;
      }
      .overlay[data-open="true"] {
        display: flex;
      }
      .dialog {
        box-sizing: border-box;
        width: min(420px, calc(100vw - 32px));
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
        color: #0f172a;
        font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .body {
        padding: 18px 18px 14px;
      }
      .title {
        margin: 0 0 8px;
        font-size: 18px;
        font-weight: 700;
      }
      .desc {
        margin: 0 0 14px;
      }
      .reading {
        font-family: ui-monospace, monospace;
        font-weight: 700;
      }
      .input {
        box-sizing: border-box;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font: inherit;
      }
      .input:focus {
        outline: 2px solid #0f766e;
        outline-offset: 1px;
        border-color: #0f766e;
      }
      .error {
        min-height: 20px;
        margin: 8px 0 0;
        color: #b91c1c;
        font-size: 12px;
      }
      .actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        padding: 0 18px 18px;
      }
      .button {
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 8px 12px;
        background: #fff;
        color: #0f172a;
        font: inherit;
        cursor: pointer;
      }
      .button-primary {
        border-color: #0f766e;
        background: #0f766e;
        color: #fff;
      }
    `;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.dataset.open = "false";
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="skk-lite-register-title">
        <div class="body">
          <h2 class="title" id="skk-lite-register-title">単語登録</h2>
          <p class="desc"><span class="reading"></span> に登録する単語を入力してください。</p>
          <input class="input" type="text" autocomplete="off" spellcheck="false" placeholder="登録する単語">
          <p class="error" aria-live="polite"></p>
        </div>
        <div class="actions">
          <button class="button" type="button" data-action="cancel">閉じる</button>
          <button class="button button-primary" type="button" data-action="save">登録</button>
        </div>
      </div>
    `;

    shadow.append(style, overlay);
    parent.appendChild(host);

    registerModal = overlay;
    registerModalEls = {
      host,
      reading: overlay.querySelector(".reading"),
      input: overlay.querySelector(".input"),
      error: overlay.querySelector(".error"),
      saveButton: overlay.querySelector('[data-action="save"]'),
      cancelButton: overlay.querySelector('[data-action="cancel"]')
    };

    registerModalEls.saveButton.addEventListener("click", () => {
      void saveRegisterWord();
    });
    registerModalEls.cancelButton.addEventListener("click", () => {
      closeRegisterModal(true);
    });
    registerModal.addEventListener("click", (e) => {
      if (e.target === registerModal) {
        closeRegisterModal(true);
      }
    });
    registerModalEls.input.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRegisterModal(true);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (insertUnicodeFromRegisterInput()) {
          return;
        }
        void saveRegisterWord();
      }
    });

    return registerModal;
  }

  function getIndicatorMode() {
    if (!state.enabled) return { mode: "off", text: "SKK OFF" };
    if (state.wideAscii) return { mode: "wide-ascii", text: "SKK 全英" };
    if (isAbbrevMode()) return { mode: "abbrev", text: "SKK 略語" };
    if (state.composing && state.showingCandidate) return { mode: "candidate", text: "SKK 候補" };
    if (state.composing) return { mode: "compose", text: "SKK 変換" };
    return { mode: "kana", text: "SKK かな" };
  }

  function updateIndicator() {
    const badge = ensureIndicator();
    if (!badge) return;

    const { mode, text } = getIndicatorMode();
    badge.dataset.mode = mode;
    badge.textContent = text;
  }

  function getDeepActiveElement(root) {
    let active = root?.activeElement || null;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function isRegisterInputElement(el) {
    return !!registerModalEls?.input && el === registerModalEls.input;
  }

  function isHandledPrintableKey(key) {
    if (key.length !== 1) return false;
    const code = key.charCodeAt(0);
    return (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 44 ||
      code === 45 ||
      code === 46 ||
      code === 91 ||
      code === 93
    );
  }

  function isAsciiPrintableKey(key) {
    if (key.length !== 1) return false;
    const code = key.charCodeAt(0);
    return code >= 32 && code <= 126;
  }

  function toFullWidthAscii(text) {
    return text.replace(/[ -~]/g, (ch) => {
      if (ch === " ") return "　";
      return String.fromCharCode(ch.charCodeAt(0) + 0xfee0);
    });
  }

  function isAbbrevMode() {
    return state.mode === engine.STATE.ABBREV;
  }

  function isUpperAsciiLetter(ch) {
    if (ch.length !== 1) return false;
    const code = ch.charCodeAt(0);
    return code >= 65 && code <= 90;
  }

  function isToggleKeyEvent(e) {
    if (!e.ctrlKey) return false;
    const code = e.keyCode;
    if (code === 74 || code === 77) return true;
    if (e.key.length !== 1) return false;
    const keyCode = e.key.charCodeAt(0) | 32;
    return keyCode === 106 || keyCode === 109;
  }

  function isCancelCandidateKeyEvent(e) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return false;
    const code = e.keyCode;
    if (code === 71) return true;
    if (e.key.length !== 1) return false;
    return (e.key.charCodeAt(0) | 32) === 103;
  }

  function setTargetElement(el) {
    if (el) state.targetElement = el;
  }

  function focusTargetElement() {
    const el = state.targetElement;
    if (!el || !el.isConnected) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  function toggleEnabled(source) {
    state.enabled = !state.enabled;
    reset();
    if (state.enabled) {
      chrome.runtime.sendMessage({ type: "warmup" }).catch(() => {});
    }
    console.log(`[SKK-LITE-V2] Toggled via ${source}. New state: ${state.enabled}`);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "toggle") return;

    if (state.modalOpen) {
      return;
    }

    if (state.enabled && state.composing && state.targetElement) {
      commitCandidate(state.targetElement);
      return;
    }

    const now = Date.now();
    if (now - state.lastKeyToggleAt < TOGGLE_DEDUPE_MS) {
      console.debug("[SKK-LITE-V2] Ignored duplicate toggle from command.");
      return;
    }

    state.lastCommandToggleAt = now;
    toggleEnabled(message.source || "message");
  });

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName?.toLowerCase();
    if (tag === "textarea") return true;
    if (tag !== "input") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return EDITABLE_INPUT_TYPES.has(type) || !el.hasAttribute("type");
  }

  function dispatchInput(el) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }

  function insertText(el, text) {
    if (el.isContentEditable) {
      document.execCommand("insertText", false, text);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.setRangeText(text, start, end, "end");
    dispatchInput(el);
  }

  function deleteBackward(el, count) {
    if (count <= 0) return;
    if (el.isContentEditable) {
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount) return;
      for (let i = 0; i < count; i++) document.execCommand("delete", false);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null) return;
    const from = Math.max(0, start - count);
    el.setRangeText("", from, end, "end");
    dispatchInput(el);
  }

  function replacePrevious(el, count, text) {
    deleteBackward(el, count);
    insertText(el, text);
  }

  function canTrackRenderedRange(el) {
    return !el.isContentEditable && el.selectionStart != null && el.selectionEnd != null;
  }

  function setRenderedRangeFromCaret(el, length) {
    if (!canTrackRenderedRange(el)) return;
    const end = el.selectionStart;
    state.renderStart = Math.max(0, end - length);
    state.renderEnd = end;
  }

  function clearRenderedRange() {
    state.renderStart = null;
    state.renderEnd = null;
  }

  function hasRenderedRange(el) {
    return (
      canTrackRenderedRange(el) &&
      Number.isInteger(state.renderStart) &&
      Number.isInteger(state.renderEnd) &&
      state.renderStart >= 0 &&
      state.renderEnd >= state.renderStart
    );
  }

  function renderedOffset(el) {
    if (!hasRenderedRange(el) || el.selectionStart !== el.selectionEnd) return null;
    if (el.selectionStart < state.renderStart || el.selectionStart > state.renderEnd) return null;
    return el.selectionStart - state.renderStart;
  }

  function replaceRendered(el, text, caretOffset = text.length) {
    if (!hasRenderedRange(el)) {
      replacePrevious(el, currentRenderedLength(), text);
      setRenderedRangeFromCaret(el, text.length);
      return;
    }

    const start = state.renderStart;
    el.setRangeText(text, state.renderStart, state.renderEnd, "end");
    dispatchInput(el);
    state.renderStart = start;
    state.renderEnd = start + text.length;
    const nextCaret = start + Math.max(0, Math.min(caretOffset, text.length));
    el.setSelectionRange(nextCaret, nextCaret);
  }

  function toKatakana(text) {
    return text.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }

  function preeditKana() {
    return engine.preeditKana(state);
  }

  function lookupKey() {
    return state.okuriKey ? state.kana + state.okuriKey : state.kana;
  }

  function abbrevPreedit() {
    return engine.abbrevPreedit(state);
  }

  function composingPreedit() {
    return engine.composingPreedit(state);
  }

  function candidateText() {
    const stem = state.candidates[state.candidateIndex] || state.kana;
    return state.okuriKey ? stem + state.okuriKana : stem;
  }

  function currentRenderedLength() {
    return engine.currentRenderedLength(state);
  }

  function showPreedit(el, caretOffset) {
    if (!state.composing) return;
    const text = composingPreedit();
    replaceRendered(el, text, caretOffset ?? text.length);
    state.replacedLength = text.length;
    state.showingCandidate = false;
    state.mode = engine.STATE.SKK_HENKAN;
    updateIndicator();
  }

  function showCandidate(el) {
    const text = candidateText();
    replaceRendered(el, text);
    state.replacedLength = text.length;
    state.showingCandidate = true;
    state.mode = engine.STATE.SKK_CANDIDATE;
    updateIndicator();
  }

  function showAbbrevPreedit(el) {
    if (!isAbbrevMode()) return;
    const text = abbrevPreedit();
    replaceRendered(el, text);
    state.replacedLength = text.length;
    updateIndicator();
  }

  function appendComposingKana(kana) {
    engine.appendComposingKana(state, kana);
  }

  function startOkuri(el, key) {
    if (state.roman === "n") {
      insertText(el, "ん");
      appendComposingKana("ん");
      setRenderedRangeFromCaret(el, state.replacedLength);
      state.roman = "";
    }
    state.okuriKey = key.toLowerCase();
    state.okuriKana = "";
    state.candidates = [];
    state.candidateIndex = 0;
    state.showingCandidate = false;
    state.replacedLength = composingPreedit().length;
    setTargetElement(el);
    updateIndicator();
  }

  function closeRegisterModal(restoreCandidate) {
    if (!registerModal || !state.modalOpen) return;
    registerModal.dataset.open = "false";
    registerModalEls.error.textContent = "";
    state.modalOpen = false;
    const modalContext = state.modalContext;
    state.modalContext = null;
    clearCompositionState();
    if (modalContext) {
      restoreCompositionState(modalContext);
      focusTargetElement();
      updateIndicator();
    }
  }

  function clearCompositionState() {
    state.mode = engine.STATE.SKK_KANA;
    state.roman = "";
    state.abbrev = "";
    state.composing = false;
    state.kana = "";
    state.okuriKey = "";
    state.okuriKana = "";
    state.candidates = [];
    state.candidateIndex = 0;
    state.showingCandidate = false;
    state.replacedLength = 0;
    clearRenderedRange();
    state.targetElement = null;
  }

  function captureCompositionState() {
    return {
      mode: state.mode,
      roman: state.roman,
      abbrev: state.abbrev,
      composing: state.composing,
      kana: state.kana,
      okuriKey: state.okuriKey,
      okuriKana: state.okuriKana,
      candidates: [...state.candidates],
      candidateIndex: state.candidateIndex,
      showingCandidate: state.showingCandidate,
      replacedLength: state.replacedLength,
      renderStart: state.renderStart,
      renderEnd: state.renderEnd,
      targetElement: state.targetElement
    };
  }

  function restoreCompositionState(snapshot) {
    if (!snapshot) return;
    state.mode = snapshot.mode || engine.STATE.SKK_KANA;
    state.roman = snapshot.roman;
    state.abbrev = snapshot.abbrev || "";
    state.composing = snapshot.composing;
    state.kana = snapshot.kana;
    state.okuriKey = snapshot.okuriKey;
    state.okuriKana = snapshot.okuriKana;
    state.candidates = [...snapshot.candidates];
    state.candidateIndex = snapshot.candidateIndex;
    state.showingCandidate = snapshot.showingCandidate;
    state.replacedLength = snapshot.replacedLength;
    state.renderStart = snapshot.renderStart ?? null;
    state.renderEnd = snapshot.renderEnd ?? null;
    state.targetElement = snapshot.targetElement;
  }

  function reset() {
    closeRegisterModal(false);
    state.wideAscii = false;
    clearCompositionState();
    state.modalOpen = false;
    updateIndicator();
  }

  function openRegisterModal() {
    const modal = ensureRegisterModal();
    if (!modal) return;
    const reading = lookupKey() || preeditKana();
    state.modalContext = captureCompositionState();
    clearCompositionState();
    state.mode = engine.STATE.SKK_TOUROKU;
    registerModalEls.reading.textContent = reading;
    registerModalEls.input.value = "";
    registerModalEls.error.textContent = "";
    modal.dataset.open = "true";
    state.modalOpen = true;
    updateIndicator();
    queueMicrotask(() => {
      registerModalEls.input.focus();
      registerModalEls.input.select();
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, resolve);
    });
  }

  function insertUnicodeFromRegisterInput() {
    const input = registerModalEls?.input;
    if (!input) return false;

    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start == null || end == null || start !== end) return false;

    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const match = before.match(/(?:\\|¥|￥)u([0-9a-fA-F]{1,6})$/);
    if (!match) return false;

    const codePoint = Number.parseInt(match[1], 16);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      registerModalEls.error.textContent = "Unicode の符号位置が不正です。";
      return true;
    }

    const replacement = String.fromCodePoint(codePoint);
    const nextBefore = before.slice(0, -match[0].length) + replacement;
    input.value = nextBefore + after;
    const nextCaret = nextBefore.length;
    input.setSelectionRange(nextCaret, nextCaret);
    registerModalEls.error.textContent = "";
    return true;
  }

  async function saveRegisterWord() {
    if (state.modalOpen && isRegisterInputElement(registerModalEls?.input)) {
      if (!flushPendingRoman(registerModalEls.input)) {
        registerModalEls.error.textContent = "未確定のローマ字があります。";
        return;
      }
    }

    const value = registerModalEls?.input?.value?.trim() || "";
    if (!value) {
      registerModalEls.error.textContent = "登録する単語を入力してください。";
      return;
    }

    const modalContext = state.modalContext;
    const key = modalContext?.okuriKey ? modalContext.kana + modalContext.okuriKey : modalContext?.kana;
    if (!key) {
      registerModalEls.error.textContent = "読みが空のため登録できません。";
      return;
    }

    const data = await storageGet(["userDict"]);
    const nextUserDict = { ...(data.userDict || {}) };
    const existing = Array.isArray(nextUserDict[key]) ? nextUserDict[key] : [];
    nextUserDict[key] = [value, ...existing.filter((candidate) => candidate !== value)];
    await storageSet({ userDict: nextUserDict });
    syncUserDict(nextUserDict);

    if (modalContext) {
      modalContext.candidates = [value, ...modalContext.candidates.filter((candidate) => candidate !== value)];
      modalContext.candidateIndex = 0;
      modalContext.showingCandidate = true;
    }
    const target = modalContext?.targetElement || null;
    closeRegisterModal(false);

    if (target) {
      commitCandidate(target);
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }
  }

  async function lookup(kana) {
    if (lookupCache.has(kana)) {
      return lookupCache.get(kana);
    }

    const lookupPromise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "lookup", kana }, (response) => {
        const bgCandidates = response?.candidates || [];
        const userCandidates = userDict[kana] || [];
        const historyCandidates = candidateHistory[kana] || [];
        const merged = [...new Set([...historyCandidates, ...userCandidates, ...bgCandidates])];
        lookupCache.set(kana, Promise.resolve(merged));
        resolve(merged);
      });
    });
    lookupCache.set(kana, lookupPromise);
    return lookupPromise;
  }

  function rememberCandidateSelection(key, candidate) {
    if (!key || !candidate) return;

    const nextCandidateHistory = { ...candidateHistory };
    const existing = Array.isArray(nextCandidateHistory[key]) ? nextCandidateHistory[key] : [];
    nextCandidateHistory[key] = [candidate, ...existing.filter((item) => item !== candidate)].slice(0, 8);
    syncCandidateHistory(nextCandidateHistory);
    lookupCache.delete(key);
    void storageSet({ candidateHistory: nextCandidateHistory });
  }

  function commitCandidate(el) {
    if (!state.composing) return;
    const committedKey = lookupKey();
    const selectedCandidate = state.showingCandidate ? state.candidates[state.candidateIndex] : "";
    const text = state.showingCandidate ? candidateText() : preeditKana();
    replaceRendered(el, text);
    if (selectedCandidate) {
      rememberCandidateSelection(committedKey, selectedCandidate);
    }
    if (state.modalOpen && isRegisterInputElement(el)) {
      clearCompositionState();
      setTargetElement(el);
      updateIndicator();
      return;
    }
    reset();
  }

  function commitKatakana(el) {
    if (!state.composing || !preeditKana()) return false;
    const text = toKatakana(preeditKana());
    replaceRendered(el, text);
    if (state.modalOpen && isRegisterInputElement(el)) {
      clearCompositionState();
      setTargetElement(el);
      updateIndicator();
      return true;
    }
    reset();
    return true;
  }

  function enterAsciiMode(el) {
    if (state.showingCandidate) {
      commitCandidate(el);
    } else if (state.composing || state.roman) {
      if (!flushPendingRoman(el) && state.roman) {
        insertText(el, state.roman);
        state.roman = "";
      }
      if (state.composing) {
        replaceRendered(el, preeditKana());
      }
    }

    state.enabled = false;
    if (state.modalOpen && isRegisterInputElement(el)) {
      clearCompositionState();
      setTargetElement(el);
      updateIndicator();
      return;
    }
    reset();
  }

  function enterWideAsciiMode(el) {
    if (state.showingCandidate) {
      commitCandidate(el);
    } else if (state.composing || state.roman) {
      if (!flushPendingRoman(el) && state.roman) {
        insertText(el, state.roman);
        state.roman = "";
      }
      if (state.composing) {
        replaceRendered(el, preeditKana());
      }
    }

    clearCompositionState();
    state.enabled = true;
    state.wideAscii = true;
    setTargetElement(el);
    updateIndicator();
  }

  function handleWideAsciiPrintable(el, e) {
    if (!isAsciiPrintableKey(e.key)) return false;

    e.preventDefault();
    e.stopImmediatePropagation();
    setTargetElement(el);
    insertText(el, toFullWidthAscii(e.key));
    return true;
  }

  function handleZCommand(el, e) {
    if (state.roman !== "z") return false;
    const text = Z_COMMANDS[e.key];
    if (!text) return false;

    e.preventDefault();
    e.stopImmediatePropagation();
    setTargetElement(el);

    if (state.showingCandidate) {
      showPreedit(el);
      state.candidates = [];
      state.candidateIndex = 0;
    }

    state.roman = "";
    insertText(el, text);
    if (state.composing) {
      appendComposingKana(text);
      setRenderedRangeFromCaret(el, state.replacedLength);
    }
    return true;
  }

  function canStartAbbrev() {
    return (
      state.enabled &&
      !state.modalOpen &&
      !state.wideAscii &&
      !state.composing &&
      !state.roman &&
      !isAbbrevMode()
    );
  }

  function startAbbrev(el) {
    clearCompositionState();
    state.mode = engine.STATE.ABBREV;
    state.abbrev = "";
    setTargetElement(el);
    insertText(el, abbrevPreedit());
    state.replacedLength = abbrevPreedit().length;
    setRenderedRangeFromCaret(el, state.replacedLength);
    updateIndicator();
  }

  function closeAbbrev(el, replacement) {
    replaceRendered(el, replacement);
    clearCompositionState();
    setTargetElement(el);
    updateIndicator();
  }

  function handleAbbrevBackspace(el, e) {
    if (!isAbbrevMode()) return false;

    e.preventDefault();
    e.stopImmediatePropagation();
    setTargetElement(el);

    if (state.abbrev) {
      state.abbrev = state.abbrev.slice(0, -1);
      showAbbrevPreedit(el);
      return true;
    }

    closeAbbrev(el, "");
    return true;
  }

  function handleAbbrevPrintable(el, e) {
    if (!isAbbrevMode()) return false;

    if (e.key === "/") {
      e.preventDefault();
      e.stopImmediatePropagation();
      setTargetElement(el);
      closeAbbrev(el, "/");
      return true;
    }

    if (!engine.isAbbrevChar(e.key)) return false;

    e.preventDefault();
    e.stopImmediatePropagation();
    setTargetElement(el);
    state.abbrev += e.key;
    showAbbrevPreedit(el);
    return true;
  }

  async function showAbbrevCandidates(el) {
    if (!isAbbrevMode() || !state.abbrev) return;
    setTargetElement(el);

    const key = state.abbrev;
    const renderedLength = state.replacedLength;
    state.candidates = await lookup(key);
    state.candidateIndex = 0;
    state.kana = key;
    state.okuriKey = "";
    state.okuriKana = "";
    state.roman = "";
    state.abbrev = "";
    state.composing = true;
    state.replacedLength = renderedLength;

    if (!state.candidates.length) {
      state.mode = engine.STATE.SKK_TOUROKU;
      state.showingCandidate = false;
      openRegisterModal();
      return;
    }

    state.mode = engine.STATE.SKK_CANDIDATE;
    state.showingCandidate = false;
    showCandidate(el);
  }

  async function autoConvertOkuri(el) {
    if (!state.composing || !state.okuriKey || !state.okuriKana || state.roman || state.candidates.length) {
      return;
    }

    state.candidates = await lookup(lookupKey());
    state.candidateIndex = 0;
    state.replacedLength = composingPreedit().length;
    if (state.candidates.length) {
      showCandidate(el);
    }
  }

  async function showNextCandidate(el) {
    if (!state.composing) return;
    setTargetElement(el);
    if (!flushPendingRoman(el)) return;

    if (!state.candidates.length) {
      state.candidates = await lookup(lookupKey());
      state.candidateIndex = 0;
      state.replacedLength = composingPreedit().length;
      if (!state.candidates.length) {
        if (state.modalOpen && isRegisterInputElement(el)) {
          showPreedit(el);
        } else {
          openRegisterModal();
        }
        return;
      }
      showCandidate(el);
      return;
    }

    if (!state.showingCandidate) {
      state.candidateIndex = 0;
      showCandidate(el);
      return;
    }

    if (state.candidateIndex >= state.candidates.length - 1) {
      openRegisterModal();
      return;
    }

    state.candidateIndex += 1;
    showCandidate(el);
  }

  function showPreviousCandidate(el) {
    if (!state.composing || !state.candidates.length || !state.showingCandidate) return false;
    setTargetElement(el);

    if (state.candidateIndex <= 0) {
      showPreedit(el);
      return true;
    }

    state.candidateIndex -= 1;
    showCandidate(el);
    return true;
  }

  function cancelCandidateSelection(el) {
    if (!state.composing || !state.showingCandidate) return false;
    setTargetElement(el);
    showPreedit(el);
    state.candidates = [];
    state.candidateIndex = 0;
    return true;
  }

  function startComposition(el) {
    state.mode = engine.STATE.SKK_HENKAN;
    state.composing = true;
    state.kana = "";
    state.okuriKey = "";
    state.okuriKana = "";
    state.candidates = [];
    state.candidateIndex = 0;
    state.showingCandidate = false;
    insertText(el, engine.HENKAN_PREFIX);
    state.replacedLength = engine.HENKAN_PREFIX.length;
    setRenderedRangeFromCaret(el, state.replacedLength);
    setTargetElement(el);
    updateIndicator();
  }

  function convertRomanChunk(el) {
    const kana = engine.consumeRomanChunk(state);
    if (!kana) return false;
    insertText(el, kana);
    setRenderedRangeFromCaret(el, state.replacedLength);
    return true;
  }

  function flushPendingRoman(el) {
    if (!state.roman) return true;

    let guard = 0;
    while (state.roman && guard++ < 8) {
      if (convertRomanChunk(el)) continue;
      if (state.roman === "n") {
        insertText(el, "ん");
        appendComposingKana("ん");
        setRenderedRangeFromCaret(el, state.replacedLength);
        state.roman = "";
        return true;
      }
      break;
    }
    return !state.roman;
  }

  function handlePrintable(el, e) {
    const ch = e.key;
    if (!isHandledPrintableKey(ch)) return false;

    e.preventDefault();
    e.stopImmediatePropagation();
    setTargetElement(el);

    if (isUpperAsciiLetter(ch)) {
      if (!state.composing) {
        startComposition(el);
      } else if (engine.shouldStartOkuri(state, ch)) {
        startOkuri(el, ch);
      }
    }

    if (state.showingCandidate) {
      showPreedit(el);
      state.candidates = [];
      state.candidateIndex = 0;
    }

    state.roman += ch.toLowerCase();
    let guard = 0;
    while (state.roman && guard++ < 4) {
      if (!convertRomanChunk(el)) break;
    }
    if (state.composing && state.okuriKey && state.okuriKana && !state.roman && !state.candidates.length) {
      void autoConvertOkuri(el);
    }
    return true;
  }

  function handleBackspace(el, e) {
    if (!state.roman && !state.composing) return false;

    e.preventDefault();
    setTargetElement(el);

    if (state.roman) {
      state.roman = state.roman.slice(0, -1);
      return true;
    }

    if (state.composing && !state.showingCandidate) {
      const offset = renderedOffset(el);
      if (offset != null && engine.deleteComposingCharBeforeOffset(state, offset)) {
        if (!preeditKana()) {
          replaceRendered(el, "", 0);
          if (state.modalOpen && isRegisterInputElement(el)) {
            if (el.value) {
              clearCompositionState();
              setTargetElement(el);
              updateIndicator();
            } else {
              closeRegisterModal(true);
            }
            return true;
          }
          reset();
          return true;
        }

        showPreedit(el, engine.composingOffsetAfterBackspace(offset));
        return true;
      }
    }

    if (state.showingCandidate) {
      showPreedit(el);
    }

    if (state.okuriKana) {
      state.okuriKana = state.okuriKana.slice(0, -1);
    } else if (state.okuriKey) {
      state.okuriKey = "";
    } else if (state.kana) {
      state.kana = state.kana.slice(0, -1);
    }

    if (!preeditKana()) {
      replaceRendered(el, "", 0);
      if (state.modalOpen && isRegisterInputElement(el)) {
        if (el.value) {
          clearCompositionState();
          setTargetElement(el);
          updateIndicator();
        } else {
          closeRegisterModal(true);
        }
        return true;
      }
      reset();
      return true;
    }

    showPreedit(el);
    return true;
  }

  document.addEventListener("keydown", (e) => {
    if (isToggleKeyEvent(e)) {
      const el = getDeepActiveElement(document);
      const isRegisterInput = isRegisterInputElement(el);
      if (state.enabled && state.composing && !isRegisterInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        commitCandidate(el);
        return;
      }
      if (state.modalOpen && isRegisterInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();

      const now = Date.now();
      if (now - state.lastCommandToggleAt < TOGGLE_DEDUPE_MS) {
        console.debug("[SKK-LITE-V2] Ignored duplicate toggle from keydown.");
        return;
      }

      state.lastKeyToggleAt = now;
      toggleEnabled("key");
      return;
    }

    if (!state.enabled) return;

    const el = getDeepActiveElement(document);
    const isEdit = isEditable(el);
    if (!isEdit) return;

    if (isCancelCandidateKeyEvent(e)) {
      if (cancelCandidateSelection(el)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === "Escape") {
      if (isAbbrevMode()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeAbbrev(el, "");
        return;
      }
      if (state.wideAscii) {
        e.preventDefault();
        e.stopImmediatePropagation();
        state.wideAscii = false;
        updateIndicator();
        return;
      }
      if (state.modalOpen && (state.composing || state.roman)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (state.composing) {
          replaceRendered(el, preeditKana());
        }
        clearCompositionState();
        updateIndicator();
        return;
      }
      if (state.composing || state.roman) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (state.composing) {
          replaceRendered(el, preeditKana());
        }
        reset();
      }
      return;
    }

    if (e.key === "Backspace") {
      if (state.wideAscii) return;
      if (handleAbbrevBackspace(el, e)) return;
      e.stopImmediatePropagation();
      handleBackspace(el, e);
      return;
    }

    if (e.key === "/" && canStartAbbrev()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      startAbbrev(el);
      return;
    }

    if (handleZCommand(el, e)) {
      return;
    }

    if (e.key === " " && isAbbrevMode()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void showAbbrevCandidates(el);
      return;
    }

    if (handleAbbrevPrintable(el, e)) {
      return;
    }

    if (isAbbrevMode()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (e.key === "l") {
      e.preventDefault();
      e.stopImmediatePropagation();
      enterAsciiMode(el);
      return;
    }

    if (e.key === "L" && !state.wideAscii) {
      e.preventDefault();
      e.stopImmediatePropagation();
      enterWideAsciiMode(el);
      return;
    }

    if (state.wideAscii) {
      handleWideAsciiPrintable(el, e);
      return;
    }

    if (e.key.toLowerCase() === "q" && state.composing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      commitKatakana(el);
      return;
    }

    if (e.key === "Enter") {
      if (state.composing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        commitCandidate(el);
      }
      return;
    }

    if (e.key === " ") {
      if (state.composing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void showNextCandidate(el);
      }
      return;
    }

    if (e.key.toLowerCase() === "x" && state.composing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showPreviousCandidate(el);
      return;
    }

    if (state.composing && state.showingCandidate) {
      commitCandidate(el);
    }

    handlePrintable(el, e);
  }, true);

  document.addEventListener("keypress", (e) => {
    if (!state.enabled) return;
  }, true);
})();
