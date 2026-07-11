import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore, type PersistedState } from './appStore'

// Build the persisted slice exactly the way App.tsx's debounced saver does
// (same keys, read from the live store) so the round-trip below exercises the
// real save shape against the real hydrate().
function saveSlice(): PersistedState {
  const s = useAppStore.getState()
  return {
    projectRoot: s.projectRoot,
    selectedFile: s.selectedFile,
    geminiMessages: s.geminiMessages,
    debateUpdates: s.debateUpdates,
    debatePrompt: s.debatePrompt,
    geminiModel: s.geminiModel,
    claudeModel: s.claudeModel,
    claudeEffort: s.claudeEffort,
    debateRounds: s.debateRounds,
    debateSideA: s.debateSideA,
    debateSideB: s.debateSideB,
    terminalShell: s.terminalShell,
    isolateAgents: s.isolateAgents,
    allowSecretReads: s.allowSecretReads,
    allowProtectedWrites: s.allowProtectedWrites,
    pipelineAllowFullDefault: s.pipelineAllowFullDefault,
    alwaysConfirm: s.alwaysConfirm,
    autonomousAllow: s.autonomousAllow,
    seenGuide: s.seenGuide,
    dockLayout: s.dockLayout,
    apiChats: s.apiChats,
    apiModels: s.apiModels,
    pipelines: s.pipelines,
    pipelineRuns: s.pipelineRuns,
    persistRunOutputs: s.persistRunOutputs,
    approvalTimeout: s.approvalTimeout,
    pipelineDefaultPermission: s.pipelineDefaultPermission,
    pipelineDefaultDryRun: s.pipelineDefaultDryRun,
    startupAgent: s.startupAgent,
    repoMapInContext: s.repoMapInContext,
    terminalFontSize: s.terminalFontSize,
    terminalScrollback: s.terminalScrollback,
    editorFontSize: s.editorFontSize,
    editorWrap: s.editorWrap,
    costCap: s.costCap,
    accentColor: s.accentColor,
    closeToTray: s.closeToTray
  }
}

describe('appStore hydrate', () => {
  // The store is a module-level singleton — reset the persisted slice between
  // tests by hydrating an empty snapshot (defaults everything).
  beforeEach(() => {
    useAppStore.getState().hydrate({})
  })

  it('applies persisted settings values', () => {
    useAppStore.getState().hydrate({
      projectRoot: 'C:/proj',
      geminiModel: 'gemini-2.5-pro',
      claudeModel: 'opus',
      debateRounds: 5,
      debateSideA: 'gemini',
      debateSideB: 'api:openai',
      terminalShell: 'bash',
      isolateAgents: false,
      alwaysConfirm: true,
      autonomousAllow: 'git,ls',
      approvalTimeout: 60,
      pipelineDefaultPermission: 'full',
      costCap: 2.5,
      accentColor: '#ff0000',
      closeToTray: true,
      apiModels: { panel1: 'gpt-4o' },
      apiChats: { panel1: [{ role: 'user', content: 'hi' }] }
    })
    const s = useAppStore.getState()
    expect(s.projectRoot).toBe('C:/proj')
    expect(s.geminiModel).toBe('gemini-2.5-pro')
    expect(s.claudeModel).toBe('opus')
    expect(s.debateRounds).toBe(5)
    expect(s.debateSideA).toBe('gemini')
    expect(s.debateSideB).toBe('api:openai')
    expect(s.terminalShell).toBe('bash')
    expect(s.isolateAgents).toBe(false)
    expect(s.alwaysConfirm).toBe(true)
    expect(s.autonomousAllow).toBe('git,ls')
    expect(s.approvalTimeout).toBe(60)
    expect(s.pipelineDefaultPermission).toBe('full')
    expect(s.costCap).toBe(2.5)
    expect(s.accentColor).toBe('#ff0000')
    expect(s.closeToTray).toBe(true)
    expect(s.apiModels).toEqual({ panel1: 'gpt-4o' })
    expect(s.apiChats.panel1).toHaveLength(1)
  })

  it('falls back to defaults for keys missing from the snapshot', () => {
    useAppStore.getState().hydrate({ geminiModel: 'gemini-2.5-pro' }) // partial snapshot
    const s = useAppStore.getState()
    expect(s.geminiModel).toBe('gemini-2.5-pro') // provided
    expect(s.debateRounds).toBe(3)
    expect(s.terminalShell).toBe('default')
    expect(s.isolateAgents).toBe(true)
    expect(s.allowSecretReads).toBe(false)
    expect(s.approvalTimeout).toBe(15)
    expect(s.pipelineDefaultPermission).toBe('read-only')
    expect(s.persistRunOutputs).toBe(true)
    expect(s.accentColor).toBe('#58a6ff')
    expect(s.costCap).toBe(0)
    expect(s.apiChats).toEqual({})
    expect(s.pipelines).toEqual([])
    expect(s.closeToTray).toBe(false)
  })

  it('never restores a running debate from disk', () => {
    useAppStore.getState().startDebateState('old prompt')
    expect(useAppStore.getState().debateRunning).toBe(true)
    expect(useAppStore.getState().debateStatus).not.toBe('')

    useAppStore.getState().hydrate({ debatePrompt: 'old prompt', debateRounds: 4 })

    const s = useAppStore.getState()
    expect(s.debateRunning).toBe(false) // the backend run is gone after restart
    expect(s.debateStatus).toBe('')
    expect(s.debatePrompt).toBe('old prompt') // transcript context still restored
  })

  it('round-trips settings through save → hydrate unchanged', () => {
    const st = useAppStore.getState()
    // Mutate through the real setters, as the settings UI does.
    st.setGeminiModel('gemini-2.5-pro')
    st.setClaudeModel('sonnet')
    st.setClaudeEffort('high')
    st.setDebateRounds(7)
    st.setDebateSides('gemini', 'claude')
    st.setTerminalShell('pwsh')
    st.setIsolateAgents(false)
    st.setAllowSecretReads(true)
    st.setAlwaysConfirm(true)
    st.setAutonomousAllow('npm')
    st.setApprovalTimeout(0)
    st.setPipelineDefaultPermission('edit')
    st.setPipelineDefaultDryRun(true)
    st.setStartupAgent('gemini')
    st.setTerminalFontSize(15)
    st.setEditorWrap(true)
    st.setCostCap(1.25)
    st.setAccentColor('#00ff00')
    st.setCloseToTray(true)
    st.setApiModel('panelX', 'gpt-4.1')
    st.savePipeline({ id: 'p1', name: 'lint', steps: [] } as never)

    const saved = saveSlice()

    // Simulate an app restart: state resets to defaults…
    useAppStore.getState().hydrate({})
    expect(useAppStore.getState().debateRounds).toBe(3)
    expect(useAppStore.getState().costCap).toBe(0)

    // …then the persisted snapshot is loaded back.
    useAppStore.getState().hydrate(saved)
    expect(saveSlice()).toEqual(saved)
    expect(useAppStore.getState().debateRounds).toBe(7)
    expect(useAppStore.getState().apiModels.panelX).toBe('gpt-4.1')
    expect(useAppStore.getState().pipelines).toHaveLength(1)
  })
})
