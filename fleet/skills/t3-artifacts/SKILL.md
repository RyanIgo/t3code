---
name: t3-artifacts
description: Publish a test sheet or interactive page the user fills in and you read back later, with a stable link that works on their phone and for teammates (T3 Code fleet fork). Use for test plans, acceptance checks, QA passes and checklists of any length, or any page whose results should persist. Needs T3 Code's artifact_publish and artifact_read tools.
---

# Artifacts (T3 Code fleet fork)

An artifact lives on the user's fleet hub. It shows inline in this chat and in the Review window,
saves what people do on it as they go, and keeps a stable link (`https://<hub>/a/<id>`).

## Test sheets

For test plans and checklists, publish a sheet; you write no HTML.

```json
{
  "title": "#201 Procore login matching",
  "sheet": {
    "intro": "Run these on staging. Mark each one and note what you saw.",
    "rows": [
      {
        "id": "match-exact",
        "group": "Matching",
        "title": "Exact login matches",
        "detail": "Steps…\nExpect: linked."
      },
      {
        "id": "no-user",
        "group": "Edge cases",
        "title": "No Procore user",
        "detail": "Expect: unmatched."
      }
    ]
  }
}
```

- Each row gets Pass / Fail / Skip / Blocked and a note. Any number of rows (up to 300).
- Give rows stable ids. To change the sheet, call `artifact_publish` again with its `id`: results
  for rows you keep stay; removed rows drop out.
- When the user presses Submit with the sheet open in this chat, you get a
  `[From page: …]` message. Then call `artifact_read` and act on failed and blocked rows.
- Results entered elsewhere (phone, teammate) don't message you. Check with `artifact_read` when
  the user says they're done, or before you report on testing.

## HTML pages

Pass `html` instead of `sheet` for anything else that should persist. The page gets
`window.t3artifact`:

- `t3artifact.state`: what was last saved (`{ data, by, at }`), or null.
- `t3artifact.save(data)`: saves `data` (JSON, up to 256 KB) for everyone; resolves with the new state.
- `t3artifact.submit(text, data)`: records a submission and, in this chat, sends you `text` and `data`.
- `t3artifact.onChange(fn)`: called when someone else's save arrives.

Style it with the same theme variables as `html_render` pages.

## Rules

- Say in one line what the user should do on it; don't restate the page.
- Share the link from the tool result when the user wants it on their phone or for someone else.
- Use a question sheet (`t3-questions`) for a few quick decisions; use an artifact when results
  should persist, be checked off over time, or be filled in by someone else.
