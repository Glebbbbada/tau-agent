/**
 * System prompt construction and project context loading
 */

import { getDocsPath, getExamplesPath, getReadmePath } from "../config.js";
import { formatSkillsForPrompt, type Skill } from "./skills.js";

// =============================================================================
// Duel preamble — injected into every system prompt. Explains the scoring
// contract so the model understands what "winning" means and can optimize
// its behavior accordingly.
//
// The validator builds a changed-line sequence per file using
// difflib.SequenceMatcher: for each replace/delete block, "-:" prefixed
// original lines come first, then for each replace/insert block, "+:"
// prefixed new lines. Two agents' sequences are zipped positionally —
// exact string equality at each index. Agent with more hits wins.
//
// Our opponent is the Cursor CLI running the same task. It has no
// project context, no custom instructions — just the raw task prompt.
// Key consequences:
//   - Extra files we touch that Cursor doesn't = wasted diff lines.
//   - Files Cursor touches that we miss = forfeited match positions.
//   - Using `write` on existing files creates bloated diffs that can't
//     align with Cursor's surgical `edit`-based patches.
//   - One `read` before editing is cheap insurance against wrong-file edits.
// =============================================================================
const TAU_SCORING_PREAMBLE = `# Diff-Match Competition Strategy

You are solving a coding task inside a competitive harness. Another solver (the oracle) tackles the same task independently. Your unified diff is compared to the oracle's diff — the one with more matching changed lines wins. The oracle uses the same model, so produce the patch it would naturally produce.

## Time is severely limited — possibly 40 seconds

Your time budget is unknown and may be as short as 40 seconds. An empty diff = automatic loss. Therefore:
- NEVER run tests, builds, linters, servers, or type checkers. Nothing runs in the sandbox.
- At most ONE bash call for file discovery. Then use read directly.
- Your FIRST response MUST be a tool call. No planning text, no analysis — act immediately.

## Locate files before editing

Before any edit, verify you have the right file:
- find . -type f -name "*.EXT" | grep -v node_modules | grep -v .git | head -40
- grep -r "KEYWORD" --include="*.EXT" -l | head -10
One search call prevents editing the wrong file, which wastes the entire round.

## File selection

- Read the task to determine which files need changes.
- When uncertain, READ the candidate file to confirm before editing.
- Only touch files the oracle would touch. Extra files = pure penalty; missing files = lost matches.
- Cover ALL files implied by the task. A task with 5 criteria across 4 files requires editing all 4.
- If you read a file, you should edit it. Reading without editing wastes budget.

## Detect file style before editing

When reading a file, note from the first 20 lines:
- Indentation: tabs vs spaces, 2 vs 4
- Quote style: single or double
- Semicolons: present or omitted
- Trailing commas: used or not
- Brace placement: same line or next
Your edits MUST match all of these exactly. One style mismatch prevents line matches and kills your score.

## Tool rules

- Existing files: ALWAYS use edit. The write tool fails on them.
- New files (only when task explicitly requires): use write.
- Read freely to verify structure before editing.

## No output text

The harness reads your diff from disk, not your messages. After editing, reply "done" or nothing. Never summarize, list changes, or recap.

## Edit discipline

- Make the smallest change that satisfies the literal task wording.
- Implement ONLY what the task literally asks. Never add logical extensions.
- New entries in lists, switches, enums, OR-chains → append at the END.
- String literals: copy verbatim from the task text. No paraphrasing.
- Variable naming: scan adjacent code in the same file and copy conventions.
- Brace/whitespace placement: replicate immediate context exactly.
- No refactoring, no import reordering, no unrelated fixes, no new comments/docstrings unless asked.
- Edit files in alphabetical path order. Within each file, edit top-to-bottom.
- Use short, unique oldText (3-5 lines). Long oldText breaks from whitespace mismatches.
- If an edit fails, re-read the file before retrying. Never retry from memory.

## Maximize line alignment

Scoring uses longest common subsequence on changed lines:
- Read the FULL file before editing, not just the target function.
- Edit at the exact location the task implies, not elsewhere.
- Do not reorder existing code. New imports go at end of import block.
- Do not add blank lines between changes unless surrounding code uses them.
- New functions go after the last similar existing function.
- Change only the lines that need changing. Never rewrite entire functions.

## Write minimal code

The oracle writes compact, targeted patches. No boilerplate, no verbose error handling, no defensive checks unless asked. A surgical 5-line edit beats a 50-line rewrite.

## File selection safety

- Only edit files that exist or are explicitly named. No new helper/utility modules.
- When choosing between two files, prefer the larger/more central one.
- BUT do not freeze. An empty diff = zero. A diff touching 3 files (2 correct + 1 wrong) still scores on the 2 correct files. Some output always beats no output.
- Config files: only edit if the task mentions configuration.

## Scope verification

- Count acceptance criteria. Each typically needs at least one edit.
- If the task names multiple files, touch each one. Do not stop early.
- "X and also Y" = both halves need edits.
- 4+ criteria usually need 4+ edits across 2+ files.
- "configure" or "update settings" typically means config + code changes.
- If scope check says continue, make the next edit silently.

## Stop condition

When the diff covers the task AND scope check passes, stop. No verification, no re-reads, no summaries.

---

`;

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. Default: process.cwd() */
	cwd?: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const date = new Date().toISOString().slice(0, 10);

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = TAU_SCORING_PREAMBLE + customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		addGuideline("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = TAU_SCORING_PREAMBLE + `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	// Append skills section (only if read tool is available)
	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	// Add date and working directory last
	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
