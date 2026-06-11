// MeetScribe — Google Meet Live Caption Extractor
// Injects into meet.google.com, watches the caption DOM, and streams text to the side panel.

(function () {
  'use strict';

  let observer = null;
  let lastCaptions = new Map(); // speaker -> last seen text
  let captionHistory = [];
  let sessionId = crypto.randomUUID();
  let isActive = false;

  // ---- CSS Selectors for Google Meet caption elements ----
  // These selectors are derived from Meet's internal DOM structure.
  // They may change — report issues to update.

  const SELECTORS = {
    // Main caption container (the CC bar at the bottom of Meet)
    captionBar: '[data-captions-bar]',
    // Individual caption segments — each has a speaker label + text
    captionSegment: '[role="region"][aria-label*="caption"]',
    // Speaker name inside a caption segment
    speakerLabel: '[data-speaker-label]',
    // The text content of a caption chunk
    captionText: '[data-caption-text]',
    // Alternative: flat caption container (older Meet UI)
    legacyCaption: '.a4cQT',
    // The full caption panel popup
    captionPanel: '[data-captions-panel]',
  };

  // ---- Detect the caption container ----
  function findCaptionContainer() {
    // Try modern selectors first
    let container = document.querySelector(SELECTORS.captionBar);
    if (container) return container;

    // Try legacy/alternative selectors
    container = document.querySelector(SELECTORS.captionPanel);
    if (container) return container;

    // Fallback: search for elements containing caption text
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (
        el.children.length === 0 &&
        el.textContent &&
        el.textContent.trim().length > 10 &&
        el.getAttribute('role') === 'region'
      ) {
        return el.parentElement;
      }
    }
    return null;
  }

  // ---- Extract captions from the DOM ----
  function extractCaptions() {
    const container = findCaptionContainer();
    if (!container) return null;

    const segments = container.querySelectorAll(SELECTORS.captionSegment);
    if (segments.length === 0) return null;

    const captions = [];
    for (const seg of segments) {
      const speakerEl = seg.querySelector(SELECTORS.speakerLabel);
      const textEl = seg.querySelector(SELECTORS.captionText);

      if (speakerEl && textEl) {
        const speaker = speakerEl.textContent.trim();
        const text = textEl.textContent.trim();
        if (text) {
          captions.push({ speaker, text, timestamp: Date.now() });
        }
      }
    }

    // Legacy fallback: read raw caption container text
    if (captions.length === 0 && container.textContent) {
      const raw = container.textContent.trim();
      if (raw && /^[A-Za-z\u0600-\u06FF]/.test(raw)) {
        // Try to guess speaker from span labels
        const speakerEls = container.querySelectorAll('span');
        for (const el of speakerEls) {
          if (el.textContent && el.textContent.trim().length < 30 && el.textContent.includes(':')) {
            const parts = el.textContent.split(':');
            if (parts.length >= 2) {
              captions.push({
                speaker: parts[0].trim(),
                text: parts.slice(1).join(':').trim(),
                timestamp: Date.now(),
              });
            }
          }
        }
        if (captions.length === 0) {
          captions.push({ speaker: 'Speaker', text: raw, timestamp: Date.now() });
        }
      }
    }

    return captions.length > 0 ? captions : null;
  }

  // ---- Deduplicate and emit new caption events ----
  function processCaptions(captions) {
    if (!captions) return;

    const newCaptures = [];
    for (const cap of captions) {
      const key = cap.speaker;
      const lastText = lastCaptions.get(key);

      // Deduplicate: only emit if text has changed significantly
      if (lastText !== cap.text && cap.text.length > 1) {
        // Check if this is an append to existing text (not a duplicate)
        if (lastText && cap.text.startsWith(lastText) && cap.text.length > lastText.length) {
          // This is an incremental append — emit just the new part
          const delta = cap.text.slice(lastText.length);
          newCaptures.push({ ...cap, text: delta, fullText: cap.text });
        } else if (!lastText || !lastText.startsWith(cap.text)) {
          // New utterance or replacement
          newCaptures.push({ ...cap, fullText: cap.text });
        }
        lastCaptions.set(key, cap.text);
      }
    }

    if (newCaptures.length > 0) {
      captionHistory.push(...newCaptures);
      // Keep last 10,000 segments in memory
      if (captionHistory.length > 10000) {
        captionHistory = captionHistory.slice(-5000);
      }
      // Send to background script
      try {
        chrome.runtime.sendMessage({
          type: 'CAPTION_EVENT',
          payload: {
            captions: newCaptures,
            sessionId,
            timestamp: Date.now(),
          },
        }).catch(() => {});
      } catch (_) {}
    }
  }

  // ---- MutationObserver callback ----
  function onDomMutation() {
    if (!isActive) return;
    const captions = extractCaptions();
    if (captions) processCaptions(captions);
  }

  // ---- Polling fallback (when observer misses changes) ----
  let pollInterval = null;
  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      if (!isActive) return;
      onDomMutation();
    }, 800); // Poll every 800ms as fallback
  }

  // ---- Activation hooks ----
  function startCapture() {
    if (isActive) return;
    isActive = true;
    sessionId = crypto.randomUUID();
    lastCaptions.clear();

    const container = findCaptionContainer();
    if (container) {
      observer = new MutationObserver(onDomMutation);
      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    startPolling();

    try {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_STARTED',
        payload: { sessionId, platform: 'google-meet' },
      }).catch(() => {});
    } catch (_) {}

    // Initial capture
    onDomMutation();
  }

  function stopCapture() {
    isActive = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    try {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_STOPPED',
        payload: { sessionId, segments: captionHistory.length },
      }).catch(() => {});
    } catch (_) {}
  }

  function getTranscript() {
    return {
      sessionId,
      captions: captionHistory,
      duration: captionHistory.length > 0
        ? captionHistory[captionHistory.length - 1].timestamp - captionHistory[0].timestamp
        : 0,
    };
  }

  function clearTranscript() {
    captionHistory = [];
    lastCaptions.clear();
    try {
      chrome.runtime.sendMessage({ type: 'TRANSCRIPT_CLEARED', payload: { sessionId } }).catch(() => {});
    } catch (_) {}
  }

  // ---- Message listener (from background or side panel) ----
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      switch (msg.type) {
        case 'START_CAPTURE':
          startCapture();
          sendResponse({ ok: true });
          break;
        case 'STOP_CAPTURE':
          stopCapture();
          sendResponse({ ok: true });
          break;
        case 'GET_TRANSCRIPT':
          sendResponse(getTranscript());
          break;
        case 'CLEAR_TRANSCRIPT':
          clearTranscript();
          sendResponse({ ok: true });
          break;
        case 'GET_STATUS':
          sendResponse({ active: isActive, segments: captionHistory.length, sessionId });
          break;
      }
      return true;
    });
  }

  // ---- Auto-detect when Google Meet is present and captions are toggled ----
  function detectMeetPage() {
    if (window.location.hostname === 'meet.google.com') {
      // Watch for the user enabling captions (CC button)
      const ccObserver = new MutationObserver(() => {
        const ccButton = document.querySelector('[aria-label*="captions" i], [aria-label*="subtitles" i], [data-is-captions-enabled]');
        if (ccButton) {
          const isEnabled = ccButton.getAttribute('aria-pressed') === 'true' ||
                          ccButton.getAttribute('data-is-captions-enabled') === 'true';
          if (isEnabled) {
            startCapture();
          }
        }
      });
      ccObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Initialize once page is ready
  // ---- Init on page load ----
  function safeInit() {
    if (window.location.hostname === 'meet.google.com') {
      detectMeetPage();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }

  // Export for debugging
  window.__meetscribe = { startCapture, stopCapture, getTranscript, clearTranscript };
})();
