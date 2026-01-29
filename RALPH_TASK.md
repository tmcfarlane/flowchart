---
task: FlowChart Designer (Vite + React + TypeScript)
test_command: "pnpm test"
----

# Task: FlowChart Designer

Build a front-end-only app that lets design teams create and present interactive flow charts.

## Success Criteria

1. [x] App loads to a blank canvas with a toolbar and 1 starter node
2. [x] Users can add nodes of at least 3 types (e.g., Step, Decision, Note)
3. [x] Users can drag nodes to reposition them and changes persist in local state
4. [x] Users can connect nodes by dragging handles; edges render correctly
5. [x] Users can edit node text/label
6. [x] Users can delete selected nodes/edges
7. [x] Users can reconnect edges by changing connection points
8. [x] "Preview" button enters full-screen presentation mode
9. [x] Preview mode shows only the flow + "Next" and "Previous" buttons
10. [x] Next/Previous navigates through nodes in a deterministic order
11. [x] Preview highlights the active node and centers it in view
12. [x] Exiting preview returns to the editor with state preserved
13. [x] All tests pass

## Context

* Front-end only (no backend)
* Use Vite + React + TypeScript
* Use React Flow ([https://reactflow.dev/learn](https://reactflow.dev/learn))


---

## Ralph Instructions

1. Work on the next incomplete criterion (marked [ ])
2. Check off completed criteria (change [ ] to [x])
3. Run tests after changes
4. Commit your changes frequently
5. When ALL criteria are [x], output: `<ralph>COMPLETE</ralph>`
6. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
