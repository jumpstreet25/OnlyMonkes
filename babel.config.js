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
      'react-native-worklets-core/plugin',
      // Must be listed last
      'react-native-reanimated/plugin',
    ],
  };
};
