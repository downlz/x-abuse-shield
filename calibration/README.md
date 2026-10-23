# Calibration data

`npm run calibrate` scores every labelled post with the word lists and the AI model, applies each preset, and writes [docs/CALIBRATION.md](../docs/CALIBRATION.md).

Sources, one JSON object per line:

| File | What | In git |
|---|---|---|
| `../spike/samples.json` | 54 hand-written Phase 0 samples | yes |
| `screenshots.jsonl` | Real post texts transcribed from screenshots, no handles | yes |
| `posts.jsonl` | Your own labelled posts | **no** (git-ignored) |

Line format:

```json
{"id":"p-001","text":"Abe gadhe, chup baith","expected":"abusive","lang":"hinglish","directed":true,
 "account":{"ageDays":3,"followers":3,"following":900,"defaultAvatar":true,"handle":"kattar_x"}}
```

- `expected`: `abusive` or `clean` — would you want this post hidden?
- `lang`: `en`, `hi` (Devanagari), `hinglish`, or another code. Used for the per-language breakdown.
- `directed` (optional): `true` for a reply or mention. Account suspicion only applies to these.
- `account` (optional): the author, so suspicion offsets can be tuned. Leave out handles you don't want stored.
- `note` (optional): why the label might be debatable.

100–200 real posts, roughly half abusive, across English, Hindi and Hinglish, make the presets meaningful. Include replies from new or throwaway accounts with their account details, and normal replies from established accounts, to tune the suspicion offsets.
