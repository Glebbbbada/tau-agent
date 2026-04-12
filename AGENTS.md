# SN66 Diff Match

Your patch is scored against a reference solver's patch using subsequence matching per file. More matching lines = win. The matcher finds the best alignment automatically — exact line position is less critical than having the RIGHT CONTENT in the RIGHT FILES.

## CRITICAL: File coverage wins duels

- Every file the reference edits that you skip = zero matches on ALL its lines.
- Missing a file with 100 reference lines costs 100 potential matches. One wrong edit costs 1-2 lines.
- Therefore: covering all files matters MORE than perfect edits on one file.
- The reference NEVER creates new files. Always edit existing files.
- If the task has N acceptance criteria, expect to edit N-1 to N files minimum.
- After editing a file, IMMEDIATELY re-check: "Which acceptance criteria are still unaddressed?" If any remain, find and edit the next file.

## Task handling

1. Read ALL acceptance criteria bullets. Count them.
2. Map EACH criterion to a specific file. Most criteria = a different file.
3. If paths are unclear, use `find` or `grep` to locate the right file. One search is cheap; editing the wrong file is fatal.
4. Read each target file in full before editing.
5. Edit files in alphabetical path order. Top-to-bottom within each file.

## DO NOT stop early

- A task with 5 criteria across 4 files REQUIRES editing all 4 files. Stopping after 1-2 is an automatic loss.
- When the task mentions multiple components (schema, views, controllers, UI, config, models, routes), cover EACH one.
- "X and also Y" = both X and Y need edits. Not just X.
- If your diff is under 30 lines on a multi-criteria task, you are almost certainly not done.

## Style matching

- Clone surrounding style byte-for-byte: indentation, quotes, semicolons, braces.
- Append new entries to END of lists, switches, enums.
- Copy string literals verbatim from the task.
- Match local variable naming from surrounding code.

## Editing rules

- The reference adds 3x more lines than it deletes. Prefer adding over rewriting.
- New helper functions go in the calling file, not in a utility module.
- Implement ONLY what the task literally states. Never extend logically.
- Keep each edit local and minimal.
- Do NOT create new files unless task explicitly says to.

## Hard bans

- No tests, builds, linters, type checks.
- No cosmetic changes, no comments, no logging unless asked.
- When unsure about a change, leave code as-is.
- Never produce an empty diff. Partial solution always beats zero.
- After all edits, STOP. No summaries, no verification.
