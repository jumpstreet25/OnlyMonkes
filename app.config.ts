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
  version: '3.0.1',
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
  // 2026-08-01: bumped from '3.3' — that tag is currently shared by BOTH the
  // old (Reanimated v3) production native binary and the new (Reanimated v4)
  // canary native binary. expo-updates uses this to gate OTA compatibility,
  // so that overlap is exactly what let a Reanimated v3/v4 JS bundle get
  // delivered to the old v3 binary and crash-loop production. A real
  // native rebuild is happening anyway for the 3.0.0 release — this is the
  // moment to give it its own distinct runtime tag so that class of mistake
  // becomes structurally impossible (expo-updates will simply refuse to
  // apply a mismatched update rather than silently crashing).
  runtimeVersion: '3.4',
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          // SDK 54 target (bumped from 35 on the sdk54-upgrade branch).
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: '36.0.0',
          kotlinVersion: '2.1.20',
          // 2026-07-09: bumped from 26.1.10909125 — Nitro Modules (vision-camera
          // 5 / nitro-modules / nitro-image) requires NDK 27+. NOTE: this field
          // is a no-op for Android (expo-build-properties has no Android writer
          // for ndkVersion) — the real pin is `rootProject.ext.ndkVersion` in
          // android/build.gradle. Kept here only as a human-readable record of
          // intent; do not rely on it actually doing anything.
          ndkVersion: '27.1.12297006',
        },
      },
    ],
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
    'expo-video',
    [
      // expo-av replacement (SDK 55 removes expo-av entirely) — sounds.ts is
      // playback-only (no recording), so recordAudioAndroid: false avoids
      // requesting RECORD_AUDIO a second time (expo-camera above already
      // declares it for actual video recording).
      'expo-audio',
      { recordAudioAndroid: false },
    ],
  ],
  scheme: 'onlymonkes',
  extra: {
    heliusApiKey: process.env.HELIUS_API_KEY ?? '',
    heliusNftApiKey: process.env.HELIUS_NFT_API_KEY ?? '',
    quickNodeDasUrl: process.env.QUICKNODE_DAS_URL ?? '',
    alchemyApiKey: process.env.ALCHEMY_API_KEY ?? '',
    groqApiKey: process.env.GROQ_API_KEY ?? '',
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
