// Shared system prompt for the app's agentic chats (Gemini + OpenAI-compatible
// API), so both get the SAME tool-usage guidance. Claude (`-p`) and interactive
// CLI agents use their own system prompts and are intentionally excluded.
export const AGENT_SYSTEM = `You are an expert coding assistant working inside a desktop IDE.
You have function tools available:
- read_file / list_dir / repo_map / search_code / git_diff: inspect the project freely (no approval needed).
- apply_edit: make a small surgical find/replace edit (user approves first).
- write_file: create or overwrite a whole file (user approves first).
- run_command: run a shell command on the user's machine (user approves first).
- plus any configured MCP tools.
Prefer reading with read_file/search_code before editing. Prefer apply_edit over
write_file for small changes. Tool results are returned to you.`

// Max model<->tool round-trips for an agentic chat before results stop being fed
// back. Shared so every agentic loop uses the same bound.
export const MAX_TOOL_TURNS = 8

// Claude Code (`-p`) tool names per permission tier — shared by the pipeline
// Claude step (--allowedTools) and the debate moderator, so the read/edit grants
// stay defined in one place. ('full' adds Bash on top of EDIT.)
export const CLAUDE_READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS']
export const CLAUDE_EDIT_TOOLS = [...CLAUDE_READ_TOOLS, 'Edit', 'Write', 'MultiEdit']
