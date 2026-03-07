// ============================================================
// Bitefight Battle Simulator — Background Service Worker
// MV3 vyžaduje service worker pre správne message handling
// ============================================================

// Udržuj worker nažive pri install/activate
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

// Spracuj správy z content scriptov
// BEZ "return true" ak nie je async odpoveď — to je zdroj chyby
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BF_PING') {
    sendResponse({ ok: true });
    return false; // Synchrónna odpoveď — channel môže byť zatvorený
  }

  if (msg.type === 'BF_STORAGE_GET') {
    // Bezpečný async storage prístup cez worker
    chrome.storage.local.get(msg.keys, (result) => {
      sendResponse({ data: result });
    });
    return true; // Async — MUSÍ vrátiť true, ale sendResponse sa VŽDY zavolá
  }

  if (msg.type === 'BF_STORAGE_SET') {
    chrome.storage.local.set(msg.data, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // Pre ostatné správy — okamžite odpovedz, nedrž kanál otvorený
  sendResponse({ ok: false, reason: 'unknown_message' });
  return false;
});
