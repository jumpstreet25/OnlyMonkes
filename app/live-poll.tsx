/**
 * live-poll — onlymonkes.app/open/poll lands here (the Monke Live vote on /live, owner 2026-11-13).
 * Fetches the live poll from the worker and opens the normal poll pop-up over Main Chat; the vote
 * goes to the bot like any poll (holders only).
 */
import { useEffect } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner-native";
import { useAppStore } from "@/store/appStore";

const LIVE_API = "https://onlymonkes.app/api/live";
const ID = /^poll-\d{10,16}-[a-z0-9]{2,10}$/;

export default function LivePollRoute() {
  const { t } = useTranslation();
  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const r = await fetch(LIVE_API);
        const d = r.ok ? await r.json() : null;
        const p = d?.poll;
        if (p && ID.test(p.id) && Array.isArray(p.options) && p.status === "open" && p.resolvesAt > Date.now()) {
          useAppStore.getState().setActivePoll({
            id: p.id,
            question: String(p.question).slice(0, 200),
            options: p.options.slice(0, 5).map((o: { id: string; label: string }) => ({ id: String(o.id), label: String(o.label).slice(0, 90) })),
            resolvesAt: p.resolvesAt,
          });
        } else toast(t(p ? "invite.liveVoteClosed" : "invite.liveVoteNone"));
      } catch {
        toast(t("invite.liveVoteNone"));
      }
      if (!done) router.replace("/chat");
    })();
    return () => { done = true; };
  }, [t]);
  return null;
}
