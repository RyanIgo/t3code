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
  ready for Rigo. The board also moves a card forward when it sees an open PR or a working agent,
  but the field is the record. Done is set by merging or closing, or by Rigo.
- If you hit a blocker you can't clear, set Lane to **Blocked** (the card shows a Blocked flag) and
  say on what in "Where it stands". Clear it when unblocked.

## Filling in plain words for existing issues

When asked to fill the Desk in: list open issues in the project without an "In plain words"
section, highest priority first, in batches of 10–20. Read each issue (and its latest comments)
and write the section from what it says; mark "Where it stands" honestly ("Not started", "Idea
only, no decision yet"). Show Rigo the batch as a list before editing, then edit the issues.
Never change titles, labels or other fields in this pass.
