export const drawCommands = [
  { id: 'link', label: 'Edit link', shortcut: 'Ctrl/Cmd K', mutates: true },
  { id: 'search', label: 'Find in drawing', shortcut: 'Ctrl/Cmd F', mutates: false },
  { id: 'palette', label: 'Command palette', shortcut: 'Ctrl/Cmd / · Ctrl/Cmd Shift P', mutates: false },
  { id: 'statistics', label: 'Drawing statistics', shortcut: 'Alt/Option /', mutates: false },
  { id: 'zen', label: 'Toggle zen mode', shortcut: 'Alt/Option Z', mutates: false },
  { id: 'view', label: 'Toggle view mode', shortcut: 'Alt/Option R', mutates: false },
  { id: 'theme', label: 'Toggle app theme', shortcut: 'Alt/Option Shift D', mutates: false },
  { id: 'clear', label: 'Clear board', shortcut: 'Ctrl/Cmd Delete', mutates: true },
] as const

export type DrawCommandId = (typeof drawCommands)[number]['id']
