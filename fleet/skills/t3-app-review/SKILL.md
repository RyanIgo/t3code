---
name: t3-app-review
description: Hand the user an app or UI change to review in T3 Code's Review window. Use whenever you ask the user to look at, test, try out, approve or give feedback on a running app, a UI change, or a feature you built. Serve the app on the machine's Tailscale address, then publish a fleet hub test sheet that carries the app's URL and the command to restart it.
---

# App reviews in the Review window (T3 Code fleet fork)

The user always reviews apps and UI changes in T3's Review window:

- **Top left:** the test sheet, a fleet hub artifact (the `t3-artifacts` skill). It always starts with the app's Tailscale URL and the command to start it again.
- **Bottom left:** this chat.
- **Right:** T3's built-in browser showing the app at its **Tailscale address**. The window opens the newest Tailscale link you post there by itself.

Set it up so the user only has to open the Review window (the two-panel icon in the chat header) and start clicking. **Always use this flow**: a hub test sheet, not an `html_render` page, a question sheet or a Claude Doc. Fall back only if the `t3-artifacts` script is missing or can't reach the hub, and say so in one line.

## Steps

1. **Start the app on Tailscale, yourself.** Find this machine's name with `tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'`. Start the app bound to all interfaces (for example `--host 0.0.0.0`) on a free port, in the background, and keep its PID so you can stop it later. Vite needs `.ts.net` hosts allowed (`server.allowedHosts`). Check it answers: `curl -sI http://<name>:<port>`.
   - Never point a dev server at the user's live data, and never kill processes by name or pattern; stop only the PID you started.
   - Write down the exact **start command**: one line the user can paste into a terminal on this machine, with the folder, the secret provider and the port, for example `cd ~/code/app/.t3/worktrees/fix-42 && doppler run -- npm run dev -- --host 0.0.0.0 --port 5190`. Background dev servers often stop before the user gets back to them, so they need it.
2. **Publish the test sheet** with the `t3-artifacts` script (see that skill for the spec):
   - `title`: what is under review, e.g. `Review — PR cfe-drawings #94 sheet compare`.
   - `intro`, always in this order:
     - `App: <the Tailscale URL of the screen to review>`
     - `If the app doesn't load, start it on <machine>: <start command>` and `(or tell me "restart the app")`
     - what changed, in a sentence or two; any login or seed data needed.
   - One row per thing to check, only what this change touched: `title` as the user would say it, and `detail` with the exact URL to open, the steps and what to expect.
3. **Post in your reply**, each on its own line:
   - the app link, `http://<name>.<tailnet>.ts.net:<port>/path` (this opens it on the right),
   - the sheet's markdown link from the script (this shows the sheet),
   - `Start command (if the app stopped): <start command>` in a code span.
4. **Tell the user:** one line, "Open the Review window to review", and stop. Don't keep working while they review.

## After the review

- When the user presses Submit you get a `[From page: …]` message. Read the results with the script's `read <id>` (also do this when they say they're done; results from a phone don't message you).
- If they say the app is down, run the start command yourself and confirm it answers.
- Fix what failed. Republish the same sheet with its `id` and a "Fixed in <short sha>, retest" line in that check's detail; results for unchanged checks stay. Post the app link again only if it changed (the browser keeps the old one open otherwise).
- Stop the dev server you started (by its PID) when the review is done, and say so.
