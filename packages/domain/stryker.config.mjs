// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**'],
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/html/index.html' },
  thresholds: { high: 80, low: 60, break: 50 },
  coverageAnalysis: 'perTest',
};
