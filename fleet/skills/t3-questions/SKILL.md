---
name: t3-questions
description: Ask the user several questions at once in a T3 Code chat as a question sheet they answer in a form (pick-one or pick-any options plus a written answer for each), instead of a long list of questions in prose. Use when you need three or more decisions, clarifications or confirmations before you can continue. Answers come back as one message.
---

# Question sheets (T3 Code fleet fork)

When you need the user to answer several things, put the questions in a fenced block with the language `questions`. T3 Code turns it into a form: the user picks options, writes notes, and sends all the answers back to this chat as one message. They can answer inside the chat or in the Review window on a second screen, and half-finished answers are kept.

Use it for three or more questions. For one or two, just ask in prose.

## Format

````markdown
```questions Release plan
One or two lines of context for the whole sheet (optional).

## Ship on Friday?
Short context for this question, in markdown. Keep it to what they need to decide.
- ( ) Yes, Friday
- ( ) No, next Tuesday

## Which checks must pass first?
- [ ] Lint
- [ ] Types
- [ ] End-to-end

## Anything I should know about billing?
```
````

- Text after `questions` on the opening fence is the sheet's title.
- Each `## heading` is one question. Leading numbers ("1.") are dropped and the form numbers them.
- `- ( ) option` lines are pick-one options; `- [ ] option` lines are pick-any options. Don't mix them in one question.
- A question with no options takes a written answer. Every question also has a note box, so don't add "Other" options.
- Other text under a heading is shown as that question's context.
- Close the fence. An unclosed fence stays plain code.

## Rules

- One sheet per message, and put it last, after a sentence that says why you are asking.
- Order questions by importance. Say in the context when a question blocks your work.
- Ask only what you can't find out yourself.
- After you send the sheet, stop and wait. Don't guess the answers.

## The answers

They arrive as a user message like:

```
Answers to "Release plan" (2 of 3 answered):

1. Ship on Friday?
   Picked: No, next Tuesday
   Note: Billing freeze this week
2. Which checks must pass first?
   Skipped
3. Anything I should know about billing?
   Answer: Invoices run on the 1st
```

"Skipped" means no answer. Ask again only about skipped questions that block you, in prose. The user may correct their answers and send the sheet again; the latest answers win.
