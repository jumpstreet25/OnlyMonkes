import { device, element, by, expect, waitFor } from 'detox';

// ─── Fresh Launch (no wallet connected) ──────────────────────────────────────

describe('OnlyMonkes — Fresh Launch', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('shows the connect screen on fresh launch', async () => {
    await expect(element(by.text('OnlyMonkes'))).toBeVisible();
  });

  it('shows connect wallet button', async () => {
    await expect(element(by.text('Connect Wallet'))).toBeVisible();
  });

  it('shows guest mode option', async () => {
    await expect(element(by.text('Continue as Guest'))).toBeVisible();
  });

  it('does not show chat screen before auth', async () => {
    await expect(element(by.id('chat-flatlist'))).not.toBeVisible();
  });
});

// ─── Guest Mode ──────────────────────────────────────────────────────────────

describe('OnlyMonkes — Guest Mode', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('can enter guest mode', async () => {
    await element(by.text('Continue as Guest')).tap();
    // Should see the chat screen with read-only access
    await waitFor(element(by.text('OnlyMonkes')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('shows the community drawer button', async () => {
    await expect(element(by.id('drawer-button'))).toBeVisible();
  });

  it('cannot send messages as guest', async () => {
    // Guest mode should show a connect prompt instead of chat input
    await expect(element(by.id('chat-input'))).not.toBeVisible();
  });
});

// ─── Authenticated Chat Flow ─────────────────────────────────────────────────
// These tests require a pre-seeded device with wallet + NFT verified.
// Set DETOX_SKIP_AUTH=1 to skip in CI without a test account.

const SKIP_AUTH = process.env.DETOX_SKIP_AUTH === '1';

(SKIP_AUTH ? describe.skip : describe)('OnlyMonkes — Authenticated Chat', () => {
  beforeAll(async () => {
    // Assumes app state persisted from a previous manual setup
    await device.launchApp({ newInstance: false });
  });

  it('displays the chat screen', async () => {
    await waitFor(element(by.id('chat-flatlist')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('shows the header with OnlyMonkes logo', async () => {
    await expect(element(by.id('header-logo'))).toBeVisible();
  });

  it('shows the chat input field', async () => {
    await expect(element(by.id('chat-input'))).toBeVisible();
  });

  it('can type a message', async () => {
    await element(by.id('chat-input')).typeText('test message from e2e');
    await expect(element(by.id('chat-input'))).toHaveText('test message from e2e');
    await element(by.id('chat-input')).clearText();
  });

  it('shows send button when text is entered', async () => {
    await element(by.id('chat-input')).typeText('hello');
    await expect(element(by.id('send-button'))).toBeVisible();
    await element(by.id('chat-input')).clearText();
  });
});

// ─── Community Drawer ────────────────────────────────────────────────────────

(SKIP_AUTH ? describe.skip : describe)('OnlyMonkes — Community Drawer', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
    await waitFor(element(by.id('chat-flatlist')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('can open the community drawer', async () => {
    await element(by.id('drawer-button')).tap();
    await waitFor(element(by.text('Community')))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('shows the Members tab', async () => {
    await expect(element(by.text('Members'))).toBeVisible();
  });

  it('shows the bot channels', async () => {
    // At least one bot channel should be visible
    await expect(element(by.text('MonkeTrades'))).toBeVisible();
  });

  it('can navigate to a bot channel', async () => {
    await element(by.text('MonkeTrades')).tap();
    await waitFor(element(by.text('Monke Trades')))
      .toBeVisible()
      .withTimeout(10000);
    // Go back
    await device.pressBack();
  });

  it('can navigate to DMs from drawer', async () => {
    await element(by.id('drawer-button')).tap();
    await element(by.text('Messages')).tap();
    await waitFor(element(by.text('Direct Messages')))
      .toBeVisible()
      .withTimeout(5000);
    await device.pressBack();
  });
});

// ─── Marketplace ─────────────────────────────────────────────────────────────

(SKIP_AUTH ? describe.skip : describe)('OnlyMonkes — Marketplace', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('can navigate to marketplace', async () => {
    await element(by.id('drawer-button')).tap();
    await element(by.text('Marketplace')).tap();
    await waitFor(element(by.text('Marketplace')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('shows the listing grid or empty state', async () => {
    // Either listings or empty state should be visible
    await waitFor(
      element(by.id('marketplace-list'))
    ).toBeVisible().withTimeout(5000);
  });

  it('shows sort controls', async () => {
    await expect(element(by.text('Recent'))).toBeVisible();
  });

  it('can go back to chat', async () => {
    await device.pressBack();
    await waitFor(element(by.id('chat-flatlist')))
      .toBeVisible()
      .withTimeout(5000);
  });
});

// ─── Profile & Settings ──────────────────────────────────────────────────────

(SKIP_AUTH ? describe.skip : describe)('OnlyMonkes — Profile & Settings', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
    await waitFor(element(by.id('chat-flatlist')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('can open settings/tools modal', async () => {
    await element(by.id('tools-button')).tap();
    await waitFor(element(by.text('Settings')))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('shows notification settings', async () => {
    await expect(element(by.text('Notifications'))).toBeVisible();
  });

  it('can close settings modal', async () => {
    await device.pressBack();
    await expect(element(by.id('chat-flatlist'))).toBeVisible();
  });
});

// ─── Media Sharing ──────────────────────────────────────────────────────

(SKIP_AUTH ? describe.skip : describe)('OnlyMonkes — Media Sharing', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
    await waitFor(element(by.id('chat-flatlist')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('shows camera button', async () => {
    await expect(element(by.id('camera-button'))).toBeVisible();
  });

  it('opens media picker with Photo/Video/File options', async () => {
    await element(by.id('camera-button')).tap();
    await waitFor(element(by.text('📷 Photo')))
      .toBeVisible()
      .withTimeout(3000);
    await expect(element(by.text('🎥 Video'))).toBeVisible();
    await expect(element(by.text('📎 File'))).toBeVisible();
    // Dismiss
    await element(by.text('Cancel')).tap();
  });
});

// ─── Slash Commands ──────────────────────────────────────────────────────

(SKIP_AUTH ? describe.skip : describe)('OnlyMonkes — Slash Commands', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
    await waitFor(element(by.id('chat-flatlist')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('shows command menu when / is typed', async () => {
    await element(by.id('chat-input')).typeText('/');
    await waitFor(element(by.text('/tip')))
      .toBeVisible()
      .withTimeout(3000);
    await element(by.id('chat-input')).clearText();
  });
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────

describe('OnlyMonkes — Lifecycle', () => {
  it('survives background/foreground cycle', async () => {
    await device.launchApp({ newInstance: false });
    await device.sendToHome();
    await device.launchApp({ newInstance: false });
    // App should still be visible (not crashed)
    await expect(element(by.text('OnlyMonkes'))).toBeVisible();
  });

  it('survives device rotation', async () => {
    await device.setOrientation('landscape');
    await expect(element(by.text('OnlyMonkes'))).toBeVisible();
    await device.setOrientation('portrait');
    await expect(element(by.text('OnlyMonkes'))).toBeVisible();
  });
});
