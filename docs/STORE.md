# Store submission kit

> **Chrome Web Store: not used** (store policy); Chrome and Brave users install from GitHub releases. **Firefox Add-ons: from 0.2.5**, one listing for Firefox desktop and Firefox for Android — section 6.

Everything needed to publish on the Chrome Web Store and Firefox Add-ons (AMO). Personal use doesn't need any of it: load the unpacked build instead (README).

## 1. Decide first

| Decision | Why it matters | Suggestion |
|---|---|---|
| **Where to host the model** | AMO rejects files over 200 MB, and the bundled build is ~331 MB. A hosted model also keeps the Chrome download at ~28 MB | A public Hugging Face model repo (Apache-2.0 allows redistribution with its notice; Hugging Face serves files with the CORS headers the extension needs) |
| **Name and icon** | Both stores reject listings that imply affiliation with another company's brand. "X" is X Corp's trademark | e.g. "Abuse Shield for X", and say "Not affiliated with X Corp." in the description. The icon is a plain letterform, not X's logo, but reviewers may still ask |
| **Contact address** | Required in the privacy policy and store listings | Fill in the contact section of [PRIVACY.md](PRIVACY.md) |

## 2. Host the model

```sh
npm run model:build    # → public/models/Horizon-Labs/multilingual-toxicity-small/
```

Upload the contents of `public/models/`, **keeping the `Horizon-Labs/multilingual-toxicity-small/` folder** (5 files, ~289 MB, including `NOTICE.md`), to the host. On Hugging Face, the base URL is `https://huggingface.co/<you>/<repo>/resolve/main/`.

Check it: `https://huggingface.co/<you>/<repo>/resolve/main/Horizon-Labs/multilingual-toxicity-small/config.json` should download.

## 3. Build the store packages

PowerShell:

```powershell
$env:WXT_BUNDLE_MODEL = 'false'; $env:WXT_MODEL_URL = 'https://huggingface.co/<you>/<repo>/resolve/main/'
npm run zip            # → .output/x-abuse-shield-<version>-chrome.zip
npm run zip:firefox    # → .output/x-abuse-shield-<version>-firefox.zip and -sources.zip
```

Bash: `WXT_BUNDLE_MODEL=false WXT_MODEL_URL=https://… npm run zip`.

Before uploading, run the hosted-model end-to-end test (it serves `public/models` locally in place of the real host): `npm run test:e2e:hosted` and `npm run test:e2e:hosted -- --firefox`. Then load the store build unpacked once and turn the model on, to check the real host.

Bump `version` in `package.json` for every upload.

## 4. Listing text

**Short description** (Chrome: 132 characters max):

> Hides abusive replies and troll brigades on x.com with an on-device AI model and word lists. Nothing leaves your browser.

**Description:**

> Abuse Shield hides abusive posts on x.com — insults, threats, slurs and copy-paste troll brigades — before they appear on your screen.
>
> • Reads what a post says: an on-device AI model scores 7 kinds of abuse in 34 languages, with built-in word lists for English, Hindi and Hinglish that see through disguised spellings.
> • Looks at who is posting: replies from days-old, throwaway-looking accounts face stricter thresholds, and the same reply pasted by several accounts is caught as a group.
> • Repeat offenders are muted automatically, for as long as you choose.
> • Nothing is deleted or blocked: posts are blurred with a Show button, and a review page explains every decision. One click marks a post "Not abusive".
> • Works on For you, Following, replies and Notifications, in light and dark themes.
>
> Private by design: everything runs in your browser. The extension has no server and sends no data anywhere; the only download is the AI model, once, when you turn it on.
>
> Not affiliated with X Corp.

**Category:** Social & Communication (Chrome) · Social & Communication (Firefox).

**Screenshots** (Chrome: 1280×800 or 640×400): use the synthetic pages from `npm run test:e2e` (`spike/results/e2e/`) or your own captures with other people's names and handles blurred. Don't publish real users' posts.

## 5. Chrome Web Store privacy tab

**Single purpose:** Hide abusive posts and accounts on x.com.

| Permission | Justification |
|---|---|
| `offscreen` | Runs the on-device AI model (ONNX Runtime WebAssembly with worker threads), which a service worker can't host |
| `storage` | Keeps settings, mutes, strikes and the review log on the device |
| `unlimitedStorage` | The downloaded AI model (~289 MB) is cached on the device |
| `alarms` | Unloads the AI model after a few idle minutes to free memory |
| Content scripts on `https://x.com/*` | Reads posts on x.com to hide abusive ones, and reads the account data x.com has already loaded into the page |

**Remote code:** No. All code, including ONNX Runtime's WebAssembly, is in the package; the model file is data.

**Data usage:** the extension doesn't collect or transmit any user data. Tick none of the data types, and certify the three disclosures (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** publish [PRIVACY.md](PRIVACY.md) somewhere public (e.g. the repository or a GitHub Pages site) and link it.

## 6. Firefox Add-ons (AMO)

- **Upload** `.output/release/x-abuse-shield-<version>.xpi` (from `npm run release`) and, when asked for source code (the build is minified), `.output/x-abuse-shield-<version>-sources.zip`.
- **Compatibility:** tick both **Firefox** and **Firefox for Android**. The manifest declares `gecko` and `gecko_android`, both Firefox 128 or later (content scripts in the page's own JavaScript world).
- **Add-on id:** `x-abuse-shield@downlz.github.io` (chosen 2026-10-24, in `wxt.config.ts`). AMO ties the listing to it: never change it.
- **Data collection:** the manifest declares `data_collection_permissions: none`. The only network request is the model download from Hugging Face, which sends no user data.
- **Build instructions for reviewers** (paste into "Notes to reviewer"):

  ```
  Node 22, npm. In the source folder:
    npm install
    WXT_BUNDLE_MODEL=false WXT_MODEL_URL=https://huggingface.co/downlz/x-abuse-shield-model/resolve/main/ npx wxt zip -b firefox
  Output: .output/x-abuse-shield-<version>-firefox.zip (same contents as the uploaded .xpi).
  public/ort/*.wasm is ONNX Runtime Web, copied from node_modules/onnxruntime-web by npm install (scripts/copy-ort.mjs).
  The AI model is data, downloaded on first use from https://huggingface.co/downlz/x-abuse-shield-model (Apache-2.0).
  ```
- **Updates:** bump the version, `npm run release`, upload the new `.xpi`. Firefox updates installed copies automatically.

## 7. After publishing

- Watch the popup's health line after X deploys: selector or API-shape changes show up there first (`src/adapters/x-dom/selectors.ts`, `src/adapters/x-api/fields.ts`).
- Re-run `npm run test:e2e` and `npm run test:e2e:firefox` before each upload.
