import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OnlyMonkes',
  slug: 'onlymonkes',
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
        icon: './assets/icon.png',
        color: '#7C3AED',
        sounds: [],
      },
    ],
  ],
  scheme: 'onlymonkes',
  extra: {
    heliusApiKey: process.env.HELIUS_API_KEY ?? 'f222b023-3712-4ab5-9dd1-caff88d27c40',
    nftCollectionAddress:
      process.env.NFT_COLLECTION_ADDRESS ?? 'GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF',
    // EAS project ID — run `npx eas build:configure` to generate this.
    // Required for Expo push tokens in production builds.
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? '',
    },
  },
});
