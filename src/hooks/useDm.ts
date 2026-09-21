import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, loadDmMessages, sendDmMessage, sendReaction, applyReaction, applyWithRetry, sendTypingIndicator, sendReadReceipt, getLastPeerReadReceipt, decodeMessage } from '@/lib/xmtp';
import { BOT_INBOX_IDS } from '@/lib/constants';
import {
  isAllowedBotCommand,
  isInactiveMlsError,
  markBotDmBroken,
  postBotCommand,
  applyBotCommandResult,
  noteBotActivity,
  getLastBotActivityTs,
} from '@/lib/botCommand';
import { getCachedProfile } from '@/lib/userProfile';
import { markChannelRead } from '@/lib/messageCache';
import type { ChatMessage, ReactionEmoji } from '@/types';

// Throttle own typing broadcasts in DMs (one signal per 2.5 s max)
let _lastDmTypingSent = 0;

async function relayDmPush(
  recipientToken: string,
  senderUsername: string,
  preview: string,
  senderAvatarUrl?: string | null,
): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      to: recipientToken,
      title: `💬 ${senderUsername}`,
      body: preview.slice(0, 80),
      sound: 'default',
      channelId: 'om_all_v8',
      data: { type: 'dm', sender: senderUsername, avatarUrl: senderAvatarUrl ?? null },
    };
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* non-critical */ }
}

// Reactions (native ReactionCodec/V2 or legacy REACT: string) never decode
// to a displayable ChatMessage — decodeMessage() returns null for them by
// design, so they must be intercepted before that call and folded into the
// target message via applyReaction() instead (same pattern as useXmtp.ts /
// useGroupChat.ts).
function isReactionContent(content: unknown): boolean {
  if (typeof content === 'string') return content.startsWith('REACT:');
  if (content && typeof content === 'object') return !!((content as any).reaction || (content as any).reactionV2);
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[useDm] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export function useDm(peerInboxId: string) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [sending, setSending]     = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const { myInboxId }             = useAppStore();
  const retryTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeStream         = useRef<(() => void) | null>(null);
  const typingTimeout             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmRef                     = useRef<any>(null);
  const seenIds                   = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const client = getXmtpClient();
      if (!client || !myInboxId) {
        retryTimer.current = setTimeout(() => { if (!cancelled) init(); }, 500);
        return;
      }

      try {
        setError(null);

        await withTimeout(client.conversations.sync(), 10_000, 'conversations.sync');
        if (cancelled) return;

        const dm = await withTimeout(
          openOrCreateDm(client, peerInboxId),
          15_000,
          'findOrCreateDm'
        );
        if (cancelled) return;
        dmRef.current = dm;

        // Load history once
        const history = await withTimeout(
          loadDmMessages(dm, myInboxId),
          10_000,
          'loadDmMessages'
        );
        if (cancelled) return;

        // Track all seen IDs to prevent duplicates from stream
        seenIds.current = new Set(history.map(m => m.id));
        setMessages(history);
        setLoading(false);

        // Mark own messages as read based on peer's last READ: receipt in history
        getLastPeerReadReceipt(dm, myInboxId!).then(readUpToId => {
          if (cancelled || !readUpToId) return;
          setMessages(prev => {
            let found = false;
            return prev.map(m => {
              if (m.id === readUpToId) found = true;
              if (m.senderAddress === myInboxId && !found) {
                return { ...m, status: 'read' as const };
              }
              if (m.id === readUpToId && m.senderAddress === myInboxId) {
                return { ...m, status: 'read' as const };
              }
              return m;
            });
          });
        }).catch(() => {});

        // Mark this DM as read + clear per-DM unread badge
        markChannelRead(`dm_${peerInboxId}`).catch(() => {});
        useAppStore.getState().clearDmUnread(peerInboxId);

        // Send read receipt for the newest peer message in history
        const newestPeerMsg = [...history].reverse().find(m => m.senderAddress !== myInboxId);
        if (newestPeerMsg) {
          sendReadReceipt(dm, newestPeerMsg.id).catch(() => {});
        }

        // Stream is the only source of new messages — no periodic sync
        const stopStream = await dm.streamMessages(
          async (raw: any) => {
            if (cancelled) return;

            // 2026-09-13: confirmed tonight that dm.send() into an
            // MLS-inactive 1:1 resolves normally (client shows "delivered")
            // instead of throwing — so the HTTP-fallback catch block below
            // can never fire for the exact failure it exists to catch. This
            // tracks the last time ANY message arrived from the bot so send()
            // can fall back on a reply timeout instead of a thrown exception.
            if (BOT_INBOX_IDS.includes(raw.senderInboxId ?? '')) {
              noteBotActivity();
            }

            // Robust text extract — same shapes as streamAllMessages
            // (string / {text} / nativeContent.text / fallback).
            const { extractXmtpText, parseImageCaptionResponse, deliverCaptionResponse } =
              await import('@/lib/imageCaption');
            const rawContent: string | null = extractXmtpText(raw);

            // Strip the bot's `MSG:<name>:` envelope so prefix checks below
            // match both wrapped and bare structured payloads.
            const innerContent: string = rawContent
              ? (rawContent.startsWith('MSG:')
                  ? rawContent.slice(4).split(':').slice(1).join(':')
                  : rawContent)
              : '';

            // Detect typing signals from peer
            if (rawContent && rawContent.startsWith('TYPING:')) {
              const typerId = rawContent.split(':')[1];
              if (typerId && typerId !== myInboxId) {
                setPeerTyping(true);
                if (typingTimeout.current) clearTimeout(typingTimeout.current);
                typingTimeout.current = setTimeout(() => setPeerTyping(false), 4000);
              }
              return;
            }

            // Caption: substring parse before startsWith checks (envelope-safe).
            if (rawContent) {
              const captionParsed = parseImageCaptionResponse(rawContent);
              if (captionParsed) {
                try {
                  const { BOT_INBOX_IDS } = await import('@/lib/constants');
                  const sender = raw.senderInboxId ?? '';
                  if (BOT_INBOX_IDS.includes(sender)) {
                    await deliverCaptionResponse(captionParsed.messageId, captionParsed.caption);
                  }
                } catch { /* swallow */ }
                return;
              }
            }

            // Bot may reply LOCATION_SYNC: on the DM when we request a roster
            // (also broadcast to main chat). Apply pins without showing the
            // protocol payload in the thread.
            if (
              rawContent &&
              (rawContent.startsWith('LOCATION_SYNC:') ||
                innerContent.startsWith('LOCATION_SYNC:'))
            ) {
              try {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                const sender = raw.senderInboxId ?? '';
                if (BOT_INBOX_IDS.includes(sender)) {
                  const payload = (rawContent.startsWith('LOCATION_SYNC:')
                    ? rawContent
                    : innerContent
                  ).slice('LOCATION_SYNC:'.length);
                  const locs = JSON.parse(payload);
                  const { applyLocationSync } = await import('@/lib/userProfile');
                  applyLocationSync(locs as Record<string, { u?: string; loc?: string; ni?: string }>);
                }
              } catch { /* ignore */ }
              return;
            }

            // Structured AutonoMonke payloads from the bot. All caught here
            // (not in useXmtp's global stream) because per-DM streamMessages
            // owns the conversation while DM screen is mounted, and the
            // messages are filtered by decodeMessage → would otherwise be
            // silently dropped. innerContent strips the MSG:<name>: envelope.
            if (innerContent.startsWith('PORTFOLIO_RESPONSE:')) {
              try {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                const sender = raw.senderInboxId ?? '';
                if (!BOT_INBOX_IDS.includes(sender)) {
                  // 2026-08-03: was toast.error — visible to real users chasing
                  // an investigation that's still open. Dev-only console log
                  // keeps the diagnostic value without the user-facing noise.
                  if (__DEV__) console.warn(`[diag] portfolio sender mismatch: "${sender}"`);
                  return;
                }
                const { parsePortfolioResponse } = await import('@/lib/xmtp');
                const parsed = parsePortfolioResponse(innerContent);
                if (!parsed) {
                  if (__DEV__) console.warn(`[diag] portfolio parse returned null, len=${innerContent.length}`);
                  return;
                }
                const { useTradesStore } = await import('@/store/tradesStore');
                useTradesStore.getState().setPortfolioResponse(parsed);
              } catch (err) {
                if (__DEV__) console.warn(`[diag] portfolio handler threw: ${(err as Error)?.message?.slice(0, 100)}`);
              }
              return;
            }

            // IMAGE_CAPTION_RESPONSE handled above via parseImageCaptionResponse.

            // MonkeMarkets private handshake (2026-09-13) — bid/offer/accept/swap/complete moved
            // off the Main Chat group broadcast to private DMs (see marketplace.ts's doc comment
            // and the matching block in useXmtp.ts's global streamAllMessages, which covers the
            // off-screen case). Caught here too so the per-DM screen updates live while it's the
            // one actually mounted. Same spoofing defense as everywhere else in this codebase:
            // trust the cryptographically-real DM sender, not the JSON payload's own claimed
            // fields (NFT_ACCEPT carries no seller field at all, so that one's checked against
            // this device's own locally-held listing record instead).
            if (
              innerContent.startsWith('NFT_BID:') || innerContent.startsWith('NFT_BID_CANCEL:') ||
              innerContent.startsWith('NFT_OFFER:') || innerContent.startsWith('NFT_ACCEPT:') ||
              innerContent.startsWith('NFT_SWAP:') || innerContent.startsWith('NFT_COMPLETE:')
            ) {
              try {
                const sender = raw.senderInboxId ?? '';
                const {
                  parseMarketplaceMessage, addBid, addSwapOffer, cancelBid, markPendingSwap, markSold,
                  getListingById, getBidsForListing, recordHistoryEntry,
                } = await import('@/lib/marketplace');
                const market = parseMarketplaceMessage(innerContent);
                if (!market) return;
                switch (market.type) {
                  case 'bid': {
                    if (sender !== market.data.bidderInboxId) return;
                    addBid(market.data);
                    const bidListing = getListingById(market.data.listingId);
                    if (bidListing && bidListing.sellerInboxId === myInboxId) {
                      const { showLocalNotification, CH_MARKET } = await import('@/lib/notifications');
                      showLocalNotification(
                        'New Bid',
                        `${market.data.bidderUsername ?? 'Someone'} bid ${market.data.bidPrice} SKR on ${bidListing.name}`,
                        CH_MARKET,
                      );
                    }
                    break;
                  }
                  case 'bid_cancel': {
                    if (sender !== market.data.bidderInboxId) return;
                    cancelBid(market.data.listingId, market.data.bidderInboxId);
                    break;
                  }
                  case 'offer': {
                    if (sender !== market.data.offererInboxId) return;
                    addSwapOffer(market.data);
                    const offerListing = getListingById(market.data.listingId);
                    if (offerListing && offerListing.sellerInboxId === myInboxId) {
                      const { showLocalNotification, CH_MARKET } = await import('@/lib/notifications');
                      showLocalNotification(
                        'Monke Swap Offer',
                        `${market.data.offererUsername ?? 'Someone'} offered ${market.data.offeredName ?? 'a Monke'} for ${offerListing.name}`,
                        CH_MARKET,
                      );
                    }
                    break;
                  }
                  case 'accept': {
                    const acceptListing = getListingById(market.data.listingId);
                    if (!acceptListing || sender !== acceptListing.sellerInboxId) return;
                    const bids = getBidsForListing(market.data.listingId);
                    const acceptedBid = bids.find((b) => b.bidderInboxId === market.data.bidderInboxId);
                    if (acceptedBid) markPendingSwap(market.data.listingId, acceptedBid);
                    break;
                  }
                  case 'swap': {
                    const swap = market.data;
                    if (sender !== swap.sellerInboxId || swap.buyerInboxId !== myInboxId) return;
                    useAppStore.getState().setPendingNftSwap(swap);
                    const swapListing = getListingById(swap.listingId);
                    const { showLocalNotification, CH_MARKET } = await import('@/lib/notifications');
                    showLocalNotification(
                      'NFT Swap Ready',
                      `${swapListing?.sellerUsername ?? 'Seller'} signed the swap for ${swapListing?.name ?? 'NFT'} (${swap.skrPrice} SKR). Open MonkeMarkets to complete.`,
                      CH_MARKET,
                    );
                    break;
                  }
                  case 'complete': {
                    if (sender !== market.data.buyerInboxId) return;
                    const soldListing = getListingById(market.data.listingId);
                    markSold(market.data.listingId);
                    if (soldListing && soldListing.sellerInboxId === myInboxId) {
                      recordHistoryEntry({
                        type: 'sell',
                        nftName: soldListing.name,
                        price: market.data.skrPrice ?? soldListing.askPrice,
                        timestamp: Date.now(),
                        counterparty: market.data.buyerUsername ?? 'anon',
                        mint: soldListing.mint,
                        txSignature: market.data.signature,
                      });
                    }
                    break;
                  }
                }
              } catch { /* non-fatal — worst case this device's local marketplace state lags */ }
              return;
            }

            if (innerContent.startsWith('STREAK_CAPTION_RESPONSE:')) {
              try {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                const sender = raw.senderInboxId ?? '';
                if (!BOT_INBOX_IDS.includes(sender)) return;
                const caption = innerContent.slice('STREAK_CAPTION_RESPONSE:'.length);
                if (!caption) return;
                const { storeStreakCaptionResponse } = await import('@/lib/imageCaption');
                await storeStreakCaptionResponse(caption);
              } catch { /* swallow */ }
              return;
            }

            if (innerContent.startsWith('TRADE_CLOSED:')) {
              try {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                const sender = raw.senderInboxId ?? '';
                if (!BOT_INBOX_IDS.includes(sender)) return;
                const { parseTradeClosed } = await import('@/lib/xmtp');
                const parsed = parseTradeClosed(innerContent);
                if (!parsed) return;
                const { useTradesStore } = await import('@/store/tradesStore');
                useTradesStore.getState().addClosedTrade({
                  id: `${parsed.mint}-${parsed.ts}`,
                  source: parsed.source,
                  token: parsed.token,
                  mint: parsed.mint,
                  entrySolAmount: parsed.entrySolAmount,
                  exitSolAmount: parsed.exitSolAmount,
                  pnlSol: parsed.pnlSol,
                  pnlPct: parsed.pnlPct,
                  durationMs: parsed.durationMs,
                  openedAt: parsed.ts - parsed.durationMs,
                  closedAt: parsed.ts,
                  reason: parsed.reason,
                  signature: parsed.signature,
                  // v2.38 multi-base fields — undefined for pre-v2.38 bot
                  // builds; UI falls back to SOL view. Native-base PnL only.
                  baseMint: parsed.baseMint,
                  baseSymbol: parsed.baseSymbol,
                  entryBaseAmount: parsed.entryBaseAmount,
                  exitBaseAmount: parsed.exitBaseAmount,
                  pnlBase: parsed.pnlBase,
                  copySourceLabel: parsed.copySourceLabel,
                });
              } catch { /* swallow */ }
              return;
            }

            // COPY_TRADE_STATUS: ground truth for copy-trade slot bindings,
            // sent by the bot after every /copy enable|disable and after a
            // weekly rebind. Reconciles the app's optimistic toggle state.
            if (innerContent.startsWith('COPY_TRADE_STATUS:')) {
              try {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                const sender = raw.senderInboxId ?? '';
                if (!BOT_INBOX_IDS.includes(sender)) return;
                const { parseCopyTradeStatus } = await import('@/lib/xmtp');
                const parsed = parseCopyTradeStatus(innerContent);
                if (!parsed) return;
                for (const s of parsed.slots) {
                  useAppStore.getState().setCopyTradeSlot(s.slot, {
                    enabled: s.enabled,
                    perTradeSOL: s.perTradeSOL,
                    boundAt: Date.now(),
                  });
                }
              } catch { /* swallow */ }
              return;
            }

            if (innerContent.startsWith('TRADE_OPENED:')) {
              try {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                const sender = raw.senderInboxId ?? '';
                if (!BOT_INBOX_IDS.includes(sender)) return;
                const { parseTradeOpened } = await import('@/lib/xmtp');
                const parsed = parseTradeOpened(innerContent);
                if (!parsed) return;
                const { useTradesStore } = await import('@/store/tradesStore');
                useTradesStore.getState().addOpenTrade({
                  id: parsed.positionId,
                  source: parsed.source,
                  token: parsed.token,
                  mint: parsed.mint,
                  entryPriceUsd: parsed.entryPriceUsd,
                  entrySolAmount: parsed.entrySolAmount,
                  tokenAmount: parsed.tokenAmount,
                  stopPrice: parsed.stopPrice,
                  stopPct: parsed.stopPct,
                  target1: parsed.target1,
                  target2: parsed.target2,
                  taComposite: parsed.taComposite,
                  openClawConfidence: parsed.openClawConfidence,
                  txHash: parsed.txHash,
                  openedAt: parsed.ts,
                  baseSymbol: parsed.baseSymbol,
                  copySourceLabel: parsed.copySourceLabel,
                });
              } catch { /* swallow */ }
              return;
            }

            // Detect read receipts from peer → mark own messages as read
            if (typeof rawContent === 'string' && rawContent.startsWith('READ:')) {
              const readUpToId = rawContent.slice(5);
              const sender = raw.senderInboxId ?? '';
              if (sender !== myInboxId && readUpToId) {
                setMessages(prev => {
                  let found = false;
                  // Mark all own messages up to (and including) the read ID
                  return prev.map(m => {
                    if (m.id === readUpToId) found = true;
                    if (m.senderAddress === myInboxId && m.status !== 'read') {
                      // Mark as read if we haven't passed the read-up-to point yet,
                      // or if this IS the read-up-to message, or it was sent before it
                      if (!found || m.id === readUpToId) return { ...m, status: 'read' as const };
                    }
                    return m;
                  });
                });
              }
              return;
            }

            // Reaction from the peer (own reactions are applied optimistically
            // in react() below — XMTP does not echo own messages back in the
            // stream, so this branch only ever fires for the other party).
            if (isReactionContent(rawContent)) {
              applyWithRetry(m => applyReaction(m, raw, myInboxId), setMessages);
              return;
            }

            const msg = decodeMessage(raw, myInboxId);
            if (!msg) return;

            // Peer sent a real message — clear typing indicator + send read receipt
            if (msg.senderAddress !== myInboxId) {
              setPeerTyping(false);
              // Auto-acknowledge: user is viewing this conversation
              sendReadReceipt(dm, msg.id).catch(() => {});
              markChannelRead(`dm_${peerInboxId}`).catch(() => {});
            }

            // Skip if we've already seen this message
            if (seenIds.current.has(msg.id)) return;

            setMessages(prev => {
              // Replace matching optimistic message
              const optimisticIdx = prev.findIndex(
                m => m.id.startsWith('optimistic-') &&
                     m.content === msg.content &&
                     m.senderAddress === msg.senderAddress
              );
              if (optimisticIdx !== -1) {
                seenIds.current.add(msg.id);
                const next = [...prev];
                next[optimisticIdx] = msg;
                return next;
              }

              // Double-check dedup (race condition guard)
              if (prev.some(m => m.id === msg.id)) return prev;

              seenIds.current.add(msg.id);
              return [...prev, msg];
            });
          }
        );
        unsubscribeStream.current = typeof stopStream === 'function' ? stopStream : null;
      } catch (e: any) {
        if (!cancelled) {
          console.warn('[useDm] init error:', e?.message ?? e);
          setError(e?.message ?? 'Failed to open DM — check connection');
          setLoading(false);
        }
      }
    }

    init();

    // On app foreground: do a single catch-up sync for messages missed while backgrounded
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && dmRef.current && !cancelled) {
        try {
          const refreshed = await loadDmMessages(dmRef.current, myInboxId!);
          if (cancelled) return;
          const newMsgs = refreshed.filter(m => !seenIds.current.has(m.id));
          if (newMsgs.length > 0) {
            for (const m of newMsgs) seenIds.current.add(m.id);
            setMessages(prev => [...prev, ...newMsgs]);
          }
        } catch { /* non-fatal */ }
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      unsubscribeStream.current?.();
      unsubscribeStream.current = null;
      dmRef.current = null;
      seenIds.current.clear();
    };
  }, [peerInboxId, myInboxId]);

  const [sendError, setSendError] = useState<string | null>(null);

  // 2026-09-13: no reply from the bot after this long means the DM is
  // probably dead — long enough to clear normal bot-side latency (botSend
  // retries against a locked XMTP DB for up to ~32s under load) without
  // making a genuinely dead conversation wait forever for the HTTP
  // fallback + its one real MWA signature prompt.
  const BOT_REPLY_TIMEOUT_MS = 40_000;

  const tryHttpFallback = useCallback(async (text: string, optimisticId: string) => {
    const result = await postBotCommand(text.trim());
    applyBotCommandResult(result);
    setMessages(prev =>
      prev.map(m => m.id === optimisticId ? { ...m, status: 'sent' } : m),
    );
    const visible = result.reply
      && !result.reply.startsWith('PORTFOLIO_RESPONSE:')
      && !result.reply.startsWith('AUTOMONKE_STATUS:');
    if (visible) {
      setMessages(prev => [...prev, {
        id: `http-${Date.now()}`,
        content: result.reply,
        senderAddress: peerInboxId,
        senderUsername: 'AI Agent #9385',
        senderNft: undefined,
        sentAt: new Date(),
        reactions: {},
        replyTo: undefined,
        status: 'sent',
      }]);
    }
  }, [peerInboxId]);

  const send = useCallback(async (text: string) => {
    if (!dmRef.current || !text.trim()) return;
    setSending(true);
    setSendError(null);
    const { username, verifiedNft, dmNotificationsEnabled } = useAppStore.getState();

    // Add optimistic message immediately so user sees it
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      content: text,
      senderAddress: myInboxId ?? '',
      senderUsername: username ?? '',
      senderNft: undefined,
      sentAt: new Date(),
      reactions: {},
      replyTo: undefined,
      status: 'sending',
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const sentAt = Date.now();
      await sendDmMessage(dmRef.current, text, username);

      // Mark optimistic message as sent
      setMessages(prev =>
        prev.map(m => m.id === optimisticId ? { ...m, status: 'sent' } : m)
      );

      if (dmNotificationsEnabled) {
        const peer = getCachedProfile(peerInboxId);
        const peerExpoToken = peer?.expoPushToken;
        if (peerExpoToken && peerExpoToken.startsWith('ExponentPushToken')) {
          void relayDmPush(
            peerExpoToken,
            username ?? 'Monke',
            text,
            verifiedNft?.image ?? null,
          );
        }
      }

      // 2026-09-13: dm.send() into an MLS-inactive 1:1 resolves normally
      // (confirmed live — the client shows "delivered" even though the
      // bot's stream never yields the message), so a thrown exception can
      // never be relied on to detect this failure class. Race a reply
      // timeout instead, scoped to allowlisted bot commands only — never
      // fires for ordinary chat, and only trips the one real MWA signature
      // prompt after a genuinely long silence.
      const toBot = BOT_INBOX_IDS.includes(peerInboxId);
      if (toBot && isAllowedBotCommand(text.trim())) {
        setTimeout(() => {
          void (async () => {
            if (getLastBotActivityTs() >= sentAt) return; // real reply already arrived
            try {
              await markBotDmBroken();
              await tryHttpFallback(text, optimisticId);
            } catch (httpErr) {
              if (__DEV__) console.warn('[useDm] bot-command reply-timeout fallback failed:', (httpErr as Error).message);
            }
          })();
        }, BOT_REPLY_TIMEOUT_MS);
      }
    } catch (e: any) {
      console.warn('[useDm] send failed:', e?.message ?? e);
      const toBot = BOT_INBOX_IDS.includes(peerInboxId);
      if (toBot && isAllowedBotCommand(text.trim())) {
        try {
          if (isInactiveMlsError(e)) await markBotDmBroken();
          await tryHttpFallback(text, optimisticId);
          return;
        } catch (httpErr) {
          if (__DEV__) console.warn('[useDm] bot-command HTTP fallback failed:', (httpErr as Error).message);
        }
      } else if (toBot && isInactiveMlsError(e)) {
        await markBotDmBroken();
      }
      setSendError('Message failed to send');
      // Mark optimistic message as failed
      setMessages(prev =>
        prev.map(m => m.id === optimisticId ? { ...m, status: 'failed' } : m)
      );
    } finally {
      setSending(false);
    }
  }, [myInboxId, peerInboxId]);

  const react = useCallback(async (emoji: ReactionEmoji, targetMessageId: string) => {
    if (!dmRef.current || !myInboxId) return;

    // Apply optimistically — XMTP does not echo own messages back in the
    // stream, so without this the reaction never appeared in a DM at all
    // (react() previously didn't exist here — DM reactions were a no-op).
    const fakeRaw = {
      content: () => ({
        reaction: {
          reference: targetMessageId,
          action: 'added',
          schema: 'unicode',
          content: emoji,
        },
      }),
      senderInboxId: myInboxId,
    };
    setMessages(prev => applyReaction(prev, fakeRaw, myInboxId));

    await sendReaction(dmRef.current, emoji, targetMessageId);
  }, [myInboxId]);

  const retry = useCallback(async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId && m.status === 'failed');
    if (!msg || !dmRef.current) return;
    // Remove the failed message and re-send
    setMessages(prev => prev.filter(m => m.id !== messageId));
    await send(msg.content);
  }, [messages, send]);

  const sendTyping = useCallback(async () => {
    if (!dmRef.current) return;
    const now = Date.now();
    if (now - _lastDmTypingSent < 2500) return;
    _lastDmTypingSent = now;
    const { username, myInboxId: id } = useAppStore.getState();
    try {
      await sendTypingIndicator(dmRef.current, id ?? myInboxId ?? '', username);
    } catch { /* typing is best-effort */ }
  }, [myInboxId]);

  // Build typingUsers array for ChatInput compatibility
  const peerProfile = getCachedProfile(peerInboxId);
  const typingUsers = peerTyping
    ? [{ inboxId: peerInboxId, username: peerProfile?.username }]
    : [];

  return { messages, loading, error, sending, sendError, send, retry, react, sendTyping, typingUsers };
}
