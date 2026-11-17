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

/** A T3 chat linked to part of the Desk: an app (and view), a sprint, or one item. */
export interface DeskChatLink {
  /** Where on the Desk the chat came from, so its header can link back there. */
  readonly kind: "app" | "sprint" | "item";
  readonly view: "overview" | "board" | "sprint" | null;
  readonly feature: string | null;
  readonly app: string | null;
  readonly sprint: string | null;
  readonly itemUrl: string | null;
  /** What the chat was started or linked about, in plain words. */
  readonly about: string;
  readonly updatedAt: string;
}

export interface DeskNotes {
  readonly schemaVersion: 1;
  /** Notes for agents, by application name. */
  readonly apps: Readonly<Record<string, DeskNote>>;
  /** Sprint title → application name → that application's goal for the sprint. */
  readonly sprintGoals: Readonly<Record<string, Readonly<Record<string, DeskNote>>>>;
  /** Sprint title → notes for the whole sprint. */
  readonly sprintNotes: Readonly<Record<string, DeskNote>>;
  /** "<environmentId>:<threadId>" → what that chat is linked to. */
  readonly links: Readonly<Record<string, DeskChatLink>>;
}

export const EMPTY_DESK_NOTES: DeskNotes = {
  schemaVersion: 1,
  apps: {},
  sprintGoals: {},
  sprintNotes: {},
  links: {},
};

const MAX_NOTE = 20_000;
const time = (note: { readonly updatedAt: string } | undefined) =>
  note ? Date.parse(note.updatedAt) || 0 : 0;

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

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function readLinks(value: unknown): Record<string, DeskChatLink> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (typeof raw !== "object" || raw === null || !key.includes(":")) return [];
      const link = raw as Record<string, unknown>;
      if (typeof link.updatedAt !== "string") return [];
      const itemUrl = text(link.itemUrl);
      return [
        [
          key,
          {
            kind: link.kind === "sprint" || link.kind === "item" ? link.kind : ("app" as const),
            view:
              link.view === "overview" || link.view === "board" || link.view === "sprint"
                ? link.view
                : null,
            feature: text(link.feature),
            app: text(link.app),
            sprint: text(link.sprint),
            itemUrl: itemUrl && /^https:\/\/github\.com\//.test(itemUrl) ? itemUrl : null,
            about: (text(link.about) ?? "").slice(0, 300),
            updatedAt: link.updatedAt,
          },
        ],
      ];
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
    links: readLinks(record.links),
  };
}

function mergeNotes<T extends { readonly updatedAt: string }>(
  a: Readonly<Record<string, T>>,
  b: Readonly<Record<string, T>>,
): Record<string, T> {
  const merged: Record<string, T> = { ...a };
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
    links: mergeNotes(remote.links, local.links),
  };
}

/** Links (or relinks) a chat to part of the Desk. */
export function withLink(notes: DeskNotes, chatKey: string, link: DeskChatLink): DeskNotes {
  return { ...notes, links: { ...notes.links, [chatKey]: link } };
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
