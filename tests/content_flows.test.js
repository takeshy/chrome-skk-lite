// Integration-ish tests: load content.js with a stubbed DOM/chrome and
// drive it with synthetic keydown events against a fake <input>.
const assert = require("node:assert/strict");

const DICT = {
  "ちょう>": ["超"],
  ">てき": ["的"],
  "はしr": ["走"],
  "だい#かい": ["第#1回", "第#3回"],
  "かんじ": ["感じ", "漢字"],
  "おおい": ["多い", "多飯", "大井", "覆い", "オオイ", "凡い", "鸁い", "飫い", "都比", "邑伊", "于"],
  "ちゅうもく": ["注目;ちゅうもく注釈"]
};

function fakeElement() {
  return {
    style: {},
    dataset: {},
    textContent: "",
    className: "",
    innerHTML: "",
    appendChild() {},
    append() {},
    attachShadow() {
      return { append() {}, appendChild() {} };
    },
    addEventListener() {},
    querySelector() {
      return fakeElement();
    },
    getRootNode() {
      return { host: { style: {} } };
    },
    focus() {}
  };
}

const keydownListeners = [];
globalThis.window = { innerWidth: 1200, innerHeight: 800 };
globalThis.InputEvent = class {
  constructor() {}
};
globalThis.document = {
  documentElement: { appendChild() {} },
  body: null,
  activeElement: null,
  addEventListener(type, fn) {
    if (type === "keydown") keydownListeners.push(fn);
  },
  createElement() {
    return fakeElement();
  },
  getSelection() {
    return null;
  },
  createRange() {
    return {};
  },
  execCommand() {
    return true;
  }
};
globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      if (message?.type === "lookup") {
        queueMicrotask(() => callback?.({ candidates: DICT[message.kana] || [] }));
      } else {
        queueMicrotask(() => callback?.({ ok: true }));
      }
      return Promise.resolve();
    },
    onMessage: { addListener() {} }
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

class FakeInput {
  constructor() {
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.tagName = "INPUT";
    this.isContentEditable = false;
    this.isConnected = true;
  }
  getAttribute(name) {
    return name === "type" ? "text" : null;
  }
  hasAttribute(name) {
    return name === "type";
  }
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  dispatchEvent() {}
  focus() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 20 };
  }
}

require("../skk_engine.js");
require("../content.js");

let input;

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
  for (const listener of keydownListeners) listener(event);
  if (!event.defaultPrevented && key.length === 1 && !opts.ctrl) {
    input.setRangeText(key, input.selectionStart, input.selectionEnd);
  }
  await flush();
  return event;
}

async function type(text) {
  for (const ch of text) {
    await press(ch, { shift: ch >= "A" && ch <= "Z" });
  }
}

async function freshSession() {
  input = new FakeInput();
  globalThis.document.activeElement = input;
  await press("j", { ctrl: true, keyCode: 74 }); // toggle off (if on) ...
  globalThis.document.activeElement = input;
  // Ensure enabled: Ctrl+J enables; if it was already enabled this commits/turns nothing off,
  // so probe by typing a vowel and checking it became kana; reset value afterwards.
  await press("j", { ctrl: true, keyCode: 74 });
  input.value = "";
  input.selectionStart = input.selectionEnd = 0;
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

(async () => {
  // The toggle dedupe window swallows rapid repeat Ctrl+J presses; wait it out per session.
  const TOGGLE_WAIT = 350;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function enableSkk() {
    input = new FakeInput();
    globalThis.document.activeElement = input;
    await wait(TOGGLE_WAIT);
    await press("j", { ctrl: true, keyCode: 74 });
    input.value = "";
    input.selectionStart = input.selectionEnd = 0;
  }

  await runTest("plain kana input works", async () => {
    await enableSkk();
    await type("aiu");
    assert.equal(input.value, "あいう");
  });

  await runTest("conversion commits via Enter", async () => {
    await enableSkk();
    await type("Kanji");
    await press(" ");
    await press("Enter");
    assert.equal(input.value, "感じ");
  });

  await runTest("> converts a prefix reading (▽ちょう>)", async () => {
    await enableSkk();
    await type("Chou");
    await press(">", { shift: true });
    await press("Enter");
    assert.equal(input.value, "超");
  });

  await runTest("> after a candidate starts suffix composition", async () => {
    await enableSkk();
    await type("Kanji");
    await press(" ");
    await press(">", { shift: true }); // commit 感じ, start ▽>
    await type("teki");
    await press(" ");
    await press("Enter");
    assert.equal(input.value, "感じ的");
  });

  await runTest("sticky shift ; starts composition and marks okuri", async () => {
    await enableSkk();
    await press(";");
    await type("hasi");
    await press(";");
    await type("ru");
    await press("Enter");
    assert.equal(input.value, "走る");
  });

  await runTest("numeric reading converts with #1 entries", async () => {
    await enableSkk();
    await type("Dai5kai");
    await press(" ");
    await press("Enter");
    assert.equal(input.value, "第５回");
  });

  await runTest("candidate list selects with label keys", async () => {
    await enableSkk();
    await type("Ooi");
    for (let i = 0; i < 5; i++) await press(" ");
    // index 4 page shows candidates[4..10]; label "f" is offset 3 -> candidates[7]
    await press("f");
    assert.equal(input.value, "飫い");
  });

  await runTest("> from kana mode starts suffix composition", async () => {
    await enableSkk();
    await press(">", { shift: true });
    await type("teki");
    await press(" ");
    await press("Enter");
    assert.equal(input.value, "的");
  });

  await runTest("annotation is stripped from the committed text", async () => {
    await enableSkk();
    await type("Chuumoku");
    await press(" ");
    await press("Enter");
    assert.equal(input.value, "注目");
  });

  await runTest("q toggles katakana input mode", async () => {
    await enableSkk();
    await press("q");
    await type("kana");
    await press("q");
    await type("kana");
    assert.equal(input.value, "カナかな");
  });

  await runTest("Ctrl+Q toggles half-width katakana input mode", async () => {
    await enableSkk();
    await press("q", { ctrl: true, keyCode: 81 });
    await type("gandamu");
    await press("q", { ctrl: true, keyCode: 81 });
    assert.equal(input.value, "ｶﾞﾝﾀﾞﾑ");
  });

  await runTest("digits type literally outside composition", async () => {
    await enableSkk();
    await type("a5b");
    // 'b' stays pending as roman; only あ5 visible
    assert.equal(input.value, "あ5");
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
