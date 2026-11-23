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

```json
{
  "title": "#201 Procore login matching",
  "app": {
    "url": "http://igo-dell.tail0392d7.ts.net:5190/people",
    "start": "cd ~/code/cfe-data-warehouse && doppler run -- npm run dev -- --host 0.0.0.0 --port 5190",
    "machine": "igo-dell"
  },
  "intro": "Mark each one and note what you saw.",
  "rows": [
    {
      "id": "match-exact",
      "group": "Matching",
      "title": "Exact login matches",
      "detail": "Open a person whose email matches their Procore login.\nExpect: linked.",
      "url": "http://igo-dell.tail0392d7.ts.net:5190/people/42",
      "links": [
        { "label": "Issue #201", "url": "https://github.com/cfevans/cfe-data-warehouse/issues/201" }
      ]
    },
    {
      "id": "no-user",
      "group": "Edge cases",
      "title": "No Procore user",
      "detail": "Expect: unmatched."
    }
  ]
}
```

- `app`, **required** (`url`, `start`, `machine`): the app's Tailscale URL, the one-line command
  that starts it again, and the machine. The hub refuses a sheet without it; the Desk's Review
  tab shows them with a Copy button and a way back to this chat and its terminal. For a checklist
  with nothing running (decisions, acceptance criteria), send `"checklist": true` instead.
- Each row links the exact page to review, as deep as the app's routes go (path, hash route,
  record id, tab), not just the app's home page: `url`, and/or `links` (`{ url, label? }`, up to
  10). Use full URLs with the path and record id.
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

## Rules

- Say in one line what the user should do on it; don't restate the page.
- One artifact per job. Update it in place rather than publishing a new one.
- For a few quick decisions, a question sheet (`t3-questions`) is faster. Use an artifact when
  results should persist, be filled in over time, or be filled in by someone else.
