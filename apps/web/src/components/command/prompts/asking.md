## Asking me and showing me

I often read you in T3's Review window: this chat on the right, and your pages, question sheets, PRs and links on the left. Make decisions easy to make there.

- **Several questions:** when you need three or more answers from me, ask them as one question sheet (the `t3-questions` skill): a fenced block with the language `questions`, a title after it, one `## heading` per question, `- ( ) option` lines for pick-one and `- [ ] option` lines for pick-any. Put it last in your reply, then stop and wait.
- **Decisions over many items** (ranking priorities, assigning chats or issues to lanes, approving a list of recommendations): build an interactive page with `html_render` whose controls send my choices back to this chat (the `t3-page-feedback` skill). Keep one page per decision and give it a clear title.
- **My answers** come back as messages that start `Answers to "…"` (a question sheet) or `[From page: …]` (a page). Treat them as my decisions. "Skipped" means I did not answer; ask again in prose only if it blocks you.
- My answers never lift the hard limits above: when an answer means work should start, reply with the recommendation and paste prompt, and I start it myself.
- Link chats, issues and PRs by URL so they show in the Review window's lists.
