// Shared node/edge type registries used by the editor canvas, the AI
// proposal preview, and presentation mode. All types are always registered
// regardless of the active diagram mode so mixed documents render everywhere.

import StepNode from '../components/nodes/StepNode'
import DecisionNode from '../components/nodes/DecisionNode'
import NoteNode from '../components/nodes/NoteNode'
import ImageNode from '../components/nodes/ImageNode'
import {
  ServiceNode,
  DatabaseNode,
  QueueNode,
  CacheNode,
  ApiGatewayNode,
  ExternalActorNode,
} from '../components/nodes/ArchNode'
import ContainerNode from '../components/nodes/ContainerNode'
import { EditableEdge, EditableSmoothStepEdge } from '../components/edges/EditableEdge'

export const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
  image: ImageNode,
  service: ServiceNode,
  database: DatabaseNode,
  queue: QueueNode,
  cache: CacheNode,
  apiGateway: ApiGatewayNode,
  externalActor: ExternalActorNode,
  container: ContainerNode,
}

export const edgeTypes = {
  default: EditableEdge,
  smoothstep: EditableSmoothStepEdge,
  step: EditableSmoothStepEdge,
}
