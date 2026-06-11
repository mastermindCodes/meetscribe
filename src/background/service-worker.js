// MeetScribe — Background Service Worker
// Routes messages between content scripts, side panel, and AI providers.
// Manages state persistence across sessions.

const STATE_KEY = 'meetscribe_session_state';
const TRANSCRIPT_KEY = 'meetscribe_transcripts';

// Session state
let currentSession = null;
let transcripts = [];
let settings = {};

// ---- Load persisted state ----
async function loadState() {
  try {
    const result = await chrome.storage.local.get([STATE_KEY, TRANSCRIPT_KEY, 'meetscribe_settings']);
    if (result[STATE_KEY]) currentSession = result[STATE_KEY];
    if (result[TRANSCRIPT_KEY]) transcripts = result[TRANSCRIPT_KEY];
    if (result.meetscribe_settings) settings = result.meetscribe_settings;
  } catch (e) {
    console.warn('[MeetScribe] Failed to load state:', e);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({
      [STATE_KEY]: currentSession,
      [TRANSCRIPT_KEY]: transcripts.slice(-50), // Keep last 50 transcripts
      meetscribe_settings: settings,
    });
  } catch (e) {
    console.warn('[MeetScribe] Failed to save state:', e);
  }
}

// ---- Message Router ----
async function handleMessage(msg, sender, sendResponse) {
  const tabId = sender?.tab?.id;

  switch (msg.type) {
    // ---- Content Script Messages (incoming captions) ----
    case 'CAPTION_EVENT':
      if (currentSession && currentSession.sessionId === msg.payload.sessionId) {
        currentSession.segments = (currentSession.segments || 0) + msg.payload.captions.length;
        currentSession.lastCaptionAt = msg.payload.timestamp;
      }
      // Forward to open side panels
      broadcastToPanels(msg);
      break;

    case 'CAPTURE_STARTED':
      currentSession = {
        sessionId: msg.payload.sessionId,
        platform: msg.payload.platform,
        startedAt: Date.now(),
        segments: 0,
        lastCaptionAt: null,
      };
      await saveState();
      broadcastToPanels({ type: 'SESSION_UPDATE', payload: currentSession });
      break;

    case 'CAPTURE_STOPPED':
      if (currentSession) {
        currentSession.finishedAt = Date.now();
        broadcastToPanels({ type: 'SESSION_UPDATE', payload: currentSession });
      }
      break;

    case 'TRANSCRIPT_CLEARED':
      currentSession = null;
      await saveState();
      broadcastToPanels({ type: 'SESSION_UPDATE', payload: null });
      break;

    // ---- Side Panel Requests ----
    case 'START_RECORDING':
      await forwardToTab(tabId, msg);
      break;

    case 'STOP_RECORDING':
      await forwardToTab(tabId, msg);
      break;

    case 'GET_TRANSCRIPT':
      const result = await forwardToTab(tabId, msg);
      sendResponse(result);
      break;

    case 'GET_SESSION':
      sendResponse(currentSession);
      break;

    case 'GET_SETTINGS':
      sendResponse(settings);
      break;

    case 'SAVE_SETTINGS':
      settings = { ...settings, ...msg.payload };
      await saveState();
      sendResponse({ ok: true });
      break;

    case 'SAVE_TRANSCRIPT':
      if (msg.payload) {
        transcripts.unshift({
          ...msg.payload,
          savedAt: Date.now(),
        });
        await saveState();
      }
      sendResponse({ ok: true });
      break;

    case 'LIST_TRANSCRIPTS':
      sendResponse(transcripts.slice(0, 50));
      break;

    // ---- AI Actions ----
    case 'AI_SUMMARIZE':
      if (currentSession) {
        generateSummary(msg.payload, sendResponse);
        return true; // Keep channel open for async response
      }
      sendResponse({ error: 'No active session' });
      break;

    case 'AI_ACTION_ITEMS':
      if (currentSession) {
        generateActionItems(msg.payload, sendResponse);
        return true;
      }
      sendResponse({ error: 'No active session' });
      break;

    case 'AI_CUSTOM_PROMPT':
      if (currentSession) {
        runCustomPrompt(msg.payload, msg.prompt, sendResponse);
        return true;
      }
      sendResponse({ error: 'No active session' });
      break;
  }
}

// ---- Broadcast to all open side panels ----
function broadcastToPanels(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Panel may not be open — ignore
  });
}

// ---- Forward message to content script in a tab ----
async function forwardToTab(tabId, msg) {
  if (!tabId) return { error: 'No tab' };
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    return { error: e.message };
  }
}

// ---- AI Providers ----
async function callAIProvider(transcriptText, systemPrompt, userPrompt) {
  const provider = settings.aiProvider || 'openai';
  const apiKey = settings.apiKey || '';
  const model = settings.model || 'gpt-4o-mini';

  if (!apiKey) {
    return { error: 'No API key configured. Set one in Settings.' };
  }

  let endpoint, headers, body;

  switch (provider) {
    case 'openai':
      endpoint = 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
      body = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript:\n\n${transcriptText}\n\n${userPrompt}` },
        ],
        temperature: 0.3,
      };
      break;

    case 'deepseek':
      endpoint = 'https://api.deepseek.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
      body = {
        model: model || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript:\n\n${transcriptText}\n\n${userPrompt}` },
        ],
        temperature: 0.3,
      };
      break;

    case 'claude':
      endpoint = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = {
        model: model || 'claude-3-sonnet-20240229',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Transcript:\n\n${transcriptText}\n\n${userPrompt}` },
        ],
      };
      break;

    case 'gemini':
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${apiKey}`;
      headers = { 'Content-Type': 'application/json' };
      body = {
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nTranscript:\n\n${transcriptText}\n\n${userPrompt}` }],
          },
        ],
      };
      break;

    default:
      return { error: `Unknown provider: ${provider}` };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await response.json();

    // Extract text from provider-specific response formats
    let result = '';
    if (data.choices && data.choices[0]?.message?.content) {
      result = data.choices[0].message.content; // OpenAI, DeepSeek
    } else if (data.content && data.content[0]?.text) {
      result = data.content[0].text; // Claude
    } else if (data.candidates && data.candidates[0]?.content?.parts) {
      result = data.candidates[0].content.parts.map(p => p.text).join(''); // Gemini
    } else if (data.error) {
      return { error: data.error.message || JSON.stringify(data.error) };
    } else {
      return { error: 'Unexpected AI provider response format' };
    }

    return { result };
  } catch (e) {
    return { error: e.message };
  }
}

// ---- AI Task Generators ----
async function generateSummary(transcript, callback) {
  const transcriptText = transcriptToText(transcript);
  const lang = settings.language || 'auto';
  const langInstruction = lang === 'auto'
    ? 'Respond in the same language as the transcript (Arabic, English, or mixed).'
    : `Respond in ${lang}.`;

  const systemPrompt = `You are a meeting summarizer. ${langInstruction} Extract key discussion points, decisions made, and important details. Be concise but thorough.`;

  const result = await callAIProvider(transcriptText, systemPrompt, 'Summarize this meeting transcript.');
  callback(result);
}

async function generateActionItems(transcript, callback) {
  const transcriptText = transcriptToText(transcript);
  const lang = settings.language || 'auto';
  const langInstruction = lang === 'auto'
    ? 'Respond in the same language as the transcript.'
    : `Respond in ${lang}.`;

  const systemPrompt = `You are an action item extractor. ${langInstruction} Extract all action items, tasks, and follow-ups from this meeting. Format as: Person: Task | Deadline (if specified). Group by owner.`;

  const result = await callAIProvider(transcriptText, systemPrompt, 'Extract action items from this transcript.');
  callback(result);
}

async function runCustomPrompt(transcript, prompt, callback) {
  const transcriptText = transcriptToText(transcript);
  const result = await callAIProvider(transcriptText, 'You are a meeting analyst.', prompt);
  callback(result);
}

function transcriptToText(transcript) {
  if (!transcript || !transcript.captions) return '';
  return transcript.captions
    .map(c => `[${c.speaker}] ${c.text}`)
    .join('\n');
}

// ---- Init ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender, sendResponse);
  return true; // Keep channel open for async responses
});

chrome.runtime.onInstalled.addListener(() => {
  loadState();
});

// Load state on startup
loadState();
