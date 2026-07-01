// AVIS Chrome MCP — Background Service Worker
// Receives commands from offscreen WebSocket bridge, executes Chrome APIs

let offscreenReady = false;

// Ensure offscreen document exists for persistent WebSocket
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['LOCAL_STORAGE'],
      justification: 'Maintains persistent WebSocket connection to AVIS'
    });
  }
  offscreenReady = true;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreen();
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreen();
});

// Also ensure on first message
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'offscreen-ready') {
    offscreenReady = true;
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'mcp-request') {
    handleMCPRequest(msg.payload)
      .then(result => sendResponse({ result }))
      .catch(err => sendResponse({ error: { code: -1, message: err.message } }));
    return true; // async response
  }
});

// ── Command Handlers ──────────────────────────────────────────────

async function handleMCPRequest({ method, params }) {
  switch (method) {
    case 'browser/navigate':
      return await doNavigate(params);
    case 'browser/screenshot':
      return await doScreenshot();
    case 'browser/click':
      return await doClick(params);
    case 'browser/type':
      return await doType(params);
    case 'browser/getContent':
      return await doGetContent();
    case 'browser/executeScript':
      return await doExecuteScript(params);
    case 'browser/waitForElement':
      return await doWaitForElement(params);
    case 'browser/scroll':
      return await doScroll(params);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

async function doNavigate({ url }) {
  const tab = await getActiveTab();
  await chrome.tabs.update(tab.id, { url });
  // Wait for page to finish loading
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ success: true, url, note: 'navigation started (timeout waiting for complete)' });
    }, 15000);

    function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve({ success: true, url });
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function doScreenshot() {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  return { image: dataUrl };
}

async function doClick({ selector }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      el.click();
      return { success: true, tag: el.tagName, text: el.textContent?.slice(0, 100) };
    },
    args: [selector]
  });
  return results[0]?.result || { success: false, error: 'Script execution failed' };
}

async function doType({ selector, text }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      el.focus();
      // Clear existing value
      el.value = '';
      // Simulate typing via input events
      el.value = txt;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    },
    args: [selector, text]
  });
  return results[0]?.result || { success: false, error: 'Script execution failed' };
}

async function doGetContent() {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // Get clean text content
      const body = document.body.cloneNode(true);
      // Remove scripts and styles
      body.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      const text = body.innerText || body.textContent || '';
      return {
        url: window.location.href,
        title: document.title,
        content: text.slice(0, 50000) // Cap at 50k chars
      };
    }
  });
  return results[0]?.result || { error: 'Failed to get page content' };
}

async function doExecuteScript({ script }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (code) => {
      try {
        const result = eval(code);
        return { success: true, result: typeof result === 'object' ? JSON.stringify(result) : String(result) };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    args: [script]
  });
  return results[0]?.result || { success: false, error: 'Script execution failed' };
}

async function doWaitForElement({ selector, timeout = 10000 }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, ms) => {
      return new Promise((resolve) => {
        const existing = document.querySelector(sel);
        if (existing) return resolve({ found: true, tag: existing.tagName });

        const observer = new MutationObserver(() => {
          const el = document.querySelector(sel);
          if (el) {
            observer.disconnect();
            clearTimeout(timer);
            resolve({ found: true, tag: el.tagName });
          }
        });

        const timer = setTimeout(() => {
          observer.disconnect();
          resolve({ found: false, error: `Timeout waiting for ${sel}` });
        }, ms);

        observer.observe(document.body, { childList: true, subtree: true });
      });
    },
    args: [selector, timeout]
  });
  return results[0]?.result || { found: false, error: 'Script execution failed' };
}

async function doScroll({ direction = 'down', amount = 300 }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (dir, amt) => {
      const x = (dir === 'left') ? -amt : (dir === 'right') ? amt : 0;
      const y = (dir === 'up') ? -amt : (dir === 'down') ? amt : 0;
      window.scrollBy({ left: x, top: y, behavior: 'smooth' });
      return { success: true, scrollX: window.scrollX, scrollY: window.scrollY };
    },
    args: [direction, amount]
  });
  return results[0]?.result || { success: false, error: 'Script execution failed' };
}
