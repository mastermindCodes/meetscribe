// MeetScribe — Zoom Live Caption Extractor (stub)
// Zoom uses a different DOM structure. This is a template to be completed per Zoom's UI.

(function () {
  'use strict';

  let isActive = false;
  let observer = null;
  let pollInterval = null;

  // Zoom caption container selectors (may need updates per Zoom's DOM)
  const SELECTORS = {
    captionContainer: '[class*="caption"], [class*="transcript"], [aria-label*="caption"]',
    captionLine: '[class*="caption-line"], [class*="caption-text"]',
    speakerLabel: '[class*="speaker"], [class*="participant-name"]',
  };

  function extractCaptions() {
    const container = document.querySelector(SELECTORS.captionContainer);
    if (!container) return null;
    const lines = container.querySelectorAll(SELECTORS.captionLine);
    if (!lines || lines.length === 0) return null;

    const captions = [];
    for (const line of lines) {
      const speaker = line.querySelector(SELECTORS.speakerLabel);
      const text = line.textContent.trim();
      if (text && text.length > 2) {
        captions.push({
          speaker: speaker ? speaker.textContent.trim() : 'Speaker',
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
            payload: { captions: caps, sessionId: crypto.randomUUID(), platform: 'zoom' },
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
          payload: { captions: caps, sessionId: crypto.randomUUID(), platform: 'zoom' },
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
