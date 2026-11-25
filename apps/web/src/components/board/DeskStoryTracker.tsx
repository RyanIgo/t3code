/**
 * Fleet fork: a story at a glance, in bullets (Rigo, 2026-11-24: "a simpler way to keep track of
 * the story; I prefer bullet points over narratives"). The stage strip, then one bullet each for
 * his move, the pieces, the PRs, the test sheet, the acceptance criteria and who's on it.
 */
import { cn } from "../../lib/utils";
import type { CardChatState } from "./boardCards.logic";
import { chatTitle, type DeskDetail, type DeskItem } from "./desk.logic";
import { type SheetSummary, sheetTurn, uncheckedRows } from "./deskSheets";
import { isShipped } from "./wrapUp.logic";

const STEPS = ["Planned", "Build", "Test", "Merge", "Wrap up"] as const;
type Step = (typeof STEPS)[number];
const HANDOFF = /^\s*(?:rigo|you)\s*[:\-–—]\s*/i;

function stepOf(item: DeskItem, sheet: SheetSummary | null, openPrs: number): Step {
  if (isShipped(item)) return "Wrap up";
  if (sheet && sheetTurn(sheet) !== "clean") return "Test";
  if (openPrs > 0 && (!sheet || sheetTurn(sheet) === "clean") && item.status === "In Review")
    return "Merge";
  if (openPrs > 0 || item.status === "In Progress" || item.status === "In Review") return "Build";
  return "Planned";
}

export function StoryTracker(props: {
  readonly item: DeskItem;
  readonly detail: DeskDetail | null;
  readonly sheets: ReadonlyArray<SheetSummary>;
  readonly lead: CardChatState | null;
  readonly helpers: ReadonlyArray<CardChatState>;
  /** The lead's next step as it wrote it. */
  readonly next: string | null;
}) {
  const { item, detail } = props;
  const sheet =
    props.sheets.find((entry) => sheetTurn(entry) !== "clean") ?? props.sheets[0] ?? null;
  const openPrs = item.pullRequests.filter((pr) => pr.state === "open" || pr.state === "draft");
  const step = stepOf(item, sheet, openPrs.length);
  const pieces = detail?.subIssues ?? [];
  const piecesDone = pieces.filter((piece) => piece.state === "closed").length;
  const criteria = item.story?.criteria ?? [];
  const move = props.next && HANDOFF.test(props.next) ? props.next.replace(HANDOFF, "") : null;
  const sheetLine = sheet
    ? (() => {
        const { total, pass, fail } = sheet.counts;
        const left = uncheckedRows(sheet.counts);
        const turn = sheetTurn(sheet);
        return `${pass} of ${total} passed${fail ? ` · ${fail} failed` : ""}${left ? ` · ${left} left` : ""}${turn === "agent" ? " · sent; lead is fixing" : ""}`;
      })()
    : "none yet";
  const bullets: ReadonlyArray<readonly [string, string | null]> = [
    [
      "Your move",
      move ?? (step === "Test" && sheet && sheetTurn(sheet) !== "agent" ? "test the sheet" : null),
    ],
    ["Next (lead)", move ? null : props.next?.trim() || null],
    [
      "Pieces",
      pieces.length
        ? `${piecesDone} of ${pieces.length} done · ${pieces
            .map((piece) => `${piece.state === "closed" ? "✓" : "○"} #${piece.number}`)
            .join("  ")}`
        : detail
          ? "none linked"
          : null,
    ],
    [
      "PRs",
      item.pullRequests.length
        ? item.pullRequests.map((pr) => `#${pr.number} ${pr.state}`).join(" · ")
        : "none yet",
    ],
    ["Test sheet", sheetLine],
    [
      "Criteria",
      criteria.length
        ? `${criteria.filter((entry) => entry.done).length} of ${criteria.length} ticked`
        : null,
    ],
    [
      "On it",
      props.lead
        ? `${chatTitle(props.lead.title)} (${props.lead.working ? "working" : "idle"})${props.helpers.length ? ` · ${props.helpers.length} ${props.helpers.length === 1 ? "helper" : "helpers"}` : ""}`
        : "no lead yet",
    ],
  ];
  return (
    <section
      aria-label="Story at a glance"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <ol className="flex flex-wrap text-2xs">
        {STEPS.map((name) => {
          const done = STEPS.indexOf(name) < STEPS.indexOf(step);
          return (
            <li
              key={name}
              className={cn(
                "-me-px flex-1 border border-border px-2 py-1 text-center",
                done && "bg-success/10 text-muted-foreground",
                name === step && "border-warning bg-warning/12 font-semibold",
              )}
            >
              {done ? "✓ " : ""}
              {name}
            </li>
          );
        })}
      </ol>
      <ul className="flex flex-col gap-1 text-sm">
        {bullets.map(([label, value]) =>
          value ? (
            <li key={label} className="flex gap-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
              <span className={cn("min-w-0", label === "Your move" && "font-semibold")}>
                {value}
              </span>
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}
