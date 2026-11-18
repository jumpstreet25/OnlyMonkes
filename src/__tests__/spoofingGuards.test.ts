jest.mock('@/lib/constants', () => ({
  BOT_INBOX_IDS: ['b'.repeat(64)],
  TREASURY_BOT_INBOX_IDS: ['t'.repeat(64)],
  BOT_DISPLAY_NAME: 'AI Agent #9385',
  TREASURY_BOT_DISPLAY_NAME: 'OnlyTreasury',
}));

import {
  displayNameFor, isAdminSender, isBotSender, isOnlyMonkesSigningText, isReservedBotName,
  isTrustedBlinkUrl, isTrustedTipLink, safeAttachmentUrl,
} from '@/lib/trustedSenders';
import { extractBlinkUrl } from '@/lib/blinkActions';

const BOT = 'b'.repeat(64);
const ADMIN = 'a'.repeat(64);
const MEMBER = 'c'.repeat(64);

describe('who may send system messages', () => {
  it('trusts the bot inboxes, not names', () => {
    expect(isBotSender(BOT)).toBe(true);
    expect(isBotSender('t'.repeat(64))).toBe(false);
    expect(displayNameFor('t'.repeat(64), 'OnlyTreasury')).toBe('OnlyTreasury');
    expect(isBotSender(MEMBER)).toBe(false);
    expect(isBotSender(undefined)).toBe(false);
  });

  it('admin only when the remote config names one', () => {
    expect(isAdminSender(ADMIN, ADMIN)).toBe(true);
    expect(isAdminSender(MEMBER, ADMIN)).toBe(false);
    expect(isAdminSender(ADMIN, null)).toBe(false);
    expect(isAdminSender('', '')).toBe(false);
  });
});

describe('bot names', () => {
  it('marks a member who takes the bot name', () => {
    expect(displayNameFor(MEMBER, 'AI Agent #9385')).toBe('AI Agent #9385 (not the bot)');
    expect(displayNameFor(MEMBER, 'ai agent  #9385')).toMatch(/not the bot/);
    expect(displayNameFor(MEMBER, 'OnlyTreasury')).toMatch(/not the bot/);
  });

  it('leaves the bot and ordinary names alone', () => {
    expect(displayNameFor(BOT, 'AI Agent #9385')).toBe('AI Agent #9385');
    expect(displayNameFor(MEMBER, 'BananaKing')).toBe('BananaKing');
    expect(isReservedBotName('')).toBe(false);
  });
});

describe('Blinks only from our own actions', () => {
  const ours = 'solana-action:https://onlymonkes-actions.jumpstreet25.workers.dev/api/actions/swap?outputMint=x';
  it('accepts our actions worker and site over https', () => {
    expect(isTrustedBlinkUrl(ours)).toBe(true);
    expect(isTrustedBlinkUrl('https://onlymonkes.app/api/actions/tip?to=x')).toBe(true);
    expect(extractBlinkUrl(`🚨 setup\n⚡ ${ours}`)).toBe(ours.replace('solana-action:', ''));
  });

  it('turns any other host into a plain link', () => {
    expect(extractBlinkUrl('⚡ solana-action:https://evil.example/api/actions/swap')).toBeNull();
    expect(extractBlinkUrl('https://dial.to/?action=solana-action:https://evil.example/api/actions/x')).toBeNull();
    expect(extractBlinkUrl('http://onlymonkes.app/api/actions/swap')).toBeNull();
    expect(isTrustedBlinkUrl('https://onlymonkes.app.evil.example/api/actions/x')).toBe(false);
  });
});

describe('tip and attachment cards', () => {
  const token = 'A'.repeat(43);
  it('opens only the worker claim link', () => {
    expect(isTrustedTipLink(`https://onlymonkes.app/claim?token=${token}`)).toBe(true);
    expect(isTrustedTipLink(`https://onlymonkes-claim.example/claim?token=${token}`)).toBe(false);
    expect(isTrustedTipLink(`https://onlymonkes.app/claim?token=${token}&next=https://evil`)).toBe(false);
    expect(isTrustedTipLink('solana:Attacker?amount=20')).toBe(false);
  });

  it('attachments open over https only', () => {
    expect(safeAttachmentUrl('https://files.example/a.pdf')?.hostname).toBe('files.example');
    expect(safeAttachmentUrl('solana:Attacker?amount=20&label=Claim')).toBeNull();
    expect(safeAttachmentUrl('intent://x#Intent;end')).toBeNull();
    expect(safeAttachmentUrl('onlymonkes://avatar-room?token=x')).toBeNull();
  });
});

describe('wallet bridge', () => {
  it('refuses OnlyMonkes sign-in and admin texts', () => {
    expect(isOnlyMonkesSigningText('OnlyMonkes XMTP identity v1\nWallet: x')).toBe(true);
    expect(isOnlyMonkesSigningText('OnlyMonkes Admin Publish\nx')).toBe(true);
    expect(isOnlyMonkesSigningText('onlymonkes.app wants you to sign in')).toBe(true);
    expect(isOnlyMonkesSigningText('Sign in to shop.sagamonkes.com')).toBe(false);
  });
});
