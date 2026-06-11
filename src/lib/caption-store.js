// MeetScribe — Caption Storage & Utils
// Shared between content scripts, background, and panel.

;(function (global) {
  'use strict';

  const CaptionStore = {
    // In-memory caption buffer
    _captions: [],
    _maxSize: 10000,

    add: function (entries) {
      this._captions.push(...entries);
      if (this._captions.length > this._maxSize) {
        this._captions = this._captions.slice(-this._maxSize / 2);
      }
    },

    getAll: function () {
      return [...this._captions];
    },

    clear: function () {
      this._captions = [];
    },

    getBySpeaker: function (speaker) {
      return this._captions.filter(c => c.speaker === speaker);
    },

    count: function () {
      return this._captions.length;
    },

    // Export formats
    toText: function (options = {}) {
      const includeSpeaker = options.speaker !== false;
      const includeTimestamps = options.timestamps === true;
      return this._captions
        .map(c => {
          let line = '';
          if (includeTimestamps) {
            const d = new Date(c.timestamp);
            line += `[${d.toLocaleTimeString()}] `;
          }
          if (includeSpeaker) {
            line += `[${c.speaker}] `;
          }
          line += c.fullText || c.text;
          return line;
        })
        .join('\n');
    },

    toSRT: function () {
      return this._captions
        .map((c, i) => {
          const start = new Date(c.timestamp);
          const end = new Date(c.timestamp + 3000); // Assume 3s per segment
          const fmt = (d) =>
            `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')},${String(d.getMilliseconds()).padStart(3, '0')}`;
          return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n[${c.speaker}] ${c.fullText || c.text}\n`;
        })
        .join('\n');
    },

    toJSON: function () {
      return JSON.stringify({
        generatedAt: new Date().toISOString(),
        segments: this._captions.length,
        captions: this._captions,
      }, null, 2);
    },

    // Count unique speakers
    getSpeakers: function () {
      return [...new Set(this._captions.map(c => c.speaker))];
    },

    // Speaking time per speaker (approximate)
    getSpeakerStats: function () {
      const stats = {};
      for (const c of this._captions) {
        if (!stats[c.speaker]) stats[c.speaker] = { segments: 0, chars: 0 };
        stats[c.speaker].segments++;
        stats[c.speaker].chars += (c.text || '').length;
      }
      return stats;
    },
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CaptionStore;
  } else {
    global.CaptionStore = CaptionStore;
  }
})(this);
