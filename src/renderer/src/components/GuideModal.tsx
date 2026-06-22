import { useState } from 'react'
import { Z } from '../zIndex'

// In-app walkthrough. Searchable, sectioned reference for what the app does and
// how the pieces fit together. Opened from the top bar (? Guide) and auto-shown
// once on first run.
interface Section {
  title: string
  kw: string
  body: JSX.Element
}

const P = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <p className="text-gray-300">{children}</p>
)
const Li = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <li className="text-gray-300">{children}</li>
)
const K = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <span className="rounded bg-bg px-1 font-mono text-[11px] text-accent">{children}</span>
)

const SECTIONS: Section[] = [
  {
    title: 'What this is',
    kw: 'overview intro cockpit orchestrate start',
    body: (
      <P>
        A cockpit for running several AI coding agents side by side — command-line agents (Claude Code, Gemini
        CLI, Aider, …), OpenAI-compatible API chats, native Gemini, and MCP tools — with a shared context pool,
        cross-model debate, saved pipelines, git-worktree isolation, and a scheduler. The app orchestrates
        processes; it does no web scraping or browser automation.
      </P>
    )
  },
  {
    title: 'Agents & API providers',
    kw: 'agent api provider cli claude gemini openai groq ollama add keys model',
    body: (
      <>
        <P>Three ways to run a model, added from the top-bar menus:</P>
        <ul className="ml-4 list-disc space-y-1">
          <Li>
            <b>+ Agent</b> — a command-line agent in a real terminal (its own login/billing; not metered here).
          </Li>
          <Li>
            <b>+ API</b> — any OpenAI-compatible provider (OpenAI, Groq, Mistral, OpenRouter, Ollama) or Gemini.
            Keys live in the OS keychain. Per-panel model picker.
          </Li>
          <Li>
            <b>Gemini</b> panel — native streaming chat.
          </Li>
        </ul>
        <P>API + Gemini chats share the same built-in tools and the same tool-usage system prompt, so they behave alike.</P>
      </>
    )
  },
  {
    title: 'Context pool & built-in tools',
    kw: 'context files repo map inject mention tools read write search',
    body: (
      <>
        <P>
          Check files in the file tree (or <K>@</K>-mention them) to ride them along with every prompt-controlled
          agent. A <b>repo map</b> (symbol outline) can be pinned in too. CLI agents get an &quot;inject context&quot; button.
        </P>
        <P>
          Tools: read-only auto tools (<K>read_file</K>, <K>list_dir</K>, <K>repo_map</K>, <K>search_code</K>,{' '}
          <K>git_diff</K>) plus gated <K>apply_edit</K> / <K>write_file</K> / <K>run_command</K> and all MCP tools.
        </P>
      </>
    )
  },
  {
    title: 'Debate',
    kw: 'debate compare two participants rounds synthesis critique',
    body: (
      <P>
        Pick any two usable participants; they propose/critique over N rounds, then one synthesizes. Rounds are
        analysis-only (Claude is constrained to read tools); the synthesis step (which may edit) is gated behind
        your explicit approval. Cancellable mid-run.
      </P>
    )
  },
  {
    title: 'Pipelines',
    kw: 'pipeline chain steps dag deps condition map template model effort permission dry-run shell',
    body: (
      <>
        <P>Chain participants so each step&apos;s output feeds the next. Per step you set:</P>
        <ul className="ml-4 list-disc space-y-1">
          <Li>model + reasoning effort, and a permission preset (read-only / edit / full).</Li>
          <Li>
            <b>inputs</b> (which earlier steps feed it — fan-in), an <b>only-if-contains</b> condition, and{' '}
            <b>map</b> (run once per input line).
          </Li>
        </ul>
        <P>
          <b>Templates</b> seed role chains (e.g. plan → implement → review). <b>Dry-run</b> reports intended actions
          without executing. A <b>full</b> step runs shell only if you tick <b>allow shell</b> (off by default).
        </P>
      </>
    )
  },
  {
    title: 'Isolation & Review',
    kw: 'isolation worktree branch review merge discard diff git parallel',
    body: (
      <>
        <P>
          Each CLI-agent session and each pipeline run works in its own git worktree on its own branch (needs a git
          repo with a commit; otherwise it falls back to the shared folder). So parallel agents can&apos;t stomp each
          other, and an agent is confined to a branch.
        </P>
        <P>
          The <b>Review</b> panel lists each branch, shows its diff vs the fork point, and offers <b>Merge</b>{' '}
          (squash into base) or <b>Discard</b>. Idle worktrees (nothing changed) are auto-cleaned on launch.
        </P>
      </>
    )
  },
  {
    title: 'Runs & Schedules',
    kw: 'runs background scheduled job interval daily git trigger cron automate',
    body: (
      <>
        <P>
          The <b>Runs</b> panel shows every pipeline run — manual, background, or scheduled — live, even if you
          closed the panel it started from. Runs are serialized (one at a time).
        </P>
        <P>
          <b>Settings → Schedules</b>: run a saved pipeline on a trigger — every N minutes, daily at a time, or on
          a git/file change. Scheduled runs are unattended (autonomous) and edit on a branch for later review. They
          fire only while the app is open.
        </P>
      </>
    )
  },
  {
    title: 'Safety & approvals',
    kw: 'safety security approval danger denylist cost cap secret git protected confirm trust',
    body: (
      <>
        <P>Main is the authority for anything with side effects. Defaults are safe; tune them in Settings → Security:</P>
        <ul className="ml-4 list-disc space-y-1">
          <Li>Commands/edits/tool-calls are gated; a dangerous-command denylist always requires an explicit card.</Li>
          <Li>Session <b>cost cap</b> (Settings → Budget) bounds spend, including scheduled runs.</Li>
          <Li>Writes to <K>.git/</K> and <K>node_modules/</K> are blocked; secret files (<K>.env</K>, keys) aren&apos;t read by tools.</Li>
          <Li>
            Knobs: <b>always require approval</b> (restrict), <b>default allow-shell</b> and <b>allow protected
            writes</b> (loosen).
          </Li>
        </ul>
        <P>Note: CLI agents run their own tooling and are governed by that tool&apos;s own permissions — treat them like running that CLI yourself.</P>
      </>
    )
  },
  {
    title: 'Keys, MCP & data',
    kw: 'keys keychain mcp server privacy data clear history local',
    body: (
      <P>
        API keys are stored in the OS keychain. Add MCP servers in Settings → MCP. Chat/run history is stored
        unencrypted on this machine — clear it any time in Settings → Security, where you can also stop persisting
        run output text.
      </P>
    )
  }
]

export default function GuideModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const shown = query
    ? SECTIONS.filter((s) => (s.title + ' ' + s.kw).toLowerCase().includes(query))
    : SECTIONS

  return (
    <div
      style={{ zIndex: Z.modal ?? 1000 }}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[44rem] max-w-full flex-col rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="font-semibold text-accent">Guide</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the guide…"
            className="ml-2 flex-1 rounded border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <button className="rounded border border-border px-2 py-0.5 text-xs text-gray-300 hover:bg-bg" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {shown.map((s) => (
            <section key={s.title} className="space-y-1.5">
              <h3 className="font-semibold text-gray-100">{s.title}</h3>
              {s.body}
            </section>
          ))}
          {shown.length === 0 && <p className="text-gray-500">No section matches “{q}”.</p>}
        </div>
      </div>
    </div>
  )
}
