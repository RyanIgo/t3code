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
  readonly view: "overview" | "board" | "sprint" | "prs" | null;
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
  /** GitHub item URL → the hub test sheet made from its acceptance criteria. */
  readonly sheets: Readonly<Record<string, DeskSheet>>;
  /** Application name (or ALL_APPS for the whole portfolio) → direction section → its text. */
  readonly directions: Readonly<Record<string, Readonly<Record<string, DeskNote>>>>;
  /** Place on the Board (see pinPlace) → "<environmentId>:<threadId>" → whether it's pinned there. */
  readonly pins: Readonly<Record<string, Readonly<Record<string, DeskPin>>>>;
}

/** A chat pinned to a place. Unpinning keeps the entry (pinned: false) so devices agree. */
export interface DeskPin {
  readonly pinned: boolean;
  readonly updatedAt: string;
}

/** Where a chat can be pinned on the Board. */
export type PinPlace =
  | { readonly kind: "today" }
  | { readonly kind: "app"; readonly app: string }
  | { readonly kind: "sprint"; readonly sprint: string }
  | { readonly kind: "item"; readonly url: string };

export function pinPlace(place: PinPlace): string {
  if (place.kind === "today") return "today";
  if (place.kind === "app") return `app:${place.app}`;
  if (place.kind === "sprint") return `sprint:${place.sprint}`;
  return `item:${place.url}`;
}

/** The chats pinned to a place, most recently pinned first. */
export function pinnedChats(notes: DeskNotes, place: PinPlace): string[] {
  return Object.entries(notes.pins[pinPlace(place)] ?? {})
    .filter(([, pin]) => pin.pinned)
    .sort((a, b) => time(b[1]) - time(a[1]))
    .map(([chatKey]) => chatKey);
}

export function withPin(
  notes: DeskNotes,
  place: PinPlace,
  chatKey: string,
  pinned: boolean,
  at: string,
): DeskNotes {
  const key = pinPlace(place);
  return {
    ...notes,
    pins: { ...notes.pins, [key]: { ...notes.pins[key], [chatKey]: { pinned, updatedAt: at } } },
  };
}

function readPins(value: unknown): Record<string, Record<string, DeskPin>> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([place, chats]) => {
      if (!/^(today|app:.+|sprint:.+|item:https:\/\/github\.com\/.+)$/.test(place)) return [];
      if (typeof chats !== "object" || chats === null) return [];
      const entries = Object.entries(chats).flatMap(([chatKey, raw]) => {
        const pin = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
        if (!chatKey.includes(":") || typeof pin.pinned !== "boolean") return [];
        if (typeof pin.updatedAt !== "string") return [];
        return [[chatKey, { pinned: pin.pinned, updatedAt: pin.updatedAt }] as const];
      });
      return [[place, Object.fromEntries(entries)]];
    }),
  );
}

/** The directions key for what applies to every application. */
export const ALL_APPS = "*";

/** The sections of an application's direction, in reading order. */
export const APP_DIRECTION = [
  {
    id: "direction",
    label: "Direction",
    hint: "Who it's for, what it's meant to do, its priority, and whether it's a custom app or part of the Framework.",
  },
  { id: "arc", label: "The arc", hint: "Now, next, later." },
  { id: "goals", label: "Goals", hint: "2 to 5 outcomes, each with a date." },
  { id: "decisions", label: "Decisions", hint: "What's been decided, and when." },
  { id: "questions", label: "Open questions", hint: "What still needs a call." },
] as const;

/** The sections of the portfolio's direction, shown above every application. */
export const PORTFOLIO_DIRECTION = [
  { id: "arc", label: "The arc", hint: "The organizational goal every application serves." },
  {
    id: "principles",
    label: "Design principles",
    hint: "What decides trade-offs in every application.",
  },
  { id: "framework", label: "The Framework", hint: "The shared base the EMG companies can adopt." },
  { id: "loop", label: "How Rigo steers", hint: "What reaches Rigo, and the daily cycle." },
] as const;

export interface DeskSheet {
  readonly id: string;
  readonly updatedAt: string;
}

export const EMPTY_DESK_NOTES: DeskNotes = {
  schemaVersion: 1,
  apps: {},
  sprintGoals: {},
  sprintNotes: {},
  links: {},
  sheets: {},
  directions: {},
  pins: {},
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
              link.view === "overview" ||
              link.view === "board" ||
              link.view === "sprint" ||
              link.view === "prs"
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

function readSheets(value: unknown): Record<string, DeskSheet> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([url, raw]) => {
      const sheet = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      if (!/^https:\/\/github\.com\//.test(url)) return [];
      if (typeof sheet.id !== "string" || !/^[a-z0-9]{12}$/.test(sheet.id)) return [];
      if (typeof sheet.updatedAt !== "string") return [];
      return [[url, { id: sheet.id, updatedAt: sheet.updatedAt }]];
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
    sheets: readSheets(record.sheets),
    directions: Object.fromEntries(
      Object.entries(
        typeof record.directions === "object" && record.directions !== null
          ? record.directions
          : {},
      ).map(([app, sections]) => [app, readNotes(sections)]),
    ),
    pins: readPins(record.pins),
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
    sheets: mergeNotes(remote.sheets, local.sheets),
    directions: Object.fromEntries(
      [...new Set([...Object.keys(local.directions), ...Object.keys(remote.directions)])].map(
        (app) => [app, mergeNotes(remote.directions[app] ?? {}, local.directions[app] ?? {})],
      ),
    ),
    pins: Object.fromEntries(
      [...new Set([...Object.keys(local.pins), ...Object.keys(remote.pins)])].map((place) => [
        place,
        mergeNotes(remote.pins[place] ?? {}, local.pins[place] ?? {}),
      ]),
    ),
  };
}

/** Links (or relinks) a chat to part of the Desk. */
export function withLink(notes: DeskNotes, chatKey: string, link: DeskChatLink): DeskNotes {
  return { ...notes, links: { ...notes.links, [chatKey]: link } };
}

export function withSheet(notes: DeskNotes, itemUrl: string, sheet: DeskSheet): DeskNotes {
  return { ...notes, sheets: { ...notes.sheets, [itemUrl]: sheet } };
}

export type DeskNoteTarget =
  | { readonly kind: "app"; readonly app: string }
  | { readonly kind: "sprintGoal"; readonly sprint: string; readonly app: string }
  | { readonly kind: "sprintNotes"; readonly sprint: string }
  | { readonly kind: "direction"; readonly app: string; readonly section: string };

export function noteAt(notes: DeskNotes, target: DeskNoteTarget): DeskNote | null {
  if (target.kind === "app") return notes.apps[target.app] ?? null;
  if (target.kind === "sprintNotes") return notes.sprintNotes[target.sprint] ?? null;
  if (target.kind === "direction") return notes.directions[target.app]?.[target.section] ?? null;
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
  if (target.kind === "direction") {
    return {
      ...notes,
      directions: {
        ...notes.directions,
        [target.app]: { ...notes.directions[target.app], [target.section]: note },
      },
    };
  }
  return {
    ...notes,
    sprintGoals: {
      ...notes.sprintGoals,
      [target.sprint]: { ...notes.sprintGoals[target.sprint], [target.app]: note },
    },
  };
}
