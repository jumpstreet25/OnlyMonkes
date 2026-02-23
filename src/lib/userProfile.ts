import * as SecureStore from 'expo-secure-store';

const SK_USERNAME = 'profile_username';
const SK_BIO = 'profile_bio';

export async function loadUserProfile(): Promise<{
  username: string | null;
  bio: string | null;
}> {
  const [username, bio] = await Promise.all([
    SecureStore.getItemAsync(SK_USERNAME),
    SecureStore.getItemAsync(SK_BIO),
  ]);
  return { username, bio };
}

export async function saveUserProfile(
  username: string,
  bio: string
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SK_USERNAME, username.trim()),
    SecureStore.setItemAsync(SK_BIO, bio.trim()),
  ]);
}
