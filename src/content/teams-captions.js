// MeetScribe — MS Teams Live Caption Extractor (stub)
// Teams uses a shadow-DOM structure. This is a template for the Teams caption overlay.

(function () {
  'use strict';

  let isActive = false;
  let observer = null;
  let pollInterval = null;

  const SELECTORS = {
    captionContainer: '[class*="caption"], [data-tid*="caption"], [aria-label*="caption"]',
    captionLine: '[class*="caption-line"], [class*="csi-caption"], span[dir="ltr"]',
    speakerLabel: '[class*="speaker"], [data-tid*="speaker"]',
  };

  function extractCaptions() {
    const container = document.querySelector(SELECTORS.captionContainer);
    if (!container) return null;
    const lines = container.querySelectorAll(SELECTORS.captionLine);
    if (!lines || lines.length === 0) return null;

    const captions = [];
    for (const line of lines) {
      const text = line.textContent.trim();
      if (text && text.length > 2) {
        captions.push({
          speaker: 'Speaker',
          text: text,
          timestamp: Date.now(),
        });
      }
    }
    return captions.length > 0 ? captions : null;
  }

  function startCapture() {
    if (isActive) return;
    isActive = true;
    const container = document.querySelector(SELECTORS.captionContainer);
    if (container) {
      observer = new MutationObserver(() => {
        const caps = extractCaptions();
        if (caps) {
          chrome.runtime.sendMessage({
            type: 'CAPTION_EVENT',
            payload: { captions: caps, sessionId: crypto.randomUUID(), platform: 'teams' },
          });
        }
      });
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }
    pollInterval = setInterval(() => {
      if (!isActive) return;
      const caps = extractCaptions();
      if (caps) {
        chrome.runtime.sendMessage({
          type: 'CAPTION_EVENT',
          payload: { captions: caps, sessionId: crypto.randomUUID(), platform: 'teams' },
        });
      }
    }, 1000);
  }

  function stopCapture() {
    isActive = false;
    if (observer) { observer.disconnect(); observer = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'START_CAPTURE': startCapture(); sendResponse({ ok: true }); break;
      case 'STOP_CAPTURE': stopCapture(); sendResponse({ ok: true }); break;
    }
  });
})();
