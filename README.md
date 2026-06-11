# 🎙️ MeetScribe — Open Source Meeting Transcriber

A Chrome extension that captures live captions from Google Meet (and Zoom/Teams), displays them in a side panel, and generates AI-powered summaries and action items. **Open-source Tactiq alternative.**

## Features

- **Live transcription** — Real-time caption capture from Google Meet's DOM
- **Multi-platform** — Google Meet (full), Zoom & Teams (stubs — contribute!)
- **Speaker identification** — Color-coded, per-speaker caption display
- **AI summaries** — One-click meeting summary using OpenAI, Claude, DeepSeek, or Gemini
- **Action items** — Automatic extraction of tasks and follow-ups from conversations
- **Custom AI prompts** — Ask any question about the meeting
- **Export** — TXT, SRT (subtitles), JSON formats
- **Multi-language** — Supports 60+ languages via Google Meet's captions; AI responds in the same language (including Arabic)
- **Privacy-first** — No audio recording, no bot joins the call, API keys stored locally
- **Open source** — MIT licensed, fully auditable

## Architecture

```
Content Script (content.js)  ──▶  Background Service Worker  ──▶  Side Panel (React-like)
  DOM caption extraction           Message routing & storage      UI & state management
```

## Quick Start

### Install from source

1. Clone this repo
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `meetscribe/` folder
5. Open a Google Meet call and turn on captions (CC button)
6. Click the MeetScribe icon to open the side panel

### Configuration

1. Click ⚙️ in the side panel
2. Select your AI provider (OpenAI, Claude, DeepSeek, Gemini)
3. Enter your API key
4. Choose the model and preferred language for responses
5. API keys are stored locally in `chrome.storage.local`

## Usage

1. Join a Google Meet call
2. Enable captions (CC button or press Ctrl/Cmd + Shift + C)
3. Open MeetScribe side panel → captions appear in real-time
4. After the meeting:
   - **📝 Summarize** — Condenses the meeting into key points
   - **✅ Action Items** — Extracts tasks with owners
   - **💬 Ask AI** — Ask custom questions about the conversation
5. Export the transcript via TXT/SRT/JSON

## Why not Tactiq?

| Feature | MeetScribe | Tactiq |
|---------|-----------|--------|
| Cost | Free (your own API key) | Free tier limited |
| Source | Open source (MIT) | Proprietary |
| Privacy | Your API key, your data | SOC-2 certified but proprietary |
| Custom AI | Any provider | OpenAI only |
| Arabic support | ✅ Full | ✅ Good |
| Self-host | ✅ Yes | ❌ |

## Development

```
npm install       # Install dev dependencies
npm run build     # Build production extension
npm run dev       # Development mode with hot reload
```

### Project Structure

```
meetscribe/
├── manifest.json              # Chrome Extension Manifest V3
├── _locales/                  # i18n translations
│   ├── en/messages.json
│   └── ar/messages.json       # Arabic support
├── src/
│   ├── content/
│   │   ├── meet-captions.js    # Google Meet caption extractor
│   │   ├── zoom-captions.js    # Zoom caption extractor (stub)
│   │   └── teams-captions.js   # MS Teams caption extractor (stub)
│   ├── background/
│   │   └── service-worker.js   # State management, AI API router
│   ├── panel/
│   │   ├── panel.html          # Side panel UI
│   │   ├── panel.css           # Dark-themed styles
│   │   └── panel.js            # UI controller
│   └── lib/
│       └── caption-store.js    # Caption buffer & export utils
└── public/                     # Icons (add your own)
```

## License

MIT — free to use, modify, and distribute.

## Contributing

- Fix caption selectors (Google Meet updates its DOM frequently)
- Complete Zoom & Teams support
- Add more AI providers
- Improve Arabic/RTI support
- Build workflow integrations (Slack, Notion, Linear)
