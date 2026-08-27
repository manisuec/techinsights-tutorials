// jest/jest.config.js — minimal, ESM-native, no Babel.
// Paths are resolved relative to this file's directory.
export default {
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  testEnvironment: 'node',
  verbose: true,
};
