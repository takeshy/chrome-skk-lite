# Chrome Web Store Submission Notes

## Upload package

Upload this file in Chrome Developer Dashboard:

```text
build/chrome-skk-lite.zip
```

The zip file must contain `manifest.json` at the root.

## Store listing

Use the text in `STORE_LISTING.md` for the item name, short description, and detailed description.

Category suggestion:

```text
Productivity
```

Language suggestion:

```text
Japanese
```

## Privacy tab

Single purpose:

```text
Provide SKK-style Japanese input conversion inside supported input fields on web pages.
```

Permission justification for `storage`:

```text
Stores user dictionary entries and candidate selection history locally in Chrome storage so conversion can be customized and frequently selected candidates can be prioritized. This data is not sent to external servers.
```

Permission / host access justification for all sites:

```text
The extension must run a content script on web pages to intercept keyboard input and update supported input fields and text areas. It is disabled for password and unsupported input types, and it does not send page content or typed text to external servers.
```

Remote code:

```text
No remote code is used. All runtime JavaScript and the compiled dictionary are bundled in the extension package.
```

Data usage:

```text
The extension processes typed text locally to provide Japanese conversion and stores user dictionary entries and candidate history locally. It does not collect, transmit, sell, or share user data.
```

Privacy policy:

After GitHub Pages is enabled for the `docs/` directory on `main`, enter this URL in the Developer Dashboard privacy policy field:

```text
https://takeshy.github.io/chrome-skk-lite/privacy/
```

## Images

Required images:

- Extension icon: `icons/icon128.png` is included in the zip.
- Small promotional image: 440 x 280 PNG.
- At least one screenshot: 1280 x 800 or 640 x 400 PNG/JPEG, square corners, no padding.

Suggested screenshots:

- A normal web page text area showing SKK kana mode and the mode badge.
- Candidate conversion in progress.
- Options page showing local user dictionary editing.

## Test instructions for reviewer

```text
1. Install the extension.
2. Open a normal web page with a text input or textarea, such as a local test page or any editable form.
3. Focus the input field and press Ctrl+J to enable SKK kana mode.
4. Type "Nihongo", press Space to convert, and press Enter or Ctrl+J to confirm.
5. Confirm that the mode badge appears near the bottom-right of the page.

The extension intentionally does not run on Chrome internal pages, the Chrome Web Store, password fields, or unsupported input types.
```

## Release checklist

- Run `node --test tests/skk_engine.test.js`.
- Run `node scripts/package.js`.
- Inspect `build/chrome-skk-lite.zip` and confirm `manifest.json` is at the root.
- Upload `build/chrome-skk-lite.zip`.
- Complete store listing, privacy fields, distribution settings, and reviewer test instructions.
