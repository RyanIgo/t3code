import { PencilIcon } from "lucide-react";
import { useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { type DeskNote, type DeskNotes, noteAt } from "./deskNotes.logic";
import { saveDeskNote } from "./deskNotesStore";
import { DeskHeading } from "./DeskParts";

interface Section {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

const when = (note: DeskNote) =>
  new Date(note.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * Fleet fork: an application's direction (or the portfolio's), section by section, read as
 * formatted text and edited in place. Agents read the same sections through the dev-desk skill
 * and the Claude connector.
 */
export function DirectionPanel(props: {
  /** Application name, or ALL_APPS for the portfolio. */
  readonly app: string;
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
  readonly notes: DeskNotes;
}) {
  return (
    <section
      aria-label={props.title}
      className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4"
    >
      <h2 className="text-base font-semibold">{props.title}</h2>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
        {props.sections.map((section) => (
          <DirectionSection
            key={section.id}
            app={props.app}
            section={section}
            note={noteAt(props.notes, { kind: "direction", app: props.app, section: section.id })}
          />
        ))}
      </div>
    </section>
  );
}

function DirectionSection(props: {
  readonly app: string;
  readonly section: Section;
  readonly note: DeskNote | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = props.note?.text ?? "";
  const save = () => {
    if (draft !== null && draft !== text) {
      saveDeskNote({ kind: "direction", app: props.app, section: props.section.id }, draft);
    }
    setDraft(null);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <DeskHeading>{props.section.label}</DeskHeading>
        {props.note ? (
          <span className="text-2xs text-muted-foreground">
            {when(props.note)}
            {props.note.by ? ` · ${props.note.by}` : ""}
          </span>
        ) : null}
        {draft === null ? (
          <Button
            variant="ghost"
            size="xs"
            className="ms-auto"
            aria-label={`Edit ${props.section.label}`}
            onClick={() => setDraft(text)}
          >
            <PencilIcon />
            Edit
          </Button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={props.section.label}
            rows={Math.min(16, Math.max(5, draft.split("\n").length + 1))}
            placeholder={props.section.hint}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex gap-2">
            <Button size="xs" onClick={save}>
              Save
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : text ? (
        <div className="text-sm">
          <ChatMarkdown text={text} cwd={undefined} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{props.section.hint}</p>
      )}
    </div>
  );
}
