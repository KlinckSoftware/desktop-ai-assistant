import type { IDockviewPanelProps } from 'dockview'
import FileTreePanel from '../panes/FileTreePanel'
import AgentPane from '../panes/AgentPane'
import GeminiChat from '../panes/GeminiChat'
import TerminalPane from '../panes/TerminalPane'
import DiffViewer from '../panes/DiffViewer'
import GitPanel from '../panes/GitPanel'
import CheckpointsPanel from '../panes/CheckpointsPanel'
import DebatePanel from '../panes/DebatePanel'
import FileEditor from '../panes/FileEditor'
import ApiChatPanel from '../panes/ApiChatPanel'
import CockpitPanel from '../panes/CockpitPanel'
import PipelinePanel from '../panes/PipelinePanel'
import ReviewPanel from '../panes/ReviewPanel'
import { focusPanel } from './dockApi'

// Each dockview panel fills its tab; panes read shared state from the store.
const wrap = (el: JSX.Element) => () => <div className="h-full w-full overflow-hidden">{el}</div>

export const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  files: wrap(<FileTreePanel />),
  agent: AgentPane, // per-instance; reads props.params.sessionId
  apichat: ApiChatPanel, // per-instance; reads props.params.instanceId/providerId
  gemini: wrap(<GeminiChat />),
  terminal: wrap(<TerminalPane />),
  editor: wrap(<FileEditor />),
  diff: wrap(<DiffViewer />),
  git: wrap(<GitPanel onOpenDiff={() => focusPanel('diff')} />),
  checkpoints: wrap(<CheckpointsPanel />),
  debate: wrap(<DebatePanel />),
  cockpit: wrap(<CockpitPanel />),
  pipeline: wrap(<PipelinePanel />),
  review: wrap(<ReviewPanel />)
}
