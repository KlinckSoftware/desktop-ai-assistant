import { useMemo } from 'react'
import * as Diff from 'diff'
import { html } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import type { PendingEdit } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

function EditCard({ edit }: { edit: PendingEdit }): JSX.Element {
  const remove = useAppStore((s) => s.removePendingEdit)

  const diffHtml = useMemo(() => {
    const patch = Diff.createTwoFilesPatch(edit.rel, edit.rel, edit.oldContent, edit.newContent, '', '')
    return html(patch, {
      outputFormat: 'line-by-line',
      drawFileList: false,
      colorScheme: ColorSchemeType.DARK
    })
  }, [edit])

  const approve = (): void => {
    window.api.edit.approve(edit.id)
    remove(edit.id)
  }
  const reject = (): void => {
    window.api.edit.reject(edit.id)
    remove(edit.id)
  }

  return (
    <div className="flex max-h-[80vh] w-[44rem] flex-col rounded-lg border border-border bg-panel shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="text-gemini">{edit.origin}</span>
        <span className="text-gray-400">proposes</span>
        <span className={edit.isNew ? 'text-green-400' : 'text-yellow-400'}>
          {edit.isNew ? 'create' : 'edit'}
        </span>
        <span className="truncate font-mono text-gray-200">{edit.rel}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg p-2 text-xs">
        <div dangerouslySetInnerHTML={{ __html: diffHtml }} />
      </div>
      <div className="flex gap-2 border-t border-border p-2 text-xs">
        <button className="flex-1 rounded bg-green-600 py-1.5 font-medium text-white" onClick={approve}>
          Apply edit
        </button>
        <button className="flex-1 rounded bg-red-600 py-1.5 font-medium text-white" onClick={reject}>
          Reject
        </button>
      </div>
    </div>
  )
}

// Modal review of agent-proposed file edits. Always requires explicit approval
// (writes are destructive); the diff is the review surface. A checkpoint of the
// prior content is taken on apply so it can be undone.
export default function EditReview(): JSX.Element | null {
  const edits = useAppStore((s) => s.pendingEdits)
  if (edits.length === 0) return null
  return (
    <div
      style={{ zIndex: Z.modal }}
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
    >
      <EditCard edit={edits[0]} />
      {edits.length > 1 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-panel px-3 py-1 text-xs text-gray-400">
          {edits.length - 1} more edit(s) queued
        </div>
      )}
    </div>
  )
}
