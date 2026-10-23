# Phase 0 spike report

Generated 2026-10-23 · Chrome for Testing Chrome/156.0.8078.47 · 12 logical CPUs
Transformers.js 4.3.1 · onnxruntime-web 1.31.0-dev.20260914-8d85527a0 · cross-origin isolated: true · WASM threads: 4

## Exit criteria

| Criterion | Result | |
|---|---|---|
| Batched latency ≤ 150 ms/post | 32 ms | ✅ |
| Loads from cache after a browser restart | 4 files cached, loaded in 2.8 s | ✅ |
| Memory acceptable | +849 MB–858 MB steady while loaded (8 runs); back to 47 MB–55 MB within 60 s of unloading | ⚠️ heavy — unload when idle |
| Browser output matches Node reference | max diff 0.0000 | ✅ |

## Loading

| Run | Model files cached before | Load time | Notes |
|---|---|---|---|
| first-load | 0 | 55.5 s | download of 289 MB |
| fresh-document | 4 | 2.2 s | from Cache API |
| after-restart | 4 | 2.8 s | from Cache API |
| Node reference | — | 56.1 s | onnxruntime-node, files on disk |

## Latency

| Runtime | First inference | Single p50 | Single p95 | Batch of 8 (per batch p50) | Batched, per post |
|---|---|---|---|---|---|
| Browser · first-load | 144 ms | 32 ms | 46 ms | 252 ms | 29 ms |
| Browser · fresh-document | 25 ms | 28 ms | 46 ms | 274 ms | 32 ms |
| Browser · after-restart | 137 ms | 37 ms | 81 ms | 251 ms | 30 ms |
| Node reference | — | 13 ms | 18 ms | 67 ms | 7.9 ms |

## Memory

Private bytes of the extension process, which hosts the offscreen document, service worker and
extension pages; other Chrome processes do not change. Each session loads the model once from cache.
"Peak" is read 5 s after the benchmark, "steady" after 60 s idle — V8 frees the large load-time
buffers lazily, so the 5 s reading varies by more than 1 GB between runs.

- **Steady-state cost of the loaded model: +849 MB–858 MB** (downloaded `.onnx`)
- **Shipped in-place `.ort` model: +505 MB–507 MB**
- Peak readings 5 s after loading: 1,184 MB–1,208 MB
- After unloading (offscreen document closed, 60 s): 47 MB–55 MB

| Session | Session options | No model | Loaded, 5 s | Loaded, 60 s idle | Unloaded, 5 s | Unloaded, 60 s | Batched, per post |
|---|---|---|---|---|---|---|---|
| after-restart | `{}` | 45 MB | 1,196 MB | 903 MB | 910 MB | 55 MB | 30 ms |
| default #1 | `{}` | 45 MB | 1,189 MB | 896 MB | 906 MB | 51 MB | 31 ms |
| default #2 | `{}` | 45 MB | 1,186 MB | 894 MB | 904 MB | 49 MB | 31 ms |
| no-arena #1 | `{enableCpuMemArena:false,enableMemPattern:false}` | 43 MB | 1,186 MB | 897 MB | 906 MB | 50 MB | 30 ms |
| no-arena #2 | `{enableCpuMemArena:false,enableMemPattern:false}` | 40 MB | 1,184 MB | 896 MB | 904 MB | 47 MB | 29 ms |
| no-graph-opt #1 | `{graphOptimizationLevel:disabled}` | 41 MB | 1,189 MB | 893 MB | 902 MB | 47 MB | 23 ms |
| no-prepack #1 | `{extra:{session:{disable_prepacking:1}}}` | 41 MB | 1,193 MB | 892 MB | 902 MB | 49 MB | 24 ms |
| no-prepack #2 | `{extra:{session:{disable_prepacking:1}}}` | 44 MB | 1,208 MB | 896 MB | 906 MB | 52 MB | 19 ms |
| bundled-ort #1 | `{extra:{session:{use_ort_model_bytes_directly:1,use_ort_model_bytes_for_initializers:1,disable_prepacking:1}}}` | 47 MB | 840 MB | 553 MB | 561 MB | 51 MB | 32 ms |
| bundled-ort #2 | `{extra:{session:{use_ort_model_bytes_directly:1,use_ort_model_bytes_for_initializers:1,disable_prepacking:1}}}` | 41 MB | 835 MB | 548 MB | 559 MB | 48 MB | 30 ms |

### What the memory is (Phase 2 investigation)

- The tokenizer (256k-token vocabulary) takes ~180 MB: 149 MB of JS heap + 32 MB external, measured in Node (same V8).
- No ONNX Runtime session option changes the total: CPU arena, graph optimisation and weight prepacking were all tried above.
- The rest was two copies of the weights: the model bytes in WebAssembly memory plus the weights parsed (and pre-packed) from them. WebAssembly memory never shrinks, so the load-time peak becomes the steady state.
- **Fix (`bundled-ort` above):** the model converted to ONNX Runtime’s `.ort` format and run in place (`use_ort_model_bytes_for_initializers`, `disable_prepacking`), with onnxruntime-web patched to keep the bytes (scripts/ort-in-place-plugin.ts). Steady cost +507 MB instead of +850 MB (−41%), peak 0.84 GB instead of 1.19 GB, same speed, scores within 1e-6 of the `.onnx`. It ships with the extension (`npm run model:build`).

## Output parity

- Browser vs Node reference: max |diff| 0.00000, mean 0.000000
- Browser first load vs fresh document: max |diff| 0.00000
- Single vs batched inference (padding effect): max |diff| 0.00000

## Detection quality on the sample set

54 hand-written posts — a smoke test, not a benchmark. Phase 2 calibrates on real posts.

| Group | Preset | Caught (TP) | Missed (FN) | False alarms (FP) | Correctly clean (TN) |
|---|---|---|---|---|---|
| English | relaxed | 5 | 7 | 1 | 7 |
| English | balanced | 7 | 5 | 1 | 7 |
| English | strict | 9 | 3 | 5 | 3 |
| Hindi (Devanagari) | relaxed | 1 | 6 | 0 | 5 |
| Hindi (Devanagari) | balanced | 2 | 5 | 0 | 5 |
| Hindi (Devanagari) | strict | 4 | 3 | 1 | 4 |
| Hinglish | relaxed | 0 | 9 | 0 | 5 |
| Hinglish | balanced | 0 | 9 | 0 | 5 |
| Hinglish | strict | 5 | 4 | 0 | 5 |
| Other languages | relaxed | 0 | 5 | 0 | 3 |
| Other languages | balanced | 4 | 1 | 0 | 3 |
| Other languages | strict | 4 | 1 | 0 | 3 |

### Per post (Balanced preset)

| Id | Expected | Top category | Flagged | Verdict | Text |
|---|---|---|---|---|---|
| en-01 | clean | toxicity 0.01 | — | ✓ | Just finished my morning run, feeling great! Who else is training for the half marathon? |
| en-02 | clean | toxicity 0.01 | — | ✓ | The new budget proposal has some good ideas but the healthcare section needs work. |
| en-03 | clean (friendly profanity) | obscene 0.64 | — | ✓ | This is fucking amazing, best concert I've been to all year! |
| en-04 | clean (identity mention) | identity_attack 0.49 | — | ✓ | I'm a proud gay man and I'm getting married next month 🎉 |
| en-05 | clean (quoting abuse) | toxicity 0.70 | — | ✓ | Someone called me an idiot today and honestly it hurt. Be kind to people. |
| en-06 | clean (violent idiom) | threat 0.74 | threat | ✗ | Kill it at your interview tomorrow, you've got this! |
| en-07 | clean | toxicity 0.01 | — | ✓ | Respectfully, I disagree with your take on interest rates. The Q3 data suggests otherwise. |
| en-08 | clean | toxicity 0.70 | — | ✓ | lol this meme is so dumb I can't stop laughing 😂 |
| en-09 | abusive | toxicity 0.92 | toxicity, insult | ✓ | You're a worthless idiot and everyone here knows it. |
| en-10 | abusive | toxicity 0.88 | toxicity, insult | ✓ | Shut the fuck up, nobody asked for your stupid opinion. |
| en-11 | abusive | threat 0.82 | toxicity, threat | ✓ | Go kill yourself, the world would be better without you. |
| en-12 | abusive (threat) | toxicity 0.03 | — | ✗ | I know where you live. Keep talking and see what happens to you. |
| en-13 | abusive (identity attack) | toxicity 0.74 | — | ✗ | People like you from that religion are all terrorists and should be kicked out of this country. |
| en-14 | abusive | toxicity 0.91 | toxicity, insult | ✓ | What a pathetic loser, crying online all day like a little bitch. |
| en-15 | abusive (sexual threat) | toxicity 0.13 | — | ✗ | Send me nudes or I'll leak your photos everywhere. |
| en-16 | abusive | toxicity 0.83 | toxicity, insult | ✓ | Ur so dumb lmao, braindead clown 🤡🤡 |
| en-17 | abusive (obfuscated) | toxicity 0.91 | toxicity, insult | ✓ | f*ck you and your whole family, you moron |
| en-18 | abusive | toxicity 0.89 | toxicity, insult | ✓ | Imagine being this stupid. Uninstall life. |
| en-19 | abusive (identity attack) | toxicity 0.32 | — | ✗ | Women like you belong in the kitchen, not giving opinions on politics. |
| en-20 | abusive (sarcasm) | toxicity 0.65 | — | ✗ | Great, another genius take from the dumbest account on this app 🙄 |
| hi-01 | clean | toxicity 0.07 | — | ✓ | आज मौसम बहुत सुहाना है, चाय पीने का मन कर रहा है। |
| hi-02 | clean | toxicity 0.00 | — | ✓ | सरकार की नई नीति पर मेरी राय थोड़ी अलग है, लेकिन चर्चा ज़रूरी है। |
| hi-03 | clean | toxicity 0.16 | — | ✓ | भाई तुमने कमाल कर दिया, बहुत बढ़िया काम! |
| hi-04 | clean | toxicity 0.00 | — | ✓ | मैच में भारत की जीत पर सबको बधाई हो! 🇮🇳 |
| hi-05 | clean (quoting abuse) | toxicity 0.64 | — | ✓ | किसी ने मुझे बेवकूफ कहा, पर मैं ध्यान नहीं देता। सबके साथ अच्छे से पेश आओ। |
| hi-06 | abusive | toxicity 0.86 | toxicity, insult | ✓ | तू एक नंबर का बेवकूफ और नालायक इंसान है। |
| hi-07 | abusive | toxicity 0.28 | — | ✗ | चुप कर कमीने, तेरी औकात क्या है? |
| hi-08 | abusive (threat) | toxicity 0.71 | threat | ✓ | तुझे घर आकर मारूंगा, देख लेना। |
| hi-09 | abusive | toxicity 0.27 | — | ✗ | हरामखोर, शर्म नहीं आती तुझे ऐसी बातें करते हुए? |
| hi-10 | abusive | toxicity 0.73 | — | ✗ | तेरे जैसे गद्दारों को देश से बाहर निकाल देना चाहिए। |
| hi-11 | abusive | toxicity 0.67 | — | ✗ | साले कुत्ते, अपनी बकवास बंद कर। |
| hi-12 | abusive | toxicity 0.34 | — | ✗ | मादरचोद, दिमाग खराब मत कर। |
| hng-01 | clean | toxicity 0.07 | — | ✓ | Bhai aaj ka match dekha? Kya zabardast batting thi yaar! |
| hng-02 | clean | toxicity 0.01 | — | ✓ | Mujhe lagta hai ki yeh policy theek nahi hai, par dekhte hain kya hota hai. |
| hng-03 | clean | toxicity 0.01 | — | ✓ | Kal office mein bahut kaam tha, ab thoda rest karunga. |
| hng-04 | clean | toxicity 0.44 | — | ✓ | Arre yaar, tum toh kamaal ho! Bahut mazaa aaya. |
| hng-05 | clean (quoting abuse) | toxicity 0.15 | — | ✓ | Kisi ne mujhe pagal bola, but I don't care. Stay positive guys. |
| hng-06 | abusive | toxicity 0.54 | — | ✗ | Tu ekdum chutiya hai, dimaag naam ki cheez nahi hai tujh mein. |
| hng-07 | abusive | toxicity 0.11 | — | ✗ | Chup kar bsdk, teri aukaat kya hai? |
| hng-08 | abusive (threat) | toxicity 0.45 | — | ✗ | Saale harami, tujhe ghar aake maarunga. |
| hng-09 | abusive | toxicity 0.45 | — | ✗ | Abe gadhe, kuch bhi bakwas karta rehta hai. |
| hng-10 | abusive | toxicity 0.32 | — | ✗ | Madarchod, apni shakal dekh pehle. |
| hng-11 | abusive | toxicity 0.69 | — | ✗ | Bhenchod tu pagal hai kya, kuch bhi bolta hai. |
| hng-12 | abusive | toxicity 0.38 | — | ✗ | Tere jaise logon ko desh se nikaal dena chahiye, gaddar kahin ke. |
| hng-13 | abusive | toxicity 0.59 | — | ✗ | Ullu ka pattha hai tu, kuch samajh nahi aata tujhe. |
| hng-14 | abusive (obfuscated) | toxicity 0.65 | — | ✗ | ch*tiya insaan, b*kwas band kar |
| es-01 | clean | toxicity 0.00 | — | ✓ | Qué día tan bonito para pasear por el parque con mi familia. |
| es-02 | abusive | toxicity 0.85 | toxicity, insult | ✓ | Eres un imbécil y un inútil, cállate ya. |
| de-01 | clean | toxicity 0.00 | — | ✓ | Ich freue mich auf das Wochenende mit meinen Freunden. |
| de-02 | abusive | toxicity 0.47 | — | ✗ | Halt die Klappe, du Vollidiot. |
| fr-01 | abusive | toxicity 0.82 | toxicity | ✓ | Ferme ta gueule, espèce de connard. |
| ar-01 | abusive | toxicity 0.86 | toxicity, insult | ✓ | أنت غبي وحقير، اسكت. |
| ur-01 | clean | toxicity 0.00 | — | ✓ | آج بہت اچھا دن تھا، شکریہ دوستو۔ |
| bn-01 | abusive | toxicity 0.83 | toxicity, insult | ✓ | তুই একটা গাধা, চুপ কর। |
