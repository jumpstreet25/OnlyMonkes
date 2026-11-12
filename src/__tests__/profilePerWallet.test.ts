import * as SecureStore from "expo-secure-store";
import { useAppStore } from "../store/appStore";
import { loadUserProfile, saveUserProfile, loadSelectedNftMint, saveSelectedNftMint } from "../lib/userProfile";

const connect = (address: string) =>
  useAppStore.setState({ wallet: { address } as never });

describe("profile belongs to the wallet, not the phone", () => {
  it("an existing profile with no owner is adopted by the connected wallet", async () => {
    await SecureStore.setItemAsync("profile_username", "OldTimer");
    connect("WalletA");
    expect((await loadUserProfile()).username).toBe("OldTimer");
    expect(await SecureStore.getItemAsync("profile_owner_wallet")).toBe("WalletA");
  });

  it("the same wallet keeps its profile", async () => {
    connect("WalletA");
    await saveUserProfile("Alpha", "bio", "x", "TipA", "NYC");
    await saveSelectedNftMint("MintA");
    expect((await loadUserProfile()).username).toBe("Alpha");
    expect(await loadSelectedNftMint()).toBe("MintA");
  });

  it("another wallet on the same phone starts fresh (username setup, no old tip wallet)", async () => {
    useAppStore.setState({ username: "Alpha", tipWallet: "TipA" });
    connect("WalletB");
    const p = await loadUserProfile();
    expect(p).toEqual({ username: null, bio: null, xAccount: null, tipWallet: null, location: null });
    expect(await loadSelectedNftMint()).toBeNull();
    expect(useAppStore.getState().username).toBeNull();
    expect(useAppStore.getState().tipWallet).toBeNull();
    expect(await SecureStore.getItemAsync("profile_owner_wallet")).toBe("WalletB");
  });
});
