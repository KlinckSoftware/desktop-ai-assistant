import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import GuideModal from './GuideModal'

afterEach(cleanup)

describe('GuideModal', () => {
  it('lists topics and opens one by default', () => {
    render(<GuideModal onClose={() => {}} />)
    // "Getting started" is a nav button (no body cross-link points to it)
    expect(screen.getByRole('button', { name: 'Getting started' })).toBeTruthy()
    // "Pipelines" appears in the nav and as a cross-link on the default page
    expect(screen.getAllByRole('button', { name: 'Pipelines' }).length).toBeGreaterThan(0)
  })

  it('switches the page when the nav topic is clicked', () => {
    render(<GuideModal onClose={() => {}} />)
    // nav button is the first match (rendered before the right-hand page)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pipelines' })[0])
    expect(screen.getByText(/topological order/i)).toBeTruthy()
  })

  it('filters the topic nav by search', () => {
    render(<GuideModal onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'schedule' } })
    expect(screen.getByRole('button', { name: 'Runs & Schedules' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Getting started' })).toBeNull()
  })

  it('calls onClose from the Close button', () => {
    const onClose = vi.fn()
    render(<GuideModal onClose={onClose} />)
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
