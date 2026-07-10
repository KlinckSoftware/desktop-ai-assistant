import { CLAUDE_MODELS, CLAUDE_EFFORT } from '../../shared/claudeModels'

// The `claude` CLI has no model-enumeration subcommand — checked `claude --help`
// (Commands: agents, auth, auto-mode, doctor, gateway, install, mcp, plugin,
// project, setup-token, ultrareview, update; none list models) and the
// `--model <model>` flag docs (accepts an alias or a full name, nothing to
// query). So there's no reliable dynamic source to shell out to today.
//
// This still goes through an async function + IPC channel (mirroring Gemini's
// listModels()) so that if Anthropic ever ships a real enumeration path, only
// this function needs to change — no renderer/IPC surface changes required.
//
// Cached in-memory for the app session since the list is static; recomputing
// per-call would be wasted work once a real dynamic source lands here.
let cached: { models: typeof CLAUDE_MODELS; effort: typeof CLAUDE_EFFORT } | null = null

export interface ClaudeModelList {
  models: { value: string; label: string }[]
  effort: { value: string; label: string }[]
}

export async function listClaudeModels(): Promise<ClaudeModelList> {
  if (cached) return cached
  cached = { models: CLAUDE_MODELS, effort: CLAUDE_EFFORT }
  return cached
}
