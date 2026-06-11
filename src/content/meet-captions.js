// MeetScribe — Google Meet Live Caption Extractor
// Uses real Google Meet internal DOM selectors + fallback strategies.

(function () {
  'use strict';

  let observer = null;
  let ccButtonObserver = null;
  let lastCaptions = new Map(); // speaker -> last seen full text
  let captionHistory = [];
  let sessionId = crypto.randomUUID();
  let isActive = false;
  let pollInterval = null;
  let lastFallbackText = '';

  // ---- Real Google Meet DOM Selectors (from working open-source extensions) ----
  const SELECTORS = {
    // Primary: parent container of captions (Google Meet's internal jsname)
    parentContainer: 'div[jsname="dsyhDe"]',
    // The live caption text div inside the container
    subtitleDiv: 'div[jsname="tgaKEf"]',
    // Speaker name element
    speakerDiv: 'div.KcIKyf.jxFHg',
    // Fallback: any div with caption-like role
    fallbackCaption: '[role="region"][aria-label*="caption" i]',
  };

  // ---- Find parent caption container (multiple strategies) ----
  function findCaptionContainer() {
    // Strategy 1: Google Meet's jsname attribute (primary)
    let container = document.querySelector(SELECTORS.parentContainer);
    if (container) return container;

    // Strategy 2: Look for the caption panel
    container = document.querySelector(SELECTORS.fallbackCaption);
    if (container) return container;

    // Strategy 3: Search for any container with subtitle-like text content
    // Captions container is usually a div with multiple children near the bottom
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const text = div.textContent || '';
      if (text.length > 5 && text.split(' ').length > 2) {
        // Check if this looks like a caption container (has structured children)
        const spans = div.querySelectorAll('span');
        if (spans.length >= 2) {
          const hasNonEmpty = Array.from(spans).some(s => (s.textContent || '').trim().length > 3);
          if (hasNonEmpty) return div;
        }
      }
    }

    return null;
  }

  // ---- Extract captions from the DOM ----
  function extractCaptions() {
    const container = findCaptionContainer();
    if (!container) return null;

    const captions = [];

    // Strategy A: Use known Google Meet subtitle structure
    const subtitleDiv = container.querySelector(SELECTORS.subtitleDiv);
    const speakerDiv = container.querySelector(SELECTORS.speakerDiv);

    if (subtitleDiv) {
      // Combine all span text (Google Meet breaks captions into spans)
      const spans = subtitleDiv.querySelectorAll('span');
      const text = Array.from(spans)
        .map(s => (s.textContent || '').trim())
        .filter(t => t.length > 0)
        .join(' ');

      const speaker = speakerDiv ? speakerDiv.textContent.trim() : 'Speaker';

      if (text && text.length > 0) {
        captions.push({ speaker, text, timestamp: Date.now() });
      }
    }

    // Strategy B: Extracting directly from container spans (fallback)
    if (captions.length === 0) {
      const lines = container.querySelectorAll('span, div[role="text"]');
      if (lines.length > 0) {
        const seen = new Set();
        for (const el of lines) {
          const t = (el.textContent || '').trim();
          if (t.length > 3 && !seen.has(t)) {
            seen.add(t);
            captions.push({ speaker: 'Speaker', text: t, timestamp: Date.now() });
          }
        }
      }
    }

    return captions.length > 0 ? captions : null;
  }

  // ---- Deduplicate and emit caption events ----
  function processCaptions(captions) {
    if (!captions || captions.length === 0) return;

    const newCaptures = [];
    for (const cap of captions) {
      const key = cap.speaker;
      const lastText = lastCaptions.get(key);

      // Only emit if text has changed
      if (lastText !== cap.text && cap.text.length > 2) {
        // Detect incremental append (Google Meet appends text in real-time)
        if (lastText && cap.text.startsWith(lastText) && cap.text.length > lastText.length) {
          const delta = cap.text.slice(lastText.length).trim();
          if (delta) {
            newCaptures.push({ ...cap, text: delta, fullText: cap.text });
          }
        } else if (!lastText || !lastText.startsWith(cap.text)) {
          // New utterance or replacement
          newCaptures.push({ ...cap, fullText: cap.text });
        }
        lastCaptions.set(key, cap.text);
      }
    }

    if (newCaptures.length > 0) {
      captionHistory.push(...newCaptures);
      if (captionHistory.length > 10000) captionHistory = captionHistory.slice(-5000);

      try {
        chrome.runtime.sendMessage({
          type: 'CAPTION_EVENT',
          payload: { captions: newCaptures, sessionId, timestamp: Date.now() },
        }).catch(() => {});
      } catch (_) {}
    }
  }

  // ---- MutationObserver callback ----
  function onDomMutation() {
    if (!isActive) return;
    const caps = extractCaptions();
    if (caps) processCaptions(caps);
  }

  // ---- Polling fallback ----
  function startPolling() {
    stopPolling();
    pollInterval = setInterval(() => {
      if (!isActive) return;
      onDomMutation();
    }, 600);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  // ---- Activation ----
  function startCapture() {
    if (isActive) return;
    isActive = true;
    sessionId = crypto.randomUUID();
    lastCaptions.clear();

    const container = findCaptionContainer();
    if (container) {
      if (observer) observer.disconnect();
      observer = new MutationObserver(onDomMutation);
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }
    startPolling();

    try {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_STARTED',
        payload: { sessionId, platform: 'google-meet' },
      }).catch(() => {});
    } catch (_) {}

    onDomMutation();
  }

  function stopCapture() {
    isActive = false;
    if (observer) { observer.disconnect(); observer = null; }
    stopPolling();

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

  // ---- Message listener ----
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      switch (msg.type) {
        case 'START_CAPTURE': startCapture(); sendResponse({ ok: true }); break;
        case 'STOP_CAPTURE': stopCapture(); sendResponse({ ok: true }); break;
        case 'GET_TRANSCRIPT': sendResponse(getTranscript()); break;
        case 'CLEAR_TRANSCRIPT': clearTranscript(); sendResponse({ ok: true }); break;
        case 'GET_STATUS': sendResponse({ active: isActive, segments: captionHistory.length, sessionId }); break;
      }
      return true;
    });
  }

  // ---- Auto-detect captions enabled ----
  function watchForCaptions() {
    // Watch for CC button toggle in Meet's toolbar
    ccButtonObserver = new MutationObserver(() => {
      const ccBtn = document.querySelector('[aria-label*="captions" i], [aria-label*="subtitles" i], [data-is-captions-enabled]');
      if (ccBtn) {
        const pressed = ccBtn.getAttribute('aria-pressed');
        const enabled = ccBtn.getAttribute('data-is-captions-enabled');
        if (pressed === 'true' || enabled === 'true') {
          if (!isActive) startCapture();
        }
      }

      // Also check if caption container appeared
      if (!isActive && findCaptionContainer()) {
        startCapture();
      }
    });

    ccButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ---- Init ----
  function init() {
    if (window.location.hostname === 'meet.google.com') {
      watchForCaptions();
      // Check if captions are already on
      setTimeout(() => {
        if (!isActive && findCaptionContainer()) startCapture();
      }, 3000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Debug access
  window.__meetscribe = { startCapture, stopCapture, getTranscript, clearTranscript, findCaptionContainer };
})();
