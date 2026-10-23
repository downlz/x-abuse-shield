/** True when `npm run model:build` had produced the in-place .ort model and it ships inside the extension (wxt.config.ts). */
declare const __BUNDLED_MODEL__: boolean;

/** Base URL of a hosted copy of public/models, downloaded on first use; '' when bundled or unset (wxt.config.ts). */
declare const __MODEL_URL__: string;
