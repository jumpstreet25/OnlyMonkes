module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Must be listed last
      'react-native-reanimated/plugin',
    ],
  };
};
