# Phone model: vocabulary trimming

`npm run model:trim` builds the smaller toxicity model Firefox for Android uses (`LITE_MODEL_ID`, see [docs/ANDROID.md](../../docs/ANDROID.md)). It needs `npm run model:build` first, which downloads the original model, and Python 3.

What it does, all in `.cache/trim/` and `.venv-trim/` (both git-ignored):

1. Creates a Python environment from `requirements.txt` (ONNX, ONNX Runtime, Hugging Face `tokenizers`, NumPy, PyArrow; no PyTorch).
2. Downloads the corpora used to choose tokens. Their text never ships; it only decides which tokens to keep:
   - [Horizon-Labs/civil-comments-multilingual](https://huggingface.co/datasets/Horizon-Labs/civil-comments-multilingual): the model's own fine-tuning data (English plus 33 languages, Hinglish included).
   - [findnitai/english-to-hinglish](https://huggingface.co/datasets/findnitai/english-to-hinglish) (Apache-2.0) and [festvox/cmu_hinglish_dog](https://huggingface.co/datasets/festvox/cmu_hinglish_dog) (CC-BY-SA 3.0): more romanised Hindi.
3. `extra-texts.ts`: our word lists, calibration posts and spike samples, which must tokenize exactly as before.
4. `trim_vocab.py build`: replays the tokenizer's BPE on every word of the chosen languages' texts and keeps every token it creates, intermediate ones included, then removes the rest from the tokenizer (vocabulary and merge rules) and from the model's vocabulary table. It re-tokenizes real text with both tokenizers and **stops if any kept text tokenizes differently**, so on that text the model gives the same scores as the original.
5. `quantize.py` (optional, `INT8_LAYERS` in `run.mjs`): stores the transformer layers' weights as int8.
6. `to-ort.ts`: converts to ONNX Runtime's `.ort` and writes `public/models/<LITE_MODEL_ID>/`.

## The DistilBERT phone model

`npm run model:trim -- distilbert` builds `DISTILBERT_LITE_MODEL_ID`, the phone version of the default model (needs `npm run model:build -- distilbert` first). DistilBERT's tokenizer is WordPiece, not BPE, so it has its own script, `trim_wordpiece.py`:

1. Keeps every token the original tokenizer uses on the English, Hindi and Hinglish corpora above and on our word lists and test posts, the special tokens, and every single Latin and Devanagari character, digit, punctuation mark and symbol (so an unseen word splits into pieces rather than becoming `[UNK]`).
2. WordPiece splits greedily, longest piece first, so text whose tokens were all kept splits exactly as before; the build checks this and stops if any kept text changes.
3. Slices the int8 vocabulary table to the kept rows. The layers are int8 already, so there's no quantize step.
4. `to-ort.ts` converts it and writes `public/models/x-abuse-shield/distilbert-toxicity-lite/`, with the OpenRAIL++ `LICENSE`.

Result: 34,671 of 119,547 tokens; model 136 → 70 MB, tokenizer 2.9 → 0.6 MB; identical scores on English, Hindi and Hinglish. WordPiece has no byte fallback, so text in dropped languages falls apart and is often wrongly scored toxic. The extension doesn't send such posts to this model (`MODEL_COVERAGE` in `src/adapters/inference/model.ts`); they're judged by the word lists alone.

```sh
npm run model:trim -- distilbert analyze    # tokens and exact-tokenization coverage per language set
npm run model:trim -- distilbert compare    # scores vs the original: kept languages, six dropped ones, our test posts
```

Other tools:

```sh
npm run model:trim -- analyze                                         # tokens and coverage per language set
.venv-trim/Scripts/python scripts/trim/compare.py <folder> [<folder>]  # scores vs the original on held-out text
npm run memory:firefox -- --phone <model folder>...                    # memory in Firefox, phone settings
```
