/**
 * Fleet fork: work chats' end-of-turn reports reaching their planner. Each machine's Stop hook
 * records a chat's turn on the Desk and sends it to the planner when the planner is on the same
 * machine. A planner elsewhere can't be reached from there, so an open Board delivers what's
 * still waiting after a couple of minutes.
 */
import { useEffect, useRef } from "react";

import type { CardChatState } from "./boardCards.logic";
import type { DeskItem } from "./desk.logic";
import { type DeskChatWork, type DeskNotes, waitingReports } from "./deskNotes.logic";
import { saveReportsSent } from "./deskNotesStore";
import { useSendToChat } from "./deskSend";

/** Gives the machine's own hook the first chance to deliver. */
const GRACE_MS = 2 * 60_000;
/** At most one update a planner every few minutes; reports in between go together. */
const UPDATE_EVERY_MS = 3 * 60_000;

function reportDigest(
  reports: ReadonlyArray<{ readonly threadId: string; readonly work: DeskChatWork }>,
  items: ReadonlyArray<DeskItem>,
): string {
  const parts = reports.map(({ threadId, work }) => {
    const open = work.items.findLast((span) => span.until === null);
    const item = open ? items.find((entry) => entry.url === open.url) : undefined;
    const name = item
      ? `${item.repo?.split("/").pop()}#${item.number} ${item.title}`
      : `chat ${threadId}`;
    return [
      `### ${name} (${work.role ?? "work"} chat ${threadId}, ${work.report?.at.slice(11, 16)} UTC)`,
      `Next: ${work.next ?? "not set"}`,
      `Said: ${work.report?.text ?? ""}`,
    ].join("\n");
  });
  return [
    `[Desk update] ${reports.length === 1 ? "A chat you run" : `${reports.length} chats you run`} finished a turn:`,
    "",
    parts.join("\n\n"),
    "",
    "Update your checklist (plan set) if the picture changed, and act on anything that needs you. Don't reply to the chat unless it needs something. Reply here in one line, or not at all.",
  ].join("\n");
}

export function useDeliverReports(
  notes: DeskNotes,
  items: ReadonlyArray<DeskItem>,
  chats: ReadonlyArray<CardChatState>,
  nowMs: number,
) {
  const sendToChat = useSendToChat();
  const sent = useRef(new Set<string>());
  // Saving the delivery updates the notes at once, so a rerun finds nothing left to send.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- delivers reports a planner's machine couldn't
  useEffect(() => {
    const appOfUrl = (url: string) => items.find((item) => item.url === url)?.app ?? null;
    for (const [plannerId, reports] of waitingReports(notes, appOfUrl)) {
      const oldest = Date.parse(reports[0]?.work.report?.at ?? "");
      const last = Date.parse(notes.work[plannerId]?.updatesSentAt ?? "") || 0;
      if (!(nowMs - oldest >= GRACE_MS) || nowMs - last < UPDATE_EVERY_MS) continue;
      const planner = chats.find((chat) => chat.threadId === plannerId);
      const key = `${plannerId}:${reports.map((entry) => entry.work.report?.at).join(",")}`;
      if (!planner || sent.current.has(key)) continue;
      sent.current.add(key);
      saveReportsSent(
        plannerId,
        reports.map((entry) => entry.threadId),
      );
      void sendToChat(planner, reportDigest(reports, items));
    }
  }, [notes, items, chats, nowMs, sendToChat]);
}
