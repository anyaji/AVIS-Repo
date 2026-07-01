// AVIS Chrome MCP — Offscreen WebSocket Bridge
// Maintains persistent WebSocket connection to AVIS server on ws://localhost:10235
// Routes JSON-RPC requests to background service worker for Chrome API execution

let ws = null;
let reconnectTimer = null;
const AVIS_URL = 'ws://localhost:10235';

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(AVIS_URL);

    ws.onopen = () => {
      console.log('[AVIS MCP] Connected to AVIS server');
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      // Notify background we're live
      chrome.runtime.sendMessage({ type: 'offscreen-ready' });
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg.jsonrpc || !msg.method) return;

        // Forward to background service worker for Chrome API execution
        const response = await chrome.runtime.sendMessage({
          type: 'mcp-request',
          payload: { method: msg.method, params: msg.params || {} }
        });

        // Send JSON-RPC response back to AVIS
        const rpcResponse = {
          jsonrpc: '2.0',
          id: msg.id
        };

        if (response.error) {
          rpcResponse.error = response.error;
        } else {
          rpcResponse.result = response.result;
        }

        ws.send(JSON.stringify(rpcResponse));
      } catch (err) {
        console.error('[AVIS MCP] Message handling error:', err);
        // Try to send error response
        try {
          const errMsg = JSON.parse(event.data);
          if (errMsg.id) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: errMsg.id,
              error: { code: -1, message: err.message }
            }));
          }
        } catch (_) {}
      }
    };

    ws.onclose = () => {
      console.log('[AVIS MCP] Disconnected from AVIS');
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[AVIS MCP] Connection error (AVIS may not be running)');
      ws = null;
      scheduleReconnect();
    };
  } catch (err) {
    console.error('[AVIS MCP] Failed to create WebSocket:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    console.log('[AVIS MCP] Attempting reconnect...');
    connect();
  }, 5000);
}

// Start connection
connect();
