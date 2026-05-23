(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SkkEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const STATE = {
    ASCII: "ascii",
    SKK_KANA: "skk_kana",
    SKK_HENKAN: "skk_henkan",
    SKK_CANDIDATE: "skk_candidate",
    ABBREV: "abbrev",
    SKK_TOUROKU: "skk_touroku"
  };

  const HENKAN_PREFIX = "▽";
  const ABBREV_PREFIX = "▽/";

  const KANA_TABLE = {
    "-": "ー", ",": "、", ".": "。", "[": "「", "]": "」",
    "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お",
    "xa": "ぁ", "xi": "ぃ", "xu": "ぅ", "xe": "ぇ", "xo": "ぉ",
    "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ",
    "sa": "さ", "shi": "し", "si": "し", "su": "す", "se": "せ", "so": "そ",
    "ta": "た", "chi": "ち", "ti": "ち", "tsu": "つ", "tu": "つ", "te": "て", "to": "と",
    "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
    "ha": "は", "hi": "ひ", "fu": "ふ", "hu": "ふ", "he": "へ", "ho": "ほ",
    "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も",
    "ya": "や", "yu": "ゆ", "yo": "よ",
    "xya": "ゃ", "xyu": "ゅ", "xyo": "ょ",
    "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ",
    "wa": "わ", "wi": "うぃ", "we": "うぇ", "wo": "を", "nn": "ん", "xtu": "っ",
    "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご",
    "za": "ざ", "ji": "じ", "zi": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
    "da": "だ", "di": "ぢ", "du": "づ", "de": "で", "do": "ど",
    "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ",
    "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
    "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ",
    "sha": "しゃ", "shu": "しゅ", "sho": "しょ",
    "sya": "しゃ", "syu": "しゅ", "syo": "しょ",
    "cha": "ちゃ", "chu": "ちゅ", "cho": "ちょ",
    "tya": "ちゃ", "tyu": "ちゅ", "tyo": "ちょ",
    "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
    "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ",
    "mya": "みゃ", "myu": "みゅ", "myo": "みょ",
    "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
    "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
    "ja": "じゃ", "ju": "じゅ", "jo": "じょ", "je": "じぇ",
    "jya": "じゃ", "jyu": "じゅ", "jyo": "じょ",
    "bya": "びゃ", "byu": "びゅ", "byo": "びょ",
    "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ",
    "fa": "ふぁ", "fi": "ふぃ", "fe": "ふぇ", "fo": "ふぉ",
    "va": "ゔぁ", "vi": "ゔぃ", "vu": "ゔ", "ve": "ゔぇ", "vo": "ゔぉ"
  };

  const SMALL_TSU_RE = /^([bcdfghjklmpqrstvwxyz])\1/;
  const SMALL_TSU_CONSONANTS = new Set("bcdfghjklmpqrstvwxyz");
  const N_FOLLOWERS = new Set("aiueoyn");
  const ROMAN_PREFIXES = new Set();

  for (const key of Object.keys(KANA_TABLE)) {
    for (let len = 1; len < key.length; len++) {
      ROMAN_PREFIXES.add(key.slice(0, len));
    }
  }

  function preeditKana(state) {
    return (state.kana || "") + (state.okuriKana || "");
  }

  function lookupKey(state) {
    return state.okuriKey ? (state.kana || "") + state.okuriKey : (state.kana || "");
  }

  function abbrevPreedit(state) {
    return ABBREV_PREFIX + (state.abbrev || "");
  }

  function composingPreedit(state) {
    return HENKAN_PREFIX + preeditKana(state);
  }

  function currentRenderedLength(state) {
    if (state.replacedLength) return state.replacedLength;
    if (state.composing) return composingPreedit(state).length;
    return preeditKana(state).length;
  }

  function appendComposingKana(state, kana) {
    if (!state.composing) return;
    if (state.okuriKey) {
      state.okuriKana += kana;
    } else {
      state.kana += kana;
    }
    state.replacedLength = composingPreedit(state).length;
  }

  function shouldStartOkuri(state, key) {
    if (key.length !== 1) return false;
    const code = key.charCodeAt(0);
    return code >= 65 && code <= 90 && !!state.composing && !state.okuriKey && !!state.kana;
  }

  function isAbbrevChar(key) {
    if (key.length !== 1) return false;
    const code = key.charCodeAt(0);
    return (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      key === "-"
    );
  }

  function deleteComposingCharBeforeOffset(state, offset) {
    const prefixLength = HENKAN_PREFIX.length;
    const kana = preeditKana(state);
    if (!state.composing || offset <= prefixLength || offset > prefixLength + kana.length) {
      return false;
    }

    const kanaIndex = offset - prefixLength - 1;
    const stemLength = (state.kana || "").length;
    if (kanaIndex < stemLength) {
      state.kana = state.kana.slice(0, kanaIndex) + state.kana.slice(kanaIndex + 1);
    } else {
      const okuriIndex = kanaIndex - stemLength;
      state.okuriKana = state.okuriKana.slice(0, okuriIndex) + state.okuriKana.slice(okuriIndex + 1);
    }
    state.replacedLength = composingPreedit(state).length;
    return true;
  }

  function composingOffsetAfterBackspace(offset) {
    return Math.max(HENKAN_PREFIX.length, offset - 1);
  }

  function consumeRomanChunk(state) {
    const r = state.roman.toLowerCase();

    if (r.startsWith("n'")) {
      state.roman = r.slice(2);
      appendComposingKana(state, "ん");
      return "ん";
    }

    if (r.length >= 2 && r[0] === r[1] && SMALL_TSU_CONSONANTS.has(r[0])) {
      state.roman = r.slice(1);
      appendComposingKana(state, "っ");
      return "っ";
    }

    if (r.length === 2 && r[0] === "n" && !N_FOLLOWERS.has(r[1])) {
      state.roman = r.slice(1);
      appendComposingKana(state, "ん");
      return "ん";
    }

    for (let len = Math.min(3, r.length); len >= 1; len--) {
      const key = r.slice(0, len);
      const kana = KANA_TABLE[key];
      if (kana) {
        state.roman = r.slice(len);
        appendComposingKana(state, kana);
        return kana;
      }
    }

    if (!ROMAN_PREFIXES.has(r)) {
      state.roman = r.slice(1);
    }

    return "";
  }

  function consumePendingN(state) {
    if (state.roman !== "n") return "";
    state.roman = "";
    appendComposingKana(state, "ん");
    return "ん";
  }

  return {
    STATE,
    HENKAN_PREFIX,
    ABBREV_PREFIX,
    KANA_TABLE,
    SMALL_TSU_RE,
    lookupKey,
    preeditKana,
    abbrevPreedit,
    composingPreedit,
    currentRenderedLength,
    appendComposingKana,
    shouldStartOkuri,
    isAbbrevChar,
    deleteComposingCharBeforeOffset,
    composingOffsetAfterBackspace,
    consumeRomanChunk,
    consumePendingN
  };
});
