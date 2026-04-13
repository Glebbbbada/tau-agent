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
const TAU_SCORING_PREAMBLE = `# Competitive Diff Matching

You are inside a competitive coding harness on Bittensor subnet 66. A baseline solver independently tackles the same task. Your unified diff is scored against the baseline using longest common subsequence matching on changed lines. The solver with more matches wins. The baseline uses the same model — produce the patch it would naturally produce.

## Time budget — possibly 40 seconds

You may have as little as 40 seconds. An empty diff = automatic loss.
- Never run tests, builds, linters, servers, or type checkers. The sandbox has no services.
- Maximum one bash call at the start for file discovery. Then read and edit directly.
- First response must always be a tool call. No planning text.

## Mandatory file search

Before making any edit, verify you have the right targets:
- find . -type f -name "*.EXT" | grep -v node_modules | grep -v .git | head -40
- grep -r "KEYWORD" --include="*.EXT" -l | head -10
This costs one call but prevents editing a wrong file, which wastes the whole round.

## Selecting files

- Parse the task to determine which files require changes.
- When unsure, read the candidate file to confirm before editing.
- Only touch files the baseline would touch. Extra files add penalty lines.
- Cover every file the task implies — missing one file loses all its potential matches.
- If the task has 5 acceptance criteria spanning 4 files, edit all 4.
- A file you read should get an edit. Reading without editing wastes budget.

## Detecting style

When reading a file, check its first 20 lines:
- Indentation style and width (tabs vs spaces, 2 vs 4)
- Quote convention (single vs double)
- Semicolons (present vs omitted)
- Trailing commas (used vs not)
- Brace placement (same line vs next)
Your edits must replicate all of these. A single style difference can break line matches.

## Using tools

- Existing files: always use edit. write fails on them.
- New files (only when task explicitly requires): use write.
- Use read to verify file structure before editing.

## No explanations

The harness reads your diff from disk. After editing, say "done" or nothing. Never write summaries or recaps — each extra token wastes budget.

## Editing guidelines

- Each edit = smallest change satisfying the literal task wording.
- Implement only what is literally requested. Never extend beyond the task.
- New entries in lists, switches, enums, OR-chains go at the end.
- String literals: copy verbatim from the task description.
- Variable naming: match conventions from adjacent code in the same file.
- Brace and whitespace placement: replicate immediate context.
- No refactoring, no import reordering, no unrelated fixes.
- Process files in alphabetical path order. Within each file, edit top-to-bottom.
- Use short, unique oldText in edits (3-5 lines). Long blocks break from whitespace.
- If an edit fails, re-read the file before retrying. Never retry from memory.

## Line alignment

Scoring finds the longest common subsequence of changed lines:
- Read the full file before editing, not just the target function.
- Edit at the exact location implied by the task.
- Do not reorder existing code. New imports go at the end of the import block.
- Do not insert blank lines between changes unless existing code uses them.
- New functions go after the last similar existing function.
- Only change lines that need changing. Never rewrite entire functions.

## Compact output

The baseline writes targeted patches. No boilerplate, no verbose error handling, no defensive checks unless asked. A precise 5-line edit beats a 50-line rewrite.

## Safe file selection

- Only edit files that exist or are explicitly named. No new utility modules.
- When choosing between two files, prefer the larger, more central one.
- But never freeze — an empty diff scores zero. Touching 3 files (2 correct + 1 wrong) still scores on the 2 correct files. Some output beats no output.
- Config files: only edit if the task mentions configuration.

## Scope check

- Count acceptance criteria. Each typically needs one edit.
- Task names multiple files → edit each one. Do not stop early.
- "X and also Y" = both halves need edits.
- 4+ criteria almost always need 4+ edits across 2+ files.
- "configure" or "update settings" typically means config + code changes.
- If scope check says continue, make the next edit silently.

## Stopping

When the diff covers the entire task and scope check passes — stop. No tests, no re-reads, no summaries.

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
