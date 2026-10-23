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

// Web build only: phone-only native packages resolve to browser stand-ins in
// src/web/ (XMTP browser SDK, Wallet Standard wallets, IndexedDB storage).
// Android/iOS resolution is untouched — this only runs when platform === 'web'.
const path = require('path');
const WEB_ALIASES = {
  '@xmtp/react-native-sdk': 'src/web/xmtpCompat.ts',
  '@solana-mobile/mobile-wallet-adapter-protocol-web3js': 'src/web/mwaCompat.ts',
  'expo-secure-store': 'src/web/shims/secureStore.ts',
  'freerasp-react-native': 'src/web/shims/freerasp.ts',
  '@react-native-firebase/analytics': 'src/web/shims/firebaseAnalytics.ts',
  '@livekit/react-native': 'src/web/shims/livekitNative.ts',
  '@livekit/react-native-krisp-noise-filter': 'src/web/shims/krisp.ts',
  'react-native-webview': 'src/web/shims/webview.tsx',
  'expo-file-system/legacy': 'src/web/shims/fileSystemLegacy.ts',
  '@shopify/react-native-skia': 'src/web/shims/skia.tsx',
};
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_ALIASES[moduleName]) {
    return { type: 'sourceFile', filePath: path.join(__dirname, WEB_ALIASES[moduleName]) };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
