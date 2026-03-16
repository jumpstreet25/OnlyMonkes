import { device, element, by, expect } from 'detox';

describe('OnlyMonkes E2E', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('shows the connect screen on fresh launch', async () => {
    // The ConnectScreen should be visible with the app name
    await expect(element(by.text('OnlyMonkes'))).toBeVisible();
  });

  it('shows connect wallet button', async () => {
    await expect(element(by.text('Connect Wallet'))).toBeVisible();
  });
});

describe('Chat flow (authenticated)', () => {
  // These tests require a pre-seeded device with wallet + NFT already verified.
  // Skip in CI unless a test account is available.

  it.skip('displays chat screen after verification', async () => {
    // Requires wallet connection + NFT verification
    await expect(element(by.text('☰'))).toBeVisible();
  });

  it.skip('can open the community drawer', async () => {
    await element(by.text('☰')).tap();
    await expect(element(by.text('Community'))).toBeVisible();
  });

  it.skip('can navigate to DMs from drawer', async () => {
    await element(by.text('☰')).tap();
    await element(by.text('Messages')).tap();
    // DM list should appear
    await expect(element(by.text('Direct Messages'))).toBeVisible();
  });
});
