# SKK Lite for Chrome Inputs

Chromeのページ内入力欄だけで動く、SKK風の最小実装です。

管理者権限がないなどの理由で OS の IME を install できない環境でも、Chrome の入力欄で SKK を使えるようにすることを主な目的にしています。

辞書は [skk-dev/dict](https://github.com/skk-dev/dict) の継続的に整備されている SKK 辞書群に依存しています。`SKK-JISYO.L` を中心に専門辞書まで揃っていて非常に扱いやすい素晴らしいプロジェクトで、この拡張のビルド時の取得元はその配布ページ `https://skk-dev.github.io/dict/` です。

## 使い方

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」
4. `build/chrome-skk-lite` を選択
5. 入力欄で試す

## キー操作

- `Ctrl+J`: 有効 / 無効（初期状態は無効）
- `Ctrl+J`: `chrome://extensions/shortcuts` で手動設定が必要
- 候補表示中の `Ctrl+J`: 候補を確定（`SKK OFF` にはならない）
- `l`: かな入力から英数モード（`SKK OFF`）へ戻る
- 小文字ローマ字: かな入力
- 大文字で開始: 変換開始
  - 例: `Nihongo` → `にほんご`
- 変換入力中の大文字: 送り仮名あり変換
  - 例: `KanJi` → `感じ`
- `Space`: 候補変換 / 次候補
- 候補表示中の `x`: 前候補へ戻る
- 先頭候補で `x`: 候補を抜けてかな表示に戻る
- 最終候補の次で `Space`: ユーザー辞書登録モーダルを開く
- 登録モーダルの `Escape`: モーダルを閉じて最後の候補表示に戻る
- 登録モーダル内は `Ctrl+J` で切り替えず、そのままかな入力
- 登録モーダル内の `q` / 変換中の `Enter`: 文字列だけ確定してモーダルは閉じない
- 登録モーダルでは `\u3042` のように入力して `Enter`: Unicode 文字を挿入（`¥u3042` / `￥u3042` でも可）
- 変換入力中の `q`: カタカナに変換して確定
- `Enter`: 確定
- `Escape`: キャンセル

有効化後は画面右下に `SKK OFF` / `SKK かな` / `SKK 変換` / `SKK 候補` の状態表示が出ます。

## 注意

これはOS IMEではなく、content scriptで入力欄を書き換える方式です。
Chromeの新規タブや初期表示のGoogle検索欄など、拡張機能のcontent scriptが入れないブラウザ内蔵ページでは動きません。通常のWebページを開いてから使ってください。
パスワード欄、メール/URL/数字専用inputなどでは動かないようにしています。

## 自前でビルドする

GitHub Actions などは不要です。手元の環境で辞書を取得して、Chrome に読み込む拡張ディレクトリを生成できます。

前提:

- Node.js 22 以降
- `https://skk-dev.github.io/dict/` にアクセスできるネットワーク環境

手順:

1. このリポジトリのルートで次を実行します。

   ```sh
   node build_extension.js
   ```

2. ビルドが終わると `build/chrome-skk-lite` が生成されます。

3. Chrome で `chrome://extensions` を開き、「パッケージ化されていない拡張機能を読み込む」から `build/chrome-skk-lite` を選択します。

`node build_extension.js` は次を行います。

- `https://skk-dev.github.io/dict/` から指定した `SKK-JISYO.*.gz` を取得
- `compiled/dictionary.json` を再生成
- Chrome にそのまま読み込める最小構成を `build/chrome-skk-lite` に出力

`build/chrome-skk-lite` に入るのは、拡張実行に必要なファイルと `compiled/dictionary.json` だけです。

使用する辞書を変更したい場合は、`dictionary_sources.json` の `dictionaries` を編集してから、同じコマンドを再実行してください。
