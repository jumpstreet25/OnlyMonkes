import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OnlyMonkes',
  slug: 'monkesonly',
  owner: process.env.EXPO_OWNER ?? undefined,
  version: '2.19.0',
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
  plugins: [
    'expo-router',
    'expo-secure-store',
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
    livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
    livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
    jupApiKey: process.env.JUP_API_KEY ?? '',
    skrMint: process.env.SKR_MINT ?? '',
    devWallet: process.env.DEV_WALLET ?? '7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J',
    eas: {
      projectId: 'e669ee53-de73-4dfb-9a36-5c22de29c67e',
    },
  },
});
