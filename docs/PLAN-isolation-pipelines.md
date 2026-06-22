# Plan — Agent Isolation, PR Flow, Pipelines, Background/Scheduled, In-flight Cancel

Status board for the post-0.27 architecture push. Captures the full design from the
review session. Sections numbered to match the original review (1–6).

Recommended build order:
1. **§1 isolation** ✅ DONE (0.28.0 + 0.29.0) — branch per CLI agent; pipeline = one shared branch; chat/pipeline tool calls scoped to the session worktree.
2. **§2 option A** ✅ DONE (0.30.0) — Review & Merge panel (diff per branch, Merge/Discard); boot reconciles surviving worktrees.
3. **§6 cancel** ✅ DONE (0.31.0) — cancel aborts the in-flight model call (fetch signal + child kill), not just at the step boundary.
4. **§3 DAG + role template**, then **§5 Tier 1/2** — remaining

---

## ✅ §1 — Branch-per-agent isolation — ~~CRITICAL — in progress~~ **DONE (0.28.0 + 0.29.0)**

> **As built** (deviations from the design below):
> - `CommandExecutor` was **not** split into one pty per session. The shared pty
>   stays on the project root (terminal pane); worktree commands run via a one-off
>   `CommandExecutor.execOnce(command, cwd)`. Simpler, same isolation.
> - `FileSystemManager` is **unchanged** — worktrees live inside the project root,
>   so its existing `assertInRoot` confinement still holds; only `toolExec.abs` and
>   `FileEditBroker.buildEdit` take the session root.
> - Per-session root = `appState.rootFor(sessionId)` (map + fallback to projectRoot).
> - Pipeline branch = `pipeline/run-N` (one per run); agent branch = `agent/<id>`.
> - Crash cleanup implemented as `WorktreeManager.pruneOnBoot` (prunes + re-adopts
>   surviving `.dai-trees` worktrees). Non-git / no-commit → falls back to shared root.

**Rule:** each CLI/API **agent session** gets its own git worktree + branch.
A **pipeline** gets **ONE shared branch** for all its steps (NOT one per step/agent).

```
agent/<sessionId>     ← per-agent branch
pipeline/<runId>      ← one branch, every step + any orchestrator-spawned subagent commits here
```

### Core: `WorktreeManager` (new, main process)
- `create(sessionId, base?)`: `git worktree add <root>/.dai-trees/<id> -b agent/<id> <base>`
- `remove(sessionId, {merge|discard})`: merge to base or `git worktree remove --force` + `git branch -D`
- Worktrees live in `.dai-trees/`; add that dir to `.git/info/exclude` (NOT the user's tracked `.gitignore`).

### The hard part: retire the global `projectRoot`
Today everything resolves against the single `appState.projectRoot`. Isolation needs **per-session roots**.

| Component | Now | After |
|-----------|-----|-------|
| `CommandExecutor` | one pty @ projectRoot (`src/main/index.ts:82`) | pty **per session**, cwd = that session's worktree |
| `FileSystemManager` | global root | resolve caller paths against the session root |
| `toolExec.abs()` | `appState.projectRoot` | `abs(sessionRoot, p)` |
| brokers (Command/FileEdit/Tool) | implicit global | carry/receive `sessionId → root` |

Introduce `sessionRoot(sessionId): string` in appState. `appState.projectRoot` becomes the
**base/default** (panels without a worktree, e.g. a plain terminal, the file tree).

### Lifecycle
1. Spawn agent → `WorktreeManager.create` → spawn pty in that worktree.
2. Agent works isolated; cannot see/stomp siblings.
3. Close/accept → Review & Merge (§2) → merge or discard → `remove`.

### Edge cases (must handle)
- **Non-git project** → no worktree possible. Offer `git init`; else fall back to shared root + a visible "no isolation" warning. Never silently share.
- **Dirty base** → worktree branches off HEAD; uncommitted base changes are invisible to the agent (correct, but warn).
- **Windows worktree perf** → fine (native git). Keep `.dai-trees` at root, avoid deep nesting.
- **Crash cleanup** → on boot, `git worktree prune` + reconcile orphaned `.dai-trees`.
- **Closes gap #4 (unsandboxed CLI)** → a CLI agent is now confined to its own branch/worktree, so it can't corrupt main work. Blast radius shrinks (worktree ≠ full FS jail, but a major improvement).

**Effort:** high. The `projectRoot → per-session` refactor is the spine; everything hangs off it.
Phase it: (a) WorktreeManager + per-session CommandExecutor; (b) thread sessionRoot through fsm/brokers/toolExec; (c) merge/cleanup UI.

---

## ✅ §2 — PR / review-merge flow — ~~design options~~ **DONE (0.30.0 — option A)**

> **As built:** a dockable **Review** panel lists each isolated worktree (agent /
> pipeline), shows its total change vs base as a side-by-side diff (`workingDiff` =
> `git diff <base>` run *inside* the worktree, so uncommitted agent work shows),
> and offers **Merge** (commitAll → squash-merge into base → remove) or **Discard**
> (delete branch + worktree). Registered in panels, default layout, and View menu.
> Options B (GitHub PR), C (cockpit board), D (per-hunk) remain future work.

- **A — Local "Review & Merge" panel (RECOMMENDED default).** No GitHub. Per session show
  `git diff <base>...agent/<id>`, changed-file tree; accept → squash-merge to base; reject →
  discard worktree+branch. Reuses `DiffViewer` + checkpoints. Fits the local-first / MIT identity.
- **B — GitHub PR via `gh` (opt-in).** Accept → `git push` + `gh pr create`, return PR URL.
  `git push` is on the dangerous denylist → forces an explicit confirm (good). Additive on top of A.
- **C — Cockpit merge board.** Fleet list → board: each card shows ahead/behind base + conflict flag;
  merge in chosen order; conflict → open in diff/editor. The "parallel agent factory" UX rivals sell.
- **D — Per-hunk cherry-pick.** Hunk-level accept/reject (`git apply` selected hunks). Power-user; later.

Plan: **A** now, **B** as a gated toggle, evolve cockpit toward **C**.

---

## §3 — Pipeline redesign (design options)

Current: strict for-loop, single `carry` string (`src/main/pipeline/PipelineRunner.ts:48`).
All steps → **one branch** (the §1 rule).

- **a — DAG, not chain.** Step `{id, deps:[ids], agent, instruction, permission, model, effort}`.
  Outputs addressable (`${stepId}`) in later instructions. Independent steps run in parallel; a join
  step merges. Unlocks fan-out / fan-in.
- **b — Map step.** Same instruction over N inputs (e.g. each changed file) in parallel, collect.
- **c — Role template.** planner → implementer → reviewer, per-step model (Opus implements, Haiku
  writes the README). Ship as a preset.
- **d — Gate / conditional steps.** "if output contains FAIL → run fix step"; or a human-approval
  gate mid-pipeline (pause, surface a card, resume).
- **e — Orchestrator step (the subagent-spawn answer).** A Claude `-p` step WILL spawn its own Task
  subagents inside that one pty. With §1, the pipeline owns ONE branch, so those subagents all commit
  to the same `pipeline/<runId>` branch → no isolation conflict, consistent with the rule. Cockpit
  visibility: parse Claude's stream for subagent markers to show count/activity; full per-subagent
  telemetry isn't exposed by `claude -p`, so surface **aggregate** (branch diff + token usage) rather
  than fake per-sub detail.

All steps share the run's single branch → final review = one diff `base...pipeline/<runId>`, one merge.

Plan: keep linear as the simple default; add **DAG (a)** + **role template (c)** as the headline
upgrade; **gate steps (d)** next.

---

## §5 — Background / scheduled / remote (walkthrough)

- **Tier 1 — Background (local detached). LOW effort, do it.** Run an agent/pipeline without keeping
  its panel focused. `PipelineRunner.run` is already async fire-and-forget — drop the
  panel-mounted requirement, post a tray/toast on done (error-toast + usage infra already exist).
- **Tier 2 — Scheduled (cron). MEDIUM effort, strong fit.** "Run pipeline X every morning / on git
  push." Main-side scheduler persists jobs (node timer or the scheduled-tasks MCP). Fires
  `pipeline.run(steps, input, autonomousPolicy)`. Security fit is exact: scheduled = unattended =
  **must use ApprovalPolicy autonomous** (no human card) — already built. Time-based first;
  git-hook / file-watch later (chokidar already in deps).
- **Tier 3 — Remote (cloud VM). SKIP / out of scope.** Needs backend + sandbox infra + billing; not
  the local-first edge. Poor-man's option later: SSH-runner to a box the user owns (the Pi at
  192.168.40.196) — spawn the CLI agent over SSH, stream back. Optional novelty, not core.

Plan: **Tier 1** now, **Tier 2** next (leverages the autonomous policy already shipped), skip Tier 3.

---

## ✅ §6 — In-flight cancel — **DONE (0.31.0)**

> **As built:** PipelineRunner and IPCModerator each hold an `AbortController`;
> `cancel()` aborts it (and keeps the boundary flag). The signal threads through
> `completeParticipant` → `claudeOneShot` (child `proc.kill()` on abort),
> `gemini.complete`/`streamOnce` (fetch signal), and `apiCompleteAgentic` →
> `runToolLoop` → `streamOnce` (fetch signal; `fetchWithRetry` treats AbortError as
> non-retryable and the fetch-catch re-throws it). Abort maps to a clean
> "Cancelled." / "Debate cancelled." status, not a red error.

**Problem:** `cancel()` only checks at the step boundary (`src/main/pipeline/PipelineRunner.ts:49`);
no `AbortController` on the fetch → mid-call cancel is a no-op.

**Plan:**
1. `PipelineRunner` + `IPCModerator` each hold an `AbortController` per run. `cancel()` →
   `controller.abort()` (keep the boundary flag as a backstop).
2. Thread `signal` down: `run` → `completeParticipant` / `apiCompleteAgentic` / `claudeOneShot` →
   fetch/process. (OpenAIClient `streamOnce`/`apiComplete` already accept an optional `signal`;
   `fetchWithRetry` now treats `AbortError` as non-retryable.)
3. `OpenAIClient`: pass `signal` to fetch → abort throws `AbortError` → reader loop exits.
4. `GeminiClient`: pass `signal` to its fetch.
5. `ClaudeHeadless.claudeOneShot`: child process → on abort, `child.kill()`.
6. Map `AbortError` → a clean `{type:'cancelled'}` status, NOT a red error toast.

**Files:** PipelineRunner, IPCModerator, complete.ts, GeminiClient, ClaudeHeadless
(OpenAIClient already pre-wired). IPC channels unchanged. **Effort:** low–medium.

---

## Shipped this session
- **0.27.2** code nits — `OpenAIClient.ts`: deduped the tool loop into `runToolLoop`; hoisted
  `MAX_TOOL_TURNS`; `fetchWithRetry` (2 retries, 429/5xx + network only, `AbortError` non-retryable);
  pre-wired optional `signal?: AbortSignal` on `streamOnce`/`apiComplete`.
- **0.28.0** §1a — WorktreeManager + git helpers; per-session root; isolate CLI agents; Settings → Isolation.
- **0.29.0** §1b — tool calls scoped to session worktree (`execOnce` cwd, `rootFor` in toolExec/FileEditBroker);
  pipeline = one shared branch.
- **0.30.0** §2 — Review & Merge panel; boot reconcile of surviving worktrees.

Latest: **131 tests green, typecheck clean, build OK.** §6 (in-flight cancel) is the next step.

### Deferred / not chasing
- MCP tool-argument denylist screening (known limitation; security design, not a mechanical nit).
- Interactive-approval nonce/handshake (renderer-trust residual risk).
- Tier 3 true remote/cloud agents.
