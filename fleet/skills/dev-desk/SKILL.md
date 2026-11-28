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
- A planner that starts a story lead records it right away with
  `focus <story> --thread <the new chat's thread id>` (from create_threads, t3_thread_launch or
  delegate_task), and names the chat after its story ("#276 AP and Administration each see their
  data"). When it moves a chat to other work, it tells the chat, and the chat runs `focus` itself.

## Levels: who does what

Every chat works at one level, recorded on the Desk and shown on the Board. Rigo steers each app
through its planner; the Board's Now tab is his list of where he's needed across every app (there
is no Today chat any more). He also talks to story leads directly to scope a story.

The unit of work is the **story** (see "Stories: the unit of work" below): Rigo plans, reviews,
tests and merges stories; the small issues inside a story are **pieces** that agents handle.

| Level                                                     | Owns                                                                                                                                                          | Does not                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Planner** (one per app, per sprint)                     | the app's sprint plan, goals and stories; starting, naming and reassigning story leads; turning feedback into plans Rigo approves; bringing decisions to Rigo | write code, open or merge PRs, test, or publish test sheets or mockups (the story lead does) |
| **Story lead** (role `work`; one story, or one quick fix) | the whole story: splitting it into pieces, a helper per piece, the mockup loop, the PRs, the one test sheet, the wrap-up                                      | change the plan, pick its own next story, take on a second story                             |
| **Helper** (a subagent or a side task)                    | one piece or job its parent gave it                                                                                                                           | talk to Rigo; its results and questions go to its parent                                     |

```sh
node ~/.claude/skills/dev-desk/desk.mjs role planner --app "BizDev Leads"            # this chat is BizDev's planner
node ~/.claude/skills/dev-desk/desk.mjs role helper --parent <parent thread id>     # this chat helps that one
node ~/.claude/skills/dev-desk/desk.mjs role work --thread <id>                     # (a planner, for a chat it started)
node ~/.claude/skills/dev-desk/desk.mjs agents "BizDev Leads"                        # the app's chats by level, and what's off
```

- **At the start of a chat**, know your level: a chat started from a story or quick fix is its
  Story lead (`focus` records it); from an app or sprint, Planner; delegated by another chat,
  Helper. If nothing says, ask Rigo in one line, then record it with `role`.
- **Stay at your level.** When Rigo asks something that belongs to another level, say so in one
  line ("That's the BizDev planner's call: sprint priorities"), put his message in that chat's
  message box with `t3_thread_send` (queue, don't steer) when you can reach it, and give him its
  link. Don't answer it yourself.
- **Planners** name the story leads they start "#<n> <plain story title>", run
  `focus <story> --thread <id>` and `role work --thread <id>` for each, and give delegated chats
  `role helper --parent <your thread id>`. A story lead that needs a decision about the work asks
  its planner; the planner asks Rigo. (The one decision a lead files itself is its mockup
  recommendation, below.)
- **Story leads** finish one story. They split it into pieces and hand each to a helper
  (`delegate_task`, then `role helper --parent <lead's thread id> --thread <helper's id>`), run
  helpers side by side where pieces don't depend on each other, check and combine their results,
  and own everything Rigo sees for the story. Work found along the way that isn't part of the
  story becomes a note to the planner (or `capture`), not a second story in the same chat.
- **Turns report themselves.** At the end of every turn of a story lead or helper, a hook records
  what it said and its `next` step for its planner and sends them as a "[Desk update]" message
  (batched, at most one every few minutes). So keep `next` true; you don't need to tell the
  planner what you did. Message it yourself only for a question or a decision it must make.
- **One test sheet per story or quick fix**, made by its story lead (t3-app-review), never one
  sheet per piece or for a whole sprint: Rigo tests it on the Board's Test page with that chat
  under it, and his feedback, blockers and submitted results go straight to the chat that can
  fix them. When the story had a mockup, the sheet checks "does it match the marked mockup, and
  is the data right", nothing more.
- **Planners** treat a "[Desk update]" as news, not a request: update the checklist (`plan set`)
  if the picture changed, act if something needs you, and otherwise end the turn with one line
  or nothing. Don't reply to the chat unless it needs something.
- **Rigo scoping with a story lead** is expected: shape the story with him, write what was
  agreed into the issue (acceptance criteria, "Where it stands"), add a `note` for anything the
  next chat should know, and tell the planner in one queued line (`t3_thread_send`) so its plan
  stays true. If what he asks is another story, say so and `capture` it for the planner.
- **Feedback gets a plan Rigo approves.** Feedback (from him, a user session, the Feedback
  button, a test sheet note that asks for something new) often spans a story, a piece and a quick
  fix. Its planner writes one `decide` card for it, options `"Approve|Change|Push back"`, whose
  `--context` lists one line per part: where it goes (a quick fix; a piece of story #n; a new
  story under feature X) and why, each part linked back to the feedback. File, start or change
  nothing before "Approve". A small tweak to the story a lead is on right now, said to that lead
  directly, is the exception: the lead takes it into the story and tells the planner.
- **Steering from a user session is expedited.** When Rigo brings what a user said while using
  the app (a session, a demo, a test with them) and it changes a feature, a bug or what comes
  first: make its feedback plan now, ahead of the queue, with "User session" in the question, and
  act the moment he approves. Elsewhere, `capture … --source "User session"` and send the planner
  one queued line at once. Triage proposes "User session" notes first, with Expedite.
- **Keep the chat thread plain conversation.** Rigo reads cards, mockups and sheets in the side
  panel (the Board's Plan pane, Test page and Review window), never embedded in the thread: it
  confuses him there. So no `html_render` pages and no `questions` blocks in a thread. Decisions
  go through `decide`; checks, mockups and anything with marks go to a hub artifact
  (t3-artifacts). In the thread, point to it in one line ("Mockup round 2 is in the side panel:
  3 screens, ~5 min").

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
 {"text":"Remove template 7's Raw marks","who":"you","item":"cfe-data-warehouse#219",
  "why":"Enforcement is on and the watch is clean; the temporary marks now only widen access.",
  "how":"1. Open Admin → Access → Templates → 7 (Contract Admin).\n2. Untick Raw on each table that has it.\n3. Save, then press Done here.",
  "links":["https://<the app>/admin/access/templates/7","cfe-data-warehouse#116"]},
 {"text":"AP roles agreed","who":"Admin team"},
 {"text":"#229, #238, #245 in progress","who":"agents"}]
JSON
node ~/.claude/skills/dev-desk/desk.mjs decisions "Data warehouse & company connectors"   # waiting questions and his answers
```

- **Questions are decisions, not prose.** Anything that needs Rigo's yes or no goes through
  `decide`, one per question, with the options, your recommendation and a one-line reason. His
  answer arrives in this chat as "Decision: … → <choice>". Don't also list them in your message.
- **Don't ask what you can set.** Priority on a bug or note you filed (P1 vs P2), a label, an area:
  set your pick, say it in one line ("Filed as P1; change it on the card if not"), and move on.
  He changes priority on the Board. A decision is only for a choice that changes what agents do.
- **Chats filing a note or feedback** file the issue, set its priority themselves, run
  `desk.mjs next ""`, and end. They never ask Rigo questions in the
  thread and never write paragraphs to him: bullets only (see "In plain words").
- **A decision is a choice about the work, never test feedback.** "Did it work?", "How fast did
  it load?", "What weren't you seeing?" are checks: they belong as rows on the item's test sheet
  (t3-artifacts), where he answers them while testing. Ask a decision only for a choice whose
  answer changes what agents do next.
- **Retire what events overtook.** At every turn, read `decisions <app>`: a waiting card whose
  PR has since merged or closed, whose release already went out, or whose question the work has
  answered is dead weight on Rigo's queue. Retire it yourself, including cards your app's story
  leads filed: `desk.mjs retire <id> "<what overtook it, e.g. PR #282 merged Nov 24>"` (ids are in
  `decisions <app>`), and say so in one line in your next message. Story leads don't file decisions about the work (only their
  mockup recommendation); they ask you.
- **Never ask twice.** Before `decide`, read `decisions <app>`: if he already answered the same
  question (or one about the same item), act on that answer. Ask again only when something new
  makes the old answer wrong, and say what changed in `--why`. `decide` warns when a waiting or
  recent answered decision touches the same items.
- **Fewer, bigger calls.** Batch small related choices into one decision, and when you are
  confident and it's undoable, do it and say so in the checklist instead of asking.
- **Stars first, then priority.** Rigo stars an area (or a whole app) on the Board's Stories tab
  when a user is about to be in it ("Austin levels Thursday"). You get "★ Focus: I starred …
  until <date>": do that area's stories first, get their sheets ready before the date, and tell
  him in one line what can't be ready in time. "★ Focus off" returns you to the usual order.
  Otherwise order work by Priority (P0 first). He sets priority himself, on the card; propose a
  change as a `decide` card rather than editing it.
- **Bullets, not narrative** (Rigo, 2026-11-24). Everything he reads (decision cards and their
  `--context`, checklist lines and their `how`, reports, a story's "Where it stands", test sheet
  intros, your messages to him) is short bullets under short headings, written for an executive /
  technical manager (outcomes and decisions, not implementation): one fact or action per
  bullet, refs inline (#312, PR #353), no paragraphs. At most one framing line above them. A
  story's status reads like: Stage · Your move · Pieces (2 of 3 done) · PR · Sheet · Next.
- **Write the background on the card for a manager** (`--context`, or `--context-file -`;
  Rigo, 2026-11-26: "heavily technical narrative and not very manager friendly"). He reads it
  as an executive / technical manager: outcomes, not mechanics. Use these headings, each with
  1-3 bullets of at most ~20 words, and skip a heading that has nothing to say:
  ```
  **What it is**
  - <the change, in what the app's users get or stop suffering>
  **Why now**
  - <what's blocked or at risk without it; the date or person it matters to>
  **If you approve**
  - <what happens next, and when it reaches users>
  **Risk**
  - <what could go wrong, or "Low: undoable">
  **Done so far**
  - <chat name>: <what it found or finished, one line> (PR #n, sheet)
  ```
  - Leave out how it works: file, row and function names, test rigs, tokens, internal tool
    names. If he needs it, he asks, and the answer goes on the card ("Tell me more" means the
    background wasn't enough; rewrite it).
  - **Read the chats that worked on it first** (`t3_thread_read` on each, their delegated
    tasks, issue comments, PR descriptions) and boil what each did down to one "Done so far"
    bullet. Never just issue or PR numbers.
  - Quote his own words only as `> ` lines. `decide` refuses paragraphs and bullets over 200
    characters.
- **Give him what he needs to decide without asking:** `--link` every item, PR, sheet or chat it
  touches (repo#n works; the Board shows each with its state now), one `--effect` per option in
  plain words, and `--final` for any option that can't be undone (merging, deleting, emailing,
  deploying). If he presses "Tell me more", explain in the chat, then update the same question
  with `--id <id>` and the missing links and effects.
- **The checklist replaces status essays.** After each turn that changes the picture, `plan set`
  the whole checklist: what's done, what's on Rigo (`"who": "you"`), on someone else (their
  name or team), and what agents are on. Your message then says only what changed.
- **Rigo's lines are his to-do list.** They show in Needs you, on Now and on his phone, each
  with **Done** and **Ask**, and open into a page of their own. A line is for something no agent
  can do: a sign-in that needs his account or phone, a person to talk to, a judgement only he
  makes, a screen only he can reach. Restarting a service, rebuilding, changing a project field
  or board option, running a script, filing or editing issues: an agent (a work chat or helper)
  does those. If an agent needs his OK for a kind of chore, ask once as a decision for standing
  permission ("May agents restart the reader on the WSL box when a build lands?"), then just do it.
  Keep each line to one action. A new line of his must be on the **Do form**; `plan set` refuses
  it otherwise and names the missing field:
  ```json
  {
    "text": "Add the bid-intake routine to Precon's Claude library",
    "who": "you",
    "item": "cfe-drawings#312",
    "minutes": 5,
    "onlyYou": "sign-in",
    "why": "The Set up bid intake panel reads this document.",
    "unblocks": "#312 closing",
    "steps": [
      { "text": "Copy the routine", "goTo": "<hub page>", "doneWhen": "copied" },
      {
        "text": "Precon → Claude → Other documents → Add, paste, save",
        "goTo": "https://precon.cfevans.com/#/claude",
        "doneWhen": "it shows as version 1"
      }
    ]
  }
  ```
  - `onlyYou` is why no agent can: `sign-in`, `phone`, `person` or `judgement`. Can't name one?
    Then it isn't his: an agent does it.
  - `steps` are short actions, one per card he ticks. Each says where (`goTo`, an https page he
    acts on) and how he knows it worked (`doneWhen`). No paragraphs; no GitHub issue links
    (issues are for agents); no claude.ai pages (publish on the hub with t3-artifacts).
  - `item` is the repo#n it belongs to: when that ships, the line drops off his list, and the
    audit tells you to remove it. If the item changes after you wrote the line, re-check it.
  - **A test is not a to-do.** Testing a change is a hub test sheet handed over with
    `next "Rigo: test …"`; `plan set` refuses a to-do that is a test.
  - A question is never a "you" line: it's a `decide`. "Done: <line>" from him means it's done:
    tick it in your next `plan set` and act on it; "About "<line>": …" means say exactly what
    you need.
  - **Only what he can do now.** A line waiting on someone else or on an agent ("wait for the
    agent's list, then…", "ask Reed to…" while Reed's sheet isn't ready) is that person's or the
    agents' line until it's ready; then it becomes his. Never put a one-time code on a line: it
    expires in minutes. Ask for it when he's there, as a chat message.
  - **"Not mine: <line>"** from him means: give it to an agent, or take it off his list until it's
    ready. If only he can do it, say why in one line. Then `plan set`.
  - **Keep the list short and moving.** At every `plan set`, look at his open lines: each shows on
    his queue with how long it has waited. One that has sat two days is stuck: ask yourself why
    (unclear, not ready, not his, or he doesn't agree) and fix that, rather than leaving it.
- **The audit is your checklist's other half.** `plan set` ends with what `audit` finds on your
  app (also on the Board's Health tab): to-dos without steps or stuck, items with no Feature,
  priority or plain words, leads with no whose-move line, stale cards. Fix what's yours that turn;
  `node desk.mjs audit "<app>"` lists it all. The hub fills an item's App from its repo and moves
  it to In Progress when a chat leads it, so don't spend turns on those. `plan set` keeps only the
  10 latest done lines.
- **Close a sprint with one card.** In the sprint's last three days the audit lists its unfinished
  items; put them on one `decide` card for Rigo (carry each to the next sprint, or drop it), not a
  to-do per item.
- **End every story-lead turn with `next` saying whose move it is.** His queue lists a finished
  turn only when its `next` starts with "Rigo:" and names one of his verbs: **review** (a mockup
  round), **test** (the sheet), **merge**, or **do** (a step only he can take), e.g.
  `next "Rigo: review mockup round 2 of #276 (3 screens, ~5 min)"` or
  `next "Rigo: test bid intake on its sheet (11 checks, ~15 min)"`; `next` refuses any other
  verb after "Rigo:". Never "Rigo: read …",
  "look at …" or "check the chat": if he needs to know something, it belongs on the sheet, the
  mockup or a `decide` card. Anything else ("waiting on CI", "merging after the release") folds
  under "Agents on it", where he doesn't need to open it.
- **Say times as agents actually take them.** A first mockup takes about an hour, a revised round
  less, a piece often an hour or two. Don't say "a day" or "a few days" for agent work unless it
  truly waits on something that long (a person, a release window), and then say what.
- **Say where.** A step on a machine names it the way the Board shows it ("on admin's Mac
  mini"), and says how to get there: the **Terminal** button next to your chat in the item's
  window opens a terminal on that machine, in your folder. Better still, don't hand him a
  terminal at all: for a GitHub sign-in or scope refresh, start it yourself in the background
  (`gh auth refresh -h github.com -s project`, or `gh auth login` with the device flow), and
  give him only the one-time code and https://github.com/login/device to approve it in his
  browser; then check it took (`gh auth status`) and tick the line.
- **His questions on a line go to its helper, not to you.** His first question on a to-do forks
  a hidden side chat from you, briefed on that line; it answers on the line
  (`desk.mjs plan answer "<the line>" "<answer>" --planner <your thread id> [--how "<new steps>"]`)
  and does what it can of the to-do for him. It closes when he ticks Done. Keep the line's text
  stable while it's open: questions, answers and the helper are matched by it. If a question
  still reaches you ("Rigo asks about your line …"), answer the same way, without `--planner`.
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
7. **Group into stories.** Where several work chats are on pieces of one user outcome, propose
   the grouping as one `decide` card per app ("Group the warehouse work into 2 stories?",
   options `"Approve|Change|Push back"`), `--context` listing each story: its one-sentence title,
   its pieces (repo#n), the chat that becomes its lead and the chats that become its helpers, and
   any item left as a quick fix. On "Approve": make the pieces sub-issues of the story, rename the
   lead "#<n> <story title>", `role helper --parent <lead> --thread <id>` the others, tell each
   chat its new place in one queued line, and `plan set`. Nothing is closed or stopped.

## Stories: the unit of work

Agreed with Rigo on 2026-11-24 (his "How the Dev Work Fits" page). Three words, three lifespans:

- **Feature** (months): an area of an app, e.g. `Warehouse · Access`. Rigo looks at it when
  planning a sprint, not day to day.
- **Story** (one sprint): what users get from a feature this sprint, in one sentence a user would
  recognize: "AP and Administration each see exactly their data." It gets one story lead, one
  mockup (if needed), one test sheet and one Merge (all its PRs together). It's sized to be mocked
  up, built, tested and shipped within its sprint. This is what Rigo deals with.
- **Piece** (hours to days): a GitHub sub-issue of its story: a fix, a migration, an access rule.
  A helper does it; Rigo never sees a piece on its own unless it blocks the story.
- **Quick fix**: a production bug or maintenance (upgrade, security) that belongs to no story.
  It gets its own small story-lead chat and reaches Rigo as test, then merge.

Pieces are sub-issues of their story:

```sh
id=$(gh api repos/<owner>/<repo>/issues/<piece n> --jq .id)
gh api -X POST repos/<owner>/<repo>/issues/<story n>/sub_issues -F sub_issue_id="$id"
```

### Mockup first

A story that changes a screen is mocked up before it's built, so Rigo sees the screens in an hour
rather than after the slow data and access work.

1. **Recommend.** Once the lead has split the story into pieces, it files its mockup
   recommendation as a decision, the one it files itself:
   `decide "Mockup for #276: Clickable?" --app "<app>" --item <story url> --options "Not needed|Sketch|Clickable|Detailed" --rec Clickable --why "<one line: which screens change and why that level>"`.
   Sketch = boxes, labels and layout, minutes. Clickable = linked screens with sample data, about
   an hour. Detailed = real field names, edge cases and empty states, a couple of hours. No screen
   change (data jobs, upgrades, access rules): recommend "Not needed" and go straight to Build.
2. **First round in about an hour.** Publish the mockup as a hub HTML artifact (t3-artifacts), one
   `<section data-screen="…" data-title="…">` per screen, `<body data-round="1">`, with
   `~/.claude/skills/t3-artifacts/mockup-marks.html` pasted at the end of the body. It gives
   each screen Right / Change this / Flag TODO / Not relevant (Drop, or Send to Backlog) and a
   note, and a "Send marks to the lead" button. Say the effort level at the top of the page.
   Then `next "Rigo: review mockup round 1 of #<n> (<k> screens, ~<m> min)"`.
3. **Loop.** His marks arrive as a `[From page: …]` message. Revise every Change screen and
   publish the next round in place (same `id`, `data-round` + 1), usually within the hour. He can
   change the effort level between rounds; follow what he says. For **Flag TODO**, `capture` it
   (`--source Other --app "<app>"`, his note as context). For **Not relevant → Drop**, add
   "Left out: <screen> (Not relevant, <date>)" to the story's Engineering section so no chat
   proposes it again; **→ Send to Backlog** is a `capture` like Flag TODO.
4. **The loop ends** when no screen is marked Change, or when he tells you to stop or go straight
   to Build. Write the Right screens into the story's acceptance criteria; the test sheet checks
   against them. Then build.

### Wrap-up after merge

When a story's PRs merge, its lead wraps up straight away without asking (see "Wrapping up"
below) and settles its helpers. A planner that sees a merged story whose lead is idle (a
"[Desk update]", `agents`, or reconciling) sends that lead one queued line: "#<n> merged: wrap up."

## Rigo's inbox

Rigo jots quick notes from email, meetings and hallway asks into an inbox on the Desk. A triage
chat proposes where each goes; Rigo approves each one on the Board, which files it.

```sh
node ~/.claude/skills/dev-desk/desk.mjs inbox                                   # notes waiting to be sorted
node ~/.claude/skills/dev-desk/desk.mjs propose <id> comment --item <url> --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs propose <id> new --repo <owner/repo> --app "<app>" --type Story --priority P2 --title "<plain title>" \
  --feature "Bid intake" --story "As an estimator, I can …, so that …" --criteria "<checkable>|<checkable>" --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs propose <id> planner --app "<app>" --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs propose <id> dismiss --reason "<why>"
node ~/.claude/skills/dev-desk/desk.mjs capture "<what Rigo was told>" --who Maddy --source "In person" --app "BizDev Leads"
```

- **Triage proposes, never files.** Search existing issues first so nothing is filed twice;
  prefer adding to an open item over a new one.
- **New items land aligned:** give each its feature (one the app already has; `context` lists
  them) and each Story a user story and acceptance criteria a test sheet can check. Then it shows
  in the right feature on the Sprint page, not under "needs setting up".
- **When Rigo approves a note for a planner, the planner is told right away** ("From Rigo's
  inbox: …"): turn it into goals or items, and say in one line what you did.
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

Features are a field, not a parent. Stories are parents: a story's pieces are its sub-issues
(see "Stories: the unit of work"). Existing parent / sub-issue links are kept.

When you **file an issue**, add it to the project and set App, Feature (or none for maintenance)
and Work type. Ask Rigo when the feature isn't obvious rather than guessing.

**A new Feature is yours to add**, never a job for Rigo in the project's settings:
`desk.mjs option Feature "<App> · <feature>" --description "<one line>"`. The hub keeps every
existing option's id, so no item loses its Feature. Then file items under it with
`desk.mjs field <repo#n> Feature "<App> · <feature>"` (`field` sets App, Status, Priority, Stage,
Work type or Sprint the same way), and file its `Feature: <name>` tracking issue.

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
