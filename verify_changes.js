import { spawn } from 'child_process';
import WebSocket from 'ws';

// 1. Start the Server
console.log('Starting server...');
const serverProcess = spawn('node', ['server.js'], {
    stdio: ['pipe', 'pipe', 'pipe'] // pipe all
});

let wsClient;

// Helper to send JSON-RPC message
function sendRpc(method, params, id) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    serverProcess.stdin.write(msg + '\n');
}

serverProcess.stdout.on('data', (data) => {
    const str = data.toString();
    console.log('MCP Output:', str);

    // Check for tool result
    if (str.includes('Script executed successfully')) {
        console.log('✅ Test Passed: Script executed successfully.');
        cleanup();
    }
});

serverProcess.stderr.on('data', (data) => {
    console.error('MCP Error:', data.toString());
});

// Wait for server to be ready
setTimeout(() => {
    console.log('Connecting WebSocket...');
    wsClient = new WebSocket('ws://localhost:3000');

    wsClient.on('open', () => {
        console.log('WebSocket connected.');

        // 2. Initialize MCP
        sendRpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0' }
        }, 1);

        // 3. Call run_script
        setTimeout(() => {
            console.log('Calling run_script...');
            const script = `
                console.log('Starting script');
                await update_count(42);
                console.log('Finished script');
            `;

            sendRpc('tools/call', {
                name: 'run_script',
                arguments: { code: script }
            }, 2);
        }, 1000);
    });

    wsClient.on('error', (err) => {
        console.error('WebSocket Error:', err.message);
    });

    wsClient.on('message', (data) => {
        const msg = JSON.parse(data);
        console.log('WS Message:', msg);

        if (msg.type === 'update' && msg.count === 42) {
            console.log('✅ Verified: WebSocket received count 42.');

            // Simulate frontend finishing animation
            setTimeout(() => {
                console.log('Sending turn_complete...');
                wsClient.send(JSON.stringify({ type: 'turn_complete' }));
            }, 500);
        }
    });

}, 5000); // Increased delay to 5s

function cleanup() {
    if (wsClient) wsClient.close();
    serverProcess.kill();
    process.exit(0);
}

// Timeout safety
setTimeout(() => {
    console.error('❌ Test Timed Out');
    cleanup();
}, 15000);
