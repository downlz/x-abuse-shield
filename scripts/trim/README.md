# Phone model: vocabulary trimming

`npm run model:trim` builds the smaller model Firefox for Android uses (`LITE_MODEL_ID`, see [docs/ANDROID.md](../../docs/ANDROID.md)). It needs `npm run model:build` first, which downloads the original model, and Python 3.

What it does, all in `.cache/trim/` and `.venv-trim/` (both git-ignored):

1. Creates a Python environment from `requirements.txt` (ONNX, ONNX Runtime, Hugging Face `tokenizers`, NumPy, PyArrow; no PyTorch).
2. Downloads the corpora used to choose tokens. Their text never ships; it only decides which tokens to keep:
   - [Horizon-Labs/civil-comments-multilingual](https://huggingface.co/datasets/Horizon-Labs/civil-comments-multilingual): the model's own fine-tuning data (English plus 33 languages, Hinglish included).
   - [findnitai/english-to-hinglish](https://huggingface.co/datasets/findnitai/english-to-hinglish) (Apache-2.0) and [festvox/cmu_hinglish_dog](https://huggingface.co/datasets/festvox/cmu_hinglish_dog) (CC-BY-SA 3.0): more romanised Hindi.
3. `extra-texts.ts`: our word lists, calibration posts and spike samples, which must tokenize exactly as before.
4. `trim_vocab.py build`: replays the tokenizer's BPE on every word of the chosen languages' texts and keeps every token it creates, intermediate ones included, then removes the rest from the tokenizer (vocabulary and merge rules) and from the model's vocabulary table. It re-tokenizes real text with both tokenizers and **stops if any kept text tokenizes differently**, so on that text the model gives the same scores as the original.
5. `quantize.py` (optional, `INT8_LAYERS` in `run.mjs`): stores the transformer layers' weights as int8.
6. `to-ort.ts`: converts to ONNX Runtime's `.ort` and writes `public/models/<LITE_MODEL_ID>/`.

Other tools:

```sh
npm run model:trim -- analyze                                         # tokens and coverage per language set
.venv-trim/Scripts/python scripts/trim/compare.py <folder> [<folder>]  # scores vs the original on held-out text
npm run memory:firefox -- --phone <model folder>...                    # memory in Firefox, phone settings
```
