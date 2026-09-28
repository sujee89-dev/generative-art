// In the Android app, the page has no built-in speech. MainActivity.java offers
// window.AndroidTTS instead; this file wraps it in the standard speechSynthesis
// API so the rest of the app works unchanged. In a normal browser it does nothing.
(() => {
"use strict";
const B = window.AndroidTTS;
if (!B) return;

const utterances = new Map();
const listeners = {};
let counter = 0, current = null, voices = [];

function loadVoices() {
  try {
    voices = JSON.parse(B.voices() || "[]").map(v => ({ name: v.name, lang: v.lang, localService: v.local !== false, default: false, voiceURI: v.name }));
  } catch { voices = []; }
}
function fire(u, type, extra) {
  const ev = Object.assign({ type, utterance: u, charIndex: 0, name: "word", elapsedTime: 0 }, extra || {});
  const handler = u["on" + type];
  if (handler) { try { handler.call(u, ev); } catch (e) { setTimeout(() => { throw e; }); } }
}

class SpeechSynthesisUtterance {
  constructor(text) {
    this.text = text == null ? "" : String(text);
    this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null;
    this.onstart = this.onend = this.onerror = this.onboundary = null;
  }
}

const synth = {
  speaking: false, pending: false, paused: false, onvoiceschanged: null,
  getVoices() { if (!voices.length) loadVoices(); return voices; },
  speak(u) {
    const id = "u" + (++counter);
    if (current && current !== u) { const old = current; current = null; fire(old, "error", { error: "interrupted" }); }
    utterances.set(id, u);
    current = u;
    synth.speaking = true;
    B.speak(u.text, u.lang || "en-US", Number(u.rate) || 1, Number(u.pitch) || 1, id, u.voice ? u.voice.name : "");
  },
  cancel() {
    const old = current;
    current = null;
    synth.speaking = false;
    B.stop();
    if (old) fire(old, "error", { error: "interrupted" });
  },
  pause() {}, resume() {},
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); }
};

// Called by MainActivity: (utterance id, "start" | "end" | "error" | "stop" | "boundary", char index).
window.__ttsEvent = (id, type, index) => {
  if (type === "voices") {
    loadVoices();
    if (synth.onvoiceschanged) synth.onvoiceschanged();
    (listeners.voiceschanged || []).forEach(f => f());
    return;
  }
  const u = utterances.get(id);
  if (!u) return;
  const live = u === current;
  if (type === "start") { if (live) fire(u, "start"); return; }
  if (type === "boundary") { if (live) fire(u, "boundary", { charIndex: index }); return; }
  utterances.delete(id);
  if (!live) return;
  current = null;
  synth.speaking = false;
  if (type === "end") fire(u, "end");
  else if (type === "error") fire(u, "error", { error: "synthesis-failed" });
};

window.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
try { Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true }); }
catch { window.speechSynthesis = synth; }
window.AHARA_ANDROID = true;
})();
