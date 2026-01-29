# FlowChart Designer

A modern, interactive flowchart designer built with Vite, React, TypeScript, and React Flow. Create beautiful flowcharts with AI assistance powered by Azure OpenAI.

## Features

### Core Functionality
- **Interactive Canvas**: Drag-and-drop interface for creating flowcharts
- **Multiple Node Types**: Step, Decision, and Note nodes
- **Flexible Connections**: Connect nodes with customizable edge styles
- **Edge Styles**: Choose from 4 edge styles:
  - Animated Dashed (default)
  - Default
  - Step
  - Smooth Step

### Node Capabilities
- **Editable Labels**: Double-click any node to edit its text
- **Smart Handles**: Decision nodes feature 8 handles (4 source, 4 target) for maximum flexibility
- **Drag & Drop**: Reposition nodes anywhere on the canvas
- **Delete**: Remove selected nodes and edges with the Delete key or toolbar button

### Presentation Mode
- **Full-Screen Preview**: Present your flowchart in a distraction-free view
- **Navigation**: Use Next/Previous buttons to step through nodes
- **Highlighting**: Active nodes are highlighted and centered automatically
- **Seamless Return**: Exit preview to return to editing with state preserved

### Sidebar Tools
- **Explorer View**: 
  - Browse all nodes and edges
  - Edit node names inline
  - See edge connections and styles
  
- **AI Assistant**:
  - Chat interface powered by Azure OpenAI
  - Context-aware flowchart assistance
  - Get suggestions for improving your flowchart

## Setup

### Prerequisites
- Node.js 18+ 
- pnpm (or npm/yarn)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. (Optional) Configure Azure OpenAI for AI assistant:
   - Copy `.env.example` to `.env`
   - Fill in your Azure OpenAI credentials:
     ```
     VITE_AZURE_DEPLOYMENT_NAME=your-deployment-name
     VITE_AZURE_RESOURCE_NAME=your-resource-name
     VITE_AZURE_API_KEY=your-api-key
     ```

### Development

Run the development server:
```bash
pnpm dev
```

### Testing

Run the test suite:
```bash
pnpm test
```

### Build

Create a production build:
```bash
pnpm build
```

Preview the production build:
```bash
pnpm preview
```

## Usage

### Creating a Flowchart
1. Click the "+ Step", "+ Decision", or "+ Note" buttons to add nodes
2. Drag nodes to position them on the canvas
3. Connect nodes by dragging from a source handle to a target handle
4. Double-click any node to edit its label

### Customizing Edges
- Select an edge and use the "Edge Style" dropdown to change its appearance
- Or set a default style for all new edges

### Using the Explorer
1. Click the "📋 Explorer" button to open the sidebar
2. View all nodes and edges in your flowchart
3. Edit node names directly in the list

### Using the AI Assistant
1. Click the "🤖 AI" button to open the AI chat
2. Ask questions about your flowchart
3. Get suggestions for improvements
4. (Requires Azure OpenAI configuration)

### Presenting Your Flowchart
1. Click the "▶ Preview" button to enter presentation mode
2. Use "Next" and "Previous" to navigate through nodes
3. Press "Exit Preview" to return to editing

## Technology Stack

- **Vite**: Fast build tool and dev server
- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **React Flow**: Powerful flowchart library
- **Vitest**: Fast unit testing
- **Testing Library**: React component testing
- **Azure OpenAI**: AI-powered assistance

## License

MIT

## Development

This project was built using the Ralph methodology for autonomous development.
