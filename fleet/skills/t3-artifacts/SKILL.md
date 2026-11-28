---
name: t3-artifacts
description: Publish a test sheet or interactive page the user fills in and you read back later, with a stable link that works in this chat, on their phone and for teammates (T3 Code fleet fork). Use for test plans, acceptance checks, QA passes and checklists of any length, or any page whose results should persist. Needs the fleet hub.
---

# Artifacts (T3 Code fleet fork)

An artifact lives on the user's fleet hub. When your reply contains its link, T3 shows it right
under your message and in the Review window. It saves what people do as they go, and the link
(`https://<hub>/a/<id>`) works on the user's phone and for teammates they've let in.

Publish and read with the script next to this file:

```sh
node ~/.claude/skills/t3-artifacts/artifact.mjs publish spec.json   # or: ... publish - < spec.json
node ~/.claude/skills/t3-artifacts/artifact.mjs read <id>
node ~/.claude/skills/t3-artifacts/artifact.mjs list
```

(Codex: `~/.codex/skills/t3-artifacts/artifact.mjs`.) `publish` prints the id, the URL and a
markdown link. **Put that markdown link in your reply on its own line**: that is what shows the
artifact in the chat. If the script says there's no hub address, ask the user for it.

## Test sheets

For test plans and checklists, publish a sheet; you write no HTML.

Every check is a **card**: its type, the page it starts on, short steps, and what passing looks
like. No narrative checks: `publish` refuses a test sheet that isn't on this form and names what's
missing (checklists with `"checklist": true` are exempt).

```json
{
  "title": "#201 Procore login matching",
  "where": { "env": "dev", "why": "test build on igo-dell, seeded data" },
  "app": {
    "url": "http://igo-dell.tail0392d7.ts.net:5190/people",
    "start": "cd ~/code/cfe-data-warehouse && doppler run -- npm run dev -- --host 0.0.0.0 --port 5190",
    "machine": "igo-dell"
  },
  "intro": "We matched people by their Procore login. Check the matches below.",
  "rows": [
    {
      "id": "match-exact",
      "group": "Matching",
      "type": "verify",
      "title": "Exact login matches",
      "goTo": "https://igo-dell.tail0392d7.ts.net:5190/people/42",
      "steps": ["Open the person", "Look at the Procore column"],
      "pass": "Shows Linked with their Procore login"
    },
    {
      "id": "unlink",
      "type": "workflow",
      "title": "Unlink and relink",
      "goTo": "https://igo-dell.tail0392d7.ts.net:5190/people/42",
      "steps": ["Press Unlink", "Press Link, pick the same login"],
      "pass": "Linked again, nobody else changed"
    }
  ]
}
```

- `where`, **required**: `"dev"` (a machine's build or staging; it opens in T3's browser beside the
  sheet) or `"live"` (production data; it opens split screen in Rigo's own signed-in browser),
  with `why` in one line.
- `type` on every check: `verify` (look and confirm a screen), `workflow` (do the steps, check the
  result), `data` (compare numbers or records), `reconcile` (the approved mockup against the built
  screen; open a sheet with these when screens changed). The sheet shows each as a coloured card.
- `goTo`: the exact https page the check starts on, as deep as the routes go. `steps`: short
  actions, one per line. `pass`: one line, what he sees when it passes.
- The intro says what happened and what it means for him ("We fixed the 2 checks that failed;
  re-run them"), not how you built it.
- `app`, **required** (`url`, `start`, `machine`): the app's Tailscale URL, the one-line command
  that starts it again, and the machine. The hub refuses a sheet without it; the Desk's Review
  tab shows them with a Copy button and a way back to this chat and its terminal. For a checklist
  with nothing running (decisions, acceptance criteria), send `"checklist": true` instead.
- Extra pages a check needs go in `links` (`{ url, label? }`, up to 10). Never GitHub issues:
  those are for agents.
- Each row gets Pass / Fail / Skip / Blocked and a note. Up to 300 rows.
- Give rows stable ids. To change the sheet, publish again with `"id": "<id>"` added: results for
  rows you keep stay, removed rows drop out, and open copies reload.
- A row you fixed after it failed gets `"retest": "Fixed in <sha>: <what changed, what to look at>"`.
  The hub moves its result to "Before" and reopens it; the sheet opens on the re-tests. A new fix
  gets a new `retest` text; leave it unchanged otherwise.
- When the user presses Submit with the sheet open in this chat, you get a `[From page: …]`
  message. Then run `read` and act on the failed and blocked rows.
- Results entered elsewhere (phone, a teammate) don't message you. Run `read` when the user says
  they're done, or before you report on testing.

## HTML pages

For anything else that should persist, publish `{ "title": "…", "html": "…" }` (or `"htmlFile"`,
a path relative to the spec). Keep it self-contained (inline CSS, JS and images). It gets T3's
theme variables, like `html_render` pages, and `window.t3artifact`:

- `t3artifact.state`: the last save, `{ data, by, at }`, or null.
- `t3artifact.save(data)`: saves `data` (JSON, up to 256 KB) for everyone.
- `t3artifact.submit(text, data)`: records a submission and, in this chat, sends you `text` and `data`.
- `t3artifact.onChange(fn)`: called when someone else's save arrives.

## Mockups

For a story's mockup round (dev-desk "Mockup first"), publish an HTML page with one
`<section data-screen="<id>" data-title="<name>">` per screen and `<body data-round="<n>">`, and
paste `mockup-marks.html` (next to this file) at the end of the body. Rigo marks each screen Right,
Change this, Flag TODO or Not relevant, with a note, and "Send marks to the lead" sends them to you
as one message. Publish later rounds in place (same `id`, round + 1).

## Rules

- In the thread, point to the artifact in one line ("Mockup round 2 is in the side panel"); Rigo
  works on it beside the chat, not in it.

- Say in one line what the user should do on it; don't restate the page.
- One artifact per job. Update it in place rather than publishing a new one.
- For a few quick decisions, a question sheet (`t3-questions`) is faster. Use an artifact when
  results should persist, be filled in over time, or be filled in by someone else.
