const assert = require("node:assert/strict");

const engine = require("../skk_engine.js");

function createState() {
  return {
    roman: "",
    composing: true,
    kana: "",
    okuriKey: "",
    okuriKana: "",
    replacedLength: 0
  };
}

function typeRoman(state, text) {
  for (const ch of text) {
    state.roman += ch.toLowerCase();
    let guard = 0;
    while (state.roman && guard++ < 8) {
      if (!engine.consumeRomanChunk(state)) break;
    }
  }
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function toKatakana(text) {
  return text.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

runTest("Jixe composes to small-e", () => {
  const state = createState();

  typeRoman(state, "jixe");

  assert.equal(state.kana, "じぇ");
  assert.equal(state.replacedLength, 3);
  assert.equal(engine.currentRenderedLength(state), 3);
  assert.equal(engine.composingPreedit(state), "▽じぇ");
});

runTest("we composes to u-small-e", () => {
  const state = createState();

  typeRoman(state, "we");

  assert.equal(state.kana, "うぇ");
  assert.equal(state.roman, "");
  assert.equal(engine.composingPreedit(state), "▽うぇ");
});

runTest("tye and che compose to chi-small-e", () => {
  for (const roman of ["tye", "che"]) {
    const state = createState();

    typeRoman(state, roman);

    assert.equal(state.kana, "ちぇ");
    assert.equal(state.roman, "");
    assert.equal(engine.composingPreedit(state), "▽ちぇ");
  }
});

runTest("xi composes to small i", () => {
  const state = createState();

  typeRoman(state, "xi");

  assert.equal(state.kana, "ぃ");
  assert.equal(state.roman, "");
  assert.equal(engine.composingPreedit(state), "▽ぃ");
});

runTest("invalid pending roman drops the previous character", () => {
  const state = createState();

  typeRoman(state, "wk");

  assert.equal(state.kana, "");
  assert.equal(state.roman, "k");

  typeRoman(state, "a");

  assert.equal(state.kana, "か");
  assert.equal(state.roman, "");
});

runTest("remaining roman can be consumed after an invalid prefix is dropped", () => {
  const state = createState();

  state.roman = "w[";

  assert.equal(engine.consumeRomanChunk(state), "");
  assert.equal(state.roman, "[");
  assert.equal(engine.consumeRomanChunk(state), "「");
  assert.equal(state.kana, "「");
  assert.equal(state.roman, "");
});

runTest("single n can be committed before special keys", () => {
  const state = createState();

  typeRoman(state, "n");

  assert.equal(state.kana, "");
  assert.equal(state.roman, "n");
  assert.equal(engine.consumePendingN(state), "ん");
  assert.equal(state.kana, "ん");
  assert.equal(state.roman, "");
  assert.equal(engine.composingPreedit(state), "▽ん");
});

runTest("n apostrophe commits n before vowels", () => {
  const state = createState();

  typeRoman(state, "n'a");

  assert.equal(state.kana, "んあ");
  assert.equal(state.roman, "");
  assert.equal(engine.composingPreedit(state), "▽んあ");
});

runTest("backspace can replace the full previously rendered kana", () => {
  const state = createState();

  typeRoman(state, "jixe");
  state.kana = state.kana.slice(0, -1);

  assert.equal(state.kana, "じ");
  assert.equal(engine.currentRenderedLength(state), 3);
});

runTest("new composition starts cleanly after katakana commit", () => {
  const first = createState();
  typeRoman(first, "puro");

  const committed = toKatakana(engine.preeditKana(first));
  assert.equal(committed, "プロ");

  const second = createState();
  typeRoman(second, "ji");

  assert.equal(second.kana, "じ");
  assert.equal(second.replacedLength, 2);
  assert.equal(engine.currentRenderedLength(second), 2);
});

runTest("uppercase does not start okuri before stem kana exists", () => {
  const state = createState();

  assert.equal(engine.shouldStartOkuri(state, "J"), false);
  state.kana = "に";

  assert.equal(engine.shouldStartOkuri(state, "J"), true);
});

runTest("okuri lookup key excludes okuri kana", () => {
  const state = createState();
  state.kana = "とうと";
  state.okuriKey = "i";
  state.okuriKana = "い";

  assert.equal(engine.preeditKana(state), "とうとい");
  assert.equal(engine.lookupKey(state), "とうとi");
});

runTest("abbrev preedit renders slash-prefixed buffer", () => {
  const state = { abbrev: "MCP-1" };

  assert.equal(engine.STATE.ABBREV, "abbrev");
  assert.equal(engine.abbrevPreedit(state), "▽/MCP-1");
});

runTest("abbrev accepts uppercase letters digits and hyphen without roman conversion", () => {
  for (const ch of "MCP-1abc") {
    assert.equal(engine.isAbbrevChar(ch), true);
  }

  assert.equal(engine.isAbbrevChar("/"), false);
  assert.equal(engine.isAbbrevChar(" "), false);
});

runTest("backspace in the middle of composing preedit deletes matching kana", () => {
  const state = createState();
  state.kana = "もりた";
  state.replacedLength = engine.composingPreedit(state).length;

  const deleted = engine.deleteComposingCharBeforeOffset(state, 3);

  assert.equal(deleted, true);
  assert.equal(state.kana, "もた");
  assert.equal(engine.composingPreedit(state), "▽もた");
  assert.equal(engine.composingOffsetAfterBackspace(3), 2);
});

runTest("editing the reading invalidates stale candidates", () => {
  const state = createState();
  state.kana = "てすと";
  state.candidates = ["テスト", "TEST"];
  state.candidateIndex = 1;
  state.replacedLength = engine.composingPreedit(state).length;

  const deleted = engine.deleteComposingCharBeforeOffset(state, 4);

  assert.equal(deleted, true);
  assert.equal(state.kana, "てす");
  assert.deepEqual(state.candidates, []);
  assert.equal(state.candidateIndex, 0);
});

runTest("appending kana invalidates stale candidates", () => {
  const state = createState();
  state.kana = "てす";
  state.candidates = ["テスト", "TEST"];
  state.candidateIndex = 1;

  typeRoman(state, "ra");

  assert.equal(state.kana, "てすら");
  assert.deepEqual(state.candidates, []);
  assert.equal(state.candidateIndex, 0);
});

runTest("failed okuri conversion folds okuri back into the stem", () => {
  const state = createState();
  state.kana = "ようきろく";
  state.okuriKey = "g";
  state.okuriKana = "がかり";

  assert.equal(engine.lookupKey(state), "ようきろくg");

  const folded = engine.foldOkuriIntoStem(state);

  assert.equal(folded, true);
  assert.equal(state.kana, "ようきろくがかり");
  assert.equal(state.okuriKey, "");
  assert.equal(state.okuriKana, "");
  assert.equal(engine.lookupKey(state), "ようきろくがかり");
  assert.equal(engine.composingPreedit(state), "▽ようきろくがかり");
});

runTest("fold is a no-op without okuri state", () => {
  const state = createState();
  state.kana = "ようきろく";

  assert.equal(engine.foldOkuriIntoStem(state), false);
  assert.equal(state.kana, "ようきろく");
});

runTest("okuri composition shows the * marker in preedit", () => {
  const state = createState();
  state.kana = "かんが";
  state.okuriKey = "e";
  state.okuriKana = "え";

  assert.equal(engine.composingPreedit(state), "▽かんが*え");
  assert.equal(engine.preeditKana(state), "かんがえ");
  assert.equal(engine.lookupKey(state), "かんがe");
});

runTest("backspace on the okuri marker folds okuri into the stem", () => {
  const state = createState();
  state.kana = "かんが";
  state.okuriKey = "e";
  state.okuriKana = "え";
  state.replacedLength = engine.composingPreedit(state).length;

  // ▽かんが*え -> offset 5 is right after the marker... offset 5 targets the marker char itself
  const deleted = engine.deleteComposingCharBeforeOffset(state, 5);

  assert.equal(deleted, true);
  assert.equal(state.kana, "かんがえ");
  assert.equal(state.okuriKey, "");
  assert.equal(state.okuriKana, "");
  assert.equal(engine.composingPreedit(state), "▽かんがえ");
});

runTest("backspace on okuri kana after the marker deletes it", () => {
  const state = createState();
  state.kana = "かんが";
  state.okuriKey = "e";
  state.okuriKana = "え";
  state.replacedLength = engine.composingPreedit(state).length;

  const deleted = engine.deleteComposingCharBeforeOffset(state, 6);

  assert.equal(deleted, true);
  assert.equal(state.kana, "かんが");
  assert.equal(state.okuriKana, "");
  assert.equal(state.okuriKey, "e");
});

runTest("numeric candidates substitute number styles", () => {
  assert.equal(engine.applyNumericCandidate("第#0回", ["5"]), "第5回");
  assert.equal(engine.applyNumericCandidate("第#1回", ["5"]), "第５回");
  assert.equal(engine.applyNumericCandidate("第#2回", ["25"]), "第二五回");
  assert.equal(engine.applyNumericCandidate("第#3回", ["25"]), "第二十五回");
  assert.equal(engine.applyNumericCandidate("#3円", ["1234"]), "千二百三十四円");
  assert.equal(engine.applyNumericCandidate("#3", ["10405"]), "一万四百五");
  assert.equal(engine.applyNumericCandidate("#3", ["0"]), "〇");
  assert.equal(engine.applyNumericCandidate("#0月#0日", ["3", "14"]), "3月14日");
});

runTest("half-width katakana conversion handles voiced marks", () => {
  assert.equal(engine.toHalfWidthKatakana("ガンダム"), "ｶﾞﾝﾀﾞﾑ");
  assert.equal(engine.toHalfWidthKatakana("パーティー"), "ﾊﾟｰﾃｨｰ");
  assert.equal(engine.toHalfWidthKatakana("ヴ、。"), "ｳﾞ､｡");
});

runTest("fold also clears pending roman, candidates and candidate view", () => {
  const state = createState();
  state.kana = "かんが";
  state.okuriKey = "e";
  state.okuriKana = "え";
  state.roman = "z";
  state.candidates = ["考え"];
  state.candidateIndex = 1;
  state.showingCandidate = true;

  const folded = engine.foldOkuriIntoStem(state);

  assert.equal(folded, true);
  assert.equal(state.kana, "かんがえ");
  assert.equal(state.roman, "");
  assert.deepEqual(state.candidates, []);
  assert.equal(state.candidateIndex, 0);
  assert.equal(state.showingCandidate, false);
  assert.equal(engine.composingPreedit(state), "▽かんがえ");
});

runTest("line geometry finds line start and end around a position", () => {
  const text = "ab\ncd\nef";

  assert.equal(engine.lineStartOfPos(text, 0), 0);
  assert.equal(engine.lineStartOfPos(text, 2), 0);
  assert.equal(engine.lineStartOfPos(text, 3), 3);
  assert.equal(engine.lineStartOfPos(text, 5), 3);
  assert.equal(engine.lineStartOfPos(text, 6), 6);
  assert.equal(engine.lineStartOfPos(text, text.length), 6);

  assert.equal(engine.lineEndOfPos(text, 0), 2);
  assert.equal(engine.lineEndOfPos(text, 2), 2);
  assert.equal(engine.lineEndOfPos(text, 3), 5);
  assert.equal(engine.lineEndOfPos(text, 6), 8);
  assert.equal(engine.lineEndOfPos(text, text.length), 8);

  assert.equal(engine.lineStartOfPos("no newline", 4), 0);
  assert.equal(engine.lineEndOfPos("no newline", 4), 10);
});

runTest("killLineAt cuts to line end or start and eats the newline at EOL", () => {
  assert.deepEqual(engine.killLineAt("hello\nworld", 8, 1), { text: "hello\nwo", cursor: 8 });
  assert.deepEqual(engine.killLineAt("hello\nworld", 5, 1), { text: "helloworld", cursor: 5 });
  assert.deepEqual(engine.killLineAt("hello\nworld", 11, 1), { text: "hello\nworld", cursor: 11 });
  assert.deepEqual(engine.killLineAt("hello\nworld", 8, -1), { text: "hello\nrld", cursor: 6 });
  assert.deepEqual(engine.killLineAt("hello\nworld", 6, -1), { text: "hello\nworld", cursor: 6 });
});

runTest("shouldAutoConvertOkuri only fires once the okurigana is complete", () => {
  const base = { composing: true, okuriKey: "r", okuriKana: "る", roman: "", candidates: [] };

  assert.equal(engine.shouldAutoConvertOkuri(base), true);
  assert.equal(engine.shouldAutoConvertOkuri({ ...base, roman: "k" }), false);
  assert.equal(engine.shouldAutoConvertOkuri({ ...base, candidates: ["走る"] }), false);
  assert.equal(engine.shouldAutoConvertOkuri({ ...base, composing: false }), false);
  assert.equal(engine.shouldAutoConvertOkuri({ ...base, okuriKana: "" }), false);
  assert.equal(engine.shouldAutoConvertOkuri({ ...base, okuriKey: "" }), false);
});

runTest("registerReadingInfo presents okuri-ari readings with the * marker", () => {
  assert.deepEqual(
    engine.registerReadingInfo({ kana: "はげ", okuriKey: "r", okuriKana: "る" }),
    { key: "はげr", reading: "はげ*る", okuri: "る" }
  );
  assert.deepEqual(
    engine.registerReadingInfo({ kana: "みてい", okuriKey: "", okuriKana: "" }),
    { key: "みてい", reading: "みてい", okuri: "" }
  );
});

runTest("status hint strings are exposed for both front-ends", () => {
  assert.equal(engine.IDLE_STATUS, "Space: convert / Enter: copy / Ctrl+O: select all");
  assert.equal(engine.CANDIDATE_STATUS, "Space: next / Enter: commit / x: previous");
});
