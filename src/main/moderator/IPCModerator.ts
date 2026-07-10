import { appState } from '../state'
import { CH, type DebateRound, type DebateAgent, type Message } from '../../shared/types'
import { extractBashBlocks } from '../executor/parser'
import { listAgents } from '../agents/registry'
import { listProviders } from '../api/providers'
import { completeParticipant } from '../agents/complete'
import { CLAUDE_READ_TOOLS, CLAUDE_EDIT_TOOLS } from '../agents/systemPrompt'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { CommandBroker } from '../executor/CommandBroker'

// Orchestrates a structured N-way (2-4 participant) debate. Participants are
// chosen by the user from whatever models/APIs are currently usable (CLI binary
// present or API key set). No participant talks to another directly —
// everything routes through main, sequentially. Round 1 is every participant
// proposing; later rounds are a round-robin critique pass (each participant, in
// seat order, critiques the OTHER participants' latest turns). Rounds are
// analysis only; editing happens in the synthesis step, run by the chosen
// synthesizer and gated behind explicit user approval.
const NO_EDIT = '\n\nThis is analysis/discussion only — do NOT modify files or run mutating commands.'
const MIN_PARTICIPANTS = 2
const MAX_PARTICIPANTS = 4

export class IPCModerator {
  private pendingTranscript: DebateRound[] | null = null
  private pendingPrompt = ''
  private pendingParticipants: DebateAgent[] | null = null
  private pendingSynthesizer: DebateAgent | null = null
  private cancelled = false
  private controller: AbortController | null = null

  /** Request cancellation: aborts the in-flight model call AND stops at the next
   *  round boundary. */
  cancel(): void {
    this.cancelled = true
    this.controller?.abort()
  }

  constructor(
    private gemini: GeminiClient,
    private broker: CommandBroker
  ) {}

  /** Debate participants currently usable by this user. Only Claude (via the
   *  headless `claude -p` one-shot), Gemini (key), and keyed OpenAI-compatible
   *  providers — these have a clean programmatic completion. */
  async listDebateAgents(): Promise<DebateAgent[]> {
    const out: DebateAgent[] = []
    const agents = await listAgents()
    if (agents.find((a) => a.id === 'claude')?.available) {
      out.push({ id: 'claude', name: 'Claude', kind: 'claude' })
    }
    if (await this.gemini.hasKey()) out.push({ id: 'gemini', name: 'Gemini', kind: 'gemini' })
    for (const p of await listProviders()) {
      if (p.hasKey || p.noKey) out.push({ id: `api:${p.id}`, name: p.name, kind: 'api' })
    }
    return out
  }

  private async resolve(id: string): Promise<DebateAgent> {
    const found = (await this.listDebateAgents()).find((a) => a.id === id)
    if (!found) throw new Error(`debate participant "${id}" is not available`)
    return found
  }

  /** One-shot completion from any participant. `prompt` is the new turn; history
   *  is prior context (used by chat-style participants). */
  // Claude tool sets per debate phase: rounds are analysis-only (read tools),
  // synthesis may edit. API/Gemini participants have no tools either way, so this
  // keeps the participants as homogeneous as their backends allow.
  private static ROUND_TOOLS = CLAUDE_READ_TOOLS
  private static SYNTH_TOOLS = CLAUDE_EDIT_TOOLS

  private complete(agent: DebateAgent, prompt: string, history: Message[], claudeTools?: string[]): Promise<string> {
    return completeParticipant(agent, prompt, history, this.gemini, this.controller?.signal, claudeTools)
  }

  async runDebate(
    userPrompt: string,
    participantIds: string[] = ['claude', 'gemini'],
    synthesizerId?: string,
    roundsArg?: number
  ): Promise<void> {
    const rounds = roundsArg ?? appState.settings.debateRounds
    const transcript: DebateRound[] = []
    const status = (s: string): void => appState.send(CH.debateStatus, s)
    this.cancelled = false
    this.controller = new AbortController()

    try {
      if (participantIds.length < MIN_PARTICIPANTS || participantIds.length > MAX_PARTICIPANTS) {
        appState.send(CH.debateUpdate, {
          type: 'error',
          text: `Debate needs ${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS} participants (got ${participantIds.length}).`
        })
        return
      }

      const participants = await Promise.all(participantIds.map((id) => this.resolve(id)))
      const synthesizer = synthesizerId
        ? participants.find((p) => p.id === synthesizerId)
        : participants[0]
      if (!synthesizer) {
        appState.send(CH.debateUpdate, {
          type: 'error',
          text: `synthesizer "${synthesizerId}" is not among the debate participants.`
        })
        return
      }

      for (let i = 0; i < rounds; i++) {
        const round: DebateRound = { round: i, turns: {} }
        transcript.push(round)

        for (let seat = 0; seat < participants.length; seat++) {
          if (this.cancelled) {
            status('')
            appState.send(CH.debateUpdate, { type: 'error', text: 'Debate cancelled.' })
            return
          }
          const p = participants[seat]
          const otherSeats = participants.map((_, idx) => idx).filter((idx) => idx !== seat)

          let prompt: string
          if (i === 0) {
            status(`${p.name} thinking… (round ${i + 1}/${rounds})`)
            prompt = userPrompt + NO_EDIT
          } else {
            status(`${p.name} critiquing… (round ${i + 1}/${rounds})`)
            const priorTurns = otherSeats
              .map((idx) => `${participants[idx].name} proposed:\n${transcript[i - 1].turns[idx]}`)
              .join('\n\n')
            prompt = `Original task: ${userPrompt}\n\n${priorTurns}\n\nCritique and improve on the above.${NO_EDIT}`
          }

          // Chat-style participants get the running transcript as history
          // (their own prior turns as assistant, others' as user).
          const history: Message[] = transcript
            .slice(0, i)
            .flatMap((r) =>
              participants.map((_, idx) => ({
                role: (idx === seat ? 'assistant' : 'user') as 'assistant' | 'user',
                content: r.turns[idx] ?? ''
              }))
            )
            .filter((m) => m.content)

          const text = await this.complete(p, prompt, history, IPCModerator.ROUND_TOOLS)
          round.turns[seat] = text
          appState.send(CH.debateUpdate, { type: 'turn', seat, agentId: p.id, name: p.name, text, round: i })

          // Round 1 proposals may include commands — run them through the
          // approval gate so later critiques see real terminal output.
          if (i === 0) {
            const cmds = extractBashBlocks(text)
            if (cmds.length) {
              status(`Awaiting approval for ${cmds.length} command(s)…`)
              const results = await Promise.all(cmds.map((cmd) => this.broker.propose(cmd, 'claude', 'debate')))
              round.turns[seat] = `${text}\n\nTerminal output:\n${results.join('\n')}`
            }
          }
        }
      }

      // Rounds done — pause for approval before the synthesis step.
      this.pendingTranscript = transcript
      this.pendingPrompt = userPrompt
      this.pendingParticipants = participants
      this.pendingSynthesizer = synthesizer
      status('')
      const edits = synthesizer.kind === 'claude'
      appState.send(CH.debateUpdate, {
        type: 'await',
        text: edits
          ? `Discussion complete. Approve to let ${synthesizer.name} implement the agreed changes (this WILL edit files), or decline to keep the discussion only.`
          : `Discussion complete. Approve to have ${synthesizer.name} write up the final implementation plan (it will NOT edit files directly — ${synthesizer.name} is API-only), or decline.`
      })
    } catch (err) {
      status('')
      if (this.cancelled || (err instanceof Error && err.name === 'AbortError')) {
        appState.send(CH.debateUpdate, { type: 'error', text: 'Debate cancelled.' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[debate] failed:', msg)
      appState.send(CH.debateUpdate, { type: 'error', text: `Debate failed: ${msg}` })
    }
  }

  /** Run the synthesis — only after user approval. Claude edits files agentically;
   *  API/Gemini participants produce a final plan (no autonomous edits). */
  async synthesize(): Promise<void> {
    const transcript = this.pendingTranscript
    const synthesizer = this.pendingSynthesizer
    if (!transcript || !synthesizer) return
    this.pendingTranscript = null
    const status = (s: string): void => appState.send(CH.debateStatus, s)
    this.cancelled = false
    this.controller = new AbortController()
    try {
      status(`${synthesizer.name} synthesizing…`)
      const prompt = `Original task: ${this.pendingPrompt}\n\nDebate transcript:\n${JSON.stringify(transcript, null, 2)}\n\n${
        synthesizer.kind === 'claude'
          ? 'Implement the final agreed changes now.'
          : 'Write the final, agreed implementation as a concrete plan with full code.'
      }`
      const synthesis = await this.complete(synthesizer, prompt, [], IPCModerator.SYNTH_TOOLS)
      appState.send(CH.debateUpdate, { type: 'synthesis', name: synthesizer.name, text: synthesis })
      status('')
    } catch (err) {
      status('')
      if (this.cancelled || (err instanceof Error && err.name === 'AbortError')) {
        appState.send(CH.debateUpdate, { type: 'error', text: 'Synthesis cancelled.' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      appState.send(CH.debateUpdate, { type: 'error', text: `Synthesis failed: ${msg}` })
    }
  }

  decline(): void {
    this.pendingTranscript = null
    this.pendingParticipants = null
    this.pendingSynthesizer = null
    appState.send(CH.debateUpdate, { type: 'synthesis', text: '(declined — discussion kept, no changes made)' })
  }
}
