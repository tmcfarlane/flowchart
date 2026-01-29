---
task: FlowChart Designer (Vite + React + TypeScript)
test_command: "pnpm test"
---

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
14. [x] "AI" button opens a right sidebar chat interface (replaces Explorer) for generating/updating flows via LLM
15. [x] AI requests are proxied through a Vercel Serverless Function (`/api/chat`) so no secrets are shipped to the browser
16. [x] Server-side env vars are used (NOT `VITE_*`): `AZURE_DEPLOYMENT_NAME`, `AZURE_RESOURCE_NAME`, `AZURE_API_KEY` (or AI Gateway equivalents)
17. [x] Frontend calls `/api/chat` and never calls Azure OpenAI (or AI Gateway) directly
18. [x] `/api/chat` supports basic chat with the model and returns an assistant reply (200 on success, useful error on failure)
19. [x] AI chat suggestions can be applied to the canvas via an **"Apply Changes"** button shown in the chat UI when applicable
20. [x] When "Apply Changes" is clicked, the current flow (nodes + edges) is updated to match the AI-proposed changes (can include adds, deletes, and modifications)
21. [x] The app sends the current flow structure to the LLM and receives a structured response back (graph-shaped data), but **the UI never displays raw JSON** to the user
22. [x] Toolbar includes **Undo** and **Redo** icon buttons; Undo/Redo work for create/modify/delete actions on nodes and edges (including notes)
23. [x] Undo history tracks up to **10** prior actions; repeated Undo steps backwards through history; Redo steps forward until a new action occurs (which clears the redo stack)
24. [x] Toolbar includes a **Clear All** button; clicking it wipes the entire board state (all nodes + edges), returning to an empty canvas state
25. [x] Toolbar includes a **Grid toggle** icon button; toggling hides/shows the grid
26. [x] **Whiteboard mode**: when enabled, the grid is hidden and nodes can be moved freely (no snapping-to-grid behavior)
27. [x] All node types (Step, Decision, Note) support **4-direction handles** (Top/Right/Bottom/Left)
28. [x] Connection handles on nodes remain **hidden until hover**; when the user starts a connection drag, handles on nearby nodes (near the cursor) become visible
29. [x] Users can **multi-select** nodes and edges:
    - Click a node/edge to toggle its selection
    - Drag a selection box to select multiple at once
    - Selected nodes/edges show a clear **border** indicator
30. [x] Users can **delete multiple** selected nodes/edges at once via a **trash icon** shown near the current selection
31. [x] Users can **copy and paste** selected nodes/edges via **copy** and **paste** icons shown near the current selection
32. [x] Users can **zoom in/out** via **zoom in** and **zoom out** icon buttons
33. [x] Nodes are resizable via visible resize handles/corners
34. [x] Resizing a node updates its dimensions in React Flow state and persists during the session
35. [ ] All tests pass

## Context

- Front-end only (no backend) **except** a minimal Vercel Serverless Function used strictly as an AI proxy
- Use Vite + React + TypeScript
- Use React Flow ([https://reactflow.dev/learn](https://reactflow.dev/learn))
- Edge styles: animated dashed arrow should be available; users can switch edge style per-edge (or via a default style setting)
- Sidebar:
  - Explorer mode: nodes list + edges list + any node/edge text; edit node name here
  - AI mode: chat UI; frontend sends messages (and optionally the current graph) to `/api/chat`
- No Supabase (not needed for this project)
- Snap-to-grid should feel like Figma/Miro alignment behavior for design teams

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked [ ])
2. Check off completed criteria (change [ ] to [x])
3. Run tests after changes
4. Commit your changes frequently
5. When ALL criteria are [x], output: `<ralph>COMPLETE</ralph>`
6. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
