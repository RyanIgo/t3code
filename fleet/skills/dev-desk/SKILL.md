---
name: dev-desk
description: Keep the Dev Desk (the fleet hub's view of the "Rigo — Dev" GitHub project) current and readable. Use before starting work on a GitHub issue (read its status, sprint and priority), after progress on it (update its plain-words line), when filing an issue, and when asked to fill in or tidy plain words for the Desk.
---

# Dev Desk (T3 Code fleet fork)

The Dev Desk shows all development work from the **Rigo — Dev** GitHub project
(https://github.com/orgs/cfevans/projects/1) in plain words, sorted into lanes. Rigo and
managers read it instead of GitHub, so every issue needs a short section a non-engineer
understands.

## The plain-words section

Every issue's body carries this section (add it if missing, keep the rest of the body as is):

```markdown
## In plain words

**What:** <one sentence: what changes for the people who use it>
**Why it matters:** <one sentence: the business reason or who is waiting on it>
**Where it stands:** <one line: the current state, e.g. "Built and in review; needs Rigo's test sheet">
```

- Plain language, no file, function, branch or tool names, no jargon. Under 20 words each.
- "What" reads like a good thread name, as a sentence: "Precon managers review incoming bids on one screen."
- Update **Where it stands** whenever the state changes: started, PR open, test sheet ready,
  blocked (say on what), merged, deployed.

Edit it with `gh issue view <n> --repo <owner/repo> --json body` and `gh issue edit <n> --repo <owner/repo> --body-file <file>`, changing only that section.

## Keep the conversation on track

Each application has **notes for agents** (goals, decisions, conventions, what not to touch) and
a **goal for the current sprint**; each sprint has notes (what it's for, what testers said).
They live on the Desk, so every chat about an app starts from the same place.

```sh
node ~/.claude/skills/dev-desk/desk.mjs context            # this repo's app
node ~/.claude/skills/dev-desk/desk.mjs context Precon     # or name the app (or a repo)
node ~/.claude/skills/dev-desk/desk.mjs note Precon "Decided: leveling stays the default Bids view"
```

- **At the start of work in a repo**, run `context` and follow it: stay inside the sprint goal,
  respect the notes. If the request conflicts with them, say so in one line and ask.
- **When something is decided or learned** that the next chat should know (a decision, a
  convention, a trap, a user's feedback), add one line with `note`. Keep it to one sentence, in
  plain words; never secrets or personal data.
- Rigo edits the notes and goals on the Desk (Apps view); don't rewrite them, only add lines.

## Say what this chat is on, and what's next

Each item has one chat **on it**, and each chat's panel on the Desk shows what it worked on and
its next step. Keep both true:

```sh
node ~/.claude/skills/dev-desk/desk.mjs focus cfe-drawings#312   # this chat is now on #312 (or an issue/PR URL)
node ~/.claude/skills/dev-desk/desk.mjs next "Stage BuildingConnected bids once Rigo names the account"
```

- **When you start on an issue or PR**, run `focus` with it. A chat is on one item at a time;
  focusing another closes the earlier one, so the Desk keeps a dated record of what you worked on.
- **At the end of each turn that changed something**, set `next` to one plain sentence: the next
  step, or what you're waiting on and from whom. Clear it (`next ""`) when the item is done.
- If Rigo or a planner moved you to another item (a message saying "You're now on …"), finish or
  park what you were doing, run `focus` with the new item, and say where the old one stands.
- A planner that starts work chats records each one right away with
  `focus <item> --thread <the new chat's thread id>` (from create_threads, t3_thread_launch or
  delegate_task), and names the chat after its item ("#229 Compliance: …"). When it moves a
  chat to other work, it tells the chat, and the chat runs `focus` itself.

## Levels: who does what

Every chat works at one level, recorded on the Desk and shown on the Board. Rigo steers each app
through its planner; the Board's Now tab is his list of where he's needed across every app (there
is no Today chat any more). He also talks to work chats directly to scope a feature.

| Level                                  | Owns                                                                                                                                  | Does not                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Planner** (one per app, per sprint)  | the app's sprint plan and goals; starting, naming and reassigning work chats; turning feedback into items; bringing decisions to Rigo | write code, open or merge PRs, test, or publish test sheets (the item's work chat does; the sheet shows in its Review tab) |
| **Work** (one item)                    | one issue or PR: code, PR, test sheet, wrap-up                                                                                        | change the plan, pick its own next item, take on a second item                                                             |
| **Helper** (a subagent or a side task) | the job its parent gave it                                                                                                            | talk to Rigo; its results and questions go to its parent                                                                   |

```sh
node ~/.claude/skills/dev-desk/desk.mjs role planner --app "BizDev Leads"            # this chat is BizDev's planner
node ~/.claude/skills/dev-desk/desk.mjs role helper --parent <parent thread id>     # this chat helps that one
node ~/.claude/skills/dev-desk/desk.mjs role work --thread <id>                     # (a planner, for a chat it started)
node ~/.claude/skills/dev-desk/desk.mjs agents "BizDev Leads"                        # the app's chats by level, and what's off
```

- **At the start of a chat**, know your level: a chat started from an item is Work (`focus`
  records it); from an app or sprint, Planner; delegated by another chat, Helper. If nothing
  says, ask Rigo in one line, then record it with `role`.
- **Stay at your level.** When Rigo asks something that belongs to another level, say so in one
  line ("That's the BizDev planner's call: sprint priorities"), put his message in that chat's
  message box with `t3_thread_send` (queue, don't steer) when you can reach it, and give him its
  link. Don't answer it yourself.
- **Planners** name the work chats they start "#<n> <plain title>", run `focus <item> --thread <id>`
  and `role work --thread <id>` for each, and give delegated chats `role helper --parent <your
  thread id>`. A work chat that needs a decision asks its planner; the planner asks Rigo.
- **Work chats** finish one item. More work found along the way becomes a note to the planner
  (or `capture`), not a second item in the same chat.
- **Rigo scoping with a work chat** is expected: shape the feature with him, write what was
  agreed into the issue (acceptance criteria, "Where it stands"), add a `note` for anything the
  next chat should know, and tell the planner in one queued line (`t3_thread_send`) so its plan
  stays true. If what he asks is another item, say so and `capture` it for the planner.
- **Steering from a user session is expedited.** When Rigo brings what a user said while using
  the app (a session, a demo, a test with them) and it changes a feature, a bug or what comes
  first: act on it now, ahead of the queue. A work chat on that item takes it on at once and
  tells the planner; anywhere else, `capture … --source "User session"` and send the planner one
  queued line at once. The planner re-plans in its next turn (priority, sprint, who's on it) and
  says what moved. Triage proposes "User session" notes first, with Expedite.

### A new planner each sprint

Each sprint starts a fresh planner chat per app, so its context starts clean:

```sh
node ~/.claude/skills/dev-desk/desk.mjs role planner --app "BizDev Leads"   # takes over from last sprint's planner
node ~/.claude/skills/dev-desk/desk.mjs context "BizDev Leads"              # direction, goal, big picture, decisions
node ~/.claude/skills/dev-desk/desk.mjs plan show                           # the open lines carried over
```

- `role planner` records the sprint, carries the earlier planner's open checklist lines over, and
  makes that chat your helper. Read its last turns (`t3_thread_read`), send it one queued message
  to hand over what isn't on the Desk and stop, then `plan set` the checklist for this sprint.
- **No sprint goal yet?** Propose one as a decision whose question is the goal sentence itself,
  nothing around it: `decide "<the goal, one plain sentence>" --goal --why "<why this, now>" --context …`. "Use this goal" sets it; Rigo's note replaces it
  with his wording.

### How a planner talks to Rigo

Rigo plans from the Plan pane beside your chat, not from your messages, so keep it current:

```sh
node ~/.claude/skills/dev-desk/desk.mjs decide "Settle the 4 finished warehouse chats?" \
  --options "Settle all|Only those whose item is closed|Not now" --rec "Settle all" \
  --why "Their items are closed; settling clears Wrap up." \
  --link cfe-data-warehouse#201 --link cfe-data-warehouse#236 \
  --effect "Settle all=>Hides the 4 chats from Rigo's lists; their history stays" \
  --effect "Only those whose item is closed=>Same, for the 3 with a closed item" \
  --effect "Not now=>Nothing changes; they stay in Wrap up"
node ~/.claude/skills/dev-desk/desk.mjs plan set - <<'JSON'
[{"text":"12 chats given a level","who":"done","done":true},
 {"text":"Sign off before the Dec 1 flip","who":"you","item":"https://github.com/cfevans/cfe-data-warehouse/issues/115"},
 {"text":"AP roles agreed","who":"Admin team"},
 {"text":"#229, #238, #245 in progress","who":"agents"}]
JSON
node ~/.claude/skills/dev-desk/desk.mjs decisions "Data warehouse & company connectors"   # waiting questions and his answers
```

- **Questions are decisions, not prose.** Anything that needs Rigo's yes or no goes through
  `decide`, one per question, with the options, your recommendation and a one-line reason. His
  answer arrives in this chat as "Decision: … → <choice>". Don't also list them in your message.
- **Write the background on the card** (`--context`, or `--context-file -` for longer text): in
  plain words, what this is, why it's coming up now, what the items and PRs involved do for the
  people who use the app, and what he's agreeing to. **Read the chats that worked on it first**
  (`t3_thread_read` on each, and their delegated tasks; issue comments and PR descriptions too),
  and say what each found, did, decided and left open, by chat name. Never just issue or PR numbers: he reads
  the card, not the code. "Tell me more" means the background wasn't enough; rewrite it.
- **Give him what he needs to decide without asking:** `--link` every item, PR, sheet or chat it
  touches (repo#n works; the Board shows each with its state now), one `--effect` per option in
  plain words, and `--final` for any option that can't be undone (merging, deleting, emailing,
  deploying). If he presses "Tell me more", explain in the chat, then update the same question
  with `--id <id>` and the missing links and effects.
- **The checklist replaces status essays.** After each turn that changes the picture, `plan set`
  the whole checklist: what's done, what's on Rigo (`"who": "you"`), on someone else (their
  name or team), and what agents are on. Your message then says only what changed.
- **Rigo's lines are his to-do list.** They show in Waiting on you, on Now and on his phone, each
  with **Done** and **Ask**. Keep them to things only he can do, one action each, with where to
  do it ("Remove template 7's Raw marks in Admin → Access"). A question is never a "you" line:
  it's a `decide`. A line about an item or PR carries `"item"`, so the Board folds it into that
  item's row instead of listing it twice. "Done: <line>" from him means it's done: tick it in
  your next `plan set` and act on it; "About "<line>": …" means say exactly what you need.
- **Work from Rigo's big picture.** `context` shows it ("Rigo's big picture"). When he edits it,
  you get a message; adjust the plan and your open decisions, and say what changed in one line.
- **Wide tables go to a hub sheet** (t3-artifacts), linked from a one-line summary, not into the
  chat.

### Reconciling an app's chats (planners)

When Rigo asks you to reconcile, or once a week:

1. `desk.mjs agents "<app>"` for the chats on record and what's off.
2. `t3_thread_list` (all projects, and each linked machine) for the app's repos, to find chats
   with no record.
3. Give each chat one level: `role … --thread <id>`; for work chats also `focus <item> --thread <id>`.
   A chat doing several levels' jobs keeps the one it's mostly doing; what's left goes to a new
   chat or back to you.
4. One planner per app. If there are two, keep the one with the current plan; the other gets
   `role helper --parent <kept planner>` and a message to hand over and stop.
5. Send each chat one short message with its level and the contract above (queued, never
   interrupting work).
6. Show Rigo a table: chat · level · item · state · what changed, and flag anything you weren't
   sure about. Ask before settling or stopping any chat.

## Rigo's inbox

Rigo jots quick notes from email, meetings and hallway asks into an inbox on the Desk. A triage
chat proposes where each goes; Rigo approves each one on the Board, which files it.

```sh
node ~/.claude/skills/dev-desk/desk.mjs inbox                                   # notes waiting to be sorted
node ~/.claude/skills/dev-desk/desk.mjs propose <id> comment --item <url> --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs propose <id> new --repo <owner/repo> --app "<app>" --type Bug --priority P2 --title "<plain title>" --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs propose <id> planner --app "<app>" --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs propose <id> dismiss --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs capture "<what Rigo was told>" --who Maddy --source "In person" --app "BizDev Leads"
```

- **Triage proposes, never files.** Search existing issues first so nothing is filed twice;
  prefer adding to an open item over a new one.
- **Planners** see notes sent to them under "From Rigo's inbox" in `context`; turn each into
  goals or items as fits the app's direction, and tell Rigo what you did.
- Use `capture` when Rigo mentions a request in a chat that isn't about the current work.

## How the work is organized

**Application → Feature → Work item.** Every item on the project carries:

- **App**: the product the change lands in (Precon, Data warehouse & company connectors,
  Materials, SharePoint connector, BizDev Leads, Custom portal, Claude usage tracking, Dev
  platform (T3 + agents), Legacy apps).
- **Feature**: `<App> · <feature>` (e.g. `Precon · Bid intake`). Each feature has an issue titled
  `Feature: <name>` with its goal and **Stage** (Experiment → Testing → Production). Moving a
  feature's stage is Rigo's call; propose it, don't set it.
- **Work type**: Story (something a user will see) · Bug · Maintenance (security, upgrades,
  standards) · Research · Support · Tracking (feature records, initiative headers, recurring
  reports; hidden on the board). It is the colored tag on every card.
- **Sprint**: two weeks. Early in a sprint the work is built; the back half is user feedback from
  the test sheet and changes from it. Sprint budget: about 60% stories, 20% maintenance, 20% bugs,
  research and support. Work not in a sprint is the **Backlog**, ordered by **Priority** (P0–P3).
- **Status**: Todo → In Progress → In Review → Done, the Sprint board's columns. **Lane** is only
  used to flag **Blocked**.
  - **Todo**: no one is on it yet.
  - **In Progress**: a chat is on it (focus), working, or has a draft PR.
  - **In Review**: something waits on Rigo: an open PR, a test sheet with checks to do, or a result or question from the chat.
  - **Done** means nothing is left: the issue is closed, every PR is merged or closed, the test
    sheet is finished with nothing failed, the acceptance criteria are ticked, and the chat is
    settled. A closed item with any of these left shows as "Done, needs wrap-up" until it's cleared.

Existing parent / sub-issue links are kept; features are a field, not a parent.

When you **file an issue**, add it to the project and set App, Feature (or none for maintenance)
and Work type. Ask Rigo when the feature isn't obvious rather than guessing.

```sh
gh project item-add 1 --owner cfevans --url <issue url>   # then set fields on the Desk or with gh project item-edit
```

**What goes up to the enterprise level** (the Technology Portfolio, through Rigo): only changes for
production users, anything affecting a commitment or date, risks (security, outage, data) and
decisions or resources needed from others. Side tasks, refactors and experiments stay here.

## User stories

Story items (Work type Story) can start with three sections above the original text; the board
reads them:

```markdown
## User story

**As** <who>, **I can** <do what>, **so that** <outcome>.

## Acceptance criteria

- [ ] <one checkable outcome, in the user's words>

## Engineering

<PRs, migrations, checks, known limits: for agents>
```

- Tick a criterion (`- [x]`) only when it was shown to work, on a test sheet or by the user. The Desk shows "2 of 6 criteria" from these boxes.
- The Desk's "Make test sheet" turns the criteria into hub test sheet rows. Read the results with the t3-artifacts script before ticking.
- Keep criteria in plain words. Technical detail, performance numbers and root-cause notes go under Engineering.

## Status, sprint and priority

Rigo puts work into sprints and sets priority on the board; agents don't add or remove items from
a sprint. Before starting work on an issue, read its fields:

```sh
gh project item-list 1 --owner cfevans --format json --limit 1000 \
  --jq '.items[] | select(.content.url == "<issue url>") | {status, sprint, priority, lane, app, feature, "work type"}'
```

- Not in the current sprint: say so in one line and ask whether to go ahead before a large change.
- Keep **Status** current: In Progress when you start, In Review when the PR or test sheet is
  ready for Rigo. The board also moves a card forward when it sees an open PR, a sheet or a
  working agent, but the field is the record. Done is set by merging or closing, or by Rigo.
- **Wrapping up** (when your work merges): tick the acceptance criteria that hold (move any that
  don't to a new issue and say so), close PRs that won't merge, make sure the test sheet is
  finished, close the issue, run `desk.mjs next ""`, and tell Rigo the chat can be settled.
- If you hit a blocker you can't clear, set Lane to **Blocked** (the card shows a Blocked flag) and
  say on what in "Where it stands". Clear it when unblocked.

## Filling in plain words for existing issues

When asked to fill the Desk in: list open issues in the project without an "In plain words"
section, highest priority first, in batches of 10–20. Read each issue (and its latest comments)
and write the section from what it says; mark "Where it stands" honestly ("Not started", "Idea
only, no decision yet"). Show Rigo the batch as a list before editing, then edit the issues.
Never change titles, labels or other fields in this pass.
