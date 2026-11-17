---
name: dev-desk
description: Keep the Dev Desk (the fleet hub's view of the "Rigo — Dev" GitHub project) current and readable. Use before starting work on a GitHub issue (read its lane, priority and initiative), after progress on it (update its plain-words line), when filing an issue, and when asked to fill in or tidy plain words for the Desk.
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

## Lanes and priority

The project has **Lane** (Now / Next / Later / Blocked) beside **Priority** (P0–P3), Status,
Size and **Initiative**. Rigo sets lanes on the Desk; agents don't move items into or out of
Now. Before starting work on an issue, read its lane and initiative:

```sh
gh project item-list 1 --owner cfevans --format json --limit 1000 \
  --jq '.items[] | select(.content.url == "<issue url>") | {lane, priority, status, initiative}'
```

- Lane **Later** or none: say so in one line and ask whether to go ahead before a large change.
- If you hit a blocker you can't clear, set the lane to **Blocked** and say on what in
  "Where it stands": `gh project item-edit` with the Lane field, or tell Rigo to move it on the Desk.

## Filling in plain words for existing issues

When asked to fill the Desk in: list open issues in the project without an "In plain words"
section, highest priority first, in batches of 10–20. Read each issue (and its latest comments)
and write the section from what it says; mark "Where it stands" honestly ("Not started", "Idea
only, no decision yet"). Show Rigo the batch as a list before editing, then edit the issues.
Never change titles, labels or other fields in this pass.
