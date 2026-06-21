import { appState } from '../state'
import { CH, type DebateRound, type DebateAgent, type Message } from '../../shared/types'
import { extractBashBlocks } from '../executor/parser'
import { listAgents } from '../agents/registry'
import { listProviders } from '../api/providers'
import { completeParticipant } from '../agents/complete'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { CommandBroker } from '../executor/CommandBroker'

// Orchestrates a structured two-participant debate. Participants are chosen by
// the user from whatever models/APIs are currently usable (CLI binary present
// or API key set). Neither side talks to the other directly — everything routes
// through main. Rounds are analysis only; editing happens in the synthesis step,
// gated behind explicit user approval.
const NO_EDIT = '\n\nThis is analysis/discussion only — do NOT modify files or run mutating commands.'

export class IPCModerator {
  private pendingTranscript: DebateRound[] | null = null
  private pendingPrompt = ''
  private pendingA: DebateAgent | null = null

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
  private complete(agent: DebateAgent, prompt: string, history: Message[]): Promise<string> {
    return completeParticipant(agent, prompt, history, this.gemini)
  }

  async runDebate(userPrompt: string, aId = 'claude', bId = 'gemini', roundsArg?: number): Promise<void> {
    const rounds = roundsArg ?? appState.settings.debateRounds
    const transcript: DebateRound[] = []
    const status = (s: string): void => appState.send(CH.debateStatus, s)

    try {
      const a = await this.resolve(aId)
      const b = await this.resolve(bId)

      for (let i = 0; i < rounds; i++) {
        status(`${a.name} thinking… (round ${i + 1}/${rounds})`)
        const aPrompt =
          (i === 0
            ? userPrompt
            : `Original task: ${userPrompt}\n\n${b.name} responded: "${transcript[i - 1].b}"\n\nRevise or defend your approach.`) +
          NO_EDIT

        // Chat-style A participants get the running transcript as history.
        const aHistory: Message[] = transcript
          .flatMap((r) => [
            { role: 'assistant' as const, content: r.a },
            { role: 'user' as const, content: r.b }
          ])
          .filter((m) => m.content)
        const aText = await this.complete(a, aPrompt, aHistory)
        transcript.push({ round: i, a: aText, b: '' })
        appState.send(CH.debateUpdate, { type: 'turn', side: 'a', name: a.name, text: aText, round: i })

        // Run any commands A proposed (through the approval gate).
        const cmds = extractBashBlocks(aText)
        if (cmds.length) status(`Awaiting approval for ${cmds.length} command(s)…`)
        const results = await Promise.all(cmds.map((cmd) => this.broker.propose(cmd, 'claude', 'debate')))

        const bHistory: Message[] = transcript
          .flatMap((r) => [
            { role: 'user' as const, content: r.a },
            { role: 'assistant' as const, content: r.b }
          ])
          .filter((m) => m.content)

        status(`${b.name} critiquing… (round ${i + 1}/${rounds})`)
        const bPrompt = `${a.name} proposed:\n${aText}\n\nTerminal output:\n${results.join('\n')}\n\nCritique and improve.${NO_EDIT}`
        const bText = await this.complete(b, bPrompt, bHistory)
        transcript[i].b = bText
        appState.send(CH.debateUpdate, { type: 'turn', side: 'b', name: b.name, text: bText, round: i })
      }

      // Rounds done — pause for approval before the synthesis step.
      this.pendingTranscript = transcript
      this.pendingPrompt = userPrompt
      this.pendingA = a
      status('')
      const edits = a.kind === 'claude'
      appState.send(CH.debateUpdate, {
        type: 'await',
        text: edits
          ? `Discussion complete. Approve to let ${a.name} implement the agreed changes (this WILL edit files), or decline to keep the discussion only.`
          : `Discussion complete. Approve to have ${a.name} write up the final implementation plan (it will NOT edit files directly — ${a.name} is API-only), or decline.`
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[debate] failed:', msg)
      status('')
      appState.send(CH.debateUpdate, { type: 'error', text: `Debate failed: ${msg}` })
    }
  }

  /** Run the synthesis — only after user approval. Claude edits files agentically;
   *  API/Gemini participants produce a final plan (no autonomous edits). */
  async synthesize(): Promise<void> {
    const transcript = this.pendingTranscript
    const a = this.pendingA
    if (!transcript || !a) return
    this.pendingTranscript = null
    const status = (s: string): void => appState.send(CH.debateStatus, s)
    try {
      status(`${a.name} synthesizing…`)
      const prompt = `Original task: ${this.pendingPrompt}\n\nDebate transcript:\n${JSON.stringify(transcript, null, 2)}\n\n${
        a.kind === 'claude'
          ? 'Implement the final agreed changes now.'
          : 'Write the final, agreed implementation as a concrete plan with full code.'
      }`
      const synthesis = await this.complete(a, prompt, [])
      appState.send(CH.debateUpdate, { type: 'synthesis', name: a.name, text: synthesis })
      status('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      status('')
      appState.send(CH.debateUpdate, { type: 'error', text: `Synthesis failed: ${msg}` })
    }
  }

  decline(): void {
    this.pendingTranscript = null
    this.pendingA = null
    appState.send(CH.debateUpdate, { type: 'synthesis', text: '(declined — discussion kept, no changes made)' })
  }
}
