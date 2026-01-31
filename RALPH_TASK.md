---
task: FlowChart Designer – UI Polish & Interaction Pass (Vite + React + TypeScript)
test_command: "pnpm test"
---

# Task: FlowChart Designer – UI Polish & Interaction Pass

Perform a focused UI/UX polish pass on the existing FlowChart Designer to ensure interactions feel clear, consistent, and presentation-ready.

This task assumes all prior core functionality is already implemented.

## Success Criteria

1. [x] App loads to a blank canvas with a toolbar and 1 starter node
2. [x] Users can add nodes of at least 3 types (Step, Decision, Note)
3. [x] Users can drag nodes to reposition them and changes persist in local state
4. [x] Users can connect nodes by dragging handles; edges support multiple styles
5. [x] Users can edit node text/label
6. [x] Users can delete selected nodes/edges
7. [x] Decision nodes use a default 4-direction handle layout; incoming edges snap to nearest side
8. [x] Preview mode enters full-screen presentation with Next / Previous navigation
9. [x] Preview highlights the active node, centers it, and exits cleanly back to editor
10. [x] Right sidebar supports Explorer and AI chat modes
11. [x] AI requests are proxied through `/api/chat` with server-side env vars only
12. [x] AI suggestions can be previewed and applied via an **Apply Changes** flow
13. [x] Undo / Redo works for nodes and edges (10-step history)
14. [x] Clear All, Grid Toggle, Whiteboard Mode, Zoom In/Out are implemented
15. [x] Multi-select, delete, copy, and paste work for nodes and edges

### UI Polish & Interaction (FOCUS OF THIS TASK)

16. [x] Nodes are **resizable** via visible resize handles/corners
17. [x] Resizing updates node dimensions in React Flow state and persists during the session
18. [x] Node interaction affordances are visually clear:
    - Hover states for nodes, handles, and edges
    - Clear selected, multi-selected, and active states
19. [x] Connection creation feels intentional:
    - Handles are hidden until hover
    - Nearby handles appear during drag
    - Edge style selection is discoverable and consistent
20. [x] Toolbar and sidebar are visually polished:
    - Clear iconography
    - Consistent spacing and alignment
    - No visual clutter during common workflows
21. [x] Multi-select, delete, copy, paste affordances feel cohesive and predictable
22. [x] Zooming, panning, and centering interactions feel smooth and non-jarring

### AI Chat UX Polish

23. [x] AI chat produces a **Proposed Flow** preview state
24. [x] Proposed Flow includes explicit actions:
    - **Insert** (apply changes)
    - **Cancel** (discard proposal)
    - **Regenerate** (request a new proposal)
25. [x] No AI-generated raw JSON is ever displayed to the user
26. [ ] Transition between Explorer ↔ AI sidebar feels smooth and intentional


### Verification

27. [ ] Use `agent-browser` to visually verify:
    - Toolbar layout and icon clarity
    - Sidebar (Explorer + AI) layout
    - Node, edge, and selection styling
    - Resize, connect, multi-select, and preview interactions
28. [ ] All tests pass

---

## Context

- Front-end only (no backend) **except** `/api/chat` Vercel Serverless Function
- Vite + React + TypeScript
- React Flow is the graph engine
- This task is **UI/UX polish only** — no new core features
- Focus on clarity, consistency, and design-tool-quality interactions

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked [ ])
2. Check off completed criteria (change [ ] to [x])
3. Run tests after changes
4. Commit your changes frequently
5. When ALL criteria are [x], output: `<ralph>COMPLETE</ralph>`
6. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
