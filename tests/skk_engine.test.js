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
