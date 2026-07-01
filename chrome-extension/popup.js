// Check connection status by pinging offscreen document
const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const reconnectBtn = document.getElementById('reconnect');

async function checkStatus() {
  try {
    // Try a quick WebSocket check
    const testWs = new WebSocket('ws://localhost:10235');
    testWs.onopen = () => {
      dot.className = 'dot connected';
      statusText.textContent = 'Connected to AVIS';
      testWs.close();
    };
    testWs.onerror = () => {
      dot.className = 'dot disconnected';
      statusText.textContent = 'AVIS not running';
    };
  } catch {
    dot.className = 'dot disconnected';
    statusText.textContent = 'AVIS not running';
  }
}

reconnectBtn.addEventListener('click', async () => {
  statusText.textContent = 'Reconnecting...';
  // Recreate offscreen document to force reconnect
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) await chrome.offscreen.closeDocument();
  } catch (_) {}
  // Background will recreate it
  setTimeout(async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['LOCAL_STORAGE'],
        justification: 'Reconnect WebSocket to AVIS'
      });
    } catch (_) {}
    setTimeout(checkStatus, 2000);
  }, 500);
});

checkStatus();
