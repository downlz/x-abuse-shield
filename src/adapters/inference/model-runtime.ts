/**
 * The model service as the build configured it (wxt.config.ts): the bundled
 * or hosted in-place .ort model, or the original .onnx from Hugging Face.
 * Runs in Chrome's offscreen document and in Firefox's model worker.
 */
import { BUNDLED_MODEL_DIR, cachedModelFileCount, LITE_MODEL_ID, MODEL_FILE_COUNT, MODEL_ID } from './model';
import { BATCH_SIZE, ModelService, PHONE_BATCH_SIZE, type ServiceStatus } from './model-service';
import { hostedModelCached, loadInPlaceClassifier } from './ort-classifier';
import { loadToxicityClassifier } from './toxicity-classifier';

/** Reports in steps, so a 300 MB download doesn't flood the background with messages. */
const PROGRESS_STEP = 5;

export function createModelService(extensionUrl: string, report: (status: ServiceStatus) => void): ModelService {
  const ortBaseUrl = new URL('/ort/', extensionUrl).href;
  return new ModelService(async (report) => {
    const progress = (downloading: boolean) => {
      let reported = 0;
      report({ state: 'loading', downloading, progress: 0 });
      return (percent: number) => {
        if (percent - reported < PROGRESS_STEP) return;
        reported = percent;
        report({ state: 'loading', downloading, progress: percent });
      };
    };

    if (__BUNDLED_MODEL__ || __MODEL_URL__) {
      const remote = !__BUNDLED_MODEL__;
      const modelBaseUrl = remote ? __MODEL_URL__ : new URL(`/${BUNDLED_MODEL_DIR}`, extensionUrl).href;
      const modelId = usesLiteModel() ? LITE_MODEL_ID : MODEL_ID;
      const downloading = remote && !(await hostedModelCached(modelBaseUrl, modelId));
      return loadInPlaceClassifier({ modelBaseUrl, remote, ortBaseUrl, modelId, onProgress: progress(downloading) });
    }

    const downloading = (await cachedModelFileCount()) < MODEL_FILE_COUNT;
    const onPercent = progress(downloading);
    return loadToxicityClassifier({
      ortBaseUrl,
      onProgress: (p) => {
        if (p.status === 'progress_total') onPercent(Math.floor(p.progress));
      },
    });
  }, report, isPhone() ? PHONE_BATCH_SIZE : BATCH_SIZE);
}

/** Firefox for Android (also readable inside the model worker, which has no extension APIs). */
export function isPhone(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** Phones run the trimmed model when this build has it (wxt.config.ts). */
export function usesLiteModel(): boolean {
  return __LITE_MODEL__ && isPhone();
}
