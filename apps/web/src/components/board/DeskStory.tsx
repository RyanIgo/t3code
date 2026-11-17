import { CheckIcon, CircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { type DeskItem, storyProgress } from "./desk.logic";
import { DeskHeading, openExternal } from "./DeskParts";
import { publishStorySheet, useDeskNotes } from "./deskNotesStore";

interface SheetCounts {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly blocked: number;
}

const sheetUrl = (id: string) => new URL(`/a/${id}`, window.location.origin).toString();

/**
 * Fleet fork: a story's "As… I can… so that…" and its acceptance criteria, with the hub test
 * sheet made from them (one row per criterion) and how far that sheet has got.
 */
export function StorySection(props: { readonly item: DeskItem }) {
  const { item } = props;
  const notes = useDeskNotes();
  const sheet = item.url ? notes.notes.sheets[item.url] : undefined;
  const [counts, setCounts] = useState<SheetCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const sheetId = sheet?.id ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the sheet's results from the hub when it is shown
  useEffect(() => {
    if (!sheetId) return;
    let live = true;
    fetch(`/fleet/artifacts/${sheetId}`, { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (body: { counts?: SheetCounts } | null) => live && setCounts(body?.counts ?? null),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [sheetId]);
  if (!item.story) return null;
  const criteria = item.story.criteria;

  const makeSheet = async () => {
    setBusy(true);
    try {
      const id = await publishStorySheet(item);
      openExternal(sheetUrl(id));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Couldn't make the test sheet",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <DeskHeading>User story</DeskHeading>
        {storyProgress(item) ? (
          <Badge variant="info" size="sm">
            {storyProgress(item)}
          </Badge>
        ) : null}
      </div>
      {item.story.text ? <p className="whitespace-pre-line">{item.story.text}</p> : null}
      {criteria.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {criteria.map((criterion) => (
            <li key={criterion.text} className="flex items-start gap-2">
              {criterion.done ? (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className={criterion.done ? "text-muted-foreground" : undefined}>
                {criterion.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {criteria.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {sheet ? (
            <>
              <Button size="xs" variant="outline" onClick={() => openExternal(sheetUrl(sheet.id))}>
                Open test sheet
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void makeSheet()}>
                Update rows from the criteria
              </Button>
              {counts ? (
                <span className="text-xs text-muted-foreground">
                  {counts.pass} passed · {counts.fail} failed · {counts.blocked} blocked of{" "}
                  {counts.total}
                </span>
              ) : null}
            </>
          ) : (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void makeSheet()}>
              Make test sheet
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
