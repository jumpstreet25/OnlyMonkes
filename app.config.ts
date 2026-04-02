import { ExpoConfig, ConfigContext } from 'expo/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Ensure .env is loaded regardless of how the bundler is spawned
dotenv.config({ path: path.resolve(__dirname, '.env') });

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OnlyMonkes',
  slug: 'monkesonly',
  owner: process.env.EXPO_OWNER ?? undefined,
  version: '2.33.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0A0F',
  },
  android: {
    package: 'com.onlymonkes.app',
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: '#0A0A0F',
    },
  },
  updates: {
    url: 'https://u.expo.dev/e669ee53-de73-4dfb-9a36-5c22de29c67e',
    enabled: true,
    fallbackToCacheTimeout: 5000,
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: '2.33',
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG ?? 'onlymonkes',
        project: process.env.SENTRY_PROJECT ?? 'onlymonkes',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/ic_notifications.png',
        color: '#7C3AED',
        androidMode: 'default',
        androidCollapsedTitle: 'OnlyMonkes',
        sounds: [],
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'Allow OnlyMonkes to open the camera to share photos in chat.',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow OnlyMonkes to open the camera to record videos in chat.',
        microphonePermission: 'Allow OnlyMonkes to record audio for videos.',
        recordAudioAndroid: true,
      },
    ],
  ],
  scheme: 'onlymonkes',
  extra: {
    heliusApiKey: process.env.HELIUS_API_KEY ?? '',
    giphyApiKey: process.env.GIPHY_API_KEY ?? '',
    nftCollectionAddress:
      process.env.NFT_COLLECTION_ADDRESS ?? 'GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF',
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    cloudinaryUploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET ?? '',
    livekitUrl: process.env.LIVEKIT_URL ?? '',
    livekitTokenUrl: process.env.LIVEKIT_TOKEN_URL ?? '',
    jupApiKey: process.env.JUP_API_KEY ?? '',
    skrMint: process.env.SKR_MINT ?? '',
    devWallet: process.env.DEV_WALLET ?? '7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J',
    sentryDsn: process.env.SENTRY_DSN ?? '',
    eas: {
      projectId: 'e669ee53-de73-4dfb-9a36-5c22de29c67e',
    },
  },
});
