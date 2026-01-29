----
task: FlowChart Designer (Vite + React + TypeScript)
test_command: "pnpm test"
----
# Task: FlowChart Designer

Build a front-end-only app that lets design teams create and present interactive flow charts.

## Success Criteria

1. [x] App loads to a blank canvas with a toolbar and 1 starter node
2. [x] Users can add nodes of at least 3 types (e.g., Step, Decision, Note)
3. [x] Users can drag nodes to reposition them and changes persist in local state
4. [x] Users can connect nodes by dragging handles; edges support style options (animated dashed arrow + at least 2 other styles)
5. [x] Users can edit node text/label
6. [x] Users can delete selected nodes/edges
7. [x] Decision nodes use a default 4-direction handle layout (Top/Right/Bottom/Left), and incoming edges connect to the nearest side
8. [x] "Preview" button enters full-screen presentation mode
9. [x] Preview mode shows only the flow + "Next" and "Previous" buttons
10. [x] Next/Previous navigates through nodes in a deterministic order
11. [x] Preview highlights the active node and centers it in view
12. [x] Exiting preview returns to the editor with state preserved
13. [x] Right sidebar: Explorer view lists nodes + edges + any associated text; node names are editable here
14. [ ] "AI" button opens a right sidebar chat interface (replaces Explorer) for generating/updating flows via LLM
15. [ ] Azure OpenAI config is read from env vars (Vite-safe): `VITE_AZURE_DEPLOYMENT_NAME`, `VITE_AZURE_RESOURCE_NAME`, `VITE_AZURE_API_KEY`
16. [ ] All tests pass

## Context

- Front-end only (no backend)
- Use Vite + React + TypeScript
- Use React Flow ([https://reactflow.dev/learn](https://reactflow.dev/learn))
- Edge styles: animated dashed arrow should be available; users can switch edge style per-edge (or via a default style setting)
- Sidebar:
   - Explorer mode: nodes list + edges list + any node/edge text; edit node name here
   - AI mode: chat UI; uses Azure OpenAI to propose changes (e.g., “add a decision after step 2”)

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked [ ])
2. Check off completed criteria (change [ ] to [x])
3. Run tests after changes
4. Commit your changes frequently
5. When ALL criteria are [x], output: `<ralph>COMPLETE</ralph>`
6. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
