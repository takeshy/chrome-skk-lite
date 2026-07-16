(() => {
  "use strict";

  const engine = globalThis.SkkEngine;
  const inputEl = document.getElementById("input");
  const modeEl = document.getElementById("mode");
  const candidateEl = document.getElementById("candidate");
  const statusEl = document.getElementById("status");
  const copyButton = document.getElementById("copy");
  const closeButton = document.getElementById("close");

  const INLINE_CANDIDATES = 4;
  const LIST_PAGE_SIZE = 7;
  const LIST_LABELS = ["a", "s", "d", "f", "j", "k", "l"];
  const Z_COMMANDS = {
    h: "←",
    j: "↓",
    k: "↑",
    l: "→",
    " ": "　",
    ".": "…",
    ",": "‥",
    "-": "～",
    "/": "・",
    "[": "『",
    "]": "』"
  };
  const ASCII_PRINTABLE_RE = /^[ -~]$/;

  let userDict = {};
  let candidateHistory = {};
  const lookupCache = new Map();

  const state = {
    text: "",
    cursor: 0,
    selectionEnd: 0,
    asciiMode: false,
    wideAscii: false,
    katakanaMode: null,
    roman: "",
    abbrev: "",
    abbrevMode: false,
    composing: false,
    kana: "",
    okuriKey: "",
    okuriKana: "",
    stickyOkuri: false,
    candidates: [],
    candidateIndex: 0,
    showingCandidate: false,
    completionMatches: null,
    completionIndex: 0,
    replacedLength: 0
  };

  function candidateWord(candidate) {
    const index = candidate.indexOf(";");
    return index === -1 ? candidate : candidate.slice(0, index);
  }

  function candidateAnnotation(candidate) {
    const index = candidate.indexOf(";");
    return index === -1 ? "" : candidate.slice(index + 1);
  }

  function syncUserDict(nextUserDict) {
    userDict = nextUserDict || {};
    lookupCache.clear();
  }

  function syncCandidateHistory(nextCandidateHistory) {
    candidateHistory = nextCandidateHistory || {};
    lookupCache.clear();
  }

  function mergeCandidateLists(lists) {
    const merged = [];
    const seen = new Set();
    for (const list of lists) {
      for (const candidate of list) {
        const word = candidateWord(candidate);
        if (!word || seen.has(word)) continue;
        seen.add(word);
        merged.push(candidate);
      }
    }
    return merged;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (data) => {
          resolve(data || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(values, () => {
          resolve(!chrome.runtime.lastError);
        });
      } catch {
        resolve(false);
      }
    });
  }

  function preeditKana() {
    return engine.preeditKana(state);
  }

  function lookupKey() {
    return engine.lookupKey(state);
  }

  function isAbbrevMode() {
    return state.abbrevMode;
  }

  function toKatakana(text) {
    return text.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }

  function toFullWidthAscii(text) {
    return text.replace(/[ -~]/g, (ch) => {
      if (ch === " ") return "　";
      return String.fromCharCode(ch.charCodeAt(0) + 0xfee0);
    });
  }

  function applyKatakanaMode(text) {
    if (!state.katakanaMode || state.composing || isAbbrevMode()) return text;
    const katakana = toKatakana(text);
    return state.katakanaMode === "han" ? engine.toHalfWidthKatakana(katakana) : katakana;
  }

  function candidateText() {
    const raw = state.candidates[state.candidateIndex];
    const stem = raw ? candidateWord(raw) : state.kana;
    return state.okuriKey ? stem + state.okuriKana : stem;
  }

  function candidateListActive() {
    return state.composing && state.showingCandidate && state.candidateIndex >= INLINE_CANDIDATES;
  }

  function candidateListText() {
    const start = state.candidateIndex;
    const end = Math.min(start + LIST_PAGE_SIZE, state.candidates.length);
    const parts = [];
    for (let i = start; i < end; i++) {
      parts.push(`${LIST_LABELS[i - start].toUpperCase()}:${candidateWord(state.candidates[i])}`);
    }
    parts.push(`[${start + 1}-${end}/${state.candidates.length}]`);
    return parts.join("  ");
  }

  function currentPreeditText() {
    if (isAbbrevMode()) return engine.abbrevPreedit(state);
    if (!state.composing) return state.roman;
    if (state.showingCandidate) return candidateText();
    return engine.composingPreedit(state) + state.roman;
  }

  function clampTextIndex(index) {
    const numeric = Number(index);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(state.text.length, numeric));
  }

  function normalizedTextSelection() {
    const start = clampTextIndex(state.cursor);
    const end = clampTextIndex(state.selectionEnd);
    return {
      start: Math.min(start, end),
      end: Math.max(start, end)
    };
  }

  function syncSelectionFromInput() {
    if (inputEl.selectionStart == null || inputEl.selectionEnd == null) return;

    const preedit = currentPreeditText();
    const preeditStart = clampTextIndex(state.cursor);
    const preeditEnd = preeditStart + preedit.length;
    if (
      preedit.length &&
      inputEl.selectionStart === preeditEnd &&
      inputEl.selectionEnd === preeditEnd
    ) {
      // render() collapses the visual selection after the temporary preedit.
      // Keep the underlying committed-text selection until the preedit is
      // converted, so typing "ka" still replaces the originally selected text.
      return;
    }
    const mapDisplayIndex = (index) => {
      const pos = Math.max(0, Number(index) || 0);
      if (!preedit.length || pos <= preeditStart) return clampTextIndex(pos);
      if (pos >= preeditEnd) return clampTextIndex(pos - preedit.length);
      return preeditStart;
    };

    state.cursor = mapDisplayIndex(inputEl.selectionStart);
    state.selectionEnd = mapDisplayIndex(inputEl.selectionEnd);
  }

  function replaceSelectedText(text) {
    const selection = normalizedTextSelection();
    state.text = state.text.slice(0, selection.start) + text + state.text.slice(selection.end);
    state.cursor = selection.start + text.length;
    state.selectionEnd = state.cursor;
  }

  function renderCandidateHint() {
    if (!state.composing || !state.showingCandidate) {
      if (candidateEl.textContent) candidateEl.textContent = "";
      if (candidateEl.dataset.active !== "false") candidateEl.dataset.active = "false";
      return;
    }

    let text = candidateText();
    if (candidateListActive()) {
      text = candidateListText();
    } else {
      const raw = state.candidates[state.candidateIndex];
      const annotation = raw ? candidateAnnotation(raw) : "";
      if (annotation) text = `${text} ※${annotation}`;
    }

    if (candidateEl.textContent !== text) candidateEl.textContent = text;
    if (candidateEl.dataset.active !== "true") candidateEl.dataset.active = "true";
  }

  function updateMode() {
    let text;
    if (state.wideAscii) {
      text = "SKK 全英";
    } else if (state.asciiMode) {
      text = "SKK OFF";
    } else if (isAbbrevMode()) {
      text = "SKK 略語";
    } else if (state.composing && state.showingCandidate) {
      text = "SKK 候補";
    } else if (state.composing) {
      text = "SKK 変換";
    } else if (state.katakanaMode === "han") {
      text = "SKK 半ｶﾅ";
    } else if (state.katakanaMode === "zen") {
      text = "SKK カナ";
    } else {
      text = "SKK かな";
    }
    if (modeEl.textContent !== text) modeEl.textContent = text;
  }

  function updateInputValue(value) {
    const previous = inputEl.value;
    if (previous === value) return;

    // Replacing textarea.value on every keystroke makes Chromium reshape and
    // repaint the entire text. Keep the unchanged prefix/suffix in the DOM and
    // replace only the edited range instead.
    if (typeof inputEl.setRangeText !== "function") {
      inputEl.value = value;
      return;
    }

    let start = 0;
    const sharedLength = Math.min(previous.length, value.length);
    while (start < sharedLength && previous.charCodeAt(start) === value.charCodeAt(start)) {
      start += 1;
    }

    let previousEnd = previous.length;
    let nextEnd = value.length;
    while (
      previousEnd > start &&
      nextEnd > start &&
      previous.charCodeAt(previousEnd - 1) === value.charCodeAt(nextEnd - 1)
    ) {
      previousEnd -= 1;
      nextEnd -= 1;
    }

    inputEl.setRangeText(value.slice(start, nextEnd), start, previousEnd, "preserve");
  }

  function render() {
    const selection = normalizedTextSelection();
    const preedit = currentPreeditText();
    const value = state.text.slice(0, selection.start) + preedit + state.text.slice(selection.end);
    const cursor = selection.start + preedit.length;
    updateInputValue(value);
    if (inputEl.selectionStart !== cursor || inputEl.selectionEnd !== cursor) {
      inputEl.selectionStart = inputEl.selectionEnd = cursor;
    }
    updateMode();
    renderCandidateHint();
  }

  function resetComposition() {
    state.roman = "";
    state.abbrev = "";
    state.abbrevMode = false;
    state.composing = false;
    state.kana = "";
    state.okuriKey = "";
    state.okuriKana = "";
    state.stickyOkuri = false;
    state.candidates = [];
    state.candidateIndex = 0;
    state.showingCandidate = false;
    state.completionMatches = null;
    state.completionIndex = 0;
    state.replacedLength = 0;
  }

  function enterKanaMode() {
    state.asciiMode = false;
    state.wideAscii = false;
    state.katakanaMode = null;
    render();
  }

  function enterAsciiMode() {
    if (state.showingCandidate) {
      commitCandidate();
    } else if (state.composing || state.roman) {
      if (!flushPendingRoman() && state.roman) {
        replaceSelectedText(state.roman);
        state.roman = "";
      }
      if (state.composing) {
        commitRawPreedit();
      }
    }

    resetComposition();
    state.asciiMode = true;
    state.wideAscii = false;
    render();
  }

  function enterWideAsciiMode() {
    if (state.showingCandidate) {
      commitCandidate();
    } else if (state.composing || state.roman) {
      if (!flushPendingRoman() && state.roman) {
        replaceSelectedText(state.roman);
        state.roman = "";
      }
      if (state.composing) {
        commitRawPreedit();
      }
    }

    resetComposition();
    state.asciiMode = false;
    state.wideAscii = true;
    render();
  }

  function appendText(text) {
    replaceSelectedText(text);
    render();
  }

  function commitCandidate() {
    if (!state.composing) return;
    const committedKey = lookupKey();
    const rawCandidate = state.showingCandidate ? state.candidates[state.candidateIndex] : "";
    const selectedCandidate = rawCandidate ? candidateWord(rawCandidate) : "";
    const text = state.showingCandidate ? candidateText() : preeditKana();
    replaceSelectedText(text);
    if (selectedCandidate) {
      rememberCandidateSelection(committedKey, selectedCandidate);
    }
    resetComposition();
    render();
  }

  function commitRawPreedit() {
    if (!state.composing) return;
    replaceSelectedText(preeditKana());
    resetComposition();
    render();
  }

  function commitKatakana(half = false) {
    if (!state.composing || !preeditKana()) return false;
    const katakana = toKatakana(preeditKana());
    replaceSelectedText(half ? engine.toHalfWidthKatakana(katakana) : katakana);
    resetComposition();
    render();
    return true;
  }

  function toggleKatakanaMode(kind) {
    state.katakanaMode = state.katakanaMode === kind ? null : kind;
    render();
  }

  function showPreedit() {
    state.showingCandidate = false;
    render();
  }

  function showCandidate() {
    state.showingCandidate = true;
    render();
  }

  function startAbbrev() {
    resetComposition();
    state.abbrevMode = true;
    state.abbrev = "";
    state.replacedLength = engine.ABBREV_PREFIX.length;
    render();
  }

  function closeAbbrev(replacement) {
    replaceSelectedText(replacement);
    resetComposition();
    render();
  }

  function lookup(kana) {
    if (lookupCache.has(kana)) {
      return lookupCache.get(kana);
    }

    const lookupPromise = new Promise((resolve) => {
      const fallback = () => {
        const merged = mergeCandidateLists([candidateHistory[kana] || [], userDict[kana] || []]);
        lookupCache.set(kana, Promise.resolve(merged));
        resolve(merged);
      };

      try {
        chrome.runtime.sendMessage({ type: "lookup", kana }, (response) => {
          if (chrome.runtime.lastError) {
            fallback();
            return;
          }
          const merged = mergeCandidateLists([
            candidateHistory[kana] || [],
            userDict[kana] || [],
            response?.candidates || []
          ]);
          lookupCache.set(kana, Promise.resolve(merged));
          resolve(merged);
        });
      } catch {
        fallback();
      }
    });

    lookupCache.set(kana, lookupPromise);
    return lookupPromise;
  }

  function lookupAny(keys) {
    return new Promise((resolve) => {
      void (async () => {
        const merged = [];
        const seen = new Set();
        for (const { key, numbers } of keys) {
          const candidates = await lookup(key);
          for (const candidate of candidates) {
            const text = numbers ? engine.applyNumericCandidate(candidate, numbers) : candidate;
            const word = candidateWord(text);
            if (!word || seen.has(word)) continue;
            seen.add(word);
            merged.push(text);
          }
        }
        resolve(merged);
      })();
    });
  }

  function lookupKeys() {
    const primary = lookupKey();
    const keys = [{ key: primary, numbers: null }];
    if (/[0-9]/.test(primary)) {
      keys.push({
        key: primary.replace(/[0-9]+/g, "#"),
        numbers: primary.match(/[0-9]+/g)
      });
    }
    return keys;
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

  async function showNextCandidate() {
    if (!state.composing) return;
    if (!flushPendingRoman()) return;

    if (!state.candidates.length) {
      state.candidates = await lookupAny(lookupKeys());
      state.candidateIndex = 0;
      if (!state.candidates.length) {
        showPreedit();
        statusEl.textContent = "No candidates.";
        return;
      }
      statusEl.textContent = "Space: next / Enter: commit / x: previous";
      showCandidate();
      return;
    }

    if (!state.showingCandidate) {
      state.candidateIndex = 0;
      showCandidate();
      return;
    }

    const nextIndex = state.candidateIndex + (candidateListActive() ? LIST_PAGE_SIZE : 1);
    const exhausted = candidateListActive()
      ? nextIndex >= state.candidates.length
      : state.candidateIndex >= state.candidates.length - 1;
    if (exhausted) {
      statusEl.textContent = "No more candidates.";
      return;
    }

    state.candidateIndex = nextIndex;
    showCandidate();
  }

  async function autoConvertOkuri() {
    if (!state.composing || !state.okuriKey || !state.okuriKana || state.roman || state.candidates.length) {
      return;
    }

    const requestKey = lookupKey();
    const candidates = await lookupAny(lookupKeys());
    if (
      !state.composing ||
      state.roman ||
      state.candidates.length ||
      lookupKey() !== requestKey
    ) {
      return;
    }

    if (!candidates.length) {
      engine.foldOkuriIntoStem(state);
      render();
      return;
    }

    state.candidates = candidates;
    state.candidateIndex = 0;
    showCandidate();
  }

  async function showAbbrevCandidates() {
    if (!isAbbrevMode() || !state.abbrev) return;

    const key = state.abbrev;
    state.candidates = await lookup(key);
    state.candidateIndex = 0;
    state.kana = key;
    state.okuriKey = "";
    state.okuriKana = "";
    state.roman = "";
    state.abbrev = "";
    state.abbrevMode = false;
    state.composing = true;

    if (!state.candidates.length) {
      statusEl.textContent = "No candidates.";
      showPreedit();
      return;
    }

    statusEl.textContent = "Space: next / Enter: commit / x: previous";
    showCandidate();
  }

  function showPreviousCandidate() {
    if (!state.composing || !state.showingCandidate || !state.candidates.length) return false;

    if (state.candidateIndex <= 0) {
      showPreedit();
      return true;
    }

    if (candidateListActive()) {
      state.candidateIndex =
        state.candidateIndex - LIST_PAGE_SIZE >= INLINE_CANDIDATES
          ? state.candidateIndex - LIST_PAGE_SIZE
          : INLINE_CANDIDATES - 1;
      showCandidate();
      return true;
    }

    state.candidateIndex -= 1;
    showCandidate();
    return true;
  }

  function handleCompletion() {
    if (!state.composing || state.showingCandidate || state.okuriKey || isAbbrevMode()) return false;

    const current = state.kana;
    if (!state.completionMatches || !state.completionMatches.includes(current)) {
      if (!current) return false;
      const keys = [...new Set([...Object.keys(candidateHistory), ...Object.keys(userDict)])].filter(
        (key) => key.startsWith(current) && key !== current && !/[a-z>#]/.test(key)
      );
      if (!keys.length) return false;
      state.completionMatches = [current, ...keys];
      state.completionIndex = 0;
    }

    state.completionIndex = (state.completionIndex + 1) % state.completionMatches.length;
    state.kana = state.completionMatches[state.completionIndex];
    state.candidates = [];
    state.candidateIndex = 0;
    showPreedit();
    return true;
  }

  async function purgeCurrentCandidate() {
    if (!state.composing || !state.showingCandidate || !state.candidates.length) return;
    const key = lookupKey();
    const word = candidateWord(state.candidates[state.candidateIndex] || "");
    if (!key || !word) return;

    const nextCandidateHistory = { ...candidateHistory };
    if (Array.isArray(nextCandidateHistory[key])) {
      nextCandidateHistory[key] = nextCandidateHistory[key].filter((item) => candidateWord(item) !== word);
      if (!nextCandidateHistory[key].length) delete nextCandidateHistory[key];
    }
    syncCandidateHistory(nextCandidateHistory);

    const nextUserDict = { ...userDict };
    if (Array.isArray(nextUserDict[key])) {
      nextUserDict[key] = nextUserDict[key].filter((item) => candidateWord(item) !== word);
      if (!nextUserDict[key].length) delete nextUserDict[key];
    }
    syncUserDict(nextUserDict);
    void storageSet({ candidateHistory: nextCandidateHistory, userDict: nextUserDict });

    state.candidates = state.candidates.filter((item) => candidateWord(item) !== word);
    if (!state.candidates.length) {
      state.candidateIndex = 0;
      showPreedit();
      return;
    }
    if (state.candidateIndex >= state.candidates.length) {
      state.candidateIndex = state.candidates.length - 1;
    }
    showCandidate();
  }

  function startComposition() {
    state.composing = true;
    state.kana = "";
    state.okuriKey = "";
    state.okuriKana = "";
    state.candidates = [];
    state.candidateIndex = 0;
    state.showingCandidate = false;
    state.replacedLength = engine.HENKAN_PREFIX.length;
    render();
  }

  function startOkuri(key) {
    if (state.roman === "n") {
      engine.consumePendingN(state);
    }
    state.okuriKey = key.toLowerCase();
    state.okuriKana = "";
    state.stickyOkuri = false;
    state.candidates = [];
    state.candidateIndex = 0;
    state.showingCandidate = false;
    state.replacedLength = engine.composingPreedit(state).length;
    render();
  }

  function convertRomanChunk() {
    const kana = engine.consumeRomanChunk(state);
    if (!kana) return false;
    if (!state.composing) {
      replaceSelectedText(applyKatakanaMode(kana));
    }
    render();
    if (state.composing && state.okuriKey && state.okuriKana && !state.roman && !state.candidates.length) {
      void autoConvertOkuri();
    }
    return true;
  }

  function flushPendingRoman() {
    if (!state.roman) return true;

    let guard = 0;
    while (state.roman && guard++ < 8) {
      const beforeRoman = state.roman;
      if (convertRomanChunk()) continue;
      if (state.roman !== beforeRoman) continue;
      if (state.roman === "n") {
        const kana = engine.consumePendingN(state);
        if (!state.composing) {
          replaceSelectedText(applyKatakanaMode(kana));
        }
        render();
        return true;
      }
      break;
    }
    return !state.roman;
  }

  function isUpperAsciiLetter(ch) {
    if (ch.length !== 1) return false;
    const code = ch.charCodeAt(0);
    return code >= 65 && code <= 90;
  }

  function isHandledPrintableKey(key) {
    if (key.length !== 1) return false;
    const code = key.charCodeAt(0);
    return (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 44 ||
      code === 45 ||
      code === 46 ||
      code === 63 ||
      code === 39 ||
      code === 91 ||
      code === 93
    );
  }

  function isToggleKeyEvent(e) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return false;
    const code = e.keyCode;
    if (code === 74) return true;
    if (e.key.length !== 1) return false;
    return (e.key.charCodeAt(0) | 32) === 106;
  }

  function isCancelCandidateKeyEvent(e) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return false;
    const code = e.keyCode;
    if (code === 71) return true;
    if (e.key.length !== 1) return false;
    return (e.key.charCodeAt(0) | 32) === 103;
  }

  function appendComposingKana(kana) {
    engine.appendComposingKana(state, kana);
    render();
  }

  function cancelCandidateSelection() {
    if (!state.composing) return false;
    showPreedit();
    state.candidates = [];
    state.candidateIndex = 0;
    return true;
  }

  function handlePrintable(e) {
    const ch = e.key;
    if (!isHandledPrintableKey(ch)) return false;

    e.preventDefault();

    if (state.showingCandidate) {
      commitCandidate();
    }

    if (isUpperAsciiLetter(ch)) {
      if (!state.composing) {
        startComposition();
      } else if (engine.shouldStartOkuri(state, ch)) {
        startOkuri(ch);
      }
    } else if (
      state.stickyOkuri &&
      state.composing &&
      !state.okuriKey &&
      state.kana &&
      /^[a-z]$/.test(ch)
    ) {
      startOkuri(ch);
    }

    if (/^[0-9]$/.test(ch) && !state.composing) {
      appendText(ch);
      return true;
    }

    if (ch === "?" && !state.composing) {
      appendText(ch);
      return true;
    }

    if (/^[0-9]$/.test(ch) && state.composing) {
      if (!flushPendingRoman()) state.roman = "";
      appendComposingKana(ch);
      return true;
    }

    state.roman += ch.toLowerCase();
    let guard = 0;
    while (state.roman && guard++ < 4) {
      const beforeRoman = state.roman;
      if (convertRomanChunk()) continue;
      if (state.roman !== beforeRoman) continue;
      break;
    }
    // A consonant may still be waiting for the following vowel. Render that
    // pending roman text immediately so every keypress has visual feedback.
    if (state.roman) render();
    return true;
  }

  function handleLiteralAscii(e) {
    if (state.composing || isAbbrevMode() || !ASCII_PRINTABLE_RE.test(e.key)) return false;

    e.preventDefault();
    appendText(e.key);
    return true;
  }

  function handleAbbrevPrintable(e) {
    if (!isAbbrevMode()) return false;

    if (e.key === "/") {
      e.preventDefault();
      closeAbbrev("/");
      return true;
    }

    if (!engine.isAbbrevChar(e.key)) return false;

    e.preventDefault();
    state.abbrev += e.key;
    render();
    return true;
  }

  function handlePrefixSuffixConversion(e) {
    if (e.key !== ">") return false;

    e.preventDefault();

    if (state.composing) {
      if (state.showingCandidate) {
        commitCandidate();
        startComposition();
        appendComposingKana(">");
        return true;
      }
      if (!flushPendingRoman()) return true;
      appendComposingKana(">");
      void showNextCandidate();
      return true;
    }

    if (!flushPendingRoman()) {
      state.roman = "";
    }
    startComposition();
    appendComposingKana(">");
    return true;
  }

  function handleZCommand(e) {
    if (state.roman !== "z") return false;
    const text = Z_COMMANDS[e.key];
    if (!text) return false;

    e.preventDefault();

    if (state.showingCandidate) {
      showPreedit();
      state.candidates = [];
      state.candidateIndex = 0;
    }

    state.roman = "";
    if (state.composing) {
      appendComposingKana(text);
    } else {
      appendText(text);
    }
    return true;
  }

  function handleBackspace(e) {
    syncSelectionFromInput();

    if (isAbbrevMode()) {
      e.preventDefault();
      if (state.abbrev) {
        state.abbrev = state.abbrev.slice(0, -1);
        render();
        return true;
      }
      closeAbbrev("");
      return true;
    }

    const selection = normalizedTextSelection();
    if (!state.roman && !state.composing && selection.start === selection.end && selection.start === 0) return false;

    e.preventDefault();
    if (state.roman) {
      state.roman = state.roman.slice(0, -1);
      render();
      return true;
    }

    if (state.showingCandidate) {
      showPreedit();
      return true;
    }

    if (state.composing) {
      if (state.okuriKana) {
        state.okuriKana = state.okuriKana.slice(0, -1);
      } else if (state.okuriKey) {
        state.okuriKey = "";
      } else if (state.kana) {
        state.kana = state.kana.slice(0, -1);
      }
      state.candidates = [];
      state.candidateIndex = 0;
      if (!preeditKana()) {
        resetComposition();
      }
      render();
      return true;
    }

    if (selection.start !== selection.end) {
      replaceSelectedText("");
    } else {
      state.text = state.text.slice(0, selection.start - 1) + state.text.slice(selection.start);
      state.cursor = selection.start - 1;
      state.selectionEnd = state.cursor;
    }
    render();
    return true;
  }

  async function copyAndClose() {
    if (state.roman) {
      flushPendingRoman();
    }
    if (state.composing) {
      commitCandidate();
    }

    const text = state.text;
    if (!text) {
      statusEl.textContent = "Nothing to copy.";
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = "Copied.";
      setTimeout(() => window.close(), 350);
    } catch {
      statusEl.textContent = "Copy failed.";
    }
  }

  inputEl.addEventListener("keydown", (e) => {
    syncSelectionFromInput();

    if (isToggleKeyEvent(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (state.asciiMode || state.wideAscii) {
        enterKanaMode();
        return;
      }
      if (state.roman && !flushPendingRoman()) return;
      if (state.composing) {
        commitCandidate();
      }
      return;
    }

    if (isCancelCandidateKeyEvent(e)) {
      if (cancelCandidateSelection()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "q") {
      e.preventDefault();
      if (state.composing) {
        if (!flushPendingRoman()) return;
        commitKatakana(true);
      } else {
        toggleKatakanaMode("han");
      }
      return;
    }

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if ((state.asciiMode || state.wideAscii) && ASCII_PRINTABLE_RE.test(e.key)) {
      e.preventDefault();
      appendText(state.wideAscii ? toFullWidthAscii(e.key) : e.key);
      return;
    }

    if (e.key === "Tab" && !e.shiftKey && state.composing && !state.showingCandidate && !state.okuriKey && !isAbbrevMode()) {
      e.preventDefault();
      handleCompletion();
      return;
    }

    if (candidateListActive()) {
      const labelIndex = LIST_LABELS.indexOf(e.key.toLowerCase());
      if (labelIndex !== -1) {
        e.preventDefault();
        const targetIndex = state.candidateIndex + labelIndex;
        if (targetIndex < state.candidates.length) {
          state.candidateIndex = targetIndex;
          commitCandidate();
        }
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (isAbbrevMode()) {
        closeAbbrev("");
        return;
      }
      if (state.composing || state.roman) {
        resetComposition();
        render();
        return;
      }
      window.close();
      return;
    }

    if (e.key === "/" && !state.composing && !state.roman && !isAbbrevMode()) {
      e.preventDefault();
      startAbbrev();
      return;
    }

    if (e.key === "Backspace") {
      handleBackspace(e);
      return;
    }

    if (e.key === " " && isAbbrevMode()) {
      e.preventDefault();
      void showAbbrevCandidates();
      return;
    }

    if (handleAbbrevPrintable(e)) {
      return;
    }

    if (isAbbrevMode()) {
      e.preventDefault();
      return;
    }

    if (e.key === "l") {
      e.preventDefault();
      enterAsciiMode();
      return;
    }

    if (e.key === "L") {
      e.preventDefault();
      enterWideAsciiMode();
      return;
    }

    if (e.key === ";" && !state.composing) {
      e.preventDefault();
      startComposition();
      return;
    }

    if (e.key === ";" && state.composing && !state.okuriKey && preeditKana()) {
      e.preventDefault();
      state.stickyOkuri = true;
      return;
    }

    if (e.key === " " && state.composing) {
      e.preventDefault();
      void showNextCandidate();
      return;
    }

    if (state.composing && state.showingCandidate && e.key === "X") {
      e.preventDefault();
      void purgeCurrentCandidate();
      return;
    }

    if (e.key.toLowerCase() === "x" && state.composing && state.showingCandidate) {
      if (showPreviousCandidate()) {
        e.preventDefault();
        return;
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        if (state.roman && !flushPendingRoman()) return;
        if (state.composing) {
          commitCandidate();
        }
        appendText("\n");
        return;
      }
      if (state.composing || state.roman) {
        if (state.roman && !flushPendingRoman()) return;
        commitCandidate();
        return;
      }
      void copyAndClose();
      return;
    }

    if (e.key.toLowerCase() === "q" && state.composing) {
      e.preventDefault();
      if (!flushPendingRoman()) return;
      commitKatakana(false);
      return;
    }

    if (e.key === "q" && !state.composing) {
      e.preventDefault();
      toggleKatakanaMode("zen");
      return;
    }

    if (handlePrefixSuffixConversion(e)) return;

    if (handleZCommand(e)) return;

    if (handlePrintable(e)) return;

    if (handleLiteralAscii(e)) return;
  }, true);

  inputEl.addEventListener("beforeinput", (e) => {
    if (e.inputType !== "insertText") return;
    e.preventDefault();
  });

  function toggleSkkMode() {
    if (state.asciiMode || state.wideAscii) {
      enterKanaMode();
    } else {
      enterAsciiMode();
    }
    inputEl.focus();
  }

  chrome.runtime?.onMessage?.addListener((message) => {
    if (message?.type !== "clipboard-toggle-skk") return false;

    if (state.asciiMode || state.wideAscii) {
      enterKanaMode();
    } else {
      if (state.roman && !flushPendingRoman()) return false;
      if (state.composing) commitCandidate();
    }
    inputEl.focus();
    return false;
  });

  modeEl.addEventListener("click", () => {
    toggleSkkMode();
  });

  modeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSkkMode();
    }
  });

  copyButton.addEventListener("click", () => {
    void copyAndClose();
  });

  closeButton.addEventListener("click", () => {
    window.close();
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

  void storageGet(["userDict", "candidateHistory"]).then((data) => {
    syncUserDict(data.userDict);
    syncCandidateHistory(data.candidateHistory);
  });

  render();
  inputEl.focus();
})();
