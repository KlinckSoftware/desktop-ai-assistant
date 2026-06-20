import { appState } from '../state'
import { CH, type DebateRound, type Message } from '../../shared/types'
import { claudeOneShot } from '../claude/ClaudeHeadless'
import { extractBashBlocks } from '../executor/parser'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { CommandBroker } from '../executor/CommandBroker'

// Orchestrates a structured Claude<->Gemini debate. Neither agent talks to the
// other directly — everything routes through main. Uses headless `claude -p`
// for clean Claude turns and Gemini's one-shot completion.
// Rounds are analysis only; the editing happens in the synthesis step, which is
// gated behind explicit user approval.
const NO_EDIT = '\n\nThis is analysis/discussion only — do NOT modify files or run mutating commands.'

export class IPCModerator {
  private pendingTranscript: DebateRound[] | null = null
  private pendingPrompt = ''

  constructor(
    private gemini: GeminiClient,
    private broker: CommandBroker
  ) {}

  async runDebate(userPrompt: string, roundsArg?: number): Promise<void> {
    const rounds = roundsArg ?? appState.settings.debateRounds
    const cwd = appState.projectRoot
    const transcript: DebateRound[] = []
    const status = (s: string): void => appState.send(CH.debateStatus, s)

    try {
      for (let i = 0; i < rounds; i++) {
        status(`Claude thinking… (round ${i + 1}/${rounds})`)
        const claudePrompt =
          (i === 0
            ? userPrompt
            : `Original task: ${userPrompt}\n\nGemini responded: "${transcript[i - 1].gemini}"\n\nRevise or defend your approach.`) +
          NO_EDIT

        const claudeText = await claudeOneShot(claudePrompt, cwd, appState.settings.claudeModel)
        transcript.push({ round: i, claude: claudeText, gemini: '' })
        appState.send(CH.debateUpdate, { type: 'claude', text: claudeText, round: i })

        // Run any commands Claude proposed (through the approval gate).
        const claudeCmds = extractBashBlocks(claudeText)
        if (claudeCmds.length) status(`Awaiting approval for ${claudeCmds.length} command(s)…`)
        const claudeResults = await Promise.all(
          claudeCmds.map((cmd) => this.broker.propose(cmd, 'claude', 'debate'))
        )

        const geminiHistory: Message[] = transcript
          .flatMap((r) => [
            { role: 'user' as const, content: r.claude },
            { role: 'model' as const, content: r.gemini }
          ])
          .filter((m) => m.content)

        status(`Gemini critiquing… (round ${i + 1}/${rounds})`)
        const geminiPrompt = `Claude proposed:\n${claudeText}\n\nTerminal output:\n${claudeResults.join('\n')}\n\nCritique and improve.`
        const geminiText = await this.gemini.complete(geminiPrompt, geminiHistory)
        transcript[i].gemini = geminiText
        appState.send(CH.debateUpdate, { type: 'gemini', text: geminiText, round: i })
      }

      // Rounds done — pause for approval before the synthesis step edits files.
      this.pendingTranscript = transcript
      this.pendingPrompt = userPrompt
      status('')
      appState.send(CH.debateUpdate, {
        type: 'await',
        text: 'Discussion complete. Approve to let Claude implement the agreed changes (this WILL edit files), or decline to keep the discussion only.'
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[debate] failed:', msg)
      status('')
      appState.send(CH.debateUpdate, { type: 'error', text: `Debate failed: ${msg}` })
    }
  }

  /** Run the agentic synthesis (edits files) — only after user approval. */
  async synthesize(): Promise<void> {
    const transcript = this.pendingTranscript
    if (!transcript) return
    this.pendingTranscript = null
    const status = (s: string): void => appState.send(CH.debateStatus, s)
    try {
      status('Implementing the agreed changes…')
      const synthesis = await claudeOneShot(
        `Original task: ${this.pendingPrompt}\n\nDebate transcript:\n${JSON.stringify(transcript, null, 2)}\n\nImplement the final agreed changes now.`,
        appState.projectRoot,
        appState.settings.claudeModel
      )
      appState.send(CH.debateUpdate, { type: 'synthesis', text: synthesis })
      status('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      status('')
      appState.send(CH.debateUpdate, { type: 'error', text: `Synthesis failed: ${msg}` })
    }
  }

  decline(): void {
    this.pendingTranscript = null
    appState.send(CH.debateUpdate, { type: 'synthesis', text: '(declined — discussion kept, no changes made)' })
  }
}
