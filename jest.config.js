module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  testTimeout: 15000,
  verbose: true,
  collectCoverageFrom: [
    'routes/wallet.js',
    'routes/auth.js',
    'services/settlement.js',
    '!**/node_modules/**',
  ],
};
