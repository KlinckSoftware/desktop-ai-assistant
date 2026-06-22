import type { PipelineStep } from '../../shared/types'

// Pure helpers for the pipeline graph: normalize steps (assign ids + default
// linear deps), topologically order them, and resolve a step's prompt/condition
// from its dependencies' outputs. Execution stays sequential (topo order) so a
// run's single shared worktree is never written by two steps at once.

export interface NormStep extends PipelineStep {
  id: string
  deps: string[]
}

/** Assign stable ids (s1, s2, …) where missing and default each step's deps to
 *  the previous step (linear back-compat). Existing ids are preserved. */
export function normalize(steps: PipelineStep[]): NormStep[] {
  const ids = steps.map((s, i) => s.id || `s${i + 1}`)
  return steps.map((s, i) => ({
    ...s,
    id: ids[i],
    deps: s.deps && s.deps.length ? s.deps : i > 0 ? [ids[i - 1]] : []
  }))
}

/** Kahn topological sort. Throws on a missing dependency id or a cycle. */
export function topoOrder(steps: NormStep[]): NormStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]))
  for (const s of steps) {
    for (const d of s.deps) if (!byId.has(d)) throw new Error(`step "${s.id}" depends on unknown step "${d}"`)
  }
  const indeg = new Map(steps.map((s) => [s.id, s.deps.length]))
  const ready = steps.filter((s) => s.deps.length === 0).map((s) => s.id)
  const dependents = new Map<string, string[]>()
  for (const s of steps) for (const d of s.deps) (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(s.id)

  const order: NormStep[] = []
  while (ready.length) {
    const id = ready.shift()!
    order.push(byId.get(id)!)
    for (const dep of dependents.get(id) ?? []) {
      indeg.set(dep, (indeg.get(dep) ?? 0) - 1)
      if (indeg.get(dep) === 0) ready.push(dep)
    }
  }
  if (order.length !== steps.length) throw new Error('pipeline has a dependency cycle')
  return order
}

/** Combined text of a step's dependencies (or the run input when it has none). */
export function combinedInput(step: NormStep, outputs: Map<string, string>, runInput: string): string {
  if (!step.deps.length) return runInput
  return step.deps.map((d) => outputs.get(d) ?? '').join('\n\n')
}

/**
 * The prompt for a step. If the instruction uses ${id}/${input} tokens, they're
 * interpolated and used verbatim; otherwise the instruction is prepended to the
 * combined dependency text (the classic "instruction + carried output" shape).
 */
export function resolvePrompt(step: NormStep, outputs: Map<string, string>, runInput: string): string {
  const instr = step.instruction ?? ''
  if (instr.includes('${')) {
    return instr.replace(/\$\{(\w+)\}/g, (_m, k: string) => (k === 'input' ? runInput : outputs.get(k) ?? ''))
  }
  const dep = combinedInput(step, outputs, runInput)
  return instr ? `${instr}\n\n${dep}` : dep
}

/** Whether a conditional step should run. No condition => always runs. */
export function conditionMet(step: NormStep, outputs: Map<string, string>, runInput: string): boolean {
  const c = step.condition
  if (!c || !c.contains) return true
  const src = c.from ? outputs.get(c.from) ?? '' : combinedInput(step, outputs, runInput)
  return src.toLowerCase().includes(c.contains.toLowerCase())
}

/** Split a map step's input into items: non-empty trimmed lines. */
export function mapItems(input: string): string[] {
  return input
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}
