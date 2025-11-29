# MCP Counter POC - Code Execution Architecture

## Overview

This is a proof-of-concept (POC) demonstrating the **"Code execution with MCP"** pattern, which enables AI agents to execute JavaScript code on a server to control external applications. This architecture can be used as a foundation for building interactive, agent-controlled applications.

## What Does This POC Do?

This POC implements a **Model Context Protocol (MCP) server** that:
1. Exposes a `run_script` tool to AI agents (like Claude via Gemini CLI)
2. Executes JavaScript code in a sandboxed environment
3. Controls a web-based counter application via WebSocket
4. Synchronizes execution with frontend animations

### Key Capability: Agent-Controlled UI
An AI agent can write JavaScript code that directly controls the counter displayed in a web browser, with execution paused until animations complete to ensure smooth user experience.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   AI Agent      │         │   MCP Server     │         │   Web Frontend  │
│  (Claude/etc)   │◄───────►│   (server.js)    │◄───────►│  (index.html)   │
│                 │   MCP   │                  │  WebSocket│                 │
└─────────────────┘ Protocol└──────────────────┘         └─────────────────┘
                              │                │
                              │  vm (sandbox)  │
                              │  - update_count│
                              │  - console.log │
                              └────────────────┘
```

### Components

1. **`server.js`** - MCP server with:
   - Express web server (port 3000)
   - WebSocket server for real-time communication
   - MCP server exposing `run_script` tool
   - VM sandbox for secure code execution

2. **`index.html`** - Frontend with:
   - Real-time counter display
   - WebSocket client
   - Animation system (3-second delay per update)
   - Pause/Resume controls

3. **`launcher.js`** - Launcher for MCP integration
   - Spawns `server.js` with correct environment
   - Captures error logs for debugging

## The "Code Execution with MCP" Pattern

### Traditional Approach (Inefficient)
```
Agent calls: update_count(1)  → Server updates → Frontend shows 1
Agent waits...
Agent calls: update_count(2)  → Server updates → Frontend shows 2
Agent waits...
Agent calls: update_count(3)  → Server updates → Frontend shows 3
```
**Problem**: Multiple round-trips to the agent for simple loops.

### Code Execution Approach (Efficient)
```javascript
Agent calls: run_script({
  code: `
    for (let i = 1; i <= 3; i++) {
      await update_count(i);
    }
  `
})
```
The server executes the entire loop, pausing at each `update_count()` call until the frontend animation completes.

**Benefit**: Complex logic runs in a single agent turn, reducing token usage and latency.

## How It Works

1. **Agent Generates Code**
   - Claude (or another LLM) writes JavaScript to accomplish a task
   - Sends code via the `run_script` MCP tool

2. **Server Executes in Sandbox**
   - Code runs in a VM context with access to:
     - `update_count(n)`: Updates counter and pauses until frontend confirms
     - `console.log()`: Captures logs returned to agent
     - `setTimeout`, `Promise`: For delays and async operations

3. **WebSocket Synchronization**
   - Server broadcasts count updates to frontend
   - Frontend displays animation (3-second delay)
   - Frontend sends `turn_complete` signal when ready
   - Server resumes script execution

4. **Agent Receives Result**
   - Script logs and execution status returned to agent
   - Agent can continue with next actions

## Setup & Usage

### Prerequisites
- Node.js 18+ (ES modules support)

### Installation
```bash
npm install
```

### Running Standalone
```bash
node server.js
```
Open browser to `http://localhost:3000`

### Running via MCP (Gemini CLI)

Add to `.gemini/settings.json`:
```json
{
  "mcpServers": {
    "my-counter": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-counter-poc\\launcher.js"]
    }
  }
}
```

Then run:
```bash
gemini
```

Ask the agent: _"Count to 10 using the counter"_

The agent will generate and execute:
```javascript
for (let i = 1; i <= 10; i++) {
  await update_count(i);
}
```

## Use Cases as Base Architecture

This POC can be adapted for:

### 1. **Agent-Controlled Dashboards**
- Replace counter with charts/graphs
- Agent updates visualizations based on data analysis

### 2. **Interactive Forms & Workflows**
- Agent fills forms step-by-step
- Validates inputs and handles errors

### 3. **Real-time Notifications**
- Agent processes events and updates UI
- Users see live status without polling

### 4. **Game Controllers**
- Agent plays games by executing move sequences
- UI updates reflect game state

### 5. **IoT Device Control**
- Replace WebSocket frontend with IoT devices
- Agent sends control sequences to hardware

## Key Patterns to Reuse

### 1. **Bidirectional WebSocket Communication**
```javascript
// Server broadcasts state
wss.clients.forEach(client => client.send(JSON.stringify(data)));

// Server waits for client confirmation
await new Promise(resolve => { pendingResponse = resolve; });
```

### 2. **VM Sandboxing**
```javascript
const sandbox = {
  myFunction: async () => { /* ... */ },
  console: { log: (...args) => logs.push(args.join(' ')) }
};
vm.createContext(sandbox);
await vm.runInNewContext(code, sandbox);
```

### 3. **MCP Tool with Code Execution**
```javascript
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { code } = request.params.arguments;
  // Execute code and return results
});
```

## Files

- **`server.js`** - Main MCP server and web server
- **`index.html`** - Frontend UI
- **`launcher.js`** - MCP launcher with error logging
- **`verify_changes.js`** - Test script (simulates MCP client + WebSocket)
- **`mcp_error.log`** - Error log for debugging

## Troubleshooting

### MCP Connection Fails
Check `mcp_error.log` for syntax errors or port conflicts.

### Port 3000 Already in Use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /F /PID <PID>
```

### WebSocket Not Connecting
Ensure server is running and accessible at `http://localhost:3000`

## License

MIT

## References

- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
