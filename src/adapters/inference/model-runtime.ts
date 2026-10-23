/**
 * The model service as the build configured it (wxt.config.ts): the bundled
 * or hosted in-place .ort model, or the original .onnx from Hugging Face.
 * Runs in Chrome's offscreen document and in Firefox's model worker.
 */
import { BUNDLED_MODEL_DIR, cachedModelFileCount, MODEL_FILE_COUNT } from './model';
import { ModelService, type ServiceStatus } from './model-service';
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
      const downloading = remote && !(await hostedModelCached(modelBaseUrl));
      return loadInPlaceClassifier({ modelBaseUrl, remote, ortBaseUrl, onProgress: progress(downloading) });
    }

    const downloading = (await cachedModelFileCount()) < MODEL_FILE_COUNT;
    const onPercent = progress(downloading);
    return loadToxicityClassifier({
      ortBaseUrl,
      onProgress: (p) => {
        if (p.status === 'progress_total') onPercent(Math.floor(p.progress));
      },
    });
  }, report);
}
