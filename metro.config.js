const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Node.js shims required for Solana web3.js and XMTP
config.resolver.extraNodeModules = {
  crypto: require.resolve('react-native-get-random-values'),
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
  process: require.resolve('process'),
};

// Register .html as an asset extension so require('assets/globe.html') works
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), 'html'];

module.exports = config;
