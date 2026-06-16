import { appState } from '../state'
import { CH, type DebateRound, type Message } from '../../shared/types'
import { claudeOneShot } from '../claude/ClaudeHeadless'
import { extractBashBlocks } from '../executor/parser'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { CommandBroker } from '../executor/CommandBroker'

// Orchestrates a structured Claude<->Gemini debate. Neither agent talks to the
// other directly — everything routes through main. Uses headless `claude -p`
// for clean Claude turns and Gemini's one-shot completion.
export class IPCModerator {
  constructor(
    private gemini: GeminiClient,
    private broker: CommandBroker
  ) {}

  async runDebate(userPrompt: string, rounds = 3): Promise<void> {
    const cwd = appState.projectRoot
    const transcript: DebateRound[] = []
    const status = (s: string): void => appState.send(CH.debateStatus, s)

    try {
      for (let i = 0; i < rounds; i++) {
        status(`Claude thinking… (round ${i + 1}/${rounds})`)
        const claudePrompt =
          i === 0
            ? userPrompt
            : `Original task: ${userPrompt}\n\nGemini responded: "${transcript[i - 1].gemini}"\n\nRevise or defend your approach.`

        const claudeText = await claudeOneShot(claudePrompt, cwd)
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

      status('Synthesizing final answer…')
      const synthesis = await claudeOneShot(
        `Based on this debate:\n${JSON.stringify(transcript, null, 2)}\n\nProduce the final agreed implementation.`,
        cwd
      )
      appState.send(CH.debateUpdate, { type: 'synthesis', text: synthesis })
      status('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[debate] failed:', msg)
      status('')
      appState.send(CH.debateUpdate, { type: 'error', text: `Debate failed: ${msg}` })
    }
  }
}
