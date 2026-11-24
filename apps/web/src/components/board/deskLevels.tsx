/**
 * Fleet fork: the Board's visual language (agreed with Rigo, 2026-11-24). Each chat level has a
 * color and an icon, each app a color, each of Rigo's verbs a color, used the same way in the
 * sidebar, on Now, in a chat's band and in its header, so where you are shows before you read.
 */
import { CircleDashedIcon, CompassIcon, FlagIcon, type LucideIcon, WrenchIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import type { DeskItem } from "./desk.logic";
import type { ChatRole } from "./deskNotes.logic";

export type DeskLevel = "planner" | "lead" | "helper" | "fix";

interface LevelStyle {
  readonly label: string;
  readonly Icon: LucideIcon;
  /** Text and icon color. */
  readonly text: string;
  /** Soft fill behind a mark or band. */
  readonly soft: string;
  /** The edge color for rows and bands. */
  readonly edge: string;
  /** What a chat at this level is for, in a line. */
  readonly purpose: string;
}

export const LEVELS: Record<DeskLevel, LevelStyle> = {
  planner: {
    label: "Planner",
    Icon: CompassIcon,
    text: "text-violet-700 dark:text-violet-300",
    soft: "bg-violet-500/12",
    edge: "border-violet-500",
    purpose: "Plans this app's sprint and brings you decisions. You steer here.",
  },
  lead: {
    label: "Story lead",
    Icon: FlagIcon,
    text: "text-teal-700 dark:text-teal-300",
    soft: "bg-teal-500/12",
    edge: "border-teal-500",
    purpose: "Owns one story: its mockup, its test sheet and its merge.",
  },
  helper: {
    label: "Helper",
    Icon: CircleDashedIcon,
    text: "text-slate-600 dark:text-slate-300",
    soft: "bg-slate-500/12",
    edge: "border-slate-400 border-dashed",
    purpose: "Does one piece for its story lead. Nothing here needs you; steer through the lead.",
  },
  fix: {
    label: "Quick fix",
    Icon: WrenchIcon,
    text: "text-amber-700 dark:text-amber-300",
    soft: "bg-amber-500/14",
    edge: "border-amber-500",
    purpose: "A bug or upgrade with no story. You test it, then merge.",
  },
};

const QUICK_FIX_TYPES = new Set(["Bug", "Maintenance"]);

/** A chat's level from its recorded role and the item it's on. Null for the day's chat or unknown. */
export function deskLevel(
  role: ChatRole | null | undefined,
  item: DeskItem | null,
): DeskLevel | null {
  if (role === "planner") return "planner";
  if (role === "helper") return "helper";
  if (role === "work" || (role == null && item)) return itemLevel(item);
  return null;
}

/** An item's level when a chat leads it: a quick fix for bugs and maintenance, else a story. */
export function itemLevel(item: DeskItem | null | undefined): DeskLevel {
  return item && QUICK_FIX_TYPES.has(item.workType ?? "") ? "fix" : "lead";
}

export function LevelMark(props: {
  readonly level: DeskLevel;
  /** Shorter label for tight rows ("Story" instead of "Story lead"). */
  readonly short?: boolean;
  readonly className?: string;
}) {
  const style = LEVELS[props.level];
  const label = props.short && props.level === "lead" ? "Story" : style.label;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full py-px ps-1.5 pe-2 text-2xs font-semibold whitespace-nowrap",
        style.soft,
        style.text,
        props.className,
      )}
    >
      <style.Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/** Just the level's icon, colored, with its name for screen readers. */
export function LevelIcon(props: { readonly level: DeskLevel; readonly className?: string }) {
  const style = LEVELS[props.level];
  return (
    <style.Icon
      className={cn("size-3.5 shrink-0", style.text, props.className)}
      aria-label={style.label}
    />
  );
}

const APP_COLORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^precon/i, "#2563eb"],
  [/warehouse/i, "#7c3aed"],
  [/bizdev/i, "#db2777"],
  [/^materials/i, "#0891b2"],
  [/sharepoint/i, "#16a34a"],
  [/dev platform/i, "#4f46e5"],
  [/portal/i, "#ea580c"],
  [/claude usage/i, "#ca8a04"],
  [/legacy/i, "#64748b"],
];
const SPARE = ["#0d9488", "#9333ea", "#e11d48", "#65a30d", "#0284c7"];

/** The app's color, the same everywhere: known apps by name, others by a stable pick. */
export function appColor(app: string | null | undefined): string {
  if (!app) return "#94a3b8";
  const known = APP_COLORS.find(([pattern]) => pattern.test(app));
  if (known) return known[1];
  let hash = 0;
  for (const char of app) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SPARE[hash % SPARE.length] ?? "#94a3b8";
}

export function AppDot(props: {
  readonly app: string | null | undefined;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-xs", props.className)}
      style={{ background: appColor(props.app) }}
    />
  );
}

/** Rigo's verbs, each its own color, so the queue can be scanned by color. */
const VERB_STYLE: Record<string, string> = {
  Decide: "bg-violet-500/14 text-violet-700 dark:text-violet-300",
  Test: "bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Retest: "bg-red-500/14 text-red-700 dark:text-red-300",
  Review: "bg-blue-500/14 text-blue-700 dark:text-blue-300",
  Merge: "bg-green-500/14 text-green-700 dark:text-green-300",
  Do: "bg-amber-500/16 text-amber-800 dark:text-amber-300",
  Approve: "bg-rose-500/14 text-rose-700 dark:text-rose-300",
  Answer: "bg-rose-500/14 text-rose-700 dark:text-rose-300",
  "Needs you": "bg-rose-500/14 text-rose-700 dark:text-rose-300",
  "Send back": "bg-red-500/14 text-red-700 dark:text-red-300",
  Blocked: "bg-red-500/14 text-red-700 dark:text-red-300",
  "Sheet done": "bg-green-500/14 text-green-700 dark:text-green-300",
};

export function VerbChip(props: { readonly verb: string; readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-20 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-2xs font-bold",
        VERB_STYLE[props.verb] ?? "bg-muted text-muted-foreground",
        props.className,
      )}
    >
      {props.verb}
    </span>
  );
}

/**
 * The band under a chat window's header: its level, what it's for, the story it belongs to (or
 * the lead a helper works for), and Rigo's move here when there is one.
 */
export function ChatLevelBand(props: {
  readonly level: DeskLevel;
  readonly app: string | null;
  /** The story or fix this chat is on (leads, helpers, quick fixes). */
  readonly about?: string | null;
  /** What Rigo does here, from the chat's hand-off ("test 4 checks on its sheet"). */
  readonly move?: string | null;
  /** A helper's lead, to steer through. */
  readonly lead?: { readonly title: string; readonly onOpen: () => void } | null;
}) {
  const style = LEVELS[props.level];
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-b border-b-border px-3 py-1.5 text-xs",
        style.edge,
        style.soft,
      )}
    >
      <LevelMark level={props.level} className="bg-background/70" />
      {props.app ? (
        <span className="inline-flex items-center gap-1 font-medium">
          <AppDot app={props.app} />
          {props.app}
        </span>
      ) : null}
      {props.about ? <span className="min-w-0 truncate font-medium">{props.about}</span> : null}
      <span className="min-w-0 flex-1 basis-64 text-muted-foreground">
        {props.move ? (
          <b className="font-semibold text-foreground">Your move: {props.move}</b>
        ) : (
          style.purpose
        )}
      </span>
      {props.lead ? (
        <button
          type="button"
          onClick={props.lead.onOpen}
          className="cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Works for: {props.lead.title} ›
        </button>
      ) : null}
    </div>
  );
}
