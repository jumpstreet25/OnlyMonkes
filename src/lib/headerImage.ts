import { Platform } from 'react-native';

// The chat/connect header art. Web gets a 1024px WebP (~45 KB) instead of the
// 2084px PNG (432 KB) the phone ships with. Native: unchanged.
export const HEADER_IMAGE = Platform.OS === 'web'
  ? require('../../assets/header-web.webp')
  : require('../../assets/header.png');
