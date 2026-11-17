/**
 * Fleet fork: notes that keep conversations about an application on track. Each application has
 * notes for agents (goals, decisions, conventions); each sprint has notes and a goal per
 * application. Stored on the fleet hub as one document; agents read and add to it with the
 * dev-desk skill's script. Pure logic only.
 */
export interface DeskNote {
  readonly text: string;
  readonly updatedAt: string;
  readonly by: string | null;
}

export interface DeskNotes {
  readonly schemaVersion: 1;
  /** Notes for agents, by application name. */
  readonly apps: Readonly<Record<string, DeskNote>>;
  /** Sprint title → application name → that application's goal for the sprint. */
  readonly sprintGoals: Readonly<Record<string, Readonly<Record<string, DeskNote>>>>;
  /** Sprint title → notes for the whole sprint. */
  readonly sprintNotes: Readonly<Record<string, DeskNote>>;
}

export const EMPTY_DESK_NOTES: DeskNotes = {
  schemaVersion: 1,
  apps: {},
  sprintGoals: {},
  sprintNotes: {},
};

const MAX_NOTE = 20_000;
const time = (note: DeskNote | undefined) => (note ? Date.parse(note.updatedAt) || 0 : 0);

function readNote(value: unknown): DeskNote | null {
  if (typeof value !== "object" || value === null) return null;
  const note = value as Record<string, unknown>;
  if (typeof note.text !== "string" || typeof note.updatedAt !== "string") return null;
  return {
    text: note.text.slice(0, MAX_NOTE),
    updatedAt: note.updatedAt,
    by: typeof note.by === "string" ? note.by : null,
  };
}

function readNotes(value: unknown): Record<string, DeskNote> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, note]) => {
      const parsed = readNote(note);
      return parsed ? [[key, parsed]] : [];
    }),
  );
}

/** Reads a stored notes document, dropping anything malformed. */
export function parseDeskNotes(raw: string | null): DeskNotes {
  if (!raw) return EMPTY_DESK_NOTES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_DESK_NOTES;
  }
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const goals =
    typeof record.sprintGoals === "object" && record.sprintGoals !== null ? record.sprintGoals : {};
  return {
    schemaVersion: 1,
    apps: readNotes(record.apps),
    sprintGoals: Object.fromEntries(
      Object.entries(goals).map(([sprint, byApp]) => [sprint, readNotes(byApp)]),
    ),
    sprintNotes: readNotes(record.sprintNotes),
  };
}

function mergeNotes(
  a: Readonly<Record<string, DeskNote>>,
  b: Readonly<Record<string, DeskNote>>,
): Record<string, DeskNote> {
  const merged: Record<string, DeskNote> = { ...a };
  for (const [key, note] of Object.entries(b)) {
    if (time(note) >= time(merged[key])) merged[key] = note;
  }
  return merged;
}

/** Two devices' notes together: each note keeps its newer edit. */
export function mergeDeskNotes(local: DeskNotes, remote: DeskNotes): DeskNotes {
  const sprints = new Set([...Object.keys(local.sprintGoals), ...Object.keys(remote.sprintGoals)]);
  return {
    schemaVersion: 1,
    apps: mergeNotes(remote.apps, local.apps),
    sprintGoals: Object.fromEntries(
      [...sprints].map((sprint) => [
        sprint,
        mergeNotes(remote.sprintGoals[sprint] ?? {}, local.sprintGoals[sprint] ?? {}),
      ]),
    ),
    sprintNotes: mergeNotes(remote.sprintNotes, local.sprintNotes),
  };
}

export type DeskNoteTarget =
  | { readonly kind: "app"; readonly app: string }
  | { readonly kind: "sprintGoal"; readonly sprint: string; readonly app: string }
  | { readonly kind: "sprintNotes"; readonly sprint: string };

export function noteAt(notes: DeskNotes, target: DeskNoteTarget): DeskNote | null {
  if (target.kind === "app") return notes.apps[target.app] ?? null;
  if (target.kind === "sprintNotes") return notes.sprintNotes[target.sprint] ?? null;
  return notes.sprintGoals[target.sprint]?.[target.app] ?? null;
}

export function withNote(
  notes: DeskNotes,
  target: DeskNoteTarget,
  text: string,
  at: string,
  by: string | null,
): DeskNotes {
  const note: DeskNote = { text: text.slice(0, MAX_NOTE), updatedAt: at, by };
  if (target.kind === "app") return { ...notes, apps: { ...notes.apps, [target.app]: note } };
  if (target.kind === "sprintNotes") {
    return { ...notes, sprintNotes: { ...notes.sprintNotes, [target.sprint]: note } };
  }
  return {
    ...notes,
    sprintGoals: {
      ...notes.sprintGoals,
      [target.sprint]: { ...notes.sprintGoals[target.sprint], [target.app]: note },
    },
  };
}
