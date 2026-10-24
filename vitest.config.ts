import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // The model-source constants wxt.config.ts defines at build time; tests pass sources explicitly.
  define: { __BUNDLED_MODEL__: 'false', __MODEL_URL__: '""', __LITE_MODEL__: 'false' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
