import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OnlyMonkes',
  slug: 'onlymonkes',
  owner: process.env.EXPO_OWNER ?? undefined,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0A0F',
  },
  android: {
    package: 'com.yourorg.onlymonkes',
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
  ],
  scheme: 'onlymonkes',
  extra: {
    heliusApiKey: process.env.HELIUS_API_KEY ?? '***REDACTED_HELIUS_KEY***',
    giphyApiKey: process.env.GIPHY_API_KEY ?? '***REDACTED_GIPHY_KEY***',
    nftCollectionAddress:
      process.env.NFT_COLLECTION_ADDRESS ?? 'GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF',
    eas: {
      projectId: 'e669ee53-de73-4dfb-9a36-5c22de29c67e',
    },
  },
});
