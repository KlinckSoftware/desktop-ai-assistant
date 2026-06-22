# Plan — Security & Privacy Hardening

**Status: ✅ ALL SHIPPED (0.36.1–0.36.8).** HIGH-2 `6a7167c` · HIGH-1/MEDIUM-4 `e5dc56d` ·
MEDIUM-3 `a67b047` · MEDIUM-5 `627cfad` · B3 warnings `52969dd` · P2 `9ff36c9` ·
P1 `4bb771c` · P3 `def2daa` · D docs `2168ace`. Deferred (noted): configurable
autonomous command allowlist; approval/action nonce (future).

Addresses every finding from the 0.36.0 security/privacy review. Findings keep
their review IDs (HIGH-1, HIGH-2, MEDIUM-3…6, plus the privacy items P1–P4).

Build order (small + highest-risk first):
1. **Phase A** — HIGH-2 (`.git` write guard) + HIGH-1/MEDIUM-4 (main-side spend cap)
2. **Phase B** — MEDIUM-3 (autonomous allowlist / `full` opt-in) + MEDIUM-5 (git-loop guard) + UI warnings
3. **Phase C** — privacy: P2 (secret-path read guard), P1 (at-rest / clear history), P3 (worktree discard-all)
4. **Phase D** — docs + MEDIUM-6 (renderer-trust note); approval nonce noted as future

---

## Phase A — close the two HIGH items

### HIGH-2 — block writes under `.git/` (and `node_modules/`)
**Problem:** `assertInRoot` blocks paths outside the project root but not `.git/`
inside it, so a gated `edit`/`full` step can plant `.git/hooks/pre-commit` →
code execution on the next commit/merge, bypassing the shell denylist. Open for
autonomous runs with isolation off.

**Fix:**
- Add a pure `isProtectedPath(absOrRel, root)` helper (new `src/shared/protectedPath.ts`)
  that returns true when the resolved path is, or is inside, a protected segment:
  `.git`, `node_modules` (extensible list).
- Enforce at the write chokepoint `FileSystemManager.writeFile` (`src/main/fs/FileSystemManager.ts`)
  — every write (edit broker apply, checkpoint undo, `fs:write` IPC) funnels through
  it. Throw `Refusing to write protected path: <rel>`.
- Also short-circuit in `FileEditBroker.buildEdit` (`src/main/editor/FileEditBroker.ts`)
  so the rejection is reported to the agent before an approval card is shown.

**Tests:** `writeFile`/`buildEdit` reject `.git/hooks/pre-commit`, `.git/config`,
`node_modules/x`; still allow normal paths and a file literally named `gitignore`.
**Effort:** small.

### HIGH-1 + MEDIUM-4 — main-side spend cap (covers scheduled/background)
**Problem:** the cost cap is renderer-enforced and interactive-only
(`ApiChatPanel.tsx:102`); pipelines and scheduled jobs have no ceiling → runaway
cost with no human watching.

**Fix:**
- Make `costCap` a main `Settings` field (`src/main/state.ts`); plumb it through the
  existing `settings.set` path (already wired) + preload type.
- Track session spend in main: a small `budget` module (new `src/main/budget.ts`)
  that accumulates from the same usage main already sees, costed via the shared
  `costFor` (`src/shared/pricing.ts`). Apply the live LiteLLM table in main too
  (call `setPriceOverrides` with `fetchLivePricing()` result on boot).
- Enforce: in `runToolLoop` / `apiCompleteAgentic` (`src/main/api/OpenAIClient.ts`)
  and the Gemini agentic loop, check `budget.over(cap)` at each turn boundary; when
  exceeded, stop and return a `[blocked: session cost cap reached]` marker.
  Also check in `RunManager.start` before launching a queued run.
- Keep the renderer cap (fast UX feedback); main is the authority.

**Tests:** `budget.over()` math; a stubbed run stops once the accumulated cost
exceeds the cap.
**Effort:** medium (token→cost accounting in main is the bulk).

---

## Phase B — make autonomy safe by default

### MEDIUM-3 — autonomous `full` is not a sandbox
**Problem:** the danger denylist is heuristic and bypassable (`python evil.py`,
`find -delete`, `node -e …`), so autonomous `full` ≈ arbitrary code under a thin
guard.

**Fix (layered):**
- Add an explicit **per-run / per-job opt-in** for `full`: an autonomous run that
  contains a `full` step is refused unless `allowFull` is set on the run (pipeline
  run option) or job (`ScheduledJob.allowFull`). Default off.
- Optionally add an **autonomous command allowlist** (Settings): when set, autonomous
  `run_command` only runs commands whose head matches the allowlist (e.g. `npm`,
  `pytest`, `git diff`), in addition to the denylist. Empty = today's behavior.
  Lives in `ApprovalPolicy.decide` (extend the autonomous branch).
- Document bluntly that autonomous `full` is effectively code execution.

**Tests:** `decide` blocks a `full` autonomous command when `allowFull` is unset;
allowlist permits/denies by command head.
**Effort:** medium.

### MEDIUM-5 — git-trigger jobs can self-trigger
**Problem:** a `git`-trigger job that edits files retriggers itself; guarded only
by the 60s gap + serialize.

**Fix:**
- In the Scheduler (`src/main/schedule/Scheduler.ts`), suppress the git trigger
  while a run started by that job is active and for a cooldown after it completes
  (track per-job `suppressUntil`).
- UI warning (below) when a `git`-trigger job contains an `edit`/`full` step.

**Tests:** a git change during/just-after a job's own run does not refire it.
**Effort:** small.

### UI warnings (supports MEDIUM-3 / MEDIUM-5 / HIGH-1)
- Schedules form (`SettingsModal.tsx`): if the chosen pipeline has any `edit`/`full`
  step, show a yellow "this job edits files / runs commands unattended" warning; if
  trigger is `git` **and** it edits, a stronger warning. Require ticking an
  "I understand" box (or the `allowFull` opt-in) before "Add job" enables for `full`.
- Pipeline panel: badge `edit`/`full` steps; show a one-line caution when a
  non-dry run includes `full`.
**Effort:** small.

---

## Phase C — privacy

### P2 — secret-path read guard
**Problem:** `read_file`/`repo_map`/context can send `.env`, keys, `*.pem` to the
provider.

**Fix:**
- Add `isSecretPath(rel)` (in `protectedPath.ts`): `.env`/`.env.*`, `.ssh/`,
  `*.pem`, `id_rsa`/`id_*`, `*.key`, `credentials`, `.aws/`.
- In the **tool** read path only (`execTool` `read_file`/`search_code`, and repo-map
  file inclusion in `src/main/tools/toolExec.ts` / `repoMap.ts`), return
  `[blocked: looks like a secret — enable secret reads in Settings to override]`.
  Gate by a setting `allowSecretReads` (default off).
- Leave `FileSystemManager.readFile` for the **editor UI** unguarded (explicit user
  action), so opening `.env` yourself still works.

**Tests:** `isSecretPath` matrix; `execTool('read_file', '.env')` blocked when the
setting is off, allowed when on.
**Effort:** small–medium.

### P1 — at-rest data (plaintext history) + egress clarity
**Problem:** `state.json` (chats, debate, **run outputs**) and `jobs.json` are
unencrypted in userData; run transcripts can hold file contents/secrets.

**Fix:**
- Add a **"Clear chat & run history"** action in Settings → Security: resets
  `geminiMessages`, `debateUpdates`, `apiChats`, `pipelineRuns` in the store and
  persists, and clears `RunManager`'s in-memory records.
- Add a setting `persistRunOutputs` (default on): when off, history records keep
  metadata (label/status/ts/steps) but drop the `updates[]` text bodies before
  persisting (App.tsx capture).
- Do **not** attempt to encrypt `state.json` (no good local key without prompting;
  out of scope) — instead document the plaintext-at-rest reality + the clear action.
- Add an explicit egress note in-app/docs: "file contents you read or @-mention are
  sent to the selected provider; multi-provider pipelines spread code across vendors."

**Effort:** small (clear action) + small (persist toggle).

### P3 — worktree disk footprint
**Problem:** `.dai-trees/` accumulates code copies until merged/discarded.

**Fix:**
- Review panel (`ReviewPanel.tsx`): a **"Discard all"** button (confirm) →
  `worktree.remove(id,'discard')` for every listed worktree.
- Show total count/age; on boot, optionally prompt to clean worktrees older than N
  days (later).
**Effort:** small.

---

## Phase D — docs + residual

### MEDIUM-6 — compromised-renderer teeth (document)
New IPC a fully-compromised renderer could abuse: `jobSave` (create an autonomous
scheduled shell job), `worktreeRemove('discard'|'merge')`. This stays within the
documented "renderer is semi-trusted" model, but the **autonomous-job creation** is
new. Action: enumerate in SECURITY.md; the real fix (a nonce/handshake proving an
action was human-initiated, already noted for approvals) is **future work** — track,
don't build now.

### SECURITY.md refresh
Add/expand sections for: the autonomous + scheduled surface and its guards (cap,
`full` opt-in, allowlist), the `.git`/protected-path write block, the secret-path
read guard, at-rest plaintext + the clear-history action, provider egress, and the
renderer-trust teeth (jobSave/worktreeRemove). Update the "known limitations" list
(remove the now-fixed cost-cap-only-interactive item; keep the nonce item).
**Effort:** small.

---

## Summary table

| ID | Item | Phase | Effort |
|----|------|-------|--------|
| HIGH-2 | Block `.git/` + `node_modules/` writes | A | S |
| HIGH-1 / MEDIUM-4 | Main-side spend cap (covers scheduled) | A | M |
| MEDIUM-3 | `full` opt-in + autonomous allowlist | B | M |
| MEDIUM-5 | git-trigger self-trigger guard | B | S |
| — | UI warnings (edit/full, git+edit) | B | S |
| P2 | Secret-path read guard | C | S–M |
| P1 | Clear history + persist-outputs toggle + egress note | C | S |
| P3 | Worktree "discard all" | C | S |
| MEDIUM-6 | Document renderer-trust teeth | D | S |
| — | SECURITY.md refresh | D | S |
| (future) | Approval/action nonce/handshake | — | L |
