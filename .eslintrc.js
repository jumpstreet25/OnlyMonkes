module.exports = {
  extends: ['expo'],
  rules: {
    // '@env' is a virtual module injected by the react-native-dotenv babel
    // plugin (babel.config.js) — it has no real file on disk for ESLint's
    // resolver to find, so it's not an actual broken import.
    'import/no-unresolved': ['error', { ignore: ['^@env$'] }],
  },
  overrides: [
    {
      files: ['jest.setup.js', '**/__tests__/**/*.{js,ts,tsx}', '**/*.test.{js,ts,tsx}'],
      env: { jest: true },
    },
  ],
};
