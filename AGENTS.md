# Diff Scoring Competition

Your unified diff is evaluated against a baseline diff using longest common subsequence matching. The agent with more matched changed lines wins the round.

Two ways to lose:
1. **Extra lines** — editing files or lines the baseline didn't touch inflates your diff with zero-match content.
2. **Style mismatch** — correct changes with wrong formatting (spaces vs tabs, quote style) won't match.

## Workflow

1. First response must be a tool call. Never start with text.
2. Run one bash command to locate target files before editing anything.
3. Read each file completely before making changes.
4. Apply the smallest edit that satisfies the task literally — nothing more.
5. Process files alphabetically by path, top-to-bottom within each file.
6. When done, stop. No summaries, no tests, no re-reads.

## Time Pressure

Budget may be as short as 40 seconds. Never run tests, builds, linters, or type checkers — the sandbox has no running services. Each wasted tool call may cost you the round.

## Finding Files

Before your first edit:
- `find . -type f -name "*.EXT" | grep -v node_modules | grep -v .git | head -40`
- `grep -r "KEYWORD" --include="*.EXT" -l | head -10`
One search prevents editing the wrong file, which wastes the entire budget.

## File Selection

- Read the task and identify exactly which files need changes.
- When uncertain, read the candidate file to verify before editing.
- Touch only files the baseline would touch. Extra files = pure penalty.
- But cover ALL files implied by the task — skipping a file loses every potential match in it.
- If you read a file, edit it. Reading without editing wastes budget.

## Style Rules

Before editing a file, observe from its first 20 lines:
- Tabs or spaces? Width?
- Single or double quotes?
- Semicolons present?
- Trailing commas used?
- Braces on same line or next?
Every edit must replicate these exactly. One mismatch can prevent line matches.

## Edit Technique

- Use the `edit` tool for existing files. `write` only for genuinely new files.
- Short, unique oldText (3-5 lines). Long blocks break from whitespace differences.
- If an edit fails, re-read the file before retrying. Never retry from memory.
- Implement only what the task literally requests. No logical extensions.
- New entries in lists, switches, enums go at the end.
- Do not reorder existing code. New imports go at the end of the import block.
- Do not add blank lines between changes unless existing code does.

## Scope Verification

Before stopping, count acceptance criteria bullets. Each typically requires at least one edit.
- Task names multiple files → edit each one.
- "X and also Y" → both need changes.
- 4+ criteria usually need changes in 2+ files.
- "configure X" often means config file + code that uses it.
- Under 30 diff lines on a multi-criteria task = probably incomplete.

## Output Rules

- No verification, no re-reads after editing, no explanations.
- Never produce an empty diff — a partial solution beats nothing.
- Write compact code. No boilerplate, no defensive checks unless asked.
