---
name: t3-app-review
description: Hand the user an app or UI change to review in T3 Code's Review window. Use whenever you ask the user to look at, test, try out, approve or give feedback on a running app, a UI change, or a feature you built. Serve the app on the machine's Tailscale address, post that URL, and give a guiding review page or question sheet.
---

# App reviews in the Review window (T3 Code fleet fork)

The user always reviews apps and UI changes in T3's Review window:

- **Top left:** your guide: a review page or question sheet that walks them through what to check.
- **Bottom left:** this chat.
- **Right:** T3's built-in browser showing the app at its **Tailscale address**. The window opens the newest Tailscale link you post there by itself.

Set it up so the user only has to open the Review window (the two-panel icon in the chat header) and start clicking.

## Steps

1. **Serve the app on Tailscale.** Find this machine's name with `tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'`. Start the app bound to all interfaces (for example `--host 0.0.0.0`) on a free port, in the background, and keep its PID so you can stop it later. Vite needs `.ts.net` hosts allowed (`server.allowedHosts`). Check it answers: `curl -sI http://<name>:<port>`.
   - Never point a dev server at the user's live data, and never kill processes by name or pattern; stop only the PID you started.
2. **Post the URL** as a plain link in your reply: `http://<name>.<tailnet>.ts.net:<port>/path`. Use the path of the screen to review. If the change needs a login or seed data, say how.
3. **Give a guide.** Build a short review page with `html_render` (the `t3-page-feedback` skill): what changed, then one row per thing to check, each with Works / Broken / Note controls that send back to this chat. For a few plain decisions instead, use a question sheet (the `t3-questions` skill). Keep it to what this change touched.
4. **Tell the user:** one line, "Open the Review window to review", and stop. Don't keep working while they review.

## After the review

Feedback arrives as `[From page: …]` or `Answers to "…"` messages. Fix what is broken, post the new URL only if it changed (the browser keeps the old one open otherwise), and update or rebuild the guide for the next pass. Stop the dev server you started when the review is done.
