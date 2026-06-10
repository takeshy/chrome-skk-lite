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
  const OKURI_MARKER = "*";

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
    "cha": "ちゃ", "chu": "ちゅ", "che": "ちぇ", "cho": "ちょ",
    "tya": "ちゃ", "tyu": "ちゅ", "tye": "ちぇ", "tyo": "ちょ",
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
    if (state.okuriKey) {
      return HENKAN_PREFIX + (state.kana || "") + OKURI_MARKER + (state.okuriKana || "");
    }
    return HENKAN_PREFIX + preeditKana(state);
  }

  function currentRenderedLength(state) {
    if (state.replacedLength) return state.replacedLength;
    if (state.composing) return composingPreedit(state).length;
    return preeditKana(state).length;
  }

  function invalidateCandidates(state) {
    if (Array.isArray(state.candidates) && state.candidates.length) {
      state.candidates = [];
    }
    if (state.candidateIndex) {
      state.candidateIndex = 0;
    }
  }

  function appendComposingKana(state, kana) {
    if (!state.composing) return;
    if (state.okuriKey) {
      state.okuriKana += kana;
    } else {
      state.kana += kana;
    }
    invalidateCandidates(state);
    state.replacedLength = composingPreedit(state).length;
  }

  function foldOkuriIntoStem(state) {
    if (!state.okuriKey && !state.okuriKana) return false;
    state.kana = (state.kana || "") + (state.okuriKana || "");
    state.okuriKey = "";
    state.okuriKana = "";
    state.replacedLength = composingPreedit(state).length;
    return true;
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
    const stemLength = (state.kana || "").length;
    const hasOkuri = !!state.okuriKey;
    const okuriLength = (state.okuriKana || "").length;
    const totalLength = stemLength + (hasOkuri ? OKURI_MARKER.length + okuriLength : okuriLength);
    if (!state.composing || offset <= prefixLength || offset > prefixLength + totalLength) {
      return false;
    }

    const kanaIndex = offset - prefixLength - 1;
    if (kanaIndex < stemLength) {
      state.kana = state.kana.slice(0, kanaIndex) + state.kana.slice(kanaIndex + 1);
    } else if (hasOkuri && kanaIndex === stemLength) {
      foldOkuriIntoStem(state);
    } else {
      const okuriIndex = kanaIndex - stemLength - (hasOkuri ? OKURI_MARKER.length : 0);
      state.okuriKana = state.okuriKana.slice(0, okuriIndex) + state.okuriKana.slice(okuriIndex + 1);
    }
    invalidateCandidates(state);
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

  const KANJI_DIGITS = "〇一二三四五六七八九";

  function toFullWidthDigits(text) {
    return text.replace(/[0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
  }

  function toKanjiDigits(text) {
    return text.replace(/[0-9]/g, (ch) => KANJI_DIGITS[ch.charCodeAt(0) - 48]);
  }

  function toKanjiNumeral(text) {
    if (!/^[0-9]+$/.test(text)) return text;
    const digits = text.replace(/^0+(?=.)/, "");
    if (digits === "0") return "〇";

    const groups = [];
    for (let end = digits.length; end > 0; end -= 4) {
      groups.unshift(digits.slice(Math.max(0, end - 4), end));
    }
    const groupUnits = ["", "万", "億", "兆", "京"];
    if (groups.length > groupUnits.length) return toKanjiDigits(digits);

    const smallUnits = ["", "十", "百", "千"];
    let result = "";
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      let part = "";
      for (let j = 0; j < group.length; j++) {
        const digit = group.charCodeAt(j) - 48;
        if (!digit) continue;
        const unit = smallUnits[group.length - 1 - j];
        part += digit === 1 && unit ? unit : KANJI_DIGITS[digit] + unit;
      }
      if (part) part += groupUnits[groups.length - 1 - i];
      result += part;
    }
    return result || "〇";
  }

  function applyNumericCandidate(candidate, numbers) {
    let index = 0;
    return candidate.replace(/#([0-9])/g, (match, type) => {
      const number = numbers[index] ?? "";
      index += 1;
      if (type === "1") return toFullWidthDigits(number);
      if (type === "2") return toKanjiDigits(number);
      if (type === "3") return toKanjiNumeral(number);
      return number;
    });
  }

  const HALF_KATAKANA_MAP = {
    "ア": "ｱ", "イ": "ｲ", "ウ": "ｳ", "エ": "ｴ", "オ": "ｵ",
    "カ": "ｶ", "キ": "ｷ", "ク": "ｸ", "ケ": "ｹ", "コ": "ｺ",
    "サ": "ｻ", "シ": "ｼ", "ス": "ｽ", "セ": "ｾ", "ソ": "ｿ",
    "タ": "ﾀ", "チ": "ﾁ", "ツ": "ﾂ", "テ": "ﾃ", "ト": "ﾄ",
    "ナ": "ﾅ", "ニ": "ﾆ", "ヌ": "ﾇ", "ネ": "ﾈ", "ノ": "ﾉ",
    "ハ": "ﾊ", "ヒ": "ﾋ", "フ": "ﾌ", "ヘ": "ﾍ", "ホ": "ﾎ",
    "マ": "ﾏ", "ミ": "ﾐ", "ム": "ﾑ", "メ": "ﾒ", "モ": "ﾓ",
    "ヤ": "ﾔ", "ユ": "ﾕ", "ヨ": "ﾖ",
    "ラ": "ﾗ", "リ": "ﾘ", "ル": "ﾙ", "レ": "ﾚ", "ロ": "ﾛ",
    "ワ": "ﾜ", "ヲ": "ｦ", "ン": "ﾝ",
    "ァ": "ｧ", "ィ": "ｨ", "ゥ": "ｩ", "ェ": "ｪ", "ォ": "ｫ",
    "ッ": "ｯ", "ャ": "ｬ", "ュ": "ｭ", "ョ": "ｮ",
    "ガ": "ｶﾞ", "ギ": "ｷﾞ", "グ": "ｸﾞ", "ゲ": "ｹﾞ", "ゴ": "ｺﾞ",
    "ザ": "ｻﾞ", "ジ": "ｼﾞ", "ズ": "ｽﾞ", "ゼ": "ｾﾞ", "ゾ": "ｿﾞ",
    "ダ": "ﾀﾞ", "ヂ": "ﾁﾞ", "ヅ": "ﾂﾞ", "デ": "ﾃﾞ", "ド": "ﾄﾞ",
    "バ": "ﾊﾞ", "ビ": "ﾋﾞ", "ブ": "ﾌﾞ", "ベ": "ﾍﾞ", "ボ": "ﾎﾞ",
    "パ": "ﾊﾟ", "ピ": "ﾋﾟ", "プ": "ﾌﾟ", "ペ": "ﾍﾟ", "ポ": "ﾎﾟ",
    "ヴ": "ｳﾞ",
    "ー": "ｰ", "。": "｡", "、": "､", "「": "｢", "」": "｣", "・": "･"
  };

  function toHalfWidthKatakana(text) {
    let result = "";
    for (const ch of text) {
      result += HALF_KATAKANA_MAP[ch] ?? ch;
    }
    return result;
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
    OKURI_MARKER,
    KANA_TABLE,
    SMALL_TSU_RE,
    lookupKey,
    preeditKana,
    abbrevPreedit,
    composingPreedit,
    currentRenderedLength,
    appendComposingKana,
    foldOkuriIntoStem,
    shouldStartOkuri,
    isAbbrevChar,
    deleteComposingCharBeforeOffset,
    composingOffsetAfterBackspace,
    consumeRomanChunk,
    consumePendingN,
    applyNumericCandidate,
    toHalfWidthKatakana
  };
});
