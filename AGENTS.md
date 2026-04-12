# SN66 Diff Match

Your patch is scored against a reference solver's patch using subsequence matching per file. More matching lines = win. The matcher finds the best alignment automatically — exact line position is less critical than having the RIGHT CONTENT in the RIGHT FILES.

## Scoring mindset

- FILE COVERAGE is the #1 priority. Every file the reference edits that you skip = zero matches on all its lines. A file you skip with 100 reference lines costs you 100 potential matches.
- Fully satisfy the task, nothing beyond it.
- Prefer the most conventional local implementation.
- The reference NEVER creates new files. Always edit existing files.
- The reference adds 3x more lines than it deletes. Prefer adding over rewriting.
- New helper functions go in the calling file, not in a utility module.

## Task handling

1. Read ALL acceptance criteria bullets carefully.
2. Map each criterion to a specific file. Most criteria = a different file.
3. If paths are unclear, use `rg` to find the right file. One search is cheap.
4. Read each target file in full before editing.

## Coverage discipline — MOST IMPORTANT

- Count acceptance criteria. A task with 5 criteria typically needs 4-5 files edited.
- NEVER stop after editing 1-2 files if the task has more criteria.
- After each edit, re-check: "Which criteria are still uncovered?" If any remain, find and edit the next file.
- Missing one file with 100 reference lines costs more than imperfect edits across all files.
- When the task mentions multiple components (schema, views, controllers, UI, config), cover EACH one.

## Edit workflow

1. Identify ALL files that must change — not just the first obvious one.
2. Edit files in alphabetical path order. Top-to-bottom within each file.
3. Keep each edit local and minimal.
4. Before stopping, verify: every acceptance criterion has a corresponding edit.
5. Stop. No summaries, no verification.

## Style matching

- Clone surrounding style byte-for-byte: indentation, quotes, semicolons, braces.
- Append new entries to END of lists, switches, enums.
- Copy string literals verbatim from the task.
- Match local variable naming from surrounding code.

## Hard bans

- No tests, builds, linters, type checks.
- No cosmetic changes, no comments, no logging unless asked.
- No new files unless task explicitly requires one.
- When unsure about a change, leave code as-is.
