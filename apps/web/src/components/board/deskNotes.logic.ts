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

/** A T3 chat linked to part of the Desk: an app (and view), a sprint, one item, or a day. */
export interface DeskChatLink {
  /** Where on the Desk the chat came from, so its header can link back there. */
  readonly kind: "app" | "sprint" | "item" | "today";
  readonly view: "overview" | "board" | "sprint" | "prs" | null;
  readonly feature: string | null;
  readonly app: string | null;
  readonly sprint: string | null;
  readonly itemUrl: string | null;
  /** What the chat was started or linked about, in plain words. */
  readonly about: string;
  /** A Today chat's day (YYYY-MM-DD, local), fixed when it was started. */
  readonly day?: string;
  /** Set once the chat carries its dated title, so a later rename by hand sticks. */
  readonly titled?: boolean;
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
  /** A chat's thread id → the items it worked on, and its next step. Agents know only their thread id. */
  readonly work: Readonly<Record<string, DeskChatWork>>;
}

/** One stretch of a chat working on an item; `until` is null while it's still on it. */
export interface DeskFocusSpan {
  readonly url: string;
  readonly from: string;
  readonly until: string | null;
}

/** What one chat has worked on, newest last, and the next step it (or Rigo) wrote down. */
export interface DeskChatWork {
  readonly items: ReadonlyArray<DeskFocusSpan>;
  readonly next: string | null;
  readonly updatedAt: string;
}

/** A chat pinned to a place. Unpinning keeps the entry (pinned: false) so devices agree. */
export interface DeskPin {
  readonly pinned: boolean;
  readonly updatedAt: string;
  /** What the chat is for here, so several chats on one place stay easy to tell apart. */
  readonly role?: PinRole;
}

export const PIN_ROLES = ["planner", "development", "bugs", "feature", "other"] as const;
export type PinRole = (typeof PIN_ROLES)[number];
export const PIN_ROLE_LABEL: Record<PinRole, string> = {
  planner: "Planner",
  development: "Development",
  bugs: "Bug fixes",
  feature: "Feature",
  other: "Other",
};

/** Where a chat can be pinned on the Board. */
export type PinPlace =
  | { readonly kind: "today" }
  | { readonly kind: "app"; readonly app: string }
  | { readonly kind: "sprint"; readonly sprint: string; readonly app?: string | null }
  | { readonly kind: "item"; readonly url: string };

export function pinPlace(place: PinPlace): string {
  if (place.kind === "today") return "today";
  if (place.kind === "app") return `app:${place.app}`;
  if (place.kind === "sprint") return `sprint:${place.sprint}${place.app ? `@${place.app}` : ""}`;
  return `item:${place.url}`;
}

/** The chats pinned to a place: a planner first, then the most recently pinned. */
export function pinnedChats(notes: DeskNotes, place: PinPlace): string[] {
  return Object.entries(notes.pins[pinPlace(place)] ?? {})
    .filter(([, pin]) => pin.pinned)
    .sort(
      (a, b) =>
        Number(b[1].role === "planner") - Number(a[1].role === "planner") ||
        time(b[1]) - time(a[1]),
    )
    .map(([chatKey]) => chatKey);
}

export function pinAt(notes: DeskNotes, place: PinPlace, chatKey: string): DeskPin | null {
  return notes.pins[pinPlace(place)]?.[chatKey] ?? null;
}

/** Pins or unpins a chat at a place; a role given replaces the old one, otherwise it's kept. */
export function withPin(
  notes: DeskNotes,
  place: PinPlace,
  chatKey: string,
  pinned: boolean,
  at: string,
  role?: PinRole,
): DeskNotes {
  const key = pinPlace(place);
  const keptRole = role ?? notes.pins[key]?.[chatKey]?.role;
  const pin: DeskPin = { pinned, updatedAt: at, ...(keptRole ? { role: keptRole } : {}) };
  return { ...notes, pins: { ...notes.pins, [key]: { ...notes.pins[key], [chatKey]: pin } } };
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
        const role = PIN_ROLES.find((entry) => entry === pin.role);
        return [
          [
            chatKey,
            { pinned: pin.pinned, updatedAt: pin.updatedAt, ...(role ? { role } : {}) },
          ] as const,
        ];
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
  work: {},
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
            kind:
              link.kind === "sprint" || link.kind === "item" || link.kind === "today"
                ? link.kind
                : ("app" as const),
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
            ...(typeof link.day === "string" && DAY.test(link.day) ? { day: link.day } : {}),
            ...(link.titled === true ? { titled: true } : {}),
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
    work: readWork(record.work),
  };
}

const MAX_SPANS = 50;

function readWork(value: unknown): Record<string, DeskChatWork> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (typeof raw !== "object" || raw === null || !/^[\w-]{8,64}$/.test(key)) return [];
      const work = raw as Record<string, unknown>;
      if (typeof work.updatedAt !== "string") return [];
      const items = (Array.isArray(work.items) ? work.items : []).flatMap((span: unknown) => {
        if (typeof span !== "object" || span === null) return [];
        const entry = span as Record<string, unknown>;
        if (typeof entry.url !== "string" || !/^https:\/\/github\.com\//.test(entry.url)) return [];
        if (typeof entry.from !== "string") return [];
        return [
          {
            url: entry.url,
            from: entry.from,
            until: typeof entry.until === "string" ? entry.until : null,
          },
        ];
      });
      return [
        [
          key,
          {
            items: items.slice(-MAX_SPANS),
            next:
              typeof work.next === "string" && work.next.trim() ? work.next.slice(0, 500) : null,
            updatedAt: work.updatedAt,
          },
        ],
      ];
    }),
  );
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
    work: mergeNotes(remote.work, local.work),
  };
}

/** The chat (thread id) on an item now: the newest open stretch on it, across every chat. */
export function focusedChat(notes: DeskNotes, itemUrl: string): string | null {
  let found: { key: string; from: string } | null = null;
  for (const [key, work] of Object.entries(notes.work)) {
    for (const span of work.items) {
      if (span.url !== itemUrl || span.until !== null) continue;
      if (!found || span.from > found.from) found = { key, from: span.from };
    }
  }
  return found?.key ?? null;
}

/** The threads on an item now (normally one), for matching chats to it. */
export function focusedThreads(notes: DeskNotes, itemUrl: string | null): Set<string> {
  const threads = new Set<string>();
  if (!itemUrl) return threads;
  for (const [threadId, work] of Object.entries(notes.work)) {
    if (work.items.some((span) => span.url === itemUrl && span.until === null))
      threads.add(threadId);
  }
  return threads;
}

/** The item a chat (thread id) is on now, if any. */
export function chatFocus(notes: DeskNotes, threadId: string): string | null {
  return notes.work[threadId]?.items.findLast((span) => span.until === null)?.url ?? null;
}

/**
 * Puts a chat on an item (or takes the item's chat off it, with chatKey null). A chat works on
 * one item at a time, and an item has one chat on it, so both earlier stretches close.
 */
export function withFocus(
  notes: DeskNotes,
  itemUrl: string,
  chatKey: string | null,
  at: string,
): DeskNotes {
  const work = { ...notes.work };
  const close = (key: string, keep: (span: DeskFocusSpan) => boolean) => {
    const current = work[key];
    if (!current || !current.items.some((span) => span.until === null && !keep(span))) return;
    work[key] = {
      ...current,
      items: current.items.map((span) =>
        span.until === null && !keep(span) ? { ...span, until: at } : span,
      ),
      updatedAt: at,
    };
  };
  const previous = focusedChat(notes, itemUrl);
  if (previous && previous !== chatKey) close(previous, (span) => span.url !== itemUrl);
  if (chatKey) {
    if (chatFocus(notes, chatKey) === itemUrl) return notes;
    close(chatKey, () => false);
    const current = work[chatKey];
    work[chatKey] = {
      items: [...(current?.items ?? []), { url: itemUrl, from: at, until: null }].slice(-MAX_SPANS),
      next: current?.next ?? null,
      updatedAt: at,
    };
  }
  return { ...notes, work };
}

/** Sets the one line a chat's panel shows as its next step. */
export function withNextStep(
  notes: DeskNotes,
  chatKey: string,
  next: string | null,
  at: string,
): DeskNotes {
  const current = notes.work[chatKey];
  return {
    ...notes,
    work: {
      ...notes.work,
      [chatKey]: {
        items: current?.items ?? [],
        next: next?.trim() ? next.trim().slice(0, 500) : null,
        updatedAt: at,
      },
    },
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

/** A local day as YYYY-MM-DD, the key a Today chat is filed under. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A Today chat's title, dated the day it was started: "Today · Thu, Nov 19". */
export function todayChatTitle(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const label = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `Today · ${label}`;
}

/** The chat started as the Today chat for a day, if any (the newest when there are several). */
export function todayChatFor(notes: DeskNotes, day: string): string | null {
  let found: { key: string; at: string } | null = null;
  for (const [key, link] of Object.entries(notes.links)) {
    if (link.kind !== "today" || link.day !== day) continue;
    if (!found || link.updatedAt > found.at) found = { key, at: link.updatedAt };
  }
  return found?.key ?? null;
}

/** Today chats that still want their dated title. */
export function untitledTodayChats(notes: DeskNotes): Array<{ key: string; title: string }> {
  return Object.entries(notes.links).flatMap(([key, link]) =>
    link.kind === "today" && link.day && !link.titled
      ? [{ key, title: todayChatTitle(link.day) }]
      : [],
  );
}
