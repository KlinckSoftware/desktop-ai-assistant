import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Stub the preload bridge the modal touches in effects/handlers.
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    mcp: { status: vi.fn(async () => []), configPath: vi.fn(async () => ''), reconnect: vi.fn(async () => []) },
    worktree: { list: vi.fn(async () => []), onChanged: vi.fn(() => () => {}) },
    jobs: { list: vi.fn(async () => []), onChanged: vi.fn(() => () => {}) },
    debate: { agents: vi.fn(async () => []) },
    gemini: { listModels: vi.fn(async () => ['gemini-2.5-pro', 'gemini-2.5-flash']) },
    settings: { set: vi.fn(async () => {}) }
  }
})
afterEach(cleanup)

import SettingsModal from './SettingsModal'

describe('SettingsModal — section nav + search', () => {
  it('shows the first section (Models) by default', () => {
    render(<SettingsModal onClose={() => {}} />)
    expect(screen.getByText('Gemini model')).toBeTruthy()
  })

  it('switches content when a nav section is clicked', () => {
    render(<SettingsModal onClose={() => {}} />)
    // Security nav button → its fields appear
    fireEvent.click(screen.getByRole('button', { name: 'Security' }))
    expect(screen.getByText('Command trust')).toBeTruthy()
  })

  it('search narrows the nav to matching sections', () => {
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'cost cap' } })
    // Budget section's field is shown; an unrelated Models field is not.
    expect(screen.getByText(/Session cost cap/)).toBeTruthy()
    expect(screen.queryByText('Gemini model')).toBeNull()
  })
})
