import { Node, Edge } from 'reactflow'
import './Explorer.css'

interface ExplorerProps {
  nodes: Node[]
  edges: Edge[]
  onUpdateNodeLabel: (nodeId: string, label: string) => void
  onClose: () => void
}

function Explorer({ nodes, edges, onUpdateNodeLabel, onClose }: ExplorerProps) {
  const handleNodeNameChange = (nodeId: string, newLabel: string) => {
    onUpdateNodeLabel(nodeId, newLabel)
  }

  return (
    <div className="explorer-sidebar">
      <div className="explorer-header">
        <h3>Explorer</h3>
        <button className="explorer-close" onClick={onClose} title="Close sidebar">
          ×
        </button>
      </div>
      
      <div className="explorer-content">
        <div className="explorer-section">
          <h4>Nodes ({nodes.length})</h4>
          <div className="explorer-list">
            {nodes.map((node) => (
              <div key={node.id} className="explorer-item">
                <span className="node-type-badge">{node.type || 'default'}</span>
                <input
                  type="text"
                  className="explorer-input"
                  value={node.data.label || ''}
                  onChange={(e) => handleNodeNameChange(node.id, e.target.value)}
                  placeholder="Node name"
                />
              </div>
            ))}
            {nodes.length === 0 && (
              <div className="explorer-empty">No nodes yet</div>
            )}
          </div>
        </div>

        <div className="explorer-section">
          <h4>Edges ({edges.length})</h4>
          <div className="explorer-list">
            {edges.map((edge, index) => {
              const sourceNode = nodes.find((n) => n.id === edge.source)
              const targetNode = nodes.find((n) => n.id === edge.target)
              return (
                <div key={edge.id || index} className="explorer-item edge-item">
                  <div className="edge-info">
                    <span className="edge-source">{sourceNode?.data.label || edge.source}</span>
                    <span className="edge-arrow">→</span>
                    <span className="edge-target">{targetNode?.data.label || edge.target}</span>
                  </div>
                  {edge.animated && <span className="edge-style-badge">animated</span>}
                  {edge.type && edge.type !== 'default' && (
                    <span className="edge-style-badge">{edge.type}</span>
                  )}
                </div>
              )
            })}
            {edges.length === 0 && (
              <div className="explorer-empty">No edges yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Explorer
