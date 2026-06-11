// MeetScribe — Side Panel UI Controller

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let isRecording = false;
  let currentTranscript = { captions: [] };
  let activeTab = 'summarize';
  let savedTranscripts = [];

  // ---- DOM Refs ----
  const recordBtn = $('recordBtn');
  const recordLabel = $('recordLabel');
  const clearBtn = $('clearBtn');
  const segmentCount = $('segmentCount');
  const transcriptArea = $('transcriptArea');
  const placeholder = $('placeholder');
  const settingsOverlay = $('settingsOverlay');

  // ---- Init ----
  async function init() {
    loadSettings();
    loadTranscriptHistory();
    getSessionStatus();
    setupEventListeners();
    setupTabSwitching();
  }

  // ---- Session Status ----
  async function getSessionStatus() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) { return; }
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
      if (resp && resp.sessionId) {
        isRecording = true;
        updateRecordingUI(true);
        segmentCount.textContent = `${resp.segments || 0} segments`;
      }
    } catch (e) {}
  }

  // ---- Recording ----
  function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (tabs.length === 0) {
      showError('Open Google Meet first');
      return;
    }
    const tab = tabs[0];
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE' });
      isRecording = true;
      updateRecordingUI(true);
      placeholder.style.display = 'none';
    } catch (e) {
      showError('Cannot access Meet tab. Refresh the page.');
    }
  }

  async function stopRecording() {
    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (tabs.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_CAPTURE' });
        // Fetch final transcript
        const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_TRANSCRIPT' });
        if (resp && resp.captions) {
          currentTranscript = resp;
          // Save to history
          await chrome.runtime.sendMessage({
            type: 'SAVE_TRANSCRIPT',
            payload: {
              id: resp.sessionId,
              platform: 'google-meet',
              date: new Date().toISOString(),
              captions: resp.captions,
            },
          });
        }
      } catch (e) {}
    }
    isRecording = false;
    updateRecordingUI(false);
  }

  function updateRecordingUI(recording) {
    recordBtn.classList.toggle('recording', recording);
    recordLabel.textContent = recording ? 'Recording...' : 'Start Recording';
    clearBtn.disabled = recording;
  }

  // ---- Clear Transcript ----
  async function clearTranscript() {
    currentTranscript = { captions: [] };
    CaptionStore.clear();
    transcriptArea.innerHTML = `<div class="ms-placeholder" id="placeholder">
      <div class="ms-placeholder-icon">🎤</div>
      <p>Open Google Meet and enable captions (CC)<br/> to start transcribing.</p>
    </div>`;
    segmentCount.textContent = '0 segments';
    clearBtn.disabled = true;

    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (tabs.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_TRANSCRIPT' });
      } catch (e) {}
    }
  }

  // ---- Render Captions ----
  function renderCaptions(captions) {
    if (!captions || captions.length === 0) return;

    // Remove placeholder if present
    if (placeholder) placeholder.style.display = 'none';

    // Only render new captions (last batch)
    const batchDiv = document.createElement('div');
    for (const cap of captions) {
      const div = document.createElement('div');
      div.className = 'ms-caption';
      const time = new Date(cap.timestamp);
      div.innerHTML = `
        <div class="ms-caption-speaker">${esc(cap.speaker)} <span class="ms-caption-time">${time.toLocaleTimeString()}</span></div>
        <div class="ms-caption-text">${esc(cap.text)}</div>
      `;
      batchDiv.appendChild(div);
    }
    transcriptArea.appendChild(batchDiv);
    // Auto-scroll
    transcriptArea.parentElement.scrollTop = transcriptArea.parentElement.scrollHeight;
  }

  // ---- AI Actions ----
  async function generateSummary() {
    const resultDiv = $('summaryResult');
    resultDiv.className = 'ms-ai-result loading';
    resultDiv.textContent = 'Generating summary...';

    const transcript = await fetchTranscript();
    if (!transcript || transcript.captions.length === 0) {
      resultDiv.className = 'ms-ai-result error';
      resultDiv.textContent = 'No captions recorded yet.';
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'AI_SUMMARIZE', payload: transcript },
      (resp) => {
        if (resp.error) {
          resultDiv.className = 'ms-ai-result error';
          resultDiv.textContent = `Error: ${resp.error}`;
        } else if (resp.result) {
          resultDiv.className = 'ms-ai-result';
          resultDiv.textContent = resp.result;
        }
      }
    );
  }

  async function generateActionItems() {
    const resultDiv = $('actionsResult');
    resultDiv.className = 'ms-ai-result loading';
    resultDiv.textContent = 'Extracting action items...';

    const transcript = await fetchTranscript();
    if (!transcript || transcript.captions.length === 0) {
      resultDiv.className = 'ms-ai-result error';
      resultDiv.textContent = 'No captions recorded yet.';
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'AI_ACTION_ITEMS', payload: transcript },
      (resp) => {
        if (resp.error) {
          resultDiv.className = 'ms-ai-result error';
          resultDiv.textContent = `Error: ${resp.error}`;
        } else if (resp.result) {
          resultDiv.className = 'ms-ai-result';
          resultDiv.textContent = resp.result;
        }
      }
    );
  }

  async function askCustom() {
    const prompt = $('customPromptInput').value.trim();
    if (!prompt) return;
    const resultDiv = $('customResult');
    resultDiv.className = 'ms-ai-result loading';
    resultDiv.textContent = 'Thinking...';

    const transcript = await fetchTranscript();
    if (!transcript || transcript.captions.length === 0) {
      resultDiv.className = 'ms-ai-result error';
      resultDiv.textContent = 'No captions recorded yet.';
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'AI_CUSTOM_PROMPT', payload: transcript, prompt },
      (resp) => {
        if (resp.error) {
          resultDiv.className = 'ms-ai-result error';
          resultDiv.textContent = `Error: ${resp.error}`;
        } else if (resp.result) {
          resultDiv.className = 'ms-ai-result';
          resultDiv.textContent = resp.result;
        }
      }
    );
  }

  async function fetchTranscript() {
    // First try from content script (live)
    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (tabs.length > 0) {
      try {
        const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_TRANSCRIPT' });
        if (resp && resp.captions && resp.captions.length > 0) {
          return resp;
        }
      } catch (e) {}
    }
    // Fallback to current in-memory
    return currentTranscript.captions.length > 0 ? currentTranscript : null;
  }

  // ---- Export ----
  function exportTXT() {
    downloadText(CaptionStore.toText({ timestamps: true }), 'transcript.txt');
  }

  function exportSRT() {
    downloadText(CaptionStore.toSRT(), 'transcript.srt');
  }

  function exportJSON() {
    downloadText(CaptionStore.toJSON(), 'transcript.json');
  }

  function copyToClipboard() {
    const text = CaptionStore.toText({ timestamps: true });
    navigator.clipboard.writeText(text).then(() => {
      const btn = $('copyBtn');
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Settings ----
  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (settings) {
          if (settings.aiProvider) $('aiProvider').value = settings.aiProvider;
          if (settings.apiKey) $('apiKey').value = settings.apiKey;
          if (settings.model) $('model').value = settings.model;
          if (settings.language) $('aiLanguage').value = settings.language;
        }
      });
    } catch (e) {}
  }

  function saveSettings() {
    const payload = {
      aiProvider: $('aiProvider').value,
      apiKey: $('apiKey').value,
      model: $('model').value,
      language: $('aiLanguage').value,
    };
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload }, (resp) => {
      if (resp && resp.ok) {
        settingsOverlay.style.display = 'none';
        $('saveSettingsBtn').textContent = '✅ Saved!';
        setTimeout(() => { $('saveSettingsBtn').textContent = 'Save'; }, 2000);
      }
    });
  }

  // ---- History ----
  async function loadTranscriptHistory() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'LIST_TRANSCRIPTS' });
      if (resp) savedTranscripts = resp;
    } catch (e) {}
  }

  // ---- Message Listener (from background/content) ----
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'CAPTION_EVENT':
          if (msg.payload && msg.payload.captions) {
            CaptionStore.add(msg.payload.captions);
            renderCaptions(msg.payload.captions);
            segmentCount.textContent = `${CaptionStore.count()} segments`;
          }
          break;
        case 'SESSION_UPDATE':
          if (msg.payload) {
            segmentCount.textContent = `${msg.payload.segments || 0} segments`;
          }
          break;
      }
    });
  }

  // ---- UI Helpers ----
  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showError(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'padding:12px;text-align:center;color:var(--ms-accent);font-size:13px;';
    div.textContent = msg;
    transcriptArea.innerHTML = '';
    transcriptArea.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }

  // ---- Tab Switching ----
  function setupTabSwitching() {
    document.querySelectorAll('.ms-ai-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.ms-ai-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.ms-ai-tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const contentId = tab.dataset.tab + 'Content';
        const contentEl = $(contentId);
        if (contentEl) contentEl.classList.add('active');
        activeTab = tab.dataset.tab;
      });
    });
  }

  // ---- Event Bindings ----
  function setupEventListeners() {
    recordBtn.addEventListener('click', toggleRecording);
    clearBtn.addEventListener('click', clearTranscript);
    $('settingsBtn').addEventListener('click', () => { settingsOverlay.style.display = 'flex'; loadSettings(); });
    $('closeSettingsBtn').addEventListener('click', () => { settingsOverlay.style.display = 'none'; });
    $('saveSettingsBtn').addEventListener('click', saveSettings);
    $('historyBtn').addEventListener('click', () => { /* TODO: show history panel */ });

    // AI
    $('summarizeBtn').addEventListener('click', generateSummary);
    $('actionsBtn').addEventListener('click', generateActionItems);
    $('customAskBtn').addEventListener('click', askCustom);
    $('customPromptInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') askCustom(); });

    // Export
    $('exportTxtBtn').addEventListener('click', exportTXT);
    $('exportSrtBtn').addEventListener('click', exportSRT);
    $('exportJsonBtn').addEventListener('click', exportJSON);
    $('copyBtn').addEventListener('click', copyToClipboard);
  }

  // ---- Start ----
  document.addEventListener('DOMContentLoaded', init);
})();
