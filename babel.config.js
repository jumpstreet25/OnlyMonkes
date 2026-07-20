module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv', {
        envName: 'APP_ENV',
        moduleName: '@env',
        path: '.env',
        safe: false,
        allowUndefined: true,
      }],
      ['module-resolver', {
        alias: {
          '@': './src',
        },
      }],
      // Must be listed last — Reanimated 4 + vision-camera 5 now share the
      // same worklets runtime (react-native-worklets). The old pairing was
      // react-native-worklets-core/plugin + react-native-reanimated/plugin;
      // both are superseded by this single plugin.
      'react-native-worklets/plugin',
    ],
  };
};
