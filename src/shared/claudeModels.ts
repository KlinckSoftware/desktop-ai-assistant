// Single source of truth for the Claude model + effort option lists shown in
// SettingsModal and PipelinePanel. The `claude` CLI has no model-enumeration
// subcommand (checked: `claude --help` only exposes `--model <alias-or-name>`
// with no listing command), so this hardcoded list is served through the same
// IPC channel a future dynamic source would use — no renderer change needed
// if that ever changes.

// '' = use the claude CLI's own default; tier aliases resolve to the latest model of that family.
export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: '', label: 'CLI default' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-opus-4-5', label: 'Opus 4.5' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-0', label: 'Sonnet 4' },
  { value: 'claude-opus-4-0', label: 'Opus 4' },
  { value: 'sonnet', label: 'Sonnet (alias → latest)' },
  { value: 'opus', label: 'Opus (alias → latest)' },
  { value: 'haiku', label: 'Haiku (alias → latest)' }
]

export const CLAUDE_EFFORT: { value: string; label: string }[] = [
  { value: '', label: 'default' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh (extended thinking)' },
  { value: 'max', label: 'max (maximum thinking)' }
]
