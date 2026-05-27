module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/api/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/release-builds/'],
  testTimeout: 15000,
  // Each file runs in its own worker — required so APPDATA overrides don't bleed across files
  maxWorkers: 4,
};
