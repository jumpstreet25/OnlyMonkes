const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Node.js shims required for Solana web3.js and XMTP
config.resolver.extraNodeModules = {
  crypto: require.resolve('react-native-get-random-values'),
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
  process: require.resolve('process'),
};

// Register .html/.txt as asset extensions so require('assets/globe.html') and the
// bundled three.js/OrbitControls.js.txt (renamed to dodge Metro's JS source-file
// transform) work as opaque asset files instead of being parsed as app code.
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), 'html', 'txt'];

module.exports = config;
