import { useMemo, useState } from 'react'
import { Z } from '../zIndex'

// In-app guide: a topic list on the left + a detailed how-to page on the right
// (mirrors the Settings layout). Pages cross-link to each other. Searchable.

type Go = (id: string) => void

const K = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <span className="rounded bg-bg px-1 font-mono text-[11px] text-accent">{children}</span>
)
const H = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <h4 className="mt-3 font-semibold text-gray-100">{children}</h4>
)
const Steps = ({ items }: { items: React.ReactNode[] }): JSX.Element => (
  <ol className="ml-4 list-decimal space-y-1 text-gray-300">
    {items.map((it, i) => (
      <li key={i}>{it}</li>
    ))}
  </ol>
)
const P = ({ children }: { children: React.ReactNode }): JSX.Element => <p className="text-gray-300">{children}</p>

interface Topic {
  id: string
  title: string
  kw: string
  body: (go: Go) => JSX.Element
}

const Link = (go: Go, id: string, label: string): JSX.Element => (
  <button className="text-accent underline-offset-2 hover:underline" onClick={() => go(id)}>
    {label}
  </button>
)

const TOPICS: Topic[] = [
  {
    id: 'start',
    title: 'Getting started',
    kw: 'overview intro start first run setup begin',
    body: (go) => (
      <div className="space-y-2">
        <P>
          This is a cockpit for running several AI coding agents side by side — CLI agents, OpenAI-compatible API
          chats, native Gemini, and MCP tools — with a shared context pool, debate, pipelines, git-worktree
          isolation, and a scheduler.
        </P>
        <H>First steps</H>
        <Steps
          items={[
            <>
              Open <b>⚙ Settings → Keys</b> and add a key for at least one provider (or install a CLI agent). See{' '}
              {Link(go, 'agents', 'Agents & APIs')}.
            </>,
            <>
              Add an agent from the top bar (<b>＋ Agent</b> / <b>＋ API</b>), or use the Gemini panel.
            </>,
            <>
              Check files in the tree so they ride along with prompts — {Link(go, 'context', 'Context & tools')}.
            </>,
            <>
              Try {Link(go, 'pipelines', 'Pipelines')} or {Link(go, 'debate', 'Debate')} once two models are usable.
            </>
          ]}
        />
        <P>Everything that edits files or runs commands is gated — see {Link(go, 'safety', 'Safety & approvals')}.</P>
      </div>
    )
  },
  {
    id: 'agents',
    title: 'Agents & APIs',
    kw: 'agent api provider cli claude gemini openai groq ollama key add model billing',
    body: (go) => (
      <div className="space-y-2">
        <H>CLI agents (＋ Agent)</H>
        <P>
          Any command-line agent (Claude Code, Gemini CLI, Aider, Codex, …) runs in a real terminal. Availability is
          probed on your <K>PATH</K>; if a tool isn’t found you’ll get an install hint. CLI agents bill to their own
          login (shown as “own login” in the {Link(go, 'runs', 'Cockpit/Runs')}, not metered by the cost cap).
        </P>
        <H>API providers (＋ API)</H>
        <Steps
          items={[
            'Pick a built-in provider (OpenAI, Groq, Mistral, OpenRouter, Ollama) or add your own in Settings → Keys.',
            <>
              Paste the key (stored in the OS keychain, never on disk). Ollama and other local providers need no key.
            </>,
            'Open an API chat panel; pick the model per panel.'
          ]}
        />
        <P>
          API + Gemini chats share the same built-in tools and the same system prompt, so they behave alike. Manage
          providers/agents under Settings → Manage.
        </P>
        <H>Image generation (Gemini panel)</H>
        <P>
          The <K>🖼</K> toggle next to Send switches the composer into image mode — Send becomes Generate and creates
          an image from your text (click 🖼 again for chat). Backend picked in
          Settings → Models (Pollinations: free/keyless, the default; or Google Imagen: paid, needs the key). Agents
          and pipeline steps can also call a <K>generate_image</K> tool (edit/full steps; Imagen additionally needs a
          full step with allow-shell — paid generation never runs unattended without that opt-in). Generated images
          live under your user data folder
          and are deleted by {Link(go, 'safety', 'Clear chat & run history')} in Settings → Security.
        </P>
      </div>
    )
  },
  {
    id: 'context',
    title: 'Context & tools',
    kw: 'context files repo map mention inject tools read write search approval',
    body: () => (
      <div className="space-y-2">
        <P>
          Tick files in the file tree (or <K>@</K>-mention them in a composer) to attach them to every
          prompt-controlled agent. Pin a <b>repo map</b> (symbol outline) for whole-project orientation. CLI agents
          get an “inject context” button.
        </P>
        <H>Built-in tools</H>
        <P>
          Read-only tools (<K>read_file</K>, <K>list_dir</K>, <K>repo_map</K>, <K>search_code</K>, <K>git_diff</K>)
          run automatically. <K>apply_edit</K>, <K>write_file</K>, <K>run_command</K>, and MCP tools are gated: you
          approve them (or a pipeline policy decides). Secret files (<K>.env</K>, keys) aren’t read by tools unless you
          allow it in Settings → Security.
        </P>
      </div>
    )
  },
  {
    id: 'debate',
    title: 'Debate',
    kw: 'debate compare models rounds seats synthesizer synthesize critique n-way',
    body: (go) => (
      <div className="space-y-2">
        <P>
          Debate runs <b>2–4 participants</b>: in round 1 every seat proposes; in later rounds each seat
          critiques the others&apos; latest turns. A chosen <b>synthesizer</b> (seat 1 by default) then merges the
          result. Rounds are analysis-only; the synthesis step (which may edit files) needs your approval.
        </P>
        <H>How to run one</H>
        <Steps
          items={[
            <>Open the <b>Debate</b> panel. The first two seats seed from Settings → Debate; add up to two more (only usable models appear).</>,
            'Pick the synthesizer, type a task, press Start. Watch the rounds stream in.',
            'When prompted, Approve to let the synthesizer implement/write up the result, or Decline to keep just the discussion.',
            'Stop cancels mid-run.'
          ]}
        />
        <P>Want sequential hand-offs instead of debate? Chain models in a {Link(go, 'pipelines', 'Pipeline')}.</P>
      </div>
    )
  },
  {
    id: 'pipelines',
    title: 'Pipelines',
    kw: 'pipeline chain steps dag deps condition map template model effort permission dry-run shell topological',
    body: (go) => (
      <div className="space-y-2">
        <P>
          A pipeline is a small graph of steps run in <b>topological order</b>. Each step picks a participant and a
          permission preset; output flows to dependent steps.
        </P>
        <H>Build one</H>
        <Steps
          items={[
            <>Open <b>Pipelines</b>. Use <b>Template ▾</b> for a starter (plan → implement → review) or <b>＋ Step</b>.</>,
            <>Per step set: model + effort, a permission preset (<b>read-only / edit / full</b>), and the instruction.</>,
            <>
              <b>inputs</b> chips choose which earlier steps feed this one (fan-in); <b>only if contains…</b> skips the
              step unless a dependency’s output matches; <b>map</b> runs the instruction once per input line.
            </>,
            <>Use <K>${'{'}stepId{'}'}</K> / <K>${'{'}input{'}'}</K> in an instruction to interpolate outputs.</>,
            <>Enter a Starting input, optionally tick <b>dry-run</b> (reports actions, changes nothing), press <b>Run</b>.</>,
            <>A <b>full</b> step runs shell only if you tick <b>allow shell</b> (off by default).</>
          ]}
        />
        <P>
          Watch progress in {Link(go, 'runs', 'Runs')}; the run’s file changes land on a branch you review in{' '}
          {Link(go, 'isolation', 'Review')}.
        </P>
        <P>
          Image paths in step output flow to later steps; a Gemini step sees the actual image, and generated images
          render as thumbnails in {Link(go, 'runs', 'Runs')}.
        </P>
      </div>
    )
  },
  {
    id: 'isolation',
    title: 'Isolation & Review',
    kw: 'isolation worktree branch review merge discard diff git parallel',
    body: (go) => (
      <div className="space-y-2">
        <P>
          Each CLI-agent session and each pipeline run works in its own <b>git worktree on its own branch</b> (needs a
          git repo with a commit; otherwise it falls back to the shared folder, with a warning). So agents can’t stomp
          each other and an agent is confined to a branch. Toggle this in Settings → Isolation.
        </P>
        <H>Reviewing</H>
        <Steps
          items={[
            <>Open the <b>Review</b> panel. Each branch card shows its age, <b>↑ahead ↓behind</b> its base, and its diff vs the fork point (new files included).</>,
            <><b>Merge</b> squash-merges the branch into its base; <b>Discard</b> deletes the branch + worktree.</>,
            <>Check several branches and <b>Merge selected</b> to squash them in list order — the queue stops at the first conflict.</>,
            <><b>Select hunks</b> switches to a per-hunk picker: apply only the chosen hunks to the base, then discard the rest.</>,
            <><b>PR</b> (opt-in) pushes the branch to origin and opens a GitHub PR via the <code>gh</code> CLI.</>,
            <><b>Discard all</b> clears everything; idle worktrees (no changes) auto-prune on launch, and old unmerged ones raise a boot notice.</>
          ]}
        />
        <P>Scheduled/background runs also land here — see {Link(go, 'runs', 'Runs & Schedules')}.</P>
      </div>
    )
  },
  {
    id: 'runs',
    title: 'Runs & Schedules',
    kw: 'runs background scheduled job interval daily git trigger cron automate cockpit',
    body: (go) => (
      <div className="space-y-2">
        <P>
          The <b>Runs</b> panel shows every pipeline run — manual, background, or scheduled — live, even after you
          close the panel that started it. Runs are serialized (one at a time). The <b>Cockpit</b> shows open agents +
          token/cost.
        </P>
        <H>Schedule a pipeline</H>
        <Steps
          items={[
            <>Settings → <b>Schedules</b>. Name it, pick a saved pipeline, optional starting input.</>,
            <>Choose a trigger: <b>every N minutes</b>, <b>daily at</b> a time, or <b>on git change</b>.</>,
            <>If the pipeline edits files / uses a <b>full</b> step, acknowledge the warning (and opt into shell).</>,
            'Enable it. It runs unattended (autonomous) and edits on a branch for review.'
          ]}
        />
        <P>
          Jobs fire while the app is open or minimized to tray (Settings → enable Close to tray). Output → Runs;
          changes → {Link(go, 'isolation', 'Review')}.
        </P>
      </div>
    )
  },
  {
    id: 'settings',
    title: 'Settings reference',
    kw: 'settings reference models budget terminal editor appearance startup keys mcp manage',
    body: (go) => (
      <div className="space-y-2">
        <P>Settings is a searchable two-pane panel. Sections:</P>
        <ul className="ml-4 list-disc space-y-1 text-gray-300">
          <li><b>Models</b> — default Gemini/Claude model + Claude effort.</li>
          <li><b>Debate</b> — default participants for the first two seats + rounds (panel supports 2–4 seats).</li>
          <li><b>Isolation</b> — toggle per-agent worktrees; review/discard active worktrees.</li>
          <li><b>Schedules</b> — create/enable scheduled pipeline jobs.</li>
          <li><b>Terminal / Editor</b> — shell, font size, scrollback, wrap.</li>
          <li><b>Appearance</b> — accent color.</li>
          <li><b>Budget</b> — session cost cap (USD, 0 = off); enforced in main, covers scheduled runs.</li>
          <li><b>Security</b> — see {Link(go, 'safety', 'Safety & approvals')}.</li>
          <li><b>Pipelines</b> — default permission + dry-run.</li>
          <li><b>Startup</b> — which agent opens on launch.</li>
          <li><b>Keys</b> — per-provider API keys (OS keychain).</li>
          <li><b>MCP</b> — connect/add MCP servers. <b>Manage</b> — edit agents/providers.</li>
        </ul>
      </div>
    )
  },
  {
    id: 'safety',
    title: 'Safety & approvals',
    kw: 'safety security approval danger denylist cost cap secret git protected confirm trust allowlist restrict loosen',
    body: () => (
      <div className="space-y-2">
        <P>Main is the authority for anything with side effects. Defaults are safe; tune in Settings → Security.</P>
        <H>Always on</H>
        <ul className="ml-4 list-disc space-y-1 text-gray-300">
          <li>Commands/edits/tool-calls are gated; a dangerous-command denylist always requires an explicit card.</li>
          <li>Writes to <K>.git/</K> and <K>node_modules/</K> are blocked; secret files aren’t read by tools.</li>
          <li>Session <b>cost cap</b> (Budget) bounds spend, including scheduled runs.</li>
          <li>Autonomous (pipeline/scheduled) shell needs an explicit opt-in; a `full` step is otherwise capped at edits.</li>
        </ul>
        <H>Knobs (Settings → Security)</H>
        <ul className="ml-4 list-disc space-y-1 text-gray-300">
          <li><b>Always require approval</b> (restrict) — never auto-approve, even a trusted session.</li>
          <li><b>Autonomous command allowlist</b> (restrict) — only listed command heads may run unattended.</li>
          <li><b>Default allow-shell</b> / <b>Allow .git writes</b> (loosen) — off by default; the latter re-opens the git-hook risk.</li>
          <li><b>Clear history</b> / <b>persist run output</b> — history is stored unencrypted locally.</li>
        </ul>
        <P>CLI agents run their own tooling and are governed by that tool’s own permissions — treat them like running that CLI yourself.</P>
      </div>
    )
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    kw: 'troubleshoot problem no models dropdown agent not found path worktree fallback schedule not firing cost',
    body: (go) => (
      <div className="space-y-2">
        <ul className="ml-4 list-disc space-y-1 text-gray-300">
          <li><b>No models in a dropdown?</b> Add an API key (Settings → Keys) or install a CLI agent; only usable ones show.</li>
          <li><b>“Agent not found”?</b> Its command isn’t on PATH — install it or fix PATH, then reopen.</li>
          <li><b>No isolation / worktree warning?</b> The folder isn’t a git repo (or has no commit) — runs use the shared folder. <K>git init</K> + commit to enable.</li>
          <li><b>Scheduled job didn’t fire?</b> Jobs run while the app is open or minimized to tray (Settings → Close to tray); check it’s enabled and the trigger/time.</li>
          <li><b>Agent shows “own login” / $0?</b> CLI &amp; Claude bill to their own login and aren’t metered here — see {Link(go, 'agents', 'Agents & APIs')}.</li>
          <li><b>Empty review diff?</b> The run made no committed/working changes on its branch.</li>
        </ul>
      </div>
    )
  }
]

export default function GuideModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [activeId, setActiveId] = useState('start')
  const query = q.trim().toLowerCase()

  const shown = useMemo(
    () => (query ? TOPICS.filter((t) => (t.title + ' ' + t.kw).toLowerCase().includes(query)) : TOPICS),
    [query]
  )
  const current = shown.find((t) => t.id === activeId) ?? shown[0]
  const go = (id: string): void => {
    setQ('')
    setActiveId(id)
  }

  return (
    <div
      style={{ zIndex: Z.modal ?? 1000 }}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[82vh] max-h-[82vh] w-[56rem] max-w-full flex-col rounded-lg border border-border bg-panel text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="font-semibold text-accent">Guide</span>
          <button className="ml-auto rounded border border-border px-2 py-0.5 text-xs text-gray-300 hover:bg-bg" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* left: search + topic nav */}
          <div className="flex w-48 shrink-0 flex-col border-r border-border">
            <div className="p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {shown.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className={`block w-full px-3 py-1.5 text-left text-xs ${
                    current?.id === t.id ? 'bg-bg font-medium text-accent' : 'text-gray-300 hover:bg-bg/50'
                  }`}
                >
                  {t.title}
                </button>
              ))}
              {query && shown.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">No matches.</div>}
            </div>
          </div>
          {/* right: the topic page */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {current ? (
              <>
                <h3 className="mb-2 text-base font-semibold text-gray-100">{current.title}</h3>
                {current.body(go)}
              </>
            ) : (
              <div className="text-gray-500">No matching topic.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
