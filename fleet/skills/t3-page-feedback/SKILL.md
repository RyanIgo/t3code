---
name: t3-page-feedback
description: Build an interactive page in a T3 Code thread that sends the user's choices straight back to the chat. Use when the user should decide, rank, approve, pick, rate or fill something in, and a page with controls beats asking in text (priority lists, plans to approve, options to compare, forms, sliders). Needs T3 Code's html_render tool.
---

# Interactive pages with feedback (T3 Code fleet fork)

A page you publish with `html_render` can send the user's input back into this chat. Use it when a decision is easier to make by clicking than by typing: approve or defer items, rank priorities, pick between options, fill a short form, tune numbers.

## How it works

The page posts a message to its parent window, and T3 Code turns it into one of three things:

| Action    | Effect                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send`    | Sent to you as the user's message right away, as `[From page: <title>]`, the text, then the data as JSON. Queued if you are mid-turn.                                |
| `draft`   | Put in the user's composer to edit before sending. Use when they may want to add words.                                                                              |
| `context` | Keeps one line `[Page: <title>] <text>` in the composer, replaced on each update, sent with their next message. Use for live state such as filters or slider values. |

T3 Code only accepts these right after the user clicks or types inside the page. Call them from event handlers (click, change, submit), never on load or on a timer.

## The helper

Paste this into the page's `<script>` and call `t3.send`, `t3.draft` or `t3.context`. Each returns a promise of `true` when T3 Code took it.

```html
<script>
  const t3 = (() => {
    let next = 0;
    const waiting = new Map();
    addEventListener("message", (event) => {
      const m = event.data;
      if (m && m.type === "t3-page:result" && waiting.has(m.id)) {
        waiting.get(m.id)(m.ok === true);
        waiting.delete(m.id);
      }
    });
    const post = (action, text, data) =>
      new Promise((resolve) => {
        const id = String(++next);
        waiting.set(id, resolve);
        parent.postMessage({ type: `t3-page:${action}`, id, text, data }, "*");
        setTimeout(() => {
          if (waiting.delete(id)) resolve(false);
        }, 8000);
      });
    return {
      send: (text, data) => post("send", text, data),
      draft: (text, data) => post("draft", text, data),
      context: (text) => post("context", text),
    };
  })();
</script>
```

## Rules for good pages

- **Title** names the decision ("Approve this week's priorities"). It labels every message the page sends.
- **One decision per page**, with one clear Submit button. Disable it after a send, and show "Sent" on `true`, or "Couldn't send. Tell me in the chat instead." on `false`.
- **`text` is a one-line human summary** ("Approve #12, #15; defer #9"). **`data` is the full structured result** you will act on (`{ approve: [12, 15], defer: [9] }`). Keep data small: ids and choices, not copies of content.
- **Use `context`** only for state worth carrying into the next message, such as a selected filter. Keep it to one short line.
- **Make every state change visible.** A selected option must look clearly different in light and dark themes: fill it with `var(--primary)` and `var(--primary-foreground)` (or a status color such as `var(--success)`, `var(--warning)`, `var(--destructive)`), and add a check mark or bold label. Never mark selection with `--secondary`, `--muted`, `--card` or `--accent-surface`: in some themes they match the background, so the click looks like it did nothing. Show a running count such as "3 of 8 decided".
- Follow `html_render`'s theme and layout rules, check the page with `html_preview` first, and keep it self-contained.
- After publishing, say in one line what the user should do on the page. When their `[From page: …]` message arrives, act on its `data`, and confirm what you did.

## Example: approve or defer

```html
<form id="f">
  <label><input type="checkbox" name="approve" value="12" checked /> #12 Fix login timeout</label>
  <label><input type="checkbox" name="approve" value="15" /> #15 Board drift report</label>
  <button id="go" type="submit">Approve selected</button> <span id="state"></span>
</form>
<script>
  /* helper from above */
  document.getElementById("f").addEventListener("submit", async (event) => {
    event.preventDefault();
    const all = [...document.querySelectorAll("input[name=approve]")];
    const approve = all.filter((i) => i.checked).map((i) => Number(i.value));
    const defer = all.filter((i) => !i.checked).map((i) => Number(i.value));
    document.getElementById("go").disabled = true;
    const ok = await t3.send(
      `Approve ${approve.map((n) => "#" + n).join(", ") || "none"}; defer ${defer.map((n) => "#" + n).join(", ") || "none"}`,
      { approve, defer },
    );
    document.getElementById("state").textContent = ok
      ? "Sent"
      : "Couldn't send. Tell me in the chat instead.";
    if (!ok) document.getElementById("go").disabled = false;
  });
</script>
```

## Example: drag to rank

Use this for priority lists. Rows drag by their handle (mouse and touch); the ↑/↓ buttons do the same from the keyboard. Send the final order as data.

```html
<ol id="rank"></ol>
<button id="save" type="button">Save order</button> <span id="state"></span>
<style>
  #rank {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  #rank li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    touch-action: none;
  }
  #rank li.dragging {
    outline: 2px solid var(--primary);
    opacity: 0.85;
  }
  #rank .grip {
    cursor: grab;
    color: var(--muted-foreground);
    user-select: none;
  }
  #rank .n {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
    min-width: 1.5em;
    text-align: right;
  }
  #rank li span.title {
    flex: 1;
  }
  #rank button {
    font: inherit;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
    border-radius: 6px;
    padding: 0 6px;
    cursor: pointer;
  }
</style>
<script>
  /* helper from above */
  const items = [
    { id: 12, title: "Fix login timeout" },
    { id: 15, title: "Board drift report" },
    { id: 9, title: "Upgrade vitest" },
  ];
  const list = document.getElementById("rank");
  function render() {
    list.innerHTML = "";
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="grip" aria-hidden="true">⠿</span><span class="n">${index + 1}</span><span class="title">#${item.id} ${item.title}</span><button type="button" aria-label="Move up">↑</button><button type="button" aria-label="Move down">↓</button>`;
      const [up, down] = li.querySelectorAll("button");
      up.onclick = () => move(index, index - 1);
      down.onclick = () => move(index, index + 1);
      li.querySelector(".grip").addEventListener("pointerdown", (event) =>
        startDrag(event, li, index),
      );
      list.appendChild(li);
    });
  }
  function move(from, to) {
    if (to < 0 || to >= items.length) return;
    items.splice(to, 0, items.splice(from, 1)[0]);
    render();
  }
  function startDrag(event, li, from) {
    event.preventDefault();
    li.classList.add("dragging");
    const rows = [...list.children];
    const onMove = (e) => {
      const over = rows.findIndex((row) => {
        const r = row.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      const target = over === -1 ? rows.length - 1 : over > from ? over - 1 : over;
      list.insertBefore(li, over === -1 ? null : rows[over]);
      li.dataset.to = String(target);
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      li.classList.remove("dragging");
      move(from, li.dataset.to === undefined ? from : Number(li.dataset.to));
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  }
  render();
  document.getElementById("save").onclick = async () => {
    const order = items.map((item) => item.id);
    const ok = await t3.send(`Priority order: ${order.map((id) => "#" + id).join(" > ")}`, {
      order,
    });
    document.getElementById("state").textContent = ok
      ? "Sent"
      : "Couldn't send. Tell me in the chat instead.";
  };
</script>
```
