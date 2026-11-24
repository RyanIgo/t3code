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
  /** Quick notes from email, meetings and hallway asks, waiting to be sorted into the work. */
  readonly inbox: Readonly<Record<string, InboxNote>>;
  /** Sprint title → app → Rigo's big picture for that app's sprint, which its planner works from. */
  readonly framing: Readonly<Record<string, Readonly<Record<string, DeskNote>>>>;
  /** Questions planners put to Rigo, answered in the Plan pane, on Now or on the phone. */
  readonly decisions: Readonly<Record<string, PlannerDecision>>;
}

/** A question a planner puts to Rigo, with its options and the one it recommends. */
export interface PlannerDecision {
  readonly id: string;
  /** The planner's thread id: its answer goes back to that chat. */
  readonly threadId: string;
  readonly app: string | null;
  readonly question: string;
  readonly why: string | null;
  readonly options: ReadonlyArray<string>;
  readonly recommended: string | null;
  readonly itemUrl: string | null;
  /** The items, PRs, sheets and chats it's about, shown with their live state. */
  readonly links: ReadonlyArray<string>;
  /** Background in plain words: what this is, why now, what Rigo is agreeing to. Markdown. */
  readonly context: string | null;
  /** Per option: what happens if Rigo picks it, and whether it can be undone. */
  readonly outcomes: ReadonlyArray<{
    readonly option: string;
    readonly effect: string;
    readonly undoable: boolean;
  }>;
  /** A proposed sprint goal: answering it sets that sprint's goal for the app. */
  readonly goalFor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly answer: {
    readonly choice: string;
    readonly note: string | null;
    readonly at: string;
  } | null;
}

/** One line of a planner's checklist: what it is, who it's on, and whether it's done. */
export interface PlanLine {
  readonly text: string;
  /** "you" (Rigo), "agents", or a person or team. */
  readonly who: string;
  readonly done: boolean;
  readonly itemUrl: string | null;
  /** For Rigo's lines: why it matters, how to do it (markdown steps) and where. */
  readonly why?: string | null;
  readonly how?: string | null;
  readonly links?: ReadonlyArray<string>;
  /** Rigo's questions about the line and the planner's answers, oldest first. */
  readonly qa?: ReadonlyArray<PlanQuestion>;
  /** When the line first appeared on the checklist. */
  readonly since?: string | null;
}

export interface PlanQuestion {
  readonly q: string;
  readonly at: string;
  /** null until the planner answers (desk.mjs plan answer). */
  readonly a: string | null;
  readonly answeredAt: string | null;
}

export const INBOX_SOURCES = [
  "In person",
  "User session",
  "Email",
  "Teams",
  "Call",
  "Other",
  // Rigo's notes on the Board itself, kept for the next fix batch rather than triaged.
  "Board feedback",
] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];
const INBOX_ACTIONS = ["comment", "new", "planner", "chat", "dismiss"] as const;
export type InboxAction = (typeof INBOX_ACTIONS)[number];

/** Where a triage agent (or Rigo) thinks a note belongs. Nothing happens until it's approved. */
export interface InboxProposal {
  readonly action: InboxAction;
  /** For "comment": the item the note adds to. */
  readonly itemUrl: string | null;
  /** For "new": where it's filed and how. */
  readonly repo: string | null;
  readonly app: string | null;
  readonly type: string | null;
  readonly priority: string | null;
  readonly title: string | null;
  /** For "new": a sprint to put it in; null leaves it in the Backlog. */
  readonly sprint?: string | null;
  /** A chat ("<environmentId>:<threadId>") that also gets the note, or the only place it goes. */
  readonly chat?: string | null;
  /** For "new": its feature (without the app), user story and acceptance criteria. */
  readonly feature?: string | null;
  readonly story?: string | null;
  readonly criteria?: ReadonlyArray<string>;
  /** One plain sentence on why. */
  readonly reason: string;
}

export interface InboxNote {
  readonly id: string;
  readonly text: string;
  readonly source: InboxSource;
  /** Who raised it. */
  readonly who: string | null;
  /** The app it's about, when Rigo said. */
  readonly app: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** "new" waits for triage; "proposed" waits for Rigo; the rest are sorted. */
  readonly state: "new" | "proposed" | "filed" | "planner" | "dismissed";
  readonly proposal: InboxProposal | null;
  /** What it became: the issue or comment, or the planner it went to. */
  readonly result: { readonly url: string | null; readonly label: string } | null;
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
  /** The chat's level: the day's chat, an app's planner, one item's work chat, or a helper. */
  readonly role?: ChatRole;
  /** The app a planner plans (or a work chat or helper belongs to). */
  readonly app?: string | null;
  /** A helper's parent chat (thread id), whose questions and results it goes through. */
  readonly parent?: string | null;
  /** A planner's checklist, kept current by the planner each turn. */
  readonly plan?: ReadonlyArray<PlanLine>;
  /** The sprint a planner runs; each sprint gets a new planner. */
  readonly sprint?: string | null;
  /** A work chat's or helper's last turn, recorded for its planner; sentAt once delivered. */
  readonly report?: { readonly at: string; readonly text: string; readonly sentAt: string | null };
  /** When a planner last rewrote its checklist. */
  readonly planAt?: string | null;
  /** When a planner last got its chats' reports. */
  readonly updatesSentAt?: string | null;
  readonly updatedAt: string;
}

export const CHAT_ROLES = ["today", "planner", "work", "helper"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];
export const CHAT_ROLE_LABEL: Record<ChatRole, string> = {
  today: "Today",
  planner: "Planner",
  work: "Work",
  helper: "Helper",
};

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
  inbox: {},
  framing: {},
  decisions: {},
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
    inbox: readInbox(record.inbox),
    framing: Object.fromEntries(
      Object.entries(
        typeof record.framing === "object" && record.framing !== null ? record.framing : {},
      ).map(([sprint, byApp]) => [sprint, readNotes(byApp)]),
    ),
    decisions: readDecisions(record.decisions),
  };
}

function readDecisions(value: unknown): Record<string, PlannerDecision> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, raw]) => {
      if (typeof raw !== "object" || raw === null || !/^[\w-]{4,40}$/.test(id)) return [];
      const entry = raw as Record<string, unknown>;
      const question = short(entry.question, 500);
      const threadId = typeof entry.threadId === "string" ? entry.threadId : null;
      if (
        !question ||
        !threadId ||
        typeof entry.createdAt !== "string" ||
        typeof entry.updatedAt !== "string"
      ) {
        return [];
      }
      const options = (Array.isArray(entry.options) ? entry.options : [])
        .flatMap((option) =>
          typeof option === "string" && option.trim() ? [option.trim().slice(0, 80)] : [],
        )
        .slice(0, 6);
      const answer =
        typeof entry.answer === "object" && entry.answer !== null
          ? (entry.answer as Record<string, unknown>)
          : null;
      return [
        [
          id,
          {
            id,
            threadId,
            app: short(entry.app, 120),
            question,
            why: short(entry.why, 1000),
            options: options.length > 0 ? options : ["Yes", "No"],
            recommended: short(entry.recommended, 80),
            itemUrl: githubUrl(entry.itemUrl),
            context: short(entry.context, 4000),
            links: (Array.isArray(entry.links) ? entry.links : [])
              .flatMap((link) =>
                typeof link === "string" && /^https:\/\/[^\s]+$/.test(link) ? [link] : [],
              )
              .slice(0, 12),
            outcomes: (Array.isArray(entry.outcomes) ? entry.outcomes : []).flatMap(
              (raw: unknown) => {
                if (typeof raw !== "object" || raw === null) return [];
                const outcome = raw as Record<string, unknown>;
                const option = short(outcome.option, 80);
                const effect = short(outcome.effect, 500);
                return option && effect
                  ? [{ option, effect, undoable: outcome.undoable !== false }]
                  : [];
              },
            ),
            goalFor: short(entry.goalFor, 80),
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            answer:
              answer && typeof answer.choice === "string" && typeof answer.at === "string"
                ? {
                    choice: answer.choice.slice(0, 80),
                    note: short(answer.note, 1000),
                    at: answer.at,
                  }
                : null,
          },
        ],
      ];
    }),
  );
}

/** A chat's last turn report, spread into its work entry (nothing when there's none). */
function readReport(value: unknown): Pick<DeskChatWork, "report"> {
  if (typeof value !== "object" || value === null) return {};
  const report = value as Record<string, unknown>;
  const text = short(report.text, 1000);
  if (typeof report.at !== "string" || !text) return {};
  return {
    report: {
      at: report.at,
      text,
      sentAt: typeof report.sentAt === "string" ? report.sentAt : null,
    },
  };
}

function readPlan(value: unknown): PlanLine[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .flatMap((raw: unknown) => {
      if (typeof raw !== "object" || raw === null) return [];
      const line = raw as Record<string, unknown>;
      const text = short(line.text, 300);
      if (!text) return [];
      return [
        {
          text,
          who: short(line.who, 40) ?? "agents",
          done: line.done === true,
          since: typeof line.since === "string" ? line.since : null,
          itemUrl: githubUrl(line.itemUrl ?? line.item),
          why: short(line.why, 600),
          how: short(line.how, 3000),
          links: (Array.isArray(line.links) ? line.links : [])
            .flatMap((link: unknown) =>
              typeof link === "string" && /^https:\/\/[^\s]+$/.test(link) ? [link] : [],
            )
            .slice(0, 8),
          qa: (Array.isArray(line.qa) ? line.qa : [])
            .flatMap((raw: unknown) => {
              if (typeof raw !== "object" || raw === null) return [];
              const entry = raw as Record<string, unknown>;
              const q = short(entry.q, 4000);
              if (!q || typeof entry.at !== "string") return [];
              return [
                {
                  q,
                  at: entry.at,
                  a: short(entry.a, 4000),
                  answeredAt: typeof entry.answeredAt === "string" ? entry.answeredAt : null,
                },
              ];
            })
            .slice(-20),
        },
      ];
    })
    .slice(0, 40);
}

/** A planner's open questions for an app (or every app), oldest first. */
export function openDecisions(notes: DeskNotes, app: string | null = null): PlannerDecision[] {
  return Object.values(notes.decisions)
    .filter((decision) => decision.answer === null && (app === null || decision.app === app))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The goal in a proposed-goal question, when the planner wrapped it ("Set the goal: '…'"). */
export function goalOf(question: string): string {
  return question.match(/:\s*['"“‘](.+?)['"”’]?\s*$/s)?.[1]?.trim() ?? question.trim();
}

/** A planner's line that's on Rigo and still open, with the planner and app it came from. */
export interface PlannerTodo {
  readonly threadId: string;
  readonly app: string | null;
  readonly line: PlanLine;
}

/** The open "you" lines of every planner (or one app's), the planner's order kept. */
export function plannerTodos(notes: DeskNotes, app: string | null = null): PlannerTodo[] {
  return Object.entries(notes.work).flatMap(([threadId, work]) =>
    work.role === "planner" && (app === null || work.app === app)
      ? (work.plan ?? [])
          .filter((line) => line.who === "you" && !line.done)
          .map((line) => ({ threadId, app: work.app ?? null, line }))
      : [],
  );
}

/** The planner a chat reports to: a helper's parent (or its parent's planner), else its app's newest planner. */
function plannerFor(
  notes: DeskNotes,
  threadId: string,
  appOfUrl: (url: string) => string | null,
  seen: ReadonlySet<string> = new Set(),
): string | null {
  const work = notes.work[threadId];
  if (!work || seen.has(threadId)) return null;
  if (work.role === "helper" && work.parent) {
    if (notes.work[work.parent]?.role === "planner") return work.parent;
    return plannerFor(notes, work.parent, appOfUrl, new Set([...seen, threadId]));
  }
  const open = work.items.findLast((span) => span.until === null);
  const app = work.app ?? (open ? appOfUrl(open.url) : null);
  if (!app) return null;
  return (
    Object.entries(notes.work)
      .filter(([, entry]) => entry.role === "planner" && entry.app === app)
      .toSorted(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))[0]?.[0] ?? null
  );
}

/** Each planner's reports from its chats that haven't reached it yet, oldest first. */
export function waitingReports(
  notes: DeskNotes,
  appOfUrl: (url: string) => string | null,
): Map<string, Array<{ readonly threadId: string; readonly work: DeskChatWork }>> {
  const out = new Map<string, Array<{ readonly threadId: string; readonly work: DeskChatWork }>>();
  for (const [threadId, work] of Object.entries(notes.work)) {
    if (!work.report || work.report.sentAt) continue;
    const planner = plannerFor(notes, threadId, appOfUrl);
    if (!planner) continue;
    out.set(planner, [...(out.get(planner) ?? []), { threadId, work }]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.work.report?.at ?? "").localeCompare(b.work.report?.at ?? ""));
  }
  return out;
}

/** Marks reports delivered to a planner. */
export function withReportsSent(
  notes: DeskNotes,
  plannerId: string,
  threadIds: ReadonlyArray<string>,
  at: string,
): DeskNotes {
  const work = { ...notes.work };
  for (const id of threadIds) {
    const entry = work[id];
    if (entry?.report)
      work[id] = { ...entry, report: { ...entry.report, sentAt: at }, updatedAt: at };
  }
  const planner = work[plannerId];
  if (planner) work[plannerId] = { ...planner, updatesSentAt: at, updatedAt: at };
  return { ...notes, work };
}

/** Adds Rigo's question to a planner's line (matched by its text); the planner answers on it. */
export function withPlanLineQuestion(
  notes: DeskNotes,
  threadId: string,
  text: string,
  question: string,
  at: string,
): DeskNotes {
  const work = notes.work[threadId];
  if (!work?.plan?.some((line) => line.text === text) || !question.trim()) return notes;
  return {
    ...notes,
    work: {
      ...notes.work,
      [threadId]: {
        ...work,
        plan: work.plan.map((line) =>
          line.text === text
            ? {
                ...line,
                qa: [...(line.qa ?? []), { q: question.trim(), at, a: null, answeredAt: null }],
              }
            : line,
        ),
        updatedAt: at,
      },
    },
  };
}

/** Ticks a planner's checklist line (matched by its text) done. */
export function withPlanLineDone(
  notes: DeskNotes,
  threadId: string,
  text: string,
  at: string,
): DeskNotes {
  const work = notes.work[threadId];
  if (!work?.plan?.some((line) => line.text === text)) return notes;
  return {
    ...notes,
    work: {
      ...notes.work,
      [threadId]: {
        ...work,
        plan: work.plan.map((line) => (line.text === text ? { ...line, done: true } : line)),
        updatedAt: at,
      },
    },
  };
}

/** Records Rigo's answer to a planner's question. */
export function withDecisionAnswer(
  notes: DeskNotes,
  id: string,
  choice: string,
  note: string | null,
  at: string,
): DeskNotes {
  const decision = notes.decisions[id];
  if (!decision) return notes;
  return {
    ...notes,
    decisions: {
      ...notes.decisions,
      [id]: {
        ...decision,
        answer: { choice, note: note?.trim() ? note.trim().slice(0, 1000) : null, at },
        updatedAt: at,
      },
    },
  };
}

const githubUrl = (value: unknown) =>
  typeof value === "string" && /^https:\/\/github\.com\//.test(value) ? value : null;
const short = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function readProposal(value: unknown): InboxProposal | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const action = INBOX_ACTIONS.find((entry) => entry === raw.action);
  if (!action) return null;
  return {
    action,
    itemUrl: githubUrl(raw.itemUrl),
    repo: typeof raw.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(raw.repo) ? raw.repo : null,
    app: short(raw.app, 120),
    type: short(raw.type, 40),
    priority: short(raw.priority, 10),
    title: short(raw.title, 200),
    sprint: short(raw.sprint, 80),
    chat: typeof raw.chat === "string" && /^[\w-]+:[\w-]+$/.test(raw.chat) ? raw.chat : null,
    feature: short(raw.feature, 120),
    story: short(raw.story, 1000),
    criteria: (Array.isArray(raw.criteria) ? raw.criteria : [])
      .flatMap((entry: unknown) =>
        typeof entry === "string" && entry.trim() ? [entry.trim().slice(0, 300)] : [],
      )
      .slice(0, 12),
    reason: short(raw.reason, 500) ?? "",
  };
}

function readInbox(value: unknown): Record<string, InboxNote> {
  if (typeof value !== "object" || value === null) return {};
  const states = ["new", "proposed", "filed", "planner", "dismissed"] as const;
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, raw]) => {
      if (typeof raw !== "object" || raw === null || !/^[\w-]{4,40}$/.test(id)) return [];
      const note = raw as Record<string, unknown>;
      const text = short(note.text, 4000);
      if (!text || typeof note.createdAt !== "string" || typeof note.updatedAt !== "string") {
        return [];
      }
      const result =
        typeof note.result === "object" && note.result !== null
          ? (note.result as Record<string, unknown>)
          : null;
      return [
        [
          id,
          {
            id,
            text,
            source: INBOX_SOURCES.find((entry) => entry === note.source) ?? "Other",
            who: short(note.who, 120),
            app: short(note.app, 120),
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            state: states.find((entry) => entry === note.state) ?? "new",
            proposal: readProposal(note.proposal),
            result: result
              ? { url: githubUrl(result.url), label: short(result.label, 200) ?? "" }
              : null,
          },
        ],
      ];
    }),
  );
}

/** Adds or replaces an inbox note. */
export function withInboxNote(notes: DeskNotes, note: InboxNote): DeskNotes {
  return { ...notes, inbox: { ...notes.inbox, [note.id]: note } };
}

/** Notes still to sort: waiting for triage, then waiting for Rigo, oldest first. */
export function inboxToSort(notes: DeskNotes): InboxNote[] {
  return Object.values(notes.inbox)
    .filter((note) => note.state === "new" || note.state === "proposed")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const MAX_SPANS = 50;

// T3 thread ids: a UUID for sidebar chats, longer ids with ":" and "%" for chats another chat
// started (mcp:launch:…, thread:delegated-task:…). desk.mjs writes with the same pattern.
const THREAD_ID = /^[\w:%.-]{8,200}$/;

function readWork(value: unknown): Record<string, DeskChatWork> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (typeof raw !== "object" || raw === null || !THREAD_ID.test(key)) return [];
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
            ...(CHAT_ROLES.includes(work.role as ChatRole) ? { role: work.role as ChatRole } : {}),
            ...(typeof work.app === "string" && work.app.trim()
              ? { app: work.app.slice(0, 120) }
              : {}),
            ...(typeof work.parent === "string" && THREAD_ID.test(work.parent)
              ? { parent: work.parent }
              : {}),
            ...(readPlan(work.plan) ? { plan: readPlan(work.plan) ?? [] } : {}),
            ...(typeof work.sprint === "string" && work.sprint.trim()
              ? { sprint: work.sprint.slice(0, 80) }
              : {}),
            ...readReport(work.report),
            ...(typeof work.updatesSentAt === "string"
              ? { updatesSentAt: work.updatesSentAt }
              : {}),
            ...(typeof work.planAt === "string" ? { planAt: work.planAt } : {}),
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
    inbox: mergeNotes(remote.inbox, local.inbox),
    framing: Object.fromEntries(
      [...new Set([...Object.keys(local.framing), ...Object.keys(remote.framing)])].map(
        (sprint) => [sprint, mergeNotes(remote.framing[sprint] ?? {}, local.framing[sprint] ?? {})],
      ),
    ),
    decisions: mergeNotes(remote.decisions, local.decisions),
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
      ...current,
      items: [...(current?.items ?? []), { url: itemUrl, from: at, until: null }].slice(-MAX_SPANS),
      next: current?.next ?? null,
      // Putting a chat on an item makes it that item's work chat (a helper stays a helper).
      role: current?.role === "helper" ? "helper" : "work",
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
        ...current,
        items: current?.items ?? [],
        next: next?.trim() ? next.trim().slice(0, 500) : null,
        updatedAt: at,
      },
    },
  };
}

/** Records a chat's (thread id's) level, and for a planner its app, for a helper its parent. */
export function withRole(
  notes: DeskNotes,
  threadId: string,
  role: ChatRole | null,
  at: string,
  extra: { readonly app?: string | null; readonly parent?: string | null } = {},
): DeskNotes {
  const current = notes.work[threadId];
  const { role: _old, ...rest } = current ?? { items: [], next: null, updatedAt: at };
  return {
    ...notes,
    work: {
      ...notes.work,
      [threadId]: {
        ...rest,
        ...(role ? { role } : {}),
        ...(extra.app !== undefined ? { app: extra.app } : {}),
        ...(extra.parent !== undefined ? { parent: extra.parent } : {}),
        updatedAt: at,
      },
    },
  };
}

/**
 * A chat's level: the one recorded for it, else what the Desk knows (the day's chat, a chat pinned
 * as an app's planner or started about an app or sprint, a chat on an item). Null when unknown.
 */
export function chatRoleOf(
  notes: DeskNotes,
  chat: { readonly environmentId: string; readonly threadId: string },
): ChatRole | null {
  const recorded = notes.work[chat.threadId]?.role;
  if (recorded) return recorded;
  const key = `${chat.environmentId}:${chat.threadId}`;
  const link = notes.links[key];
  if (link?.kind === "today" && link.day) return "today";
  if (
    link?.kind === "app" ||
    link?.kind === "sprint" ||
    Object.entries(notes.pins).some(
      ([place, pins]) => place.startsWith("app:") && pins[key]?.role === "planner",
    )
  ) {
    return "planner";
  }
  if (chatFocus(notes, chat.threadId) || link?.kind === "item") return "work";
  return null;
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
  | { readonly kind: "direction"; readonly app: string; readonly section: string }
  /** Rigo's big picture for an app's sprint, shown above its plan. */
  | { readonly kind: "framing"; readonly sprint: string; readonly app: string };

export function noteAt(notes: DeskNotes, target: DeskNoteTarget): DeskNote | null {
  if (target.kind === "app") return notes.apps[target.app] ?? null;
  if (target.kind === "sprintNotes") return notes.sprintNotes[target.sprint] ?? null;
  if (target.kind === "direction") return notes.directions[target.app]?.[target.section] ?? null;
  if (target.kind === "framing") return notes.framing[target.sprint]?.[target.app] ?? null;
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
  if (target.kind === "framing") {
    return {
      ...notes,
      framing: {
        ...notes.framing,
        [target.sprint]: { ...notes.framing[target.sprint], [target.app]: note },
      },
    };
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

/** Today chats that still want their dated title. */
export function untitledTodayChats(notes: DeskNotes): Array<{ key: string; title: string }> {
  return Object.entries(notes.links).flatMap(([key, link]) =>
    link.kind === "today" && link.day && !link.titled
      ? [{ key, title: todayChatTitle(link.day) }]
      : [],
  );
}
