import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import type { Extension } from '@codemirror/state'

function langFor(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: true, typescript: true })]
    case 'json':
      return [json()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return [html()]
    case 'css':
    case 'scss':
    case 'less':
      return [css()]
    case 'py':
      return [python()]
    case 'rs':
      return [rust()]
    default:
      return []
  }
}

interface Props {
  value: string
  onChange?: (v: string) => void
  path: string
  readOnly?: boolean
}

// CodeMirror 6 editor with extension-based language detection + dark theme.
// Bundled locally (no CDN/eval) so it satisfies the renderer CSP.
export default function CodeEditor({ value, onChange, path, readOnly }: Props): JSX.Element {
  return (
    <CodeMirror
      value={value}
      onChange={(v) => onChange?.(v)}
      theme={oneDark}
      extensions={langFor(path)}
      readOnly={readOnly}
      height="100%"
      style={{ height: '100%', fontSize: 13 }}
      basicSetup={{ lineNumbers: true, highlightActiveLine: !readOnly, foldGutter: true }}
    />
  )
}
