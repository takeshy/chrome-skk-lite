const assert = require("node:assert/strict");

const DICT = {
  "かんじ": ["感じ", "漢字"],
  "ちょう>": ["超"],
  "もt": ["持"],
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
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  focus() {}

  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.rangeTextUpdates += 1;
  }
}

const elements = {
  input: new FakeElement("input"),
  mode: new FakeElement("mode"),
  candidate: new FakeElement("candidate"),
  status: new FakeElement("status"),
  copy: new FakeElement("copy"),
  close: new FakeElement("close")
};

let copiedText = "";
let closed = false;
let runtimeMessageListener = null;

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

globalThis.navigator = {
  clipboard: {
    async writeText(text) {
      copiedText = text;
    }
  }
};

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
        queueMicrotask(() => callback({}));
      },
      set(values, callback) {
        queueMicrotask(() => callback?.());
      }
    },
    onChanged: { addListener() {} }
  }
};

require("../skk_engine.js");
require("../skk_clipboard.js");

const input = elements.input;
const keydown = input.listeners.keydown;

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

async function type(text) {
  for (const ch of text) {
    await press(ch, { shift: ch >= "A" && ch <= "Z" });
  }
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

  await runTest("kana input replaces the selected range in the clipboard window", async () => {
    await type("aiu");
    input.selectionStart = 1;
    input.selectionEnd = 2;
    await type("ka");
    assert.equal(input.value, "あかう");
  });

  await runTest("okuri conversion auto-selects after okuri kana", async () => {
    await type("MoTi");
    assert.equal(input.value, "持ち");
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
    await type("zh");
    await press("z");
    await press(" ");
    assert.equal(input.value, "←　");
  });

  await press("Enter");
  assert.equal(copiedText, "");
  assert.equal(closed, false);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
