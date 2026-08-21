// Mock AsyncStorage for unit tests
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-secure-store has no official jest mock and its real module reaches into
// expo-modules-core's native EventEmitter, which isn't present in the jest
// environment — plain in-memory stand-in, same three calls used app-wide.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn((key, value) => { store.set(key, value); return Promise.resolve(); }),
    deleteItemAsync: jest.fn((key) => { store.delete(key); return Promise.resolve(); }),
  };
});
