import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import GuideModal from './GuideModal'

afterEach(cleanup)

describe('GuideModal', () => {
  it('renders the sections', () => {
    render(<GuideModal onClose={() => {}} />)
    expect(screen.getByText('What this is')).toBeTruthy()
    expect(screen.getByText('Pipelines')).toBeTruthy()
  })

  it('filters sections by the search box', () => {
    render(<GuideModal onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Search the guide…'), { target: { value: 'schedule' } })
    expect(screen.getByText('Runs & Schedules')).toBeTruthy()
    expect(screen.queryByText('What this is')).toBeNull() // non-matching section hidden
  })

  it('calls onClose from the Close button', () => {
    const onClose = vi.fn()
    render(<GuideModal onClose={onClose} />)
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
