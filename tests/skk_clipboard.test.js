const assert = require("node:assert/strict");

const DICT = {
  "かんじ": ["感じ", "漢字"],
  "ちょう>": ["超"],
  "もt": ["持"],
  "かえr": ["変"],
  ">てき": ["的"]
};

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.listeners = {};
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.rangeTextUpdates = 0;
    this.scrollTop = 0;
    this.scrollHeight = 1000;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  focus() {}

  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }

  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.rangeTextUpdates += 1;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

const elements = {
  input: new FakeElement("input"),
  mode: new FakeElement("mode"),
  candidate: new FakeElement("candidate"),
  status: new FakeElement("status"),
  copy: new FakeElement("copy"),
  close: new FakeElement("close"),
  "register-overlay": new FakeElement("register-overlay"),
  "register-reading": new FakeElement("register-reading"),
  "register-mode": new FakeElement("register-mode"),
  "register-input": new FakeElement("register-input"),
  "register-candidate": new FakeElement("register-candidate"),
  "register-error": new FakeElement("register-error"),
  "register-save": new FakeElement("register-save"),
  "register-cancel": new FakeElement("register-cancel")
};

let copiedText = "";
let closed = false;
let runtimeMessageListener = null;
let storedData = {};

globalThis.document = {
  getElementById(id) {
    return elements[id] || null;
  }
};

globalThis.window = {
  close() {
    closed = true;
  }
};

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      async writeText(text) {
        copiedText = text;
      }
    }
  }
});

globalThis.chrome = {
  runtime: {
    lastError: null,
    onMessage: {
      addListener(listener) {
        runtimeMessageListener = listener;
      }
    },
    sendMessage(message, callback) {
      if (message?.type === "lookup") {
        queueMicrotask(() => callback?.({ candidates: DICT[message.kana] || [] }));
      }
    }
  },
  storage: {
    local: {
      get(keys, callback) {
        queueMicrotask(() => callback({ ...storedData }));
      },
      set(values, callback) {
        queueMicrotask(() => {
          storedData = { ...storedData, ...values };
          callback?.();
        });
      }
    },
    onChanged: { addListener() {} }
  }
};

require("../skk_engine.js");
require("../skk_clipboard.js");

const input = elements.input;
const keydown = input.listeners.keydown;
const paste = input.listeners.paste;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function press(key, opts = {}) {
  const event = {
    key,
    ctrlKey: !!opts.ctrl,
    altKey: false,
    metaKey: false,
    shiftKey: !!opts.shift,
    keyCode: opts.keyCode ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {}
  };
  keydown(event);
  await flush();
  return event;
}

async function pressRegister(key, opts = {}) {
  const event = {
    key,
    ctrlKey: !!opts.ctrl,
    altKey: false,
    metaKey: false,
    shiftKey: !!opts.shift,
    keyCode: opts.keyCode ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {}
  };
  elements["register-input"].listeners.keydown(event);
  await flush();
  return event;
}

async function typeRegister(text) {
  for (const ch of text) {
    await pressRegister(ch, { shift: ch >= "A" && ch <= "Z" });
  }
}

async function type(text) {
  for (const ch of text) {
    await press(ch, { shift: ch >= "A" && ch <= "Z" });
  }
}

function pasteText(text) {
  const event = {
    defaultPrevented: false,
    clipboardData: {
      getData(type) {
        return type === "text/plain" ? text : "";
      }
    },
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
  paste(event);
  return event;
}

async function resetWindow() {
  await press("Escape");
  let guard = 0;
  while (input.value && guard++ < 100) {
    input.selectionStart = input.selectionEnd = input.value.length;
    await press("Backspace");
  }
  copiedText = "";
  closed = false;
}

async function runTest(name, fn) {
  try {
    await fn();
    await resetWindow();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

(async () => {
  await runTest("digits type literally outside composition", async () => {
    await press("5");
    assert.equal(input.value, "5");
  });

  await runTest("ascii symbols type literally outside composition", async () => {
    for (const ch of [" ", "?", "!", "@", ":", "<"]) {
      await press(ch);
    }
    assert.equal(input.value, " ?!@:<");
  });

  await runTest("pending roman text is visible until it becomes kana", async () => {
    await press("k");
    assert.equal(input.value, "k");
    await press("a");
    assert.equal(input.value, "か");
  });

  await runTest("typing at the end scrolls the clipboard input to the caret", async () => {
    input.scrollTop = 0;
    await type("aiu");
    assert.equal(input.scrollTop, input.scrollHeight);
  });

  await runTest("editing in the middle preserves the clipboard input scroll position", async () => {
    await type("aiu");
    input.selectionStart = input.selectionEnd = 1;
    input.scrollTop = 240;
    await type("ka");
    assert.equal(input.scrollTop, 240);
  });

  await runTest("pending roman text is visible during composition", async () => {
    await press("K", { shift: true });
    assert.equal(input.value, "▽k");
    await press("a");
    assert.equal(input.value, "▽か");
  });

  await runTest("kana input preserves moved caret in the clipboard window", async () => {
    const updatesBefore = input.rangeTextUpdates;
    await type("aiu");
    input.selectionStart = input.selectionEnd = 1;
    await type("ka");
    assert.equal(input.value, "あかいう");
    assert.equal(input.selectionStart, 2);
    assert.ok(input.rangeTextUpdates > updatesBefore);
  });

  await runTest("mode changes preserve a caret moved to the end", async () => {
    await type("aiu");
    input.selectionStart = input.selectionEnd = input.value.length - 1;
    input.listeners.select();
    input.selectionStart = input.selectionEnd = input.value.length;
    input.listeners.select();

    elements.mode.listeners.click();
    await press("z");

    assert.equal(input.value, "あいうz");
    assert.equal(input.selectionStart, input.value.length);
    elements.mode.listeners.click();
  });

  await runTest("kana input replaces the selected range in the clipboard window", async () => {
    await type("aiu");
    input.selectionStart = 1;
    input.selectionEnd = 2;
    await type("ka");
    assert.equal(input.value, "あかう");
  });

  await runTest("pasted text remains when backspace and kana input follow", async () => {
    const event = pasteText("貼り付け");
    assert.equal(event.defaultPrevented, true);
    assert.equal(input.value, "貼り付け");

    await press("Backspace");
    assert.equal(input.value, "貼り付");

    await type("ka");
    assert.equal(input.value, "貼り付か");
  });

  await runTest("paste replaces the selected range", async () => {
    pasteText("abcdef");
    input.selectionStart = 2;
    input.selectionEnd = 4;
    pasteText("XY");
    assert.equal(input.value, "abXYef");
  });

  await runTest("okuri conversion auto-selects after okuri kana", async () => {
    await type("MoTi");
    assert.equal(input.value, "持ち");
  });

  await runTest("missing okuri candidates open registration", async () => {
    await type("YoutuumoTi");
    assert.equal(elements["register-overlay"].dataset.open, "true");
    assert.equal(elements["register-reading"].textContent, "ようつうも*ち");

    elements["register-input"].value = "腰痛持";
    elements["register-save"].listeners.click();
    await flush();
    await flush();

    assert.equal(elements["register-overlay"].dataset.open, "false");
    assert.equal(input.value, "腰痛持ち");
    assert.deepEqual(storedData.userDict["ようつうもt"], ["腰痛持"]);
  });

  await runTest("new text after candidate commits current candidate first", async () => {
    await type("Kanji");
    await press(" ");
    await type("na");
    assert.equal(input.value, "感じな");
  });

  await runTest("Ctrl+G cancels candidate selection back to preedit", async () => {
    await type("Kanji");
    await press(" ");
    await press("g", { ctrl: true, keyCode: 71 });
    assert.equal(input.value, "▽かんじ");
  });

  await runTest("Ctrl+G folds an okuri-ari reading back into one heading", async () => {
    // Start okurigana input (uppercase mid-word) but stop before the vowel
    // lands, so auto-conversion has not fired yet.
    await type("KangaS");
    await press("g", { ctrl: true, keyCode: 71 });
    assert.equal(input.value, "▽かんが");
    // The folded reading now converts as a single okuri-nasi heading.
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");
    assert.equal(elements["register-reading"].textContent, "かんが");
    elements["register-cancel"].listeners.click();
    await flush();
  });

  await runTest("missing candidates can be registered from the clipboard window", async () => {
    await type("Mitei");
    await press(" ");

    assert.equal(elements["register-overlay"].dataset.open, "true");
    assert.equal(elements["register-reading"].textContent, "みてい");

    elements["register-input"].value = "未定";
    elements["register-save"].listeners.click();
    await flush();
    await flush();

    assert.equal(elements["register-overlay"].dataset.open, "false");
    assert.equal(input.value, "未定");
    assert.deepEqual(storedData.userDict["みてい"], ["未定"]);
  });

  await runTest("the registration field supports kana and candidate conversion", async () => {
    await type("Mikakutei");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    await typeRegister("Kanji");
    assert.equal(elements["register-input"].value, "▽かんじ");
    await pressRegister(" ");
    assert.equal(elements["register-input"].value, "感じ");
    assert.equal(elements["register-candidate"].textContent, "感じ");

    await pressRegister("Enter");
    assert.equal(elements["register-input"].value, "感じ");
    await pressRegister("Enter");
    await flush();

    assert.equal(elements["register-overlay"].dataset.open, "false");
    assert.equal(input.value, "感じ");
    assert.deepEqual(storedData.userDict["みかくてい"], ["感じ"]);
  });

  await runTest("the registration field switches between kana and ascii input", async () => {
    await type("Tourokumo-do");
    await press(" ");

    await pressRegister("l");
    assert.equal(elements["register-mode"].textContent, "SKK OFF");
    await typeRegister("abc-123");
    assert.equal(elements["register-input"].value, "abc-123");

    runtimeMessageListener({ type: "clipboard-toggle-skk", source: "command" });
    assert.equal(elements["register-mode"].textContent, "SKK かな");
    await typeRegister("ka");
    assert.equal(elements["register-input"].value, "abc-123か");

    elements["register-cancel"].listeners.click();
  });

  await runTest("the registration mode label toggles kana and ascii input", async () => {
    await type("Mikakutei2");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    elements["register-mode"].listeners.click();
    assert.equal(elements["register-mode"].textContent, "SKK OFF");
    elements["register-mode"].listeners.click();
    assert.equal(elements["register-mode"].textContent, "SKK かな");

    elements["register-cancel"].listeners.click();
  });

  await runTest("Ctrl+G cancels the registration window", async () => {
    await type("Mikakuteikyanseru");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    const event = await pressRegister("g", { ctrl: true });
    assert.equal(event.defaultPrevented, true);
    assert.equal(elements["register-overlay"].dataset.open, "false");
  });

  await runTest("Ctrl+G unwinds the registration dialog one step at a time", async () => {
    await type("Mikakuteidankai");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    await typeRegister("Kanji");
    assert.equal(elements["register-input"].value, "▽かんじ");
    await pressRegister(" ");
    assert.equal(elements["register-input"].value, "感じ");

    // 1) drop the candidate, back to the ▽ reading
    await pressRegister("g", { ctrl: true });
    assert.equal(elements["register-input"].value, "▽かんじ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    // 2) drop the composition
    await pressRegister("g", { ctrl: true });
    assert.equal(elements["register-input"].value, "");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    // 3) nothing left: close the dialog
    await pressRegister("g", { ctrl: true });
    assert.equal(elements["register-overlay"].dataset.open, "false");
  });

  await runTest("the registration dialog auto-converts once the okurigana is complete", async () => {
    await type("Henkantouroku");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    await typeRegister("KaeRu");
    assert.equal(elements["register-input"].value, "変る");
    assert.equal(elements["register-candidate"].textContent, "変る");

    elements["register-cancel"].listeners.click();
  });

  await runTest("the registration field supports wide ascii input", async () => {
    await type("Mikakutei3");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");

    await pressRegister("L", { shift: true });
    assert.equal(elements["register-mode"].textContent, "SKK 全英");
    await typeRegister("A 1");
    assert.equal(elements["register-input"].value, "Ａ　１");

    elements["register-cancel"].listeners.click();
  });

  await runTest("q commits katakana in the registration field", async () => {
    await type("Mikakutei4");
    await press(" ");

    await typeRegister("Katakana");
    assert.equal(elements["register-input"].value, "▽かたかな");
    await pressRegister("q");
    assert.equal(elements["register-input"].value, "カタカナ");

    elements["register-cancel"].listeners.click();
  });

  await runTest("q and Ctrl+Q toggle katakana input modes in the registration field", async () => {
    await type("Mikakutei5");
    await press(" ");

    await pressRegister("q");
    assert.equal(elements["register-mode"].textContent, "SKK カナ");
    await typeRegister("kana");
    assert.equal(elements["register-input"].value, "カナ");

    await pressRegister("q");
    await pressRegister("q", { ctrl: true, keyCode: 81 });
    assert.equal(elements["register-mode"].textContent, "SKK 半ｶﾅ");
    await typeRegister("kana");
    assert.equal(elements["register-input"].value, "カナｶﾅ");

    elements["register-cancel"].listeners.click();
  });

  await runTest("a registered clipboard candidate is available on the next conversion", async () => {
    await type("Mitei");
    await press(" ");

    assert.equal(elements["register-overlay"].dataset.open, "false");
    assert.equal(input.value, "未定");
    assert.equal(elements.candidate.textContent, "未定");
    assert.equal(elements.candidate.dataset.active, "true");
  });

  await runTest("advancing past the last candidate opens registration", async () => {
    await type("Kanji");
    await press(" ");
    await press(" ");
    await press(" ");

    assert.equal(elements["register-overlay"].dataset.open, "true");
    assert.equal(elements["register-reading"].textContent, "かんじ");

    elements["register-cancel"].listeners.click();
    assert.equal(elements["register-overlay"].dataset.open, "false");
    assert.equal(elements.candidate.textContent, "漢字");
  });

  await runTest("Chrome Ctrl+J command commits conversion in the clipboard window", async () => {
    await type("Kanji");
    await press(" ");
    runtimeMessageListener({ type: "clipboard-toggle-skk", source: "command" });
    assert.equal(input.value, "感じ");
  });

  await runTest("Shift+Enter inserts newline", async () => {
    await type("ai");
    await press("Enter", { shift: true });
    assert.equal(input.value, "あい\n");
  });

  await runTest("> converts prefix readings", async () => {
    await type("Chou");
    await press(">", { shift: true });
    assert.equal(input.value, "超");
  });

  await runTest("z commands insert symbols", async () => {
    await type("zhzjzkzl");
    await press("z");
    await press(" ");
    assert.equal(input.value, "←↓↑→　");
  });

  await runTest("Emacs caret keys move within the committed text", async () => {
    pasteText("abcdef");
    input.selectionStart = input.selectionEnd = 3;
    await press("b", { ctrl: true });
    assert.equal(input.selectionStart, 2);
    await press("f", { ctrl: true });
    assert.equal(input.selectionStart, 3);
    await press("a", { ctrl: true });
    assert.equal(input.selectionStart, 0);
    await press("e", { ctrl: true });
    assert.equal(input.selectionStart, 6);
  });

  await runTest("Ctrl+A / Ctrl+E respect line boundaries", async () => {
    pasteText("hello\nworld");
    input.selectionStart = input.selectionEnd = 9;
    await press("a", { ctrl: true });
    assert.equal(input.selectionStart, 6);
    await press("e", { ctrl: true });
    assert.equal(input.selectionStart, 11);
  });

  await runTest("Ctrl+K kills to end of line and joins at EOL; Ctrl+U kills to line start", async () => {
    pasteText("hello\nworld");
    input.selectionStart = input.selectionEnd = 5; // end of the first line
    await press("k", { ctrl: true });
    assert.equal(input.value, "helloworld");
    input.selectionStart = input.selectionEnd = 5;
    await press("u", { ctrl: true });
    assert.equal(input.value, "world");
    assert.equal(input.selectionStart, 0);
  });

  await runTest("Ctrl+O selects all and typing replaces the buffer", async () => {
    pasteText("replace me");
    await press("o", { ctrl: true });
    assert.equal(input.value, "replace me");
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, 10);
    input.listeners.select();
    assert.equal(input.value, "replace me");
    await type("ai");
    assert.equal(input.value, "あい");
  });

  await runTest("cut updates the model and Ctrl+Z restores it", async () => {
    pasteText("abcdef");
    input.selectionStart = 2;
    input.selectionEnd = 4;
    input.listeners.select();
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    input.listeners.cut(event);
    await flush();
    assert.equal(event.defaultPrevented, true);
    assert.equal(copiedText, "cd");
    assert.equal(input.value, "abef");
    await press("z", { ctrl: true });
    assert.equal(input.value, "abcdef");
  });

  await runTest("Ctrl+Z undoes committed-text edits one step at a time", async () => {
    pasteText("あいうえお");
    input.selectionStart = input.selectionEnd = 3;
    await press("k", { ctrl: true });
    assert.equal(input.value, "あいう");
    await type("a");
    assert.equal(input.value, "あいうあ");
    await press("z", { ctrl: true });
    assert.equal(input.value, "あいう");
    await press("z", { ctrl: true });
    assert.equal(input.value, "あいうえお");
  });

  await runTest("Ctrl+[ behaves like Escape in the main and register inputs", async () => {
    await type("Kanji");
    await press("[", { ctrl: true, keyCode: 219 });
    assert.equal(input.value, "");
    assert.equal(closed, false);

    await type("Nai");
    await press(" ");
    assert.equal(elements["register-overlay"].dataset.open, "true");
    await pressRegister("[", { ctrl: true, keyCode: 219 });
    assert.equal(elements["register-overlay"].dataset.open, "false");
  });

  await runTest("Emacs keys are inert while composing", async () => {
    await type("Kanji");
    await press("a", { ctrl: true });
    assert.equal(input.value, "▽かんじ");
  });

  await runTest("the status hint switches with candidate context", async () => {
    const engine = require("../skk_engine.js");
    await type("Kanji");
    await press(" ");
    assert.equal(elements.status.textContent, engine.CANDIDATE_STATUS);
    await press("j", { ctrl: true, keyCode: 74 }); // commit
    assert.equal(elements.status.textContent, engine.IDLE_STATUS);
  });

  await press("Enter");
  assert.equal(copiedText, "");
  assert.equal(closed, false);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
