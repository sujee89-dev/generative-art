(() => {
"use strict";

/* ============ Change the name here ============ */
const CHILD = "Ahara";
// How her name is written in each language. The Tamil sentences add endings
// straight onto the name (அஹாரா + வின் = அஹாராவின்), which suits names ending in ா.
const NAMES = { en: CHILD, fr: CHILD, ta: "அஹாரா" };

const COLORS = ["#e84a7f", "#2f8fd8", "#3fa66b", "#f28a2e", "#8a5cc7", "#e0a800"];
const DATA = window.AHARA_DATA || { pictures: [], words: { en: [], fr: [], ta: [] } };
const BOOKS = window.AHARA_BOOKS || {};

/* ---------------------------------------------------------------- helpers */
const store = {
  get(k, d) { try { const v = localStorage.getItem("ahara:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ahara:" + k, JSON.stringify(v)); } catch {} }
};
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = s => segmenter ? [...segmenter.segment(s)].map(x => x.segment) : (s.match(/\P{M}\p{M}*/gu) || []);
const baseOf = g => g.normalize("NFD")[0].toUpperCase();
const clean = w => w.replace(/[^\p{L}\p{M}\p{N}'’-]/gu, "");

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pick = (arr, rnd = Math.random) => arr[rnd() * arr.length | 0];

// A deck walks through a pool in a remembered shuffled order, so nothing
// repeats until every item has been seen once. Then it reshuffles.
const deckCache = {};
function draw(key, pool) {
  if (!pool.length) return null;
  let st = store.get("deck:" + key, null);
  if (!st || st.n !== pool.length || st.pos >= st.n) {
    st = { n: pool.length, seed: (Math.random() * 2 ** 31) | 0, pos: 0 };
  }
  let order = deckCache[key];
  if (!order || order.seed !== st.seed || order.idx.length !== pool.length) {
    order = deckCache[key] = { seed: st.seed, idx: shuffle([...pool.keys()], mulberry32(st.seed)) };
  }
  const item = pool[order.idx[st.pos]];
  st.pos++;
  store.set("deck:" + key, st);
  return item;
}
const deckPos = key => (store.get("deck:" + key, null) || { pos: 0 }).pos;

// Some older tablets cannot draw newer emoji. Test each one once and skip the
// ones that come out as an empty box or as several separate pictures.
const emojiOK = (() => {
  const cache = new Map();
  let ctx = null, refW = 0, blank = "";
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 36;
    ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.font = "30px sans-serif";
    ctx.textBaseline = "top";
    refW = ctx.measureText("😀").width;
    const snap = t => { ctx.clearRect(0, 0, 36, 36); ctx.fillText(t, 0, 0); return ctx.getImageData(0, 0, 36, 36).data.join(","); };
    blank = snap("\u{1FFFE}");
    ctx.snap = snap;
  } catch { ctx = null; }
  return e => {
    if (!ctx || !e) return true;
    if (cache.has(e)) return cache.get(e);
    let ok = true;
    try {
      const w = ctx.measureText(e).width;
      if (refW && w > refW * 1.6) ok = false;
      else ok = ctx.snap(e) !== blank;
    } catch { ok = true; }
    cache.set(e, ok);
    return ok;
  };
})();
const safePic = (p, fallback = "📖") => graphemes(p || "").every(emojiOK) ? p : fallback;

/* ---------------------------------------------------------------- state */
let lang = store.get("lang", "en");
if (!["en", "fr", "ta"].includes(lang)) lang = "en";
let tab = Math.min(8, Math.max(0, store.get("tab", 0) | 0));
let stars = store.get("stars", 0) | 0;
const nm = () => NAMES[lang] || CHILD;
const fillName = s => s.replaceAll("{n}", nm());
const fillEn = s => s.replaceAll("{n}", CHILD);

/* ---------------------------------------------------------------- text */
const UI = {
  en: {
    hello: n => `Hello, ${n}!`, sub: "Reading Room", sound: "Sound",
    tabs: ["Letters", "Words", "Read", "Play", "Books", "Math", "Colors & Numbers", "World", "Chess"],
    footer: "Tap any word to hear it.",
    levels: ["All", "Easy", "Medium", "Hard"],
    lettersH: "The alphabet", lettersHint: n => `Tap a letter. The pink ones are in your name, ${n}!`,
    isFor: (l, w) => `${l} is for ${w}`, inName: () => "This letter is in your name!",
    wordsH: "Sound it out", wordsHint: "Tap each part, then read the whole word.",
    hear: "Hear it", next: "Next", prev: "Back",
    wordCount: (i, n) => `Word ${i.toLocaleString()} of ${n.toLocaleString()}. No repeats until you have read them all.`,
    readH: "Read a sentence", readHint: "Tap a word to hear it, or press Read to me.",
    readMe: "Read to me", sentCount: (i, n) => `Sentence ${i.toLocaleString()} of ${n.toLocaleString()}`,
    playH: "Games", modes: ["Find the picture", "Listen and find", "Missing letter"],
    pictureHint: "Read the word, then tap the matching picture.",
    listenHint: "Listen, then tap the word you hear.",
    missingHint: "Which letter is missing?",
    help: "Help me", good: n => [`Great job, ${n}!`, `You did it, ${n}!`, "Super reading!", `Wow, ${n}!`],
    bad: "Try again!", again: "Play again", done: n => `All done! You are a star, ${n}!`,
    booksH: "Books", booksHint: "Pick a book. Tap any word to hear it.",
    machine: "Surprise story", machineSub: "A brand new story every time",
    shelf: "Story shelf", more: "More free books online",
    moreHint: "These open in a new tab. On a kids' tablet, a parent may need to allow each website first.",
    read: "Read", level: l => `Level ${l}`, page: (i, n) => `Page ${i} of ${n}`,
    theEnd: "The End", readAll: "Read the whole book", backToShelf: "All books", readAgain: "Read again",
    noVoice: l => `This device has no ${l} voice, so words can't be read aloud.`,
    silent: "No sound? Check the volume, then open Sound check.",
    openCheck: "Sound check",
    langName: { en: "English", fr: "French", ta: "Tamil" }
  },
  fr: {
    hello: n => `Bonjour, ${n} !`, sub: "Coin lecture", sound: "Son",
    tabs: ["Lettres", "Mots", "Lire", "Jouer", "Livres", "Maths", "Couleurs et nombres"],
    footer: "Touche un mot pour l'entendre.",
    levels: ["Tous", "Facile", "Moyen", "Difficile"],
    lettersH: "L'alphabet", lettersHint: n => `Touche une lettre. Les roses sont dans ton prénom, ${n} !`,
    isFor: (l, w) => `${l} comme ${w}`, inName: () => "Cette lettre est dans ton prénom !",
    wordsH: "Syllabe par syllabe", wordsHint: "Touche chaque syllabe, puis lis le mot entier.",
    hear: "Écouter", next: "Suivant", prev: "Retour",
    wordCount: (i, n) => `Mot ${i.toLocaleString("fr")} sur ${n.toLocaleString("fr")}. Pas de répétition avant d'avoir tout lu.`,
    readH: "Lis une phrase", readHint: "Touche un mot pour l'entendre, ou appuie sur Lis-moi.",
    readMe: "Lis-moi", sentCount: (i, n) => `Phrase ${i.toLocaleString("fr")} sur ${n.toLocaleString("fr")}`,
    playH: "Jeux", modes: ["Trouve l'image", "Écoute et trouve", "Lettre manquante"],
    pictureHint: "Lis le mot, puis touche la bonne image.",
    listenHint: "Écoute, puis touche le mot que tu entends.",
    missingHint: "Quelle lettre manque ?",
    help: "Aide-moi", good: n => [`Bravo, ${n} !`, `Super, ${n} !`, "Tu lis très bien !", `Génial, ${n} !`],
    bad: "Essaie encore !", again: "Rejouer", done: n => `Fini ! Tu es une étoile, ${n} !`,
    booksH: "Livres", booksHint: "Choisis un livre. Touche un mot pour l'entendre.",
    machine: "Histoire surprise", machineSub: "Une nouvelle histoire à chaque fois",
    shelf: "Bibliothèque", more: "Plus de livres gratuits en ligne",
    moreHint: "Ces sites s'ouvrent dans un nouvel onglet. Sur une tablette enfant, un parent doit parfois les autoriser.",
    read: "Lire", level: l => `Niveau ${l}`, page: (i, n) => `Page ${i} sur ${n}`,
    theEnd: "Fin", readAll: "Lis tout le livre", backToShelf: "Tous les livres", readAgain: "Relire",
    noVoice: l => `Cet appareil n'a pas de voix en ${l}. Les mots ne peuvent pas être lus à voix haute.`,
    silent: "Pas de son ? Vérifie le volume, puis ouvre Test du son.",
    openCheck: "Test du son",
    langName: { en: "anglais", fr: "français", ta: "tamoul" }
  },
  ta: {
    hello: n => `வணக்கம், ${n}!`, sub: "படிக்கும் அறை", sound: "ஒலி",
    tabs: ["எழுத்து", "சொல்", "படி", "விளையாடு", "புத்தகம்", "கணக்கு", "நிறம் & எண்"],
    footer: "எந்தச் சொல்லையும் தொட்டால் கேட்கலாம்.",
    levels: ["எல்லாம்", "எளிது", "நடுத்தரம்", "கடினம்"],
    lettersH: "தமிழ் எழுத்துகள்", lettersHint: n => `ஒரு எழுத்தைத் தொடு. இளஞ்சிவப்பு எழுத்துகள் உன் பெயரில் உள்ளன, ${n}!`,
    isFor: (l, w) => `${l}, ${w}`, inName: () => "இந்த எழுத்து உன் பெயரில் உள்ளது!",
    wordsH: "அசை அசையாகப் படி", wordsHint: "ஒவ்வொரு பகுதியையும் தொடு, பிறகு முழுச் சொல்லையும் படி.",
    hear: "கேள்", next: "அடுத்தது", prev: "முந்தையது",
    wordCount: (i, n) => `சொல் ${i} / ${n}. எல்லாவற்றையும் படிக்கும் வரை மீண்டும் வராது.`,
    readH: "ஒரு வாக்கியம் படி", readHint: "ஒரு சொல்லைத் தொட்டுக் கேள், அல்லது 'எனக்குப் படி' அழுத்து.",
    readMe: "எனக்குப் படி", sentCount: (i, n) => `வாக்கியம் ${i} / ${n}`,
    playH: "விளையாட்டுகள்", modes: ["படத்தைக் கண்டுபிடி", "கேட்டுக் கண்டுபிடி", "விடுபட்ட எழுத்து"],
    pictureHint: "சொல்லைப் படி, பிறகு சரியான படத்தைத் தொடு.",
    listenHint: "கேள், பிறகு நீ கேட்ட சொல்லைத் தொடு.",
    missingHint: "எந்த எழுத்து விடுபட்டுள்ளது?",
    help: "உதவி", good: n => [`சபாஷ், ${n}!`, `மிக நன்று, ${n}!`, "அருமையாகப் படித்தாய்!", `சூப்பர், ${n}!`],
    bad: "மீண்டும் முயற்சி செய்!", again: "மீண்டும் விளையாடு", done: n => `முடிந்தது! நீ ஒரு நட்சத்திரம், ${n}!`,
    booksH: "புத்தகங்கள்", booksHint: "ஒரு புத்தகத்தைத் தேர்ந்தெடு. எந்தச் சொல்லையும் தொட்டால் கேட்கலாம்.",
    machine: "புதிய கதை", machineSub: "ஒவ்வொரு முறையும் ஒரு புதுக் கதை",
    shelf: "கதைப் புத்தகங்கள்", more: "இணையத்தில் இலவசப் புத்தகங்கள்",
    moreHint: "இவை புதிய தாவலில் திறக்கும். குழந்தைகளின் டேப்லெட்டில் பெற்றோர் ஒவ்வொரு தளத்தையும் அனுமதிக்க வேண்டியிருக்கலாம்.",
    read: "படி", level: l => `நிலை ${l}`, page: (i, n) => `பக்கம் ${i} / ${n}`,
    theEnd: "முற்றும்", readAll: "முழுப் புத்தகத்தையும் படி", backToShelf: "எல்லாப் புத்தகங்களும்", readAgain: "மீண்டும் படி",
    noVoice: l => `இந்தச் சாதனத்தில் ${l} குரல் இல்லை. சொற்களை வாசித்துக் காட்ட முடியாது.`,
    silent: "ஒலி கேட்கவில்லையா? ஒலி அளவைப் பார்த்து, 'ஒலிச் சோதனை'யைத் திற.",
    openCheck: "ஒலிச் சோதனை",
    langName: { en: "ஆங்கில", fr: "பிரெஞ்சு", ta: "தமிழ்" }
  }
};
const t = () => UI[lang];
const showEn = () => lang !== "en";
// Native text with its English meaning underneath (in French and Tamil).
function tt(key, ...args) {
  const pick = u => typeof u[key] === "function" ? u[key](...args) : u[key];
  const native = pick(t());
  return esc(native) + (showEn() ? `<small class="en">${esc(pick(UI.en))}</small>` : "");
}
const enUnder = s => showEn() && s ? `<small class="en">${esc(s)}</small>` : "";
const TAB_ICONS = ["🔤", "🧩", "💬", "🎯", "📚", "➕", "🎨", "🌍", "♟️"];
const TAB_COLORS = ["#2f8fd8", "#3fa66b", "#8a5cc7", "#f28a2e", "#e84a7f", "#0f8f84", "#c2410c", "#1a7f5a", "#5b4636"];
// World and Chess are English-only sections.
const tabVisible = i => i < 7 || lang === "en";

const LETTERS = {
  en: [
    ["A","Apple","🍎"],["B","Ball","⚽"],["C","Cat","🐱"],["D","Dog","🐶"],["E","Egg","🥚"],
    ["F","Fish","🐟"],["G","Grapes","🍇"],["H","Hat","👒"],["I","Ice cream","🍦"],["J","Juice","🧃"],
    ["K","Kite","🪁"],["L","Lion","🦁"],["M","Moon","🌙"],["N","Nose","👃"],["O","Owl","🦉"],
    ["P","Pig","🐷"],["Q","Queen","👑"],["R","Rabbit","🐰"],["S","Sun","☀️"],["T","Tree","🌳"],
    ["U","Umbrella","☂️"],["V","Van","🚐"],["W","Whale","🐳"],["X","Fox","🦊"],["Y","Yo-yo","🪀"],["Z","Zebra","🦓"]
  ],
  fr: [
    ["A","Ananas","🍍"],["B","Banane","🍌"],["C","Chat","🐱"],["D","Dauphin","🐬"],["E","Éléphant","🐘"],
    ["F","Fraise","🍓"],["G","Gâteau","🎂"],["H","Hibou","🦉"],["I","Île","🏝️"],["J","Jus","🧃"],
    ["K","Koala","🐨"],["L","Lune","🌙"],["M","Maison","🏠"],["N","Nuage","☁️"],["O","Oiseau","🐦"],
    ["P","Pomme","🍎"],["Q","Quatre","4️⃣"],["R","Robot","🤖"],["S","Soleil","☀️"],["T","Tortue","🐢"],
    ["U","Un","1️⃣"],["V","Vache","🐄"],["W","Wagon","🚃"],["X","Taxi","🚕"],["Y","Yoyo","🪀"],["Z","Zèbre","🦓"]
  ],
  // English meanings for the French letter words, in the same order.
  frEn: ["pineapple","banana","cat","dolphin","elephant","strawberry","cake","owl","island","juice","koala","moon","house","cloud","bird","apple","four","robot","sun","tortoise","one","cow","train car","taxi","yo-yo","zebra"],
  ta: [
    ["அ","அம்மா","👩"],["ஆ","ஆடு","🐐"],["இ","இலை","🍃"],["ஈ","ஈ","🪰"],["உ","உப்பு","🧂"],["ஊ","ஊசி","💉"],
    ["எ","எலி","🐭"],["ஏ","ஏணி","🪜"],["ஐ","ஐந்து","5️⃣"],["ஒ","ஒட்டகம்","🐫"],["ஓ","ஓடம்","⛵"],["ஔ","ஔவையார்","👵"],
    ["க","கப்பல்","🚢"],["ங","சங்கு","🐚"],["ச","சட்டை","👕"],["ஞ","ஞாயிறு","☀️"],["ட","பட்டம்","🪁"],["ண","மணி","🔔"],
    ["த","தக்காளி","🍅"],["ந","நண்டு","🦀"],["ப","பந்து","⚽"],["ம","மரம்","🌳"],["ய","யானை","🐘"],["ர","ரோஜா","🌹"],
    ["ல","பலூன்","🎈"],["வ","வாத்து","🦆"],["ழ","வாழைப்பழம்","🍌"],["ள","பள்ளி","🏫"],["ற","பறவை","🐦"],["ன","மீன்","🐟"],
    ["ஜ","ஜன்னல்","🪟"],["ஸ","ஸ்கூட்டர்","🛵"],["ஹ","ஹெலிகாப்டர்","🚁"]
  ]
};

/* ---------------------------------------------------------------- speech */
const Speech = (() => {
  const synth = window.speechSynthesis;
  const TAGS = { en: "en-US", fr: "fr-FR", ta: "ta-IN" };
  let voices = [];
  let waited = false;
  let current = null;
  const keep = [];
  const listeners = new Set();
  const load = () => {
    try { voices = synth.getVoices() || []; } catch { voices = []; }
    listeners.forEach(f => f());
  };
  if (synth) {
    load();
    try { synth.addEventListener("voiceschanged", load); } catch { synth.onvoiceschanged = load; }
    // Some browsers fill the list late and never fire the event.
    [300, 1000].forEach(ms => setTimeout(load, ms));
    setTimeout(() => { waited = true; load(); }, 2500);
  }
  const norm = v => (v.lang || "").replace("_", "-").toLowerCase();
  const voicesFor = l => voices.filter(v => norm(v).startsWith(l));
  function voiceFor(l) {
    const list = voicesFor(l);
    if (!list.length) return null;
    const chosen = store.get("voice:" + l, "");
    return list.find(v => v.name === chosen)
      || list.find(v => norm(v) === TAGS[l].toLowerCase() && v.localService)
      || list.find(v => norm(v) === TAGS[l].toLowerCase())
      || list.find(v => v.localService) || list[0];
  }

  // iOS only lets a page speak after speech starts inside a tap, so say
  // nothing, quietly, on the first tap anywhere.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let unlocked = !isIOS;
  function unlock() {
    if (!synth || unlocked) return;
    unlocked = true;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); } catch {}
  }

  function speak(text, opts = {}) {
    const l = opts.lang || lang;
    if (!synth) { problem("unsupported", l); opts.onend && opts.onend(); return false; }
    const rate = (opts.rate || 0.85) * (store.get("speed", 1) || 1);
    let started = false;
    const make = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = TAGS[l];
      const v = voiceFor(l);
      if (v) u.voice = v;
      u.rate = Math.max(0.4, Math.min(1.5, rate));
      u.pitch = 1.05;
      u.volume = 1;
      u.onstart = () => { if (current !== u) return; started = true; setSpeaking(true); opts.onstart && opts.onstart(); };
      u.onend = () => { if (current !== u) return; current = null; setSpeaking(false); opts.onend && opts.onend(); };
      u.onerror = e => {
        if (current !== u) return;
        current = null; setSpeaking(false);
        if (e.error !== "interrupted" && e.error !== "canceled") problem(e.error || "error", l);
        opts.onend && opts.onend();
      };
      if (opts.onboundary) u.onboundary = e => { if (current === u) opts.onboundary(e); };
      keep.push(u); if (keep.length > 12) keep.shift(); // Chrome can drop events on collected utterances
      return u;
    };
    try {
      if (synth.speaking || synth.pending) { current = null; synth.cancel(); }
      if (synth.paused) synth.resume();
      current = make();
      synth.speak(current);
    } catch { problem("error", l); return false; }
    // Chrome and Safari sometimes swallow an utterance that follows cancel(). Try once more.
    const first = current;
    setTimeout(() => {
      if (started || current !== first) return;
      if (!synth.speaking) {
        try { current = make(); synth.cancel(); synth.speak(current); } catch {}
        const second = current;
        setTimeout(() => { if (!started && current === second && !synth.speaking) problem("silent", l); }, 2200);
      }
    }, 650);
    return true;
  }
  function stop() { try { current = null; synth && synth.cancel(); setSpeaking(false); } catch {} }
  return {
    speak, stop, unlock, voicesFor, voiceFor, TAGS,
    supported: !!synth,
    ready: () => voices.length > 0 || waited,
    has: l => voicesFor(l).length > 0,
    onChange: f => listeners.add(f)
  };
})();
const say = (text, opts) => Speech.speak(text, opts);

function setSpeaking(on) { $("#soundBtn").classList.toggle("speaking", on); }

let toastTimer = 0;
const warned = new Set();
function problem(kind, l) {
  const key = kind + ":" + l;
  if (warned.has(key)) return;
  warned.add(key);
  const msg = kind === "unsupported" || (Speech.ready() && !Speech.has(l)) ? t().noVoice(t().langName[l]) : t().silent;
  showToast(msg);
}
function showToast(msg) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span><button type="button" data-open>${esc(t().openCheck)}</button><button type="button" class="x" aria-label="Close">✕</button>`;
  el.hidden = false;
  $("[data-open]", el).onclick = () => { el.hidden = true; openSoundCheck(); };
  $(".x", el).onclick = () => { el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

/* ---------------------------------------------------------------- sound check */
const CHECK = {
  en: {
    title: "Sound check", intro: "Reading aloud uses the voices built into this device. Test each language here.",
    none: "This browser can't read aloud. Try Chrome, Safari or the Silk browser.",
    has: n => `Voice found: ${n}`, missing: "No voice installed for this language.", loading: "Looking for voices…",
    test: "Test", speed: "Speed", slow: "Slower", fast: "Faster",
    tipsH: "No sound?", tips: [
      "Turn the volume up. On iPhone and iPad, also flip off silent mode.",
      "Amazon Fire tablet: Settings → Accessibility → Text-to-Speech. Pick a voice for each language if one is offered.",
      "Android: Settings → Accessibility → Text-to-speech → Preferred engine (Speech Services by Google) → Install voice data. Add French and Tamil.",
      "iPhone or iPad: Settings → Accessibility → Spoken Content → Voices. Download French and Tamil voices.",
      "After installing a voice, close and reopen this page."
    ], close: "Done",
    sample: { en: "Hello! I can read with you.", fr: "Bonjour ! Je peux lire avec toi.", ta: "வணக்கம்! நான் உன்னுடன் படிப்பேன்." }
  },
  fr: {
    title: "Test du son", intro: "La lecture à voix haute utilise les voix de cet appareil. Teste chaque langue ici.",
    none: "Ce navigateur ne peut pas lire à voix haute. Essaie Chrome, Safari ou Silk.",
    has: n => `Voix trouvée : ${n}`, missing: "Aucune voix installée pour cette langue.", loading: "Recherche des voix…",
    test: "Tester", speed: "Vitesse", slow: "Plus lent", fast: "Plus rapide",
    tipsH: "Pas de son ?", tips: [
      "Monte le volume. Sur iPhone et iPad, désactive aussi le mode silencieux.",
      "Tablette Amazon Fire : Paramètres → Accessibilité → Synthèse vocale. Choisis une voix pour chaque langue si possible.",
      "Android : Paramètres → Accessibilité → Synthèse vocale → Moteur préféré (Services vocaux Google) → Installer les données vocales. Ajoute le français et le tamoul.",
      "iPhone ou iPad : Réglages → Accessibilité → Contenu énoncé → Voix. Télécharge les voix française et tamoule.",
      "Après avoir installé une voix, ferme puis rouvre cette page."
    ], close: "OK",
    sample: { en: "Hello! I can read with you.", fr: "Bonjour ! Je peux lire avec toi.", ta: "வணக்கம்! நான் உன்னுடன் படிப்பேன்." }
  },
  ta: {
    title: "ஒலிச் சோதனை", intro: "வாசித்துக் காட்ட இந்தச் சாதனத்தில் உள்ள குரல்கள் பயன்படும். ஒவ்வொரு மொழியையும் இங்கே சோதிக்கவும்.",
    none: "இந்த உலாவியால் வாசித்துக் காட்ட முடியாது. Chrome, Safari அல்லது Silk பயன்படுத்தவும்.",
    has: n => `குரல் உள்ளது: ${n}`, missing: "இந்த மொழிக்குக் குரல் நிறுவப்படவில்லை.", loading: "குரல்களைத் தேடுகிறது…",
    test: "சோதி", speed: "வேகம்", slow: "மெதுவாக", fast: "வேகமாக",
    tipsH: "ஒலி கேட்கவில்லையா?", tips: [
      "ஒலி அளவை அதிகரிக்கவும். iPhone, iPad-இல் அமைதி நிலையையும் (silent mode) அணைக்கவும்.",
      "Amazon Fire டேப்லெட்: Settings → Accessibility → Text-to-Speech. ஒவ்வொரு மொழிக்கும் குரல் இருந்தால் தேர்ந்தெடுக்கவும்.",
      "Android: Settings → Accessibility → Text-to-speech → Preferred engine (Speech Services by Google) → Install voice data. பிரெஞ்சு, தமிழ் சேர்க்கவும்.",
      "iPhone / iPad: Settings → Accessibility → Spoken Content → Voices. பிரெஞ்சு, தமிழ் குரல்களைப் பதிவிறக்கவும்.",
      "குரலை நிறுவிய பிறகு இந்தப் பக்கத்தை மூடி மீண்டும் திறக்கவும்."
    ], close: "சரி",
    sample: { en: "Hello! I can read with you.", fr: "Bonjour ! Je peux lire avec toi.", ta: "வணக்கம்! நான் உன்னுடன் படிப்பேன்." }
  }
};
function openSoundCheck() {
  const d = $("#soundSheet");
  const draw = () => {
    const c = CHECK[lang];
    const rows = ["en", "fr", "ta"].map(l => {
      const list = Speech.voicesFor(l);
      const v = Speech.voiceFor(l);
      const status = !Speech.supported ? `<span class="status bad">${esc(c.none)}</span>`
        : !Speech.ready() ? `<span class="status">${esc(c.loading)}</span>`
        : v ? `<span class="status good">✓ ${esc(c.has(v.name))}</span>`
        : `<span class="status bad">✗ ${esc(c.missing)}</span>`;
      const select = list.length > 1
        ? `<select id="voice-${l}" aria-label="${esc(UI.en.langName[l])} voice">${list.map(x => `<option value="${esc(x.name)}"${v && x.name === v.name ? " selected" : ""}>${esc(x.name)} (${esc(x.lang)})</option>`).join("")}</select>`
        : "";
      return `<div class="voice-row"><div><b>${l === "en" ? "English" : l === "fr" ? "Français" : "தமிழ்"}</b><br>${status}</div>
        <button type="button" class="btn alt" data-test="${l}">🔊 ${esc(c.test)}</button>${select}</div>`;
    }).join("");
    const speed = store.get("speed", 1);
    d.innerHTML = `<h2>${esc(c.title)}</h2><p class="hint">${esc(c.intro)}</p>${rows}
      <div class="speed"><span>${esc(c.slow)}</span><input type="range" id="speed" min="0.6" max="1.3" step="0.1" value="${speed}" aria-label="${esc(c.speed)}"><span>${esc(c.fast)}</span></div>
      <b>${esc(c.tipsH)}</b><ul class="tips">${c.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="closeCheck">${esc(c.close)}</button></div>`;
    d.querySelectorAll("[data-test]").forEach(b => b.onclick = () => say(c.sample[b.dataset.test], { lang: b.dataset.test }));
    d.querySelectorAll("select").forEach(s => s.onchange = () => { store.set("voice:" + s.id.slice(6), s.value); say(c.sample[s.id.slice(6)], { lang: s.id.slice(6) }); });
    $("#speed", d).onchange = e => store.set("speed", +e.target.value);
    $("#closeCheck", d).onclick = () => d.close();
  };
  draw();
  if (!d.dataset.watching) { d.dataset.watching = "1"; Speech.onChange(() => { if (d.open) openSoundCheck.redraw(); }); }
  openSoundCheck.redraw = draw;
  try { d.showModal(); } catch { d.setAttribute("open", ""); }
}

/* ---------------------------------------------------------------- word data */
const pictures = { en: [], fr: [], ta: [] };
const picByWord = { en: new Map(), fr: new Map(), ta: new Map() };
const wordPools = {};
function prepareData() {
  const drawable = DATA.pictures.filter(p => emojiOK(p.e));
  const usable = drawable.length >= 40 ? drawable : DATA.pictures;
  for (const p of usable) {
    for (const l of ["en", "fr", "ta"]) {
      if (!p[l]) continue;
      pictures[l].push(p);
      if (!picByWord[l].has(p[l].toLowerCase())) picByWord[l].set(p[l].toLowerCase(), p.e);
    }
  }
}
function levelOf(l, syl, word) {
  const n = syl.length;
  if (l === "ta") { const g = graphemes(word).length; return g <= 2 ? 1 : g <= 4 ? 2 : 3; }
  const len = word.length;
  if (l === "en") return n === 1 && len <= 4 ? 1 : n <= 2 && len <= 7 ? 2 : 3;
  return n <= 2 && len <= 5 ? 1 : n <= 2 ? 2 : 3;
}
function wordsFor(l) {
  if (wordPools[l]) return wordPools[l];
  const all = (DATA.words[l] || []).map(s => {
    const [body, gloss = ""] = s.split("~");
    const syl = body.split("|");
    const w = syl.join("");
    return { w, syl, gloss, lvl: levelOf(l, syl, w), pic: picByWord[l].get(w.toLowerCase()) || "" };
  });
  return (wordPools[l] = { 0: all, 1: all.filter(x => x.lvl === 1), 2: all.filter(x => x.lvl === 2), 3: all.filter(x => x.lvl === 3) });
}

/* ---------------------------------------------------------------- grammar */
const FR_H_MUET = new Set(["hôpital", "hélicoptère", "hippopotame", "herbe", "hirondelle", "homme", "horloge", "huile"]);
const FR_PLURAL = new Set(["lunettes"]);
const frElide = w => /^[aeiouyàâéèêëîïôœ]/i.test(w) || FR_H_MUET.has(w.toLowerCase());
const G = {
  en: {
    a: p => p.enm ? "some " + p.en : (/^[aeiou]/i.test(p.en) && !/^(uni|use|eu)/i.test(p.en) ? "an " : "a ") + p.en,
    the: p => "the " + p.en
  },
  fr: {
    un: p => p.frm ? G.fr.du(p) : (p.g === "f" ? "une " : "un ") + p.fr,
    le: p => frElide(p.fr) ? "l'" + p.fr : (p.g === "f" ? "la " : "le ") + p.fr,
    du: p => frElide(p.fr) ? "de l'" + p.fr : (p.g === "f" ? "de la " : "du ") + p.fr,
    au: p => frElide(p.fr) ? "à l'" + p.fr : p.g === "f" ? "à la " + p.fr : "au " + p.fr,
    mon: p => (p.g === "f" && !frElide(p.fr) ? "ma " : "mon ") + p.fr,
    son: p => (p.g === "f" && !frElide(p.fr) ? "sa " : "son ") + p.fr,
    adj: (p, m, f) => p.g === "f" ? f : m
  },
  ta: {
    // Hard consonants double after words like எனக்கு: எனக்குப் பால்.
    join: (word, next) => {
      const b = baseOf(graphemes(next)[0] || "");
      return ({ "க": "க்", "ச": "ச்", "த": "த்", "ப": "ப்" }[b] ? word + { "க": "க்", "ச": "ச்", "த": "த்", "ப": "ப்" }[b] : word) + " " + next;
    }
  }
};
const FAMILY = new Set(["👩", "👨", "👵", "👴", "👶"]);

// Sentence patterns. Each returns text for a picture word, or null if it does not fit.
const SENTENCES = {
  en: [
    p => p.c !== "people" && `I see ${G.en.a(p)}.`,
    p => p.c !== "people" && `Look at the ${p.en}!`,
    p => p.c !== "people" && `Where is the ${p.en}?`,
    p => p.c !== "people" && `Here is ${G.en.a(p)}.`,
    p => ["animal", "food", "thing", "clothes"].includes(p.c) && `{n} has ${G.en.a(p)}.`,
    p => p.c !== "people" && !p.enm && `Is it ${G.en.a(p)}? Yes, it is!`,
    p => p.c !== "people" && `I like the ${p.en}.`,
    p => ["animal", "thing", "vehicle", "food", "nature", "place"].includes(p.c) && !p.enm && `The ${p.en} is big.`,
    p => ["animal", "thing", "vehicle", "food"].includes(p.c) && !p.enm && `The ${p.en} is little.`,
    p => p.c === "animal" && `The ${p.en} is sleeping.`,
    p => p.c === "animal" && `The ${p.en} is hungry.`,
    p => p.c === "animal" && `The ${p.en} can see {n}.`,
    p => p.c === "animal" && `Hello, little ${p.en}!`,
    p => p.c === "food" && `{n} eats ${G.en.a(p)}.`,
    p => p.c === "food" && `Yum! The ${p.en} is good.`,
    p => p.c === "drink" && `{n} drinks some ${p.en}.`,
    p => p.c === "drink" && `The ${p.en} is cold.`,
    p => p.c === "vehicle" && `The ${p.en} goes fast.`,
    p => p.c === "vehicle" && `{n} can see the ${p.en}.`,
    p => p.c === "clothes" && `{n} puts on her ${p.en}.`,
    p => (p.c === "thing" || p.c === "body") && `This is my ${p.en}.`,
    p => p.c === "body" && `I can touch my ${p.en}.`,
    p => p.c === "nature" && `The ${p.en} is pretty.`,
    p => p.c === "place" && `{n} goes to the ${p.en}.`,
    p => FAMILY.has(p.e) && `I love my ${p.en}.`,
    p => FAMILY.has(p.e) && `Hello, ${p.en}!`
  ],
  // French and Tamil patterns return [sentence, English meaning].
  fr: [
    p => p.c !== "people" && [`Je vois ${G.fr.un(p)}.`, `I see ${G.en.a(p)}.`],
    p => p.c !== "people" && [`Regarde ${G.fr.le(p)} !`, `Look at the ${p.en}!`],
    p => p.c !== "people" && [`Où est ${G.fr.le(p)} ?`, `Where is the ${p.en}?`],
    p => p.c !== "people" && [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`],
    p => p.c !== "people" && [`J'aime ${G.fr.le(p)}.`, `I like the ${p.en}.`],
    p => ["animal", "thing", "clothes"].includes(p.c) && [`{n} a ${G.fr.un(p)}.`, `{n} has ${G.en.a(p)}.`],
    p => ["animal", "thing", "vehicle", "nature", "place"].includes(p.c) && !p.frm && [`${cap(G.fr.le(p))} est ${G.fr.adj(p, "grand", "grande")}.`, `The ${p.en} is big.`],
    p => ["animal", "thing", "vehicle", "food"].includes(p.c) && !p.frm && [`${cap(G.fr.le(p))} est ${G.fr.adj(p, "petit", "petite")}.`, `The ${p.en} is little.`],
    p => p.c === "animal" && [`${cap(G.fr.le(p))} dort.`, `The ${p.en} is sleeping.`],
    p => p.c === "animal" && [`${cap(G.fr.le(p))} a faim.`, `The ${p.en} is hungry.`],
    p => p.c === "animal" && [`${cap(G.fr.le(p))} est ${G.fr.adj(p, "content", "contente")}.`, `The ${p.en} is happy.`],
    p => p.c === "animal" && !frElide(p.fr) && [`Bonjour, ${G.fr.adj(p, "petit", "petite")} ${p.fr} !`, `Hello, little ${p.en}!`],
    p => p.c === "food" && [`{n} mange ${G.fr.un(p)}.`, `{n} eats ${G.en.a(p)}.`],
    p => p.c === "food" && [`Miam ! ${cap(G.fr.le(p))} est ${G.fr.adj(p, "bon", "bonne")}.`, `Yum! The ${p.en} is good.`],
    p => p.c === "drink" && [`{n} boit ${G.fr.du(p)}.`, `{n} drinks some ${p.en}.`],
    p => p.c === "vehicle" && [`${cap(G.fr.le(p))} va vite.`, `The ${p.en} goes fast.`],
    p => p.c === "clothes" && [`{n} met ${G.fr.son(p)}.`, `{n} puts on her ${p.en}.`],
    p => (p.c === "thing" || p.c === "body") && [`C'est ${G.fr.mon(p)}.`, `This is my ${p.en}.`],
    p => p.c === "body" && [`Je touche ${G.fr.mon(p)}.`, `I touch my ${p.en}.`],
    p => p.c === "nature" && [`${cap(G.fr.le(p))} est ${G.fr.adj(p, "joli", "jolie")}.`, `The ${p.en} is pretty.`],
    p => p.c === "place" && [`{n} va ${G.fr.au(p)}.`, `{n} goes to the ${p.en}.`],
    p => FAMILY.has(p.e) && [`J'aime ${G.fr.mon(p)}.`, `I love my ${p.en}.`],
    p => FAMILY.has(p.e) && [`Bonjour, ${p.fr} !`, `Hello, ${p.en}!`]
  ],
  ta: [
    p => p.c !== "people" && [`இது ஒரு ${p.ta}.`, `This is ${G.en.a(p)}.`],
    p => p.c !== "people" && [`அங்கே ஒரு ${p.ta} இருக்கிறது.`, `There is ${G.en.a(p)} over there.`],
    p => p.c !== "people" && [`${p.ta} எங்கே?`, `Where is the ${p.en}?`],
    p => p.c !== "people" && [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`],
    p => p.c !== "people" && [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`],
    p => p.c !== "body" && (p.c !== "people" || FAMILY.has(p.e)) && [`${G.ta.join("எனக்கு", p.ta)} பிடிக்கும்.`, `I like ${FAMILY.has(p.e) ? "my " + p.en : p.enm ? p.en : "the " + p.en}.`],
    p => ["animal", "thing", "vehicle", "nature", "place"].includes(p.c) && [`${p.ta} பெரியது.`, `The ${p.en} is big.`],
    p => ["animal", "thing", "vehicle", "food"].includes(p.c) && [`${p.ta} சிறியது.`, `The ${p.en} is small.`],
    p => ["animal", "nature", "place", "thing"].includes(p.c) && [`${p.ta} அழகாக இருக்கிறது.`, `The ${p.en} is beautiful.`],
    p => p.c === "animal" && [`${p.ta} தூங்குகிறது.`, `The ${p.en} is sleeping.`],
    p => p.c === "animal" && [`${p.ta} விளையாடுகிறது.`, `The ${p.en} is playing.`],
    p => (p.c === "animal" || FAMILY.has(p.e)) && [`வணக்கம், ${p.ta}!`, `Hello, ${p.en}!`],
    p => p.c === "food" && [`{n} ${p.ta} சாப்பிடுகிறாள்.`, `{n} is eating ${G.en.a(p)}.`],
    p => p.c === "drink" && [`{n} ${p.ta} குடிக்கிறாள்.`, `{n} is drinking ${p.en}.`],
    p => p.c === "vehicle" && [`${p.ta} வேகமாகப் போகிறது.`, `The ${p.en} goes fast.`],
    p => ["thing", "clothes", "body"].includes(p.c) && [`இது என் ${p.ta}.`, `This is my ${p.en}.`],
    p => ["thing", "clothes"].includes(p.c) && [`{n}விடம் ஒரு ${p.ta} இருக்கிறது.`, `{n} has ${G.en.a(p)}.`]
  ]
};
const HANDWRITTEN = {
  en: ["{n} can read!", "The cat is on the mat.", "The dog runs fast.", "I see the big sun.", "{n} likes to jump.",
    "The fish can swim.", "Good night, {n}. I love you.", "We go to the park.", "The bird is in the tree.",
    "Mom and Dad love {n}.", "It is a sunny day.", "The frog can hop.", "I have a red hat.", "The bus is big and yellow.",
    "Can you see the moon?", "We like to play.", "The duck is in the pond.", "{n} reads a book.", "The baby is sleeping.",
    "Look at the rainbow!"].map(s => [s, ""]),
  fr: [["{n} sait lire !", "{n} can read!"], ["Le chat est sur le tapis.", "The cat is on the rug."],
    ["Le chien court vite.", "The dog runs fast."], ["Je vois le grand soleil.", "I see the big sun."],
    ["{n} aime sauter.", "{n} likes to jump."], ["Le poisson nage.", "The fish swims."], ["Bonne nuit, {n}.", "Good night, {n}."],
    ["Nous allons au parc.", "We are going to the park."], ["L'oiseau est dans l'arbre.", "The bird is in the tree."],
    ["Papa et maman aiment {n}.", "Dad and Mom love {n}."], ["Il fait beau aujourd'hui.", "It is nice weather today."],
    ["La grenouille saute.", "The frog jumps."], ["J'ai un chapeau rouge.", "I have a red hat."],
    ["Le bus est grand et jaune.", "The bus is big and yellow."], ["Tu vois la lune ?", "Can you see the moon?"],
    ["Nous aimons jouer.", "We like to play."], ["Le canard est dans la mare.", "The duck is in the pond."],
    ["{n} lit un livre.", "{n} reads a book."], ["Le bébé dort.", "The baby is sleeping."],
    ["Regarde l'arc-en-ciel !", "Look at the rainbow!"]],
  ta: [["{n} படிக்கிறாள்!", "{n} is reading!"], ["பூனை பாயில் இருக்கிறது.", "The cat is on the mat."],
    ["நாய் வேகமாக ஓடுகிறது.", "The dog runs fast."], ["நான் பெரிய சூரியனைப் பார்க்கிறேன்.", "I see the big sun."],
    ["{n}வுக்குக் குதிக்கப் பிடிக்கும்.", "{n} likes to jump."], ["மீன் நீந்துகிறது.", "The fish swims."],
    ["இனிய இரவு, {n}.", "Good night, {n}."], ["நாங்கள் பூங்காவுக்குப் போகிறோம்.", "We are going to the park."],
    ["பறவை மரத்தில் இருக்கிறது.", "The bird is in the tree."], ["அம்மாவும் அப்பாவும் {n}வை நேசிக்கிறார்கள்.", "Mom and Dad love {n}."],
    ["இன்று நல்ல வெயில்.", "It is sunny today."], ["தவளை குதிக்கிறது.", "The frog jumps."],
    ["என்னிடம் ஒரு சிவப்புத் தொப்பி இருக்கிறது.", "I have a red hat."], ["பேருந்து பெரியது.", "The bus is big."],
    ["நிலாவைப் பார்த்தாயா?", "Did you see the moon?"], ["எங்களுக்கு விளையாடப் பிடிக்கும்.", "We like to play."],
    ["வாத்து குளத்தில் இருக்கிறது.", "The duck is in the pond."], ["{n} புத்தகம் படிக்கிறாள்.", "{n} is reading a book."],
    ["குழந்தை தூங்குகிறது.", "The baby is sleeping."], ["வானவில்லைப் பார்!", "Look at the rainbow!"]]
};
const sentencePools = {};
function sentencesFor(l) {
  if (sentencePools[l]) return sentencePools[l];
  const out = HANDWRITTEN[l].map(([text, en]) => ({ text, en, pic: "" }));
  for (const p of pictures[l]) {
    if (l === "fr" && FR_PLURAL.has(p.fr)) continue;
    for (const f of SENTENCES[l]) {
      const s = f(p);
      if (!s) continue;
      const [text, en] = Array.isArray(s) ? s : [s, ""];
      out.push({ text, en, pic: p.e });
    }
  }
  return (sentencePools[l] = out);
}

/* ---------------------------------------------------------------- story machine */
const THEMES = [
  { id: "zoo", cover: "🦁", pool: "🦁🐯🐻🐼🐨🦊🐵🦒🦓🦏🦛🐘🐪🦘🦍🐆🐊🐧🦩🦚🦜🦙" },
  { id: "farm", cover: "🚜", pool: "🐮🐷🐔🐓🐴🐐🐑🦆🐶🐱🦃🐤🐰🐃🐝🌽🥕🚜" },
  { id: "sea", cover: "🌊", pool: "🐟🐬🐳🦈🦀🐙🐢🐚🦐🦞🦭🦦🌊⛵🚢⚓" },
  { id: "garden", cover: "🌷", pool: "🐝🦋🐛🐞🐌🐜🪱🌸🌻🌷🌹🍄🐸🌱🍁🐿️🐦🍓🍅" },
  { id: "market", cover: "🧺", cats: ["food", "drink"] },
  { id: "toys", cover: "🧸", pool: "🧸⚽🪁🎈🪀🧩🎲🥁🎸🎹🤖📖🖍️🚗🚂✈️🚀👑🎁" },
  { id: "sky", cover: "☁️", pool: "☀️🌙⭐☁️🌈✈️🚁🚀🦅🐦🦉🪁🎈🦇🪐🌧️⚡" },
  { id: "town", cover: "🏙️", cats: ["vehicle", "place"] },
  { id: "home", cover: "🏠", pool: "🛏️🪑🚪🪟🧼🧹🪣💡🕯️⏰📺🪞🥣🥄🍽️🧺📦🐱🐶🧸" }
];
const STORY = {
  en: {
    zoo: ["{n} at the Zoo", "{n} goes to the zoo.", [p => `{n} sees ${G.en.a(p)}.`, p => `Look! ${cap(G.en.a(p))}!`, p => `Hello, ${p.en}!`], "Bye-bye, zoo! See you soon."],
    farm: ["{n} on the Farm", "{n} visits the farm.", [p => `{n} sees ${G.en.a(p)}.`, p => `Here is ${G.en.a(p)}.`, p => `Hello, ${p.en}!`], "Bye-bye, farm!"],
    sea: ["{n} Under the Sea", "{n} dives into the sea. Splash!", [p => `{n} sees ${G.en.a(p)}.`, p => `Look! ${cap(G.en.a(p))}!`, p => `Hello, ${p.en}!`], "Time to swim home!"],
    garden: ["{n}'s Garden", "{n} goes out to the garden.", [p => `{n} finds ${G.en.a(p)}.`, p => `Look! ${cap(G.en.a(p))}!`, p => `Here is ${G.en.a(p)}.`], "What a lovely garden!"],
    market: ["{n} Goes Shopping", "{n} goes to the market with Mom.", [p => `{n} buys ${G.en.a(p)}.`, p => `Here is ${G.en.a(p)}.`, p => `Mom buys ${G.en.a(p)}.`], "What a full bag! Yum!"],
    toys: ["{n}'s Toy Box", "{n} opens her toy box.", [p => `{n} finds ${G.en.a(p)}.`, p => `Here is ${G.en.a(p)}.`, p => `{n} plays with the ${p.en}.`], "Time to tidy up!"],
    sky: ["{n} Looks Up", "{n} looks up at the sky.", [p => `{n} sees ${G.en.a(p)}.`, p => `Look up! ${cap(G.en.a(p))}!`], "What a big sky!"],
    town: ["{n} in Town", "{n} walks around town.", [p => `{n} sees ${G.en.a(p)}.`, p => `Here is ${G.en.a(p)}.`, p => `Look! ${cap(G.en.a(p))}!`], "Home again!"],
    home: ["{n} at Home", "{n} looks around her house.", [p => `Here is ${G.en.a(p)}.`, p => `{n} sees ${G.en.a(p)}.`, p => `This is our ${p.en}.`], "Home, sweet home!"]
  },
  // French and Tamil stories: every text is [story language, English].
  fr: {
    zoo: [["{n} au zoo", "{n} at the Zoo"], ["{n} va au zoo.", "{n} goes to the zoo."], [p => [`{n} voit ${G.fr.un(p)}.`, `{n} sees ${G.en.a(p)}.`], p => [`Regarde, ${G.fr.un(p)} !`, `Look, ${G.en.a(p)}!`], p => [`Bonjour, ${G.fr.le(p)} !`, `Hello, ${p.en}!`]], ["Au revoir, le zoo ! À bientôt !", "Goodbye, zoo! See you soon!"]],
    farm: [["{n} à la ferme", "{n} on the Farm"], ["{n} visite la ferme.", "{n} visits the farm."], [p => [`{n} voit ${G.fr.un(p)}.`, `{n} sees ${G.en.a(p)}.`], p => [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`], p => [`Bonjour, ${G.fr.le(p)} !`, `Hello, ${p.en}!`]], ["Au revoir, la ferme !", "Goodbye, farm!"]],
    sea: [["{n} sous la mer", "{n} Under the Sea"], ["{n} plonge dans la mer. Plouf !", "{n} dives into the sea. Splash!"], [p => [`{n} voit ${G.fr.un(p)}.`, `{n} sees ${G.en.a(p)}.`], p => [`Regarde, ${G.fr.un(p)} !`, `Look, ${G.en.a(p)}!`], p => [`Bonjour, ${G.fr.le(p)} !`, `Hello, ${p.en}!`]], ["Il est temps de rentrer !", "Time to go home!"]],
    garden: [["Le jardin de {n}", "{n}'s Garden"], ["{n} va dans le jardin.", "{n} goes into the garden."], [p => [`{n} trouve ${G.fr.un(p)}.`, `{n} finds ${G.en.a(p)}.`], p => [`Regarde, ${G.fr.un(p)} !`, `Look, ${G.en.a(p)}!`], p => [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`]], ["Quel joli jardin !", "What a pretty garden!"]],
    market: [["{n} au marché", "{n} at the Market"], ["{n} va au marché avec maman.", "{n} goes to the market with Mom."], [p => [`{n} achète ${G.fr.un(p)}.`, `{n} buys ${G.en.a(p)}.`], p => [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`], p => [`Maman achète ${G.fr.un(p)}.`, `Mom buys ${G.en.a(p)}.`]], ["Le panier est plein ! Miam !", "The basket is full! Yum!"]],
    toys: [["Les jouets de {n}", "{n}'s Toys"], ["{n} ouvre son coffre à jouets.", "{n} opens her toy box."], [p => [`{n} trouve ${G.fr.un(p)}.`, `{n} finds ${G.en.a(p)}.`], p => [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`], p => [`{n} joue avec ${G.fr.le(p)}.`, `{n} plays with the ${p.en}.`]], ["C'est l'heure de ranger !", "Time to tidy up!"]],
    sky: [["{n} regarde le ciel", "{n} Looks at the Sky"], ["{n} regarde le ciel.", "{n} looks at the sky."], [p => [`{n} voit ${G.fr.un(p)}.`, `{n} sees ${G.en.a(p)}.`], p => [`Regarde, ${G.fr.un(p)} !`, `Look, ${G.en.a(p)}!`]], ["Que le ciel est grand !", "The sky is so big!"]],
    town: [["{n} en ville", "{n} in Town"], ["{n} se promène en ville.", "{n} walks around town."], [p => [`{n} voit ${G.fr.un(p)}.`, `{n} sees ${G.en.a(p)}.`], p => [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`], p => [`Regarde, ${G.fr.un(p)} !`, `Look, ${G.en.a(p)}!`]], ["On rentre à la maison !", "Let's go home!"]],
    home: [["{n} à la maison", "{n} at Home"], ["{n} fait le tour de la maison.", "{n} looks around the house."], [p => [`Voici ${G.fr.un(p)}.`, `Here is ${G.en.a(p)}.`], p => [`{n} voit ${G.fr.un(p)}.`, `{n} sees ${G.en.a(p)}.`]], ["On est bien chez soi !", "There's no place like home!"]]
  },
  ta: {
    zoo: [["மிருகக்காட்சிசாலையில் {n}", "{n} at the Zoo"], ["{n} மிருகக்காட்சிசாலைக்குப் போகிறாள்.", "{n} goes to the zoo."], [p => [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`], p => [`அங்கே ஒரு ${p.ta} இருக்கிறது.`, `There is ${G.en.a(p)} over there.`], p => [`வணக்கம், ${p.ta}!`, `Hello, ${p.en}!`]], ["டாட்டா! மீண்டும் வருவோம்.", "Bye-bye! We will come again."]],
    farm: [["பண்ணையில் {n}", "{n} on the Farm"], ["{n} பண்ணைக்குப் போகிறாள்.", "{n} goes to the farm."], [p => [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`], p => [`அங்கே ஒரு ${p.ta} இருக்கிறது.`, `There is ${G.en.a(p)} over there.`]], ["டாட்டா, பண்ணை!", "Bye-bye, farm!"]],
    sea: [["கடலுக்கு அடியில் {n}", "{n} Under the Sea"], ["{n} கடலுக்குள் நீந்துகிறாள்.", "{n} swims into the sea."], [p => [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`], p => [`அங்கே ஒரு ${p.ta} இருக்கிறது.`, `There is ${G.en.a(p)} over there.`]], ["வீட்டுக்குப் போகும் நேரம்!", "Time to go home!"]],
    garden: [["{n}வின் தோட்டம்", "{n}'s Garden"], ["{n} தோட்டத்துக்குப் போகிறாள்.", "{n} goes to the garden."], [p => [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`], p => [`அங்கே ஒரு ${p.ta} இருக்கிறது.`, `There is ${G.en.a(p)} over there.`]], ["எவ்வளவு அழகான தோட்டம்!", "What a beautiful garden!"]],
    market: [["சந்தையில் {n}", "{n} at the Market"], ["{n} அம்மாவுடன் சந்தைக்குப் போகிறாள்.", "{n} goes to the market with Mom."], [p => [`{n} ${p.ta} வாங்குகிறாள்.`, `{n} buys ${G.en.a(p)}.`], p => [`இதோ ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`அம்மா ${p.ta} வாங்குகிறார்.`, `Mom buys ${G.en.a(p)}.`]], ["பை நிறைந்துவிட்டது!", "The bag is full!"]],
    toys: [["{n}வின் பொம்மைப் பெட்டி", "{n}'s Toy Box"], ["{n} தன் பொம்மைப் பெட்டியைத் திறக்கிறாள்.", "{n} opens her toy box."], [p => [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`{n}விடம் ஒரு ${p.ta} இருக்கிறது.`, `{n} has ${G.en.a(p)}.`], p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`]], ["எல்லாவற்றையும் எடுத்து வைப்போம்!", "Let's put everything away!"]],
    sky: [["வானத்தைப் பார்!", "Look at the Sky!"], ["{n} வானத்தைப் பார்க்கிறாள்.", "{n} looks at the sky."], [p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`], p => [`வானத்தில் ஒரு ${p.ta}!`, `${cap(G.en.a(p))} in the sky!`]], ["வானம் எவ்வளவு பெரியது!", "How big the sky is!"]],
    town: [["ஊரில் {n}", "{n} in Town"], ["{n} ஊரைச் சுற்றிப் பார்க்கிறாள்.", "{n} looks around town."], [p => [`இதோ ஒரு ${p.ta}!`, `Here is ${G.en.a(p)}!`], p => [`பார்! ஒரு ${p.ta}!`, `Look! ${cap(G.en.a(p))}!`], p => [`அங்கே ஒரு ${p.ta} இருக்கிறது.`, `There is ${G.en.a(p)} over there.`]], ["வீட்டுக்குத் திரும்புவோம்!", "Let's go back home!"]],
    home: [["வீட்டில் {n}", "{n} at Home"], ["{n} வீட்டைச் சுற்றிப் பார்க்கிறாள்.", "{n} looks around the house."], [p => [`இதோ ஒரு ${p.ta}.`, `Here is ${G.en.a(p)}.`], p => [`இது நம் ${G.ta.join("வீட்டு", p.ta)}.`, `This is our house's ${p.en}.`]], ["வீடு எவ்வளவு இனிமையானது!", "Home is so sweet!"]]
  }
};
function themeItems(theme, l) {
  const set = theme.pool ? new Set(graphemes(theme.pool)) : null;
  return pictures[l].filter(p => set ? set.has(p.e) : theme.cats.includes(p.c));
}
function makeStory(l) {
  const theme = draw("theme:" + l, THEMES);
  const both = x => Array.isArray(x) ? x : [x, ""];
  const [title, intro, lines, end] = STORY[l][theme.id].map((x, i) => i === 2 ? x : both(x));
  const items = themeItems(theme, l);
  const chosen = [];
  for (let i = 0; i < 6 && chosen.length < Math.min(5, items.length); i++) {
    const p = draw("story:" + theme.id + ":" + l, items);
    if (!chosen.includes(p)) chosen.push(p);
  }
  const pages = [[theme.cover, ...intro]];
  chosen.forEach((p, i) => pages.push([p.e, ...both(lines[i % lines.length](p))]));
  pages.push(["👋", ...end]);
  return { level: 1, cover: theme.cover, title: title[0], enTitle: title[1], pages, generated: true };
}

/* ---------------------------------------------------------------- chrome */
function drawBackdrop() {
  const bd = $("#backdrop");
  bd.innerHTML = "";
  const spots = [[-4,4,18,-8],[40,-2,11,6],[62,30,22,-4],[-8,48,14,10],[30,62,24,-6],[70,78,12,8],[8,86,16,-3],[50,14,8,12]];
  spots.forEach(([x, y, size, r], i) => {
    const s = document.createElement("span");
    s.textContent = i % 3 === 1 ? NAMES.ta : CHILD;
    s.style.left = x + "vw"; s.style.top = y + "vh";
    s.style.fontSize = size + "vw";
    s.style.color = COLORS[i % COLORS.length];
    s.style.setProperty("--r", r + "deg");
    s.style.animationDelay = (-i * 2.3) + "s";
    bd.appendChild(s);
  });
}
function drawName() {
  const h = $("#name");
  h.innerHTML = "";
  h.setAttribute("aria-label", nm());
  graphemes(nm()).forEach((ch, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = ch;
    b.style.color = COLORS[i % COLORS.length];
    b.onclick = () => { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); say(ch); };
    h.appendChild(b);
  });
}
function renderChrome() {
  document.documentElement.lang = lang;
  drawName();
  $("#hello").textContent = t().hello(nm());
  $("#sub").textContent = t().sub;
  $("#footer").textContent = t().footer;
  $("#soundLabel").textContent = t().sound;
  $("#starCount").textContent = stars;
  document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.lang === lang));
  const nav = $("#tabs");
  nav.innerHTML = "";
  if (!tabVisible(tab)) tab = 0;
  t().tabs.forEach((label, i) => {
    if (!tabVisible(i)) return;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", i === tab);
    b.style.setProperty("--tab", TAB_COLORS[i]);
    b.innerHTML = `<span class="ic" aria-hidden="true">${TAB_ICONS[i]}</span><span>${esc(label)}</span>${showEn() ? `<small class="en">${esc(UI.en.tabs[i])}</small>` : ""}`;
    b.onclick = () => { tab = i; store.set("tab", tab); seqToken++; Speech.stop(); view = null; render(); };
    nav.appendChild(b);
  });
}
function addStar(n = 1) {
  stars += n;
  store.set("stars", stars);
  $("#starCount").textContent = stars;
}

/* ---------------------------------------------------------------- shared widgets */
const panel = $("#panel");
let view = null; // per-tab state

function levelChips(key, onPick) {
  const cur = store.get("level:" + key, 0);
  const box = document.createElement("div");
  box.className = "chips";
  t().levels.forEach((label, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = (i ? "⭐".repeat(i) + " " : "") + esc(label) + enUnder(UI.en.levels[i]);
    b.setAttribute("aria-pressed", i === cur);
    b.onclick = () => { store.set("level:" + key, i); onPick(i); };
    box.appendChild(b);
  });
  return box;
}

// Turns text into tappable words. Punctuation sticks to its neighbour.
function wordButtons(text, box) {
  const toks = [];
  for (const m of text.matchAll(/\S+/g)) {
    const s = m[0];
    if (/^[\p{P}\p{S}]+$/u.test(s) && toks.length && !/^[«“"(]+$/.test(s)) { toks[toks.length - 1].s += " " + s; continue; }
    if (toks.length && toks[toks.length - 1].open) { const o = toks.pop(); toks.push({ s: o.s + " " + s, i: o.i }); continue; }
    toks.push({ s, i: m.index, open: /^[«“"(]+$/.test(s) });
  }
  const her = nm();
  return toks.map(tok => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = tok.s;
    b.dataset.start = tok.i;
    if (clean(tok.s).startsWith(her)) b.classList.add("her");
    b.onclick = () => { b.classList.add("hi"); setTimeout(() => b.classList.remove("hi"), 700); say(clean(tok.s)); };
    box.appendChild(b);
    return b;
  });
}

// Reads text aloud and lights up each word as it is spoken.
function readAloud(text, spans, onend) {
  spans.forEach(s => s.classList.remove("hi"));
  let gotBoundary = false, timer = 0, i = 0;
  const light = k => { spans.forEach(s => s.classList.remove("hi")); if (spans[k]) spans[k].classList.add("hi"); };
  let started = false;
  const finish = () => { clearTimeout(timer); light(-1); onend && onend(started); };
  const step = () => {
    light(i);
    const len = graphemes(spans[i] ? spans[i].textContent : "").length;
    timer = setTimeout(() => { i++; if (i < spans.length) step(); }, 220 + len * 70 / (store.get("speed", 1) || 1));
  };
  say(text, {
    rate: 0.75,
    onstart: () => { started = true; setTimeout(() => { if (!gotBoundary) step(); }, 150); },
    onboundary: e => {
      if (e.name && e.name !== "word") return;
      gotBoundary = true; clearTimeout(timer);
      let k = spans.findIndex(s => +s.dataset.start > e.charIndex) - 1;
      if (k < 0) k = e.charIndex >= +spans[spans.length - 1].dataset.start ? spans.length - 1 : 0;
      light(k);
    },
    onend: finish
  });
}

/* ---------------------------------------------------------------- letters */
function viewLetters() {
  if (!view) view = { idx: 0 };
  const list = LETTERS[lang];
  const [L, word, pic] = list[view.idx];
  const gs = graphemes(word);
  const i = gs.findIndex(g => baseOf(g) === L);
  const wordHtml = i >= 0 ? esc(gs.slice(0, i).join("")) + "<b>" + esc(gs[i]) + "</b>" + esc(gs.slice(i + 1).join("")) : esc(word);
  const inName = new Set(graphemes(nm()).map(baseOf));
  const meaning = lang === "fr" ? LETTERS.frEn[view.idx] : "";
  panel.innerHTML = `
    <h2>${tt("lettersH")}</h2>
    <p class="hint">${tt("lettersHint", nm())}</p>
    <div class="letter-card">
      <div class="big-letter">${L}${L.toLowerCase() !== L ? `<small>${L.toLowerCase()}</small>` : ""}</div>
      <div>
        <div class="row"><span class="pic" aria-hidden="true">${safePic(pic, "")}</span><span class="word">${wordHtml}${meaning ? `<small class="gloss">${esc(meaning)}</small>` : ""}</span></div>
        ${inName.has(L) ? `<p class="note">💖 ${tt("inName")}</p>` : ""}
        <div class="row" style="margin-top:12px"><button class="btn" id="hearL" type="button">🔊 ${tt("hear")}</button></div>
      </div>
    </div>
    <div class="alpha" id="alpha"></div>`;
  const alpha = $("#alpha", panel);
  list.forEach(([l], idx) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = l;
    if (inName.has(l)) b.classList.add("in-name");
    if (idx === view.idx) b.classList.add("on");
    b.onclick = () => { view.idx = idx; viewLetters(); speakLetter(); };
    alpha.appendChild(b);
  });
  $("#hearL", panel).onclick = speakLetter;
}
// Just the word: "Apple", "Banane". No "A is for".
function speakLetter() {
  say(LETTERS[lang][view.idx][1]);
}

/* ---------------------------------------------------------------- words */
function viewWords() {
  const lvl = store.get("level:words", 0);
  const pools = wordsFor(lang);
  const pool = pools[lvl].length ? pools[lvl] : pools[0];
  const key = `words:${lang}:${lvl}`;
  if (!view || view.key !== key) view = { key, history: [draw(key, pool)], at: 0 };
  const item = view.history[view.at];
  panel.innerHTML = `
    <h2>${tt("wordsH")}</h2>
    <p class="hint">${tt("wordsHint")}</p>`;
  panel.appendChild(levelChips("words", () => { view = null; viewWords(); }));
  const stage = document.createElement("div");
  stage.className = "word-stage";
  stage.innerHTML = `
    <div class="pic${item.pic ? "" : " none"}" aria-hidden="true">${item.pic || "✏️"}</div>
    <div class="syll"></div>
    ${showEn() && item.gloss ? `<p class="gloss big">${esc(item.gloss)}</p>` : ""}
    <div class="btns">
      <button class="btn alt" id="prevW" type="button"${view.at ? "" : " disabled"}>◀ ${tt("prev")}</button>
      <button class="btn" id="hearW" type="button">🔊 ${tt("hear")}</button>
      <button class="btn go" id="nextW" type="button">${tt("next")} ▶</button>
    </div>
    <p class="meta">${esc(t().wordCount(Math.max(1, deckPos(key) - (view.history.length - 1 - view.at)), pool.length))}</p>`;
  panel.appendChild(stage);
  const box = $(".syll", stage);
  item.syl.forEach(s => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = s;
    b.onclick = () => { box.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on"); say(s, { rate: 0.6 }); };
    box.appendChild(b);
  });
  $("#hearW", stage).onclick = () => {
    box.querySelectorAll("button").forEach(x => x.classList.add("on"));
    say(item.w, { onend: () => box.querySelectorAll("button").forEach(x => x.classList.remove("on")) });
  };
  $("#nextW", stage).onclick = () => {
    if (view.at < view.history.length - 1) view.at++;
    else {
      view.history.push(draw(key, pool));
      if (view.history.length > 50) view.history.shift();
      view.at = view.history.length - 1;
      const n = store.get("wordsRead", 0) + 1;
      store.set("wordsRead", n);
      if (n % 10 === 0) addStar();
    }
    viewWords();
  };
  $("#prevW", stage).onclick = () => { if (view.at > 0) { view.at--; viewWords(); } };
}

/* ---------------------------------------------------------------- read */
function viewRead() {
  const pool = sentencesFor(lang);
  const key = "sent:" + lang;
  if (!view || view.key !== key) view = { key, item: draw(key, pool) };
  const item = view.item;
  const text = fillName(item.text);
  panel.innerHTML = `
    <h2>${tt("readH")}</h2>
    <p class="hint">${tt("readHint")}</p>
    <div class="sentence-card">
      <div class="pic" aria-hidden="true">${safePic(item.pic || "💬", "💬")}</div>
      <div class="words"></div>
      ${showEn() && item.en ? `<p class="gloss big">${esc(fillEn(item.en))}</p>` : ""}
      <div class="btns">
        <button class="btn" id="readMe" type="button">🔊 ${tt("readMe")}</button>
        <button class="btn go" id="nextS" type="button">${tt("next")} ▶</button>
      </div>
    </div>
    <p class="meta">${esc(t().sentCount(deckPos(key), pool.length))}</p>`;
  const spans = wordButtons(text, $(".words", panel));
  $("#readMe", panel).onclick = () => readAloud(text, spans);
  $("#nextS", panel).onclick = () => {
    Speech.stop();
    view.item = draw(key, pool);
    const n = store.get("sentencesRead", 0) + 1;
    store.set("sentencesRead", n);
    if (n % 5 === 0) addStar();
    viewRead();
  };
}

/* ---------------------------------------------------------------- play */
function viewPlay() {
  const mode = store.get("playMode", 0);
  if (!view || view.lang !== lang || view.mode !== mode) view = { lang, mode, round: 0, rounds: 5 };
  panel.innerHTML = `<h2>${tt("playH")}</h2>`;
  const chips = document.createElement("div");
  chips.className = "chips";
  t().modes.forEach((label, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.innerHTML = esc(label) + enUnder(UI.en.modes[i]);
    b.setAttribute("aria-pressed", i === mode);
    b.onclick = () => { store.set("playMode", i); view = null; Speech.stop(); viewPlay(); };
    chips.appendChild(b);
  });
  panel.appendChild(chips);
  const body = document.createElement("div");
  panel.appendChild(body);
  if (view.round >= view.rounds) {
    body.innerHTML = `<div class="celebrate">🏆 ${esc(t().done(nm()))}${enUnder(UI.en.done(CHILD))}</div>
      <div class="btns"><button class="btn" id="again" type="button">${tt("again")}</button></div>`;
    $("#again", body).onclick = () => { view = null; viewPlay(); };
    say(t().done(nm()));
    confetti();
    return;
  }
  [roundPicture, roundListen, roundMissing][mode](body);
}
function progressDots() {
  return `<div class="progress">${Array.from({ length: view.rounds }, (_, k) => `<i class="${k < view.round ? "done" : ""}"></i>`).join("")}</div>`;
}
function answer(btn, right, feedback, spoken, meaning) {
  if (right) {
    btn.classList.add("right");
    const word = $(".quiz-word", panel);
    if (showEn() && meaning && word && !$(".gloss", word)) word.insertAdjacentHTML("beforeend", `<small class="gloss">${esc(meaning)}</small>`);
    const msgs = t().good(nm()), m = pick(msgs);
    feedback.className = "feedback good"; feedback.textContent = "⭐ " + m;
    addStar();
    say((spoken ? spoken + "! " : "") + m);
    const v0 = view;
    setTimeout(() => { if (view !== v0) return; view.round++; view.cur = null; viewPlay(); }, 1800);
  } else {
    btn.classList.remove("wrong"); void btn.offsetWidth; btn.classList.add("wrong");
    feedback.className = "feedback bad"; feedback.textContent = t().bad;
    say(t().bad);
  }
}
function roundPicture(body) {
  const pool = pictures[lang];
  if (!view.cur) {
    const target = draw("pic:" + lang, pool);
    const others = shuffle(pool.filter(p => p.e !== target.e && p[lang] !== target[lang])).slice(0, 2);
    view.cur = { target, options: shuffle([target, ...others]) };
  }
  const { target, options } = view.cur;
  body.innerHTML = `<p class="hint">${tt("pictureHint")}</p>${progressDots()}
    <div class="quiz-word">${esc(target[lang])}</div>
    <div class="choices"></div><div class="feedback"></div>
    <div class="btns"><button class="btn alt" id="helpQ" type="button">🔊 ${tt("help")}</button></div>`;
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(p => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.e;
    b.onclick = () => { if (locked) return; const ok = p === target; if (ok) locked = true; answer(b, ok, fb, target[lang], target.en); };
    box.appendChild(b);
  });
  $("#helpQ", body).onclick = () => say(target[lang], { rate: 0.6 });
}
function roundListen(body) {
  const lvl = store.get("level:words", 0);
  const pools = wordsFor(lang);
  const pool = pools[lvl].length ? pools[lvl] : pools[0];
  if (!view.cur) {
    const target = draw("listen:" + lang + ":" + lvl, pool);
    const others = shuffle(pool.filter(w => w.w.toLowerCase() !== target.w.toLowerCase())).slice(0, 2);
    view.cur = { target, options: shuffle([target, ...others]) };
    setTimeout(() => say(target.w, { rate: 0.7 }), 250);
  }
  const { target, options } = view.cur;
  body.innerHTML = `<p class="hint">${tt("listenHint")}</p>${progressDots()}
    <button class="big-ear" id="ear" type="button" aria-label="${esc(t().hear)}">👂🔊</button>
    <div class="quiz-word" style="font-size:1.4rem;min-height:1em"></div>
    <div class="choices text"></div><div class="feedback"></div>`;
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(w => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = w.w;
    b.onclick = () => { if (locked) return; const ok = w === target; if (ok) locked = true; answer(b, ok, fb, target.w, target.gloss); };
    box.appendChild(b);
  });
  $("#ear", body).onclick = () => say(target.w, { rate: 0.7 });
}
function roundMissing(body) {
  const pool = pictures[lang].filter(p => graphemes(p[lang]).length >= 3 && !/[\s-]/.test(p[lang]));
  if (!view.cur) {
    const target = draw("miss:" + lang, pool);
    const letters = graphemes(target[lang]);
    const spots = letters.map((g, i) => i).filter(i => /\p{L}/u.test(letters[i]));
    const at = pick(spots);
    const right = letters[at].toLowerCase();
    const alphabet = lang === "ta"
      ? [...new Set(pictures.ta.flatMap(p => graphemes(p.ta)))].filter(g => /\p{L}/u.test(g))
      : [..."abcdefghijklmnopqrstuvwxyz"];
    const wrong = shuffle(alphabet.filter(g => g.toLowerCase() !== right)).slice(0, 2);
    view.cur = { target, letters, at, right, options: shuffle([right, ...wrong]) };
  }
  const { target, letters, at, right, options } = view.cur;
  const shown = letters.map((g, i) => i === at ? `<span class="blank">?</span>` : esc(g)).join("");
  body.innerHTML = `<p class="hint">${tt("missingHint")}</p>${progressDots()}
    <div class="pic" style="text-align:center;font-size:4.5rem" aria-hidden="true">${target.e}</div>
    <div class="quiz-word">${shown}</div>
    <div class="choices text"></div><div class="feedback"></div>
    <div class="btns"><button class="btn alt" id="helpQ" type="button">🔊 ${tt("help")}</button></div>`;
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(g => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = g;
    b.onclick = () => {
      if (locked) return;
      const ok = g === right;
      if (ok) { locked = true; $(".blank", body).textContent = letters[at]; }
      answer(b, ok, fb, target[lang], target.en);
    };
    box.appendChild(b);
  });
  $("#helpQ", body).onclick = () => say(target[lang], { rate: 0.6 });
}

/* ---------------------------------------------------------------- books */
const LIBRARIES = [
  { name: "StoryWeaver", url: "https://storyweaver.org.in/", langs: ["en", "fr", "ta"],
    note: { en: "Thousands of free picture books in English, French and Tamil, sorted by reading level.",
            fr: "Des milliers d'albums gratuits en anglais, français et tamoul, classés par niveau.",
            ta: "ஆங்கிலம், பிரெஞ்சு, தமிழில் ஆயிரக்கணக்கான இலவசப் படக்கதைப் புத்தகங்கள், நிலை வாரியாக." } },
  { name: "Unite for Literacy", url: "https://www.uniteforliteracy.com/", langs: ["en", "fr"],
    note: { en: "Free picture books with read-aloud narration.", fr: "Albums gratuits avec narration audio.", ta: "" } },
  { name: "Starfall", url: "https://www.starfall.com/", langs: ["en"],
    note: { en: "Phonics games and first stories for learning to read.", fr: "", ta: "" } },
  { name: "Il était une histoire", url: "https://www.iletaitunehistoire.fr/", langs: ["fr"],
    note: { en: "", fr: "Contes et histoires pour enfants, à lire et à écouter.", ta: "" } },
  { name: "African Storybook", url: "https://www.africanstorybook.org/", langs: ["en", "fr"],
    note: { en: "Free illustrated stories for young readers.", fr: "Histoires illustrées gratuites pour jeunes lecteurs.", ta: "" } }
];
function booksFor(l) {
  return (BOOKS[l] || []).map(([level, cover, title, pages, enTitle], i) => ({ id: l + ":" + i, level, cover, title, pages, enTitle: enTitle || "" }));
}
function viewBooks() {
  if (view && view.book) return viewReader();
  const lvl = store.get("level:books", 0);
  const list = booksFor(lang).filter(b => !lvl || b.level === lvl);
  const read = store.get("booksRead", {});
  panel.innerHTML = `<h2>${tt("booksH")}</h2><p class="hint">${tt("booksHint")}</p>`;
  panel.appendChild(levelChips("books", () => { view = null; viewBooks(); }));
  const shelf = document.createElement("div");
  shelf.className = "shelf";
  const machine = document.createElement("button");
  machine.type = "button";
  machine.className = "book machine";
  machine.innerHTML = `<span class="cover" aria-hidden="true">🎲</span><span class="t">${tt("machine")}</span><span class="lv">${tt("machineSub")}</span>`;
  machine.onclick = () => { view = { book: makeStory(lang), page: 0 }; viewReader(); };
  shelf.appendChild(machine);
  list.forEach(b => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "book";
    el.innerHTML = `${read[b.id] ? `<span class="done">✓</span>` : ""}<span class="cover" aria-hidden="true">${safePic(b.cover)}</span>
      <span class="t">${esc(fillName(b.title))}${enUnder(fillEn(b.enTitle))}</span><span class="lv">${"⭐".repeat(b.level)} ${esc(t().level(b.level))}</span>`;
    el.onclick = () => { view = { book: b, page: 0 }; viewReader(); };
    shelf.appendChild(el);
  });
  panel.appendChild(shelf);
  const libs = LIBRARIES.filter(x => x.langs.includes(lang));
  const more = document.createElement("div");
  more.innerHTML = `<p class="section-title">${tt("more")}</p><p class="hint">${tt("moreHint")}</p>
    <div class="links">${libs.map(x => `<a href="${x.url}" target="_blank" rel="noopener"><b>${esc(x.name)} ↗</b><span>${esc(x.note[lang] || x.note.en)}</span></a>`).join("")}</div>`;
  panel.appendChild(more);
}
function viewReader() {
  const b = view.book;
  const total = b.pages.length;
  panel.innerHTML = `
    <div class="reader-top">
      <button class="btn alt" id="shelfBtn" type="button">◀ ${tt("backToShelf")}</button>
      <span class="page-num">${view.page < total ? esc(t().page(view.page + 1, total)) : ""}</span>
    </div>
    <h2>${esc(fillName(b.title))}${enUnder(fillEn(b.enTitle || ""))}</h2>`;
  $("#shelfBtn", panel).onclick = () => { Speech.stop(); view = null; viewBooks(); };
  const card = document.createElement("div");
  card.className = "sentence-card page-card";
  panel.appendChild(card);
  if (view.page >= total) {
    card.innerHTML = `<div class="pic" aria-hidden="true">🌟</div><div class="the-end">${tt("theEnd")}</div>
      <div class="btns"><button class="btn alt" id="again" type="button">${tt("readAgain")}</button>
      <button class="btn go" id="shelf2" type="button">${tt("backToShelf")}</button></div>`;
    $("#again", card).onclick = () => { view.page = 0; view.auto = false; viewReader(); };
    $("#shelf2", card).onclick = () => { view = null; viewBooks(); };
    if (!view.finished) {
      view.finished = true;
      addStar(2);
      if (!b.generated) { const read = store.get("booksRead", {}); read[b.id] = 1; store.set("booksRead", read); }
      confetti();
      say(t().theEnd + "! " + t().good(nm())[0]);
    }
    return;
  }
  const [pic, raw, en] = b.pages[view.page];
  const text = fillName(raw);
  card.innerHTML = `<div class="pic" aria-hidden="true">${safePic(pic, safePic(b.cover))}</div><div class="words"></div>
    ${showEn() && en ? `<p class="gloss big">${esc(fillEn(en))}</p>` : ""}
    <div class="btns">
      <button class="btn alt" id="prevP" type="button"${view.page ? "" : " disabled"}>◀</button>
      <button class="btn" id="readP" type="button">🔊 ${tt("readMe")}</button>
      <button class="btn go" id="nextP" type="button">▶</button>
    </div>
    <div class="btns"><button class="btn alt" id="readAll" type="button">📖 ${tt("readAll")}</button></div>`;
  const spans = wordButtons(text, $(".words", card));
  const go = d => { Speech.stop(); view.auto = false; view.page = Math.max(0, view.page + d); viewReader(); };
  $("#prevP", card).onclick = () => go(-1);
  $("#nextP", card).onclick = () => go(1);
  $("#readP", card).onclick = () => { view.auto = false; readAloud(text, spans); };
  $("#readAll", card).onclick = () => { view.auto = true; readAloud(text, spans, autoNext); };
  if (view.auto) readAloud(text, spans, autoNext);
  function autoNext(spoke) {
    if (!view || !view.auto || view.book !== b) return;
    if (!spoke) { view.auto = false; return; }
    setTimeout(() => { if (view && view.auto && view.book === b) { view.page++; viewReader(); } }, 700);
  }
}

/* ---------------------------------------------------------------- numbers in words */
const EN_ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const EN_TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
const FR_ONES = ["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix","onze","douze","treize","quatorze","quinze","seize","dix-sept","dix-huit","dix-neuf"];
const FR_TENS = ["","","vingt","trente","quarante","cinquante","soixante"];
const TA_ONES = ["பூஜ்ஜியம்","ஒன்று","இரண்டு","மூன்று","நான்கு","ஐந்து","ஆறு","ஏழு","எட்டு","ஒன்பது","பத்து","பதினொன்று","பன்னிரண்டு","பதின்மூன்று","பதினான்கு","பதினைந்து","பதினாறு","பதினேழு","பதினெட்டு","பத்தொன்பது"];
const TA_TENS = ["","","இருபது","முப்பது","நாற்பது","ஐம்பது","அறுபது","எழுபது","எண்பது","தொண்ணூறு"];
const TA_STEMS = ["","","இருபத்","முப்பத்","நாற்பத்","ஐம்பத்","அறுபத்","எழுபத்","எண்பத்","தொண்ணூற்"];
const TA_VOWEL_SIGN = { "ஒ": "ொ", "இ": "ி", "ஐ": "ை", "ஆ": "ா", "ஏ": "ே", "எ": "ெ" };
function numWord(n, l = lang) {
  if (l === "en") {
    if (n < 20) return EN_ONES[n];
    if (n === 100) return "one hundred";
    return EN_TENS[n / 10 | 0] + (n % 10 ? "-" + EN_ONES[n % 10] : "");
  }
  if (l === "fr") {
    if (n < 20) return FR_ONES[n];
    if (n === 100) return "cent";
    const t = n / 10 | 0, u = n % 10;
    if (t === 7) return "soixante" + (u === 1 ? " et onze" : "-" + FR_ONES[10 + u]);
    if (t === 8) return u ? "quatre-vingt-" + FR_ONES[u] : "quatre-vingts";
    if (t === 9) return "quatre-vingt-" + FR_ONES[10 + u];
    return FR_TENS[t] + (u === 1 ? " et un" : u ? "-" + FR_ONES[u] : "");
  }
  if (n < 20) return TA_ONES[n];
  if (n === 100) return "நூறு";
  const t = n / 10 | 0, u = n % 10;
  if (!u) return TA_TENS[t];
  // இருபத் + ஒன்று = இருபத்தொன்று, இருபத் + மூன்று = இருபத்துமூன்று
  const stem = TA_STEMS[t], c = stem[stem.length - 2], unit = TA_ONES[u];
  const sign = TA_VOWEL_SIGN[unit[0]];
  return sign ? stem + c + sign + unit.slice(1) : stem + c + "ு" + unit;
}
const taDigits = n => String(n).replace(/\d/g, d => "௦௧௨௩௪௫௬௭௮௯"[d]);

/* ---------------------------------------------------------------- extra text */
Object.assign(UI.en, {
  mathH: "Math", grade: g => `Grade ${g}`, question: "Hear it",
  cnH: "Colors and numbers", cnModes: ["Colors", "Numbers 0 to 20", "Numbers to 100", "Color game", "Number game"],
  tapHear: "Tap any one to hear it.", findColor: "Tap this color:", findNumber: "Tap this number:"
});
Object.assign(UI.fr, {
  mathH: "Maths", grade: g => `Niveau ${g}`, question: "Écouter",
  cnH: "Couleurs et nombres", cnModes: ["Couleurs", "Nombres de 0 à 20", "Nombres jusqu'à 100", "Jeu des couleurs", "Jeu des nombres"],
  tapHear: "Touche pour écouter.", findColor: "Touche cette couleur :", findNumber: "Touche ce nombre :"
});
Object.assign(UI.ta, {
  mathH: "கணக்கு", grade: g => `${g}ஆம் வகுப்பு`, question: "கேள்",
  cnH: "நிறங்களும் எண்களும்", cnModes: ["நிறங்கள்", "எண்கள் 0 முதல் 20", "100 வரை எண்கள்", "நிற விளையாட்டு", "எண் விளையாட்டு"],
  tapHear: "எதையும் தொட்டால் கேட்கலாம்.", findColor: "இந்த நிறத்தைத் தொடு:", findNumber: "இந்த எண்ணைத் தொடு:"
});

/* ---------------------------------------------------------------- Tamil letters */
const TA_VOWELS = [["அ","a"],["ஆ","aa"],["இ","i"],["ஈ","ii"],["உ","u"],["ஊ","uu"],["எ","e"],["ஏ","ee"],["ஐ","ai"],["ஒ","o"],["ஓ","oo"],["ஔ","au"]];
const TA_SIGNS = ["", "ா", "ி", "ீ", "ு", "ூ", "ெ", "ே", "ை", "ொ", "ோ", "ௌ"];
const TA_CONS = [["க","k"],["ங","ng"],["ச","ch"],["ஞ","nj"],["ட","ṭ"],["ண","ṇ"],["த","th"],["ந","n"],["ப","p"],["ம","m"],["ய","y"],["ர","r"],["ல","l"],["வ","v"],["ழ","zh"],["ள","ḷ"],["ற","ṟ"],["ன","ṉ"]];
const TA_GRANTHA = [["ஜ","j"],["ஷ","sh"],["ஸ","s"],["ஹ","h"],["க்ஷ","ksh"]];
const TA_LETTER_EN = { "அம்மா": "mom", "ஆடு": "goat", "இலை": "leaf", "ஈ": "fly", "உப்பு": "salt", "ஊசி": "needle", "எலி": "mouse", "ஏணி": "ladder", "ஐந்து": "five", "ஒட்டகம்": "camel", "ஓடம்": "boat", "ஔவையார்": "Avvaiyar (a Tamil poet)", "கப்பல்": "ship", "சங்கு": "conch shell", "சட்டை": "shirt", "ஞாயிறு": "sun", "பட்டம்": "kite", "மணி": "bell", "தக்காளி": "tomato", "நண்டு": "crab", "பந்து": "ball", "மரம்": "tree", "யானை": "elephant", "ரோஜா": "rose", "பலூன்": "balloon", "வாத்து": "duck", "வாழைப்பழம்": "banana", "பள்ளி": "school", "பறவை": "bird", "மீன்": "fish", "ஜன்னல்": "window", "ஸ்கூட்டர்": "scooter", "ஹெலிகாப்டர்": "helicopter" };
const TA_ALL = [
  ...TA_VOWELS.map(([l, r]) => ({ l, r, kind: "uyir" })),
  { l: "ஃ", r: "akh", kind: "aytham" },
  ...TA_CONS.map(([c, r]) => ({ l: c + "்", r, kind: "mei", base: c })),
  ...TA_CONS.flatMap(([c, cr]) => TA_VOWELS.map(([v, vr], i) => ({ l: c + TA_SIGNS[i], r: cr + vr, kind: "uyirmei", base: c, v })))
];
let taHeard = new Set(store.get("taHeard", []));
function taSay(item, opts) {
  if (TA_ALL.includes(item) && !taHeard.has(item.l)) { taHeard.add(item.l); store.set("taHeard", [...taHeard]); }
  // Dead consonants are recited with a lead-in vowel, the way children learn them: க் = "இக்".
  const text = item.kind === "mei" ? "இ" + item.l : item.kind === "aytham" ? "அஃகு" : item.l;
  say(text, { lang: "ta", rate: 0.7, ...opts });
}
let seqToken = 0;
function saySequence(items, onEach, onDone) {
  const token = ++seqToken;
  const step = i => {
    if (token !== seqToken) return;
    if (i >= items.length) { onDone && onDone(); return; }
    onEach(i);
    taSay(items[i], { onend: () => setTimeout(() => step(i + 1), 180) });
  };
  step(0);
}
function taTile(item, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ta-tile" + (taHeard.has(item.l) ? " heard" : "") + extra;
  b.innerHTML = `<span class="tl">${esc(item.l)}</span><span class="tr">${esc(item.r)}</span>`;
  b.onclick = () => { taSay(item); b.classList.add("heard", "on"); setTimeout(() => b.classList.remove("on"), 600); showTaCard(item); updateTaMeter(); };
  return b;
}
function showTaCard(item) {
  const card = $("#taCard", panel);
  if (!card) return;
  const ex = LETTERS.ta.find(([L]) => L === item.l || L === item.base);
  const how = item.kind === "uyirmei" ? `${item.base}் + ${item.v} = ${item.l}` : item.kind === "mei" ? `${item.base} + ் = ${item.l}` : "";
  card.innerHTML = `<div class="big-letter">${esc(item.l)}</div>
    <div><div class="roman">${esc(item.r)}</div>
    ${how ? `<div class="how">${esc(how)}</div>` : ""}
    ${ex && item.kind !== "uyirmei" ? `<div class="row"><span class="pic" aria-hidden="true">${safePic(ex[2], "")}</span><span class="word">${esc(ex[1])}<small class="gloss">${esc(TA_LETTER_EN[ex[1]] || "")}</small></span></div>` : ""}</div>`;
  card.hidden = false;
}
function updateTaMeter() {
  const m = $("#taMeter", panel);
  if (!m) return;
  const n = TA_ALL.filter(x => taHeard.has(x.l)).length;
  m.innerHTML = `<div class="meter"><i style="width:${(n / TA_ALL.length * 100).toFixed(1)}%"></i></div>
    <p class="meta">நீ ${n} / ${TA_ALL.length} எழுத்துகளைக் கேட்டிருக்கிறாய்<small class="en">You have heard ${n} of ${TA_ALL.length} letters</small></p>`;
}
const TA_MODES = [["உயிர்", "Vowels · 12"], ["மெய்", "Consonants · 18"], ["உயிர்மெய்", "Letter families · 216"], ["அட்டவணை", "Full chart · 247"], ["கிரந்தம்", "Extra letters"], ["விளையாட்டு", "Letter game"]];
function viewTamilLetters() {
  const mode = store.get("taMode", 0);
  if (!view || view.kind !== "ta" || view.mode !== mode) view = { kind: "ta", mode, row: store.get("taRow", 0), round: 0, rounds: 10 };
  seqToken++;
  panel.innerHTML = `<h2>தமிழ் எழுத்துகள்<small class="en">Tamil letters: 12 vowels + 18 consonants + 216 letter families + ஃ = 247</small></h2>
    <p class="hint">ஒரு எழுத்தைத் தொட்டுக் கேள்.<small class="en">Tap a letter to hear it. The English letters under each one show how to say it.</small></p>`;
  const chips = document.createElement("div");
  chips.className = "chips";
  TA_MODES.forEach(([ta, en], i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `${esc(ta)}<small class="en">${esc(en)}</small>`;
    b.setAttribute("aria-pressed", i === mode);
    b.onclick = () => { store.set("taMode", i); view = null; Speech.stop(); viewTamilLetters(); };
    chips.appendChild(b);
  });
  panel.appendChild(chips);
  panel.insertAdjacentHTML("beforeend", `<div id="taMeter"></div><div class="letter-card" id="taCard" hidden></div>`);
  updateTaMeter();
  const body = document.createElement("div");
  panel.appendChild(body);
  [taVowels, taConsonants, taFamilies, taChart, taGrantha, taGame][mode](body);
}
function taGrid(body, items, cls = "") {
  const g = document.createElement("div");
  g.className = "ta-grid " + cls;
  items.forEach(it => g.appendChild(taTile(it)));
  body.appendChild(g);
  return g;
}
function taVowels(body) {
  body.insertAdjacentHTML("beforeend", `<p class="section-title">உயிர் எழுத்துகள்<small class="en">Vowels: say them by themselves</small></p>`);
  taGrid(body, TA_ALL.filter(x => x.kind === "uyir" || x.kind === "aytham"));
  readAllButton(body, TA_ALL.filter(x => x.kind === "uyir"));
}
function taConsonants(body) {
  body.insertAdjacentHTML("beforeend", `<p class="section-title">மெய் எழுத்துகள்<small class="en">Consonants: the dot on top (்) means "no vowel". We say க் as "ik".</small></p>`);
  taGrid(body, TA_ALL.filter(x => x.kind === "mei"));
  readAllButton(body, TA_ALL.filter(x => x.kind === "mei"));
}
function readAllButton(body, items) {
  const box = document.createElement("div");
  box.className = "btns";
  box.style.marginTop = "14px";
  box.innerHTML = `<button class="btn" type="button">🔊 எல்லாவற்றையும் படி<small class="en">Read them all</small></button>`;
  box.firstElementChild.onclick = () => {
    const tiles = [...body.querySelectorAll(".ta-tile")];
    saySequence(items, i => { tiles.forEach(t => t.classList.remove("on")); const tile = tiles.find(t => $(".tl", t).textContent === items[i].l); tile && tile.classList.add("on", "heard"); showTaCard(items[i]); updateTaMeter(); },
      () => tiles.forEach(t => t.classList.remove("on")));
  };
  body.appendChild(box);
}
function taFamilies(body) {
  const row = Math.min(TA_CONS.length - 1, view.row);
  const [c, cr] = TA_CONS[row];
  const pick = document.createElement("div");
  pick.className = "chips cons-pick";
  TA_CONS.forEach(([cc], i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = cc;
    b.setAttribute("aria-pressed", i === row);
    b.onclick = () => { view.row = i; store.set("taRow", i); seqToken++; body.innerHTML = ""; taFamilies(body); };
    pick.appendChild(b);
  });
  body.appendChild(pick);
  body.insertAdjacentHTML("beforeend", `<p class="section-title">${esc(c)}் + உயிர் = ${esc(c)} வரிசை<small class="en">The ${esc(cr)} family: ${esc(c)}் joined with each vowel (${row + 1} of 18)</small></p>`);
  const items = TA_ALL.filter(x => x.kind === "uyirmei" && x.base === c);
  taGrid(body, items, "family");
  const nav = document.createElement("div");
  nav.className = "btns";
  nav.style.marginTop = "14px";
  nav.innerHTML = `<button class="btn alt" type="button" data-d="-1"${row ? "" : " disabled"}>◀</button>
    <button class="btn" type="button" data-read>🔊 வரிசையைப் படி<small class="en">Read the row</small></button>
    <button class="btn go" type="button" data-d="1"${row < TA_CONS.length - 1 ? "" : " disabled"}>▶</button>`;
  nav.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { view.row = row + +b.dataset.d; store.set("taRow", view.row); seqToken++; body.innerHTML = ""; taFamilies(body); });
  $("[data-read]", nav).onclick = () => {
    const tiles = [...body.querySelectorAll(".ta-grid .ta-tile")];
    saySequence(items, i => { tiles.forEach(t => t.classList.remove("on")); tiles[i].classList.add("on", "heard"); showTaCard(items[i]); updateTaMeter(); },
      () => tiles.forEach(t => t.classList.remove("on")));
  };
  body.appendChild(nav);
}
function taTable(body, cons) {
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const table = document.createElement("table");
  table.className = "ta-chart";
  const head = document.createElement("tr");
  head.innerHTML = `<th></th>` + TA_VOWELS.map(([v, r]) => `<th><span class="tl">${v}</span><span class="tr">${r}</span></th>`).join("");
  table.appendChild(head);
  cons.forEach(([c, cr]) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.innerHTML = `<span class="tl">${c}்</span><span class="tr">${cr}</span>`;
    tr.appendChild(th);
    TA_VOWELS.forEach(([v, vr], i) => {
      const item = TA_ALL.find(x => x.kind === "uyirmei" && x.base === c && x.v === v) || { l: c + TA_SIGNS[i], r: cr + vr, kind: "grantha", base: c, v };
      const td = document.createElement("td");
      td.appendChild(taTile(item));
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  body.appendChild(wrap);
}
function taChart(body) {
  body.insertAdjacentHTML("beforeend", `<p class="section-title">உயிர்மெய் அட்டவணை<small class="en">The full chart: each row is a consonant, each column is a vowel. Slide sideways to see it all.</small></p>`);
  taTable(body, TA_CONS);
}
function taGrantha(body) {
  body.insertAdjacentHTML("beforeend", `<p class="section-title">கிரந்த எழுத்துகள்<small class="en">Extra letters used in words from other languages, like ஜன்னல் (window) and ஹெலிகாப்டர் (helicopter)</small></p>`);
  taTable(body, TA_GRANTHA);
  taGrid(body, [{ l: "ஸ்ரீ", r: "shrii", kind: "grantha" }]);
}
function taGame(body) {
  if (view.round >= view.rounds) {
    body.innerHTML = `<div class="celebrate">🏆 ${esc(UI.ta.done(nm()))}<small class="en">${esc(UI.en.done(CHILD))}</small></div>
      <div class="btns"><button class="btn" type="button">${esc(UI.ta.again)}<small class="en">${esc(UI.en.again)}</small></button></div>`;
    $("button", body).onclick = () => { view = null; viewTamilLetters(); };
    confetti();
    return;
  }
  if (!view.cur) {
    const target = draw("taLetter", TA_ALL);
    const same = TA_ALL.filter(x => x !== target && (x.base === target.base || x.v === target.v || x.kind === target.kind));
    view.cur = { target, options: shuffle([target, ...shuffle(same).slice(0, 3)]) };
    setTimeout(() => taSay(target), 250);
  }
  const { target, options } = view.cur;
  body.innerHTML = `<p class="hint">எந்த எழுத்தைக் கேட்டாய்?<small class="en">Which letter did you hear?</small></p>${progressDots()}
    <button class="big-ear" type="button" aria-label="Hear it again">👂🔊</button>
    <div class="choices"></div><div class="feedback"></div>`;
  $(".big-ear", body).onclick = () => taSay(target);
  const box = $(".choices", body), fb = $(".feedback", body);
  box.style.gridTemplateColumns = "repeat(2, 1fr)";
  let locked = false;
  options.forEach(o => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span class="tl">${esc(o.l)}</span>`;
    b.onclick = () => {
      if (locked) return;
      if (o === target) {
        locked = true;
        b.classList.add("right");
        b.insertAdjacentHTML("beforeend", `<span class="tr">${esc(o.r)}</span>`);
        fb.className = "feedback good"; fb.innerHTML = "⭐ " + esc(pick(UI.ta.good(nm())));
        addStar();
        const v0 = view;
        setTimeout(() => { if (view !== v0) return; view.round++; view.cur = null; body.innerHTML = ""; taGame(body); }, 1600);
      } else {
        b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong");
        fb.className = "feedback bad"; fb.innerHTML = esc(UI.ta.bad) + `<small class="en">${esc(UI.en.bad)}</small>`;
        taSay(target);
      }
    };
    box.appendChild(b);
  });
}

/* ---------------------------------------------------------------- math */
const MATH_TOPICS = [
  { id: "count", g: 1, icon: "🔢", n: ["Count", "Compter", "எண்ணுதல்"] },
  { id: "add10", g: 1, icon: "➕", n: ["Add to 10", "Additions jusqu'à 10", "10 வரை கூட்டல்"] },
  { id: "sub10", g: 1, icon: "➖", n: ["Take away to 10", "Soustractions jusqu'à 10", "10 வரை கழித்தல்"] },
  { id: "add20", g: 1, icon: "➕", n: ["Add to 20", "Additions jusqu'à 20", "20 வரை கூட்டல்"] },
  { id: "sub20", g: 1, icon: "➖", n: ["Take away to 20", "Soustractions jusqu'à 20", "20 வரை கழித்தல்"] },
  { id: "compare", g: 1, icon: "⚖️", n: ["Bigger number", "Le plus grand", "பெரிய எண்"] },
  { id: "next", g: 1, icon: "⏭️", n: ["What comes next", "Et après ?", "அடுத்த எண்"] },
  { id: "shapes", g: 1, icon: "🔺", n: ["Shapes", "Les formes", "வடிவங்கள்"] },
  { id: "add100", g: 2, icon: "➕", n: ["Add to 100", "Additions jusqu'à 100", "100 வரை கூட்டல்"] },
  { id: "sub100", g: 2, icon: "➖", n: ["Take away to 100", "Soustractions jusqu'à 100", "100 வரை கழித்தல்"] },
  { id: "place", g: 2, icon: "🧱", n: ["Tens and ones", "Dizaines et unités", "பத்துகளும் ஒன்றுகளும்"] },
  { id: "missing", g: 2, icon: "❓", n: ["Missing number", "Nombre manquant", "விடுபட்ட எண்"] },
  { id: "skip", g: 2, icon: "🐸", n: ["Skip counting", "Compter par bonds", "தாவி எண்ணுதல்"] },
  { id: "evenodd", g: 2, icon: "👯", n: ["Even or odd", "Pair ou impair", "இரட்டை / ஒற்றை"] },
  { id: "time", g: 2, icon: "🕒", n: ["Tell the time", "Lire l'heure", "நேரம் பார்"] }
];
const LI = { en: 0, fr: 1, ta: 2 };
const MQ = {
  howMany: ["How many?", "Combien ?", "எத்தனை?"],
  solve: ["What is the answer?", "Quelle est la réponse ?", "விடை என்ன?"],
  bigger: ["Which number is bigger?", "Quel nombre est le plus grand ?", "எந்த எண் பெரியது?"],
  after: [n => `What comes after ${n}?`, n => `Quel nombre vient après ${n} ?`, n => `${n}க்கு அடுத்த எண் எது?`],
  shape: [s => `Which one is the ${s}?`, s => `Trouve la forme : ${s}`, s => `${s} எது?`],
  place: ["What number is this?", "Quel est ce nombre ?", "இது என்ன எண்?"],
  missing: ["Find the missing number.", "Trouve le nombre qui manque.", "விடுபட்ட எண்ணைக் கண்டுபிடி."],
  skip: ["What comes next?", "Quel nombre vient ensuite ?", "அடுத்து என்ன வரும்?"],
  evenOdd: [n => `Is ${n} even or odd?`, n => `${n} est-il pair ou impair ?`, n => `${n} இரட்டை எண்ணா, ஒற்றை எண்ணா?`],
  time: ["What time is it?", "Quelle heure est-il ?", "மணி என்ன?"],
  even: ["even", "pair", "இரட்டை"], odd: ["odd", "impair", "ஒற்றை"],
  plus: ["plus", "plus", "கூட்டல்"], minus: ["minus", "moins", "கழித்தல்"],
  tens: ["tens", "dizaines", "பத்துகள்"], ones: ["ones", "unités", "ஒன்றுகள்"]
};
const mq = (key, ...a) => { const v = MQ[key][LI[lang]]; return typeof v === "function" ? v(...a) : v; };
const mqEn = (key, ...a) => { const v = MQ[key][0]; return typeof v === "function" ? v(...a) : v; };
const SHAPES = {
  circle: { n: ["circle", "cercle", "வட்டம்"], svg: `<circle cx="50" cy="50" r="38" fill="#e84a7f"/>` },
  square: { n: ["square", "carré", "சதுரம்"], svg: `<rect x="14" y="14" width="72" height="72" rx="4" fill="#2f8fd8"/>` },
  triangle: { n: ["triangle", "triangle", "முக்கோணம்"], svg: `<polygon points="50,10 90,86 10,86" fill="#3fa66b"/>` },
  rectangle: { n: ["rectangle", "rectangle", "செவ்வகம்"], svg: `<rect x="6" y="28" width="88" height="44" rx="4" fill="#f28a2e"/>` },
  star: { n: ["star", "étoile", "நட்சத்திரம்"], svg: `<polygon points="50,6 61,38 95,38 67,58 78,92 50,71 22,92 33,58 5,38 39,38" fill="#e0a800"/>` },
  heart: { n: ["heart", "cœur", "இதயம்"], svg: `<path d="M50 88 C20 66 6 48 16 30 C26 12 46 16 50 32 C54 16 74 12 84 30 C94 48 80 66 50 88 Z" fill="#d92d4f"/>` },
  oval: { n: ["oval", "ovale", "நீள்வட்டம்"], svg: `<ellipse cx="50" cy="50" rx="44" ry="28" fill="#8a5cc7"/>` },
  diamond: { n: ["diamond", "losange", "சாய்சதுரம்"], svg: `<polygon points="50,6 88,50 50,94 12,50" fill="#0f8f84"/>` }
};
const shapeSvg = id => `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">${SHAPES[id].svg}</svg>`;
const rand = (a, b) => a + (Math.random() * (b - a + 1) | 0);
function nearOptions(ans, spread, min = 0, max = 200, count = 4) {
  const set = new Set([ans]);
  let guard = 0;
  while (set.size < count && guard++ < 200) {
    const v = ans + rand(-spread, spread);
    if (v >= min && v <= max) set.add(v);
  }
  return shuffle([...set]);
}
const OBJECTS = ["🍎", "⭐", "🐟", "🎈", "🌸", "🐥", "⚽", "🍓", "🚗", "🍪", "🦋", "🐢"];
function objectGroup(n, e, crossFrom = n) {
  return Array.from({ length: n }, (_, i) => `<span class="${i >= crossFrom ? "gone" : ""}">${e}</span>`).join("");
}
function clockSvg(h, m) {
  const ha = ((h % 12) + m / 60) * 30, ma = m * 6;
  const nums = Array.from({ length: 12 }, (_, i) => {
    const a = (i + 1) * 30 * Math.PI / 180;
    return `<text x="${50 + 36 * Math.sin(a)}" y="${50 - 36 * Math.cos(a) + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#1d3557">${i + 1}</text>`;
  }).join("");
  return `<svg viewBox="0 0 100 100" width="180" height="180" role="img" aria-label="clock">
    <circle cx="50" cy="50" r="46" fill="#fff" stroke="#1d3557" stroke-width="3"/>${nums}
    <line x1="50" y1="50" x2="${50 + 22 * Math.sin(ha * Math.PI / 180)}" y2="${50 - 22 * Math.cos(ha * Math.PI / 180)}" stroke="#e84a7f" stroke-width="5" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="${50 + 32 * Math.sin(ma * Math.PI / 180)}" y2="${50 - 32 * Math.cos(ma * Math.PI / 180)}" stroke="#2f8fd8" stroke-width="3" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="3" fill="#1d3557"/></svg>`;
}
function timeWords(h, m, l) {
  if (l === "en") return m ? `half past ${numWord(h, "en")}` : `${numWord(h, "en")} o'clock`;
  if (l === "fr") return (h === 1 ? "une heure" : `${numWord(h, "fr")} heures`) + (m ? " et demie" : "");
  const w = numWord(h, "ta");
  return m ? w.replace(/ு$/, "") + "ரை மணி" : w + " மணி";
}
function makeMathQuestion(id) {
  const e = pick(OBJECTS);
  const eq = (a, op, b, blank) => {
    const parts = [a, op, b, "=", blank];
    return `<div class="equation">${parts.map(x => x === "?" ? `<span class="blank">?</span>` : esc(String(x))).join(" ")}</div>`;
  };
  const say2 = (a, op, b) => `${numWord(a)} ${mq(op === "+" ? "plus" : "minus")} ${numWord(b)}`;
  switch (id) {
    case "count": {
      const n = rand(1, 20);
      return { ask: ["howMany"], show: `<div class="objects${n > 10 ? " small" : ""}">${objectGroup(n, e)}</div>`, answer: n, options: nearOptions(n, 3, 1, 20), speak: mq("howMany") };
    }
    case "add10": case "add20": {
      const max = id === "add10" ? 10 : 20;
      const a = rand(id === "add10" ? 0 : 2, max - 1), b = rand(1, max - a);
      const vis = a + b <= 20 ? `<div class="objects${a + b > 10 ? " small" : ""}">${objectGroup(a, e)}<b class="op">+</b>${objectGroup(b, e)}</div>` : "";
      return { ask: ["solve"], show: eq(a, "+", b, "?") + vis, answer: a + b, options: nearOptions(a + b, 3, 0, max), speak: say2(a, "+", b) };
    }
    case "sub10": case "sub20": {
      const max = id === "sub10" ? 10 : 20;
      const a = rand(2, max), b = rand(1, a);
      return { ask: ["solve"], show: eq(a, "−", b, "?") + `<div class="objects${a > 10 ? " small" : ""}">${objectGroup(a, e, a - b)}</div>`, answer: a - b, options: nearOptions(a - b, 3, 0, max), speak: say2(a, "-", b) };
    }
    case "add100": {
      const a = rand(10, 89), b = rand(1, Math.min(60, 99 - a));
      return { ask: ["solve"], show: eq(a, "+", b, "?"), answer: a + b, options: nearOptions(a + b, 10, 0, 100), speak: say2(a, "+", b) };
    }
    case "sub100": {
      const a = rand(20, 99), b = rand(1, a - 1);
      return { ask: ["solve"], show: eq(a, "−", b, "?"), answer: a - b, options: nearOptions(a - b, 10, 0, 100), speak: say2(a, "-", b) };
    }
    case "compare": {
      const max = Math.random() < .5 ? 20 : 100;
      const a = rand(0, max);
      let b = rand(0, max);
      while (b === a) b = rand(0, max);
      return { ask: ["bigger"], show: "", answer: Math.max(a, b), options: [a, b], speak: mq("bigger") };
    }
    case "next": {
      const n = rand(0, 98);
      return { ask: ["after", n], show: `<div class="equation">${n}, <span class="blank">?</span></div>`, answer: n + 1, options: nearOptions(n + 1, 3, 0, 100), speak: mq("after", numWord(n)) };
    }
    case "shapes": {
      const ids = Object.keys(SHAPES), target = pick(ids);
      const name = SHAPES[target].n[LI[lang]];
      return { ask: ["shape", name], askEn: mqEn("shape", SHAPES[target].n[0]), show: "", answer: target, options: shuffle([target, ...shuffle(ids.filter(x => x !== target)).slice(0, 3)]), label: v => shapeSvg(v), speak: mq("shape", name) };
    }
    case "place": {
      const n = rand(11, 99), t = n / 10 | 0, o = n % 10;
      const rods = Array.from({ length: t }, () => `<span class="rod">${"<i></i>".repeat(10)}</span>`).join("");
      const cubes = Array.from({ length: o }, () => `<i class="cube"></i>`).join("");
      const opts = new Set([n, o * 10 + t, n + 10 <= 99 ? n + 10 : n - 10, n + 1]);
      return { ask: ["place"], show: `<div class="blocks"><div class="rods">${rods}</div><div class="cubes">${cubes}</div></div>
        <p class="meta">🟦 = 10 · 🟧 = 1</p>`,
        answer: n, options: shuffle([...opts].filter(v => v >= 0 && v <= 99)), speak: mq("place") };
    }
    case "missing": {
      const add = Math.random() < .6;
      const a = rand(1, 12), b = rand(1, 10);
      const [x, y, z] = add ? [a, b, a + b] : [a + b, b, a];
      const hideFirst = Math.random() < .5;
      const show = `<div class="equation">${hideFirst ? `<span class="blank">?</span>` : x} ${add ? "+" : "−"} ${hideFirst ? y : `<span class="blank">?</span>`} = ${z}</div>`;
      const ans = hideFirst ? x : y;
      return { ask: ["missing"], show, answer: ans, options: nearOptions(ans, 3, 0, 30), speak: mq("missing") };
    }
    case "skip": {
      const step = pick([2, 5, 10]), start = step * rand(0, step === 10 ? 5 : 8);
      const seq = [0, 1, 2].map(i => start + i * step);
      const ans = start + 3 * step;
      return { ask: ["skip"], show: `<div class="equation">${seq.join(", ")}, <span class="blank">?</span></div>`, answer: ans, options: shuffle([...new Set([ans, ans + 1, ans - 1, ans + step])]), speak: seq.map(v => numWord(v)).join(", ") };
    }
    case "evenodd": {
      const n = rand(1, 20);
      const dots = Array.from({ length: n }, () => `<span>${e}</span>`).join("");
      return { ask: ["evenOdd", n], show: `<div class="objects pairs${n > 10 ? " small" : ""}">${dots}</div>`, answer: n % 2 ? "odd" : "even", options: ["even", "odd"], label: v => esc(mq(v)) + enUnder(mqEn(v)), speak: mq("evenOdd", numWord(n)) };
    }
    case "time": {
      const h = rand(1, 12), m = pick([0, 30]);
      const fmt = (hh, mm) => `${hh}:${mm ? "30" : "00"}`;
      const opts = new Set([fmt(h, m), fmt(h, m ? 0 : 30), fmt(h % 12 + 1, m), fmt((h + 10) % 12 + 1, m)]);
      return { ask: ["time"], show: `<div class="clock">${clockSvg(h, m)}</div>`, answer: fmt(h, m), options: shuffle([...opts]), speak: mq("time"), sayAnswer: timeWords(h, m, lang) };
    }
  }
}
function viewMath() {
  const topic = store.get("mathTopic", "add10");
  if (!view || view.kind !== "math" || view.topic !== topic || view.lang !== lang) view = { kind: "math", topic, lang, round: 0, rounds: 10 };
  panel.innerHTML = `<h2>${tt("mathH")}</h2>`;
  [1, 2].forEach(g => {
    panel.insertAdjacentHTML("beforeend", `<p class="section-title">${tt("grade", g)}</p>`);
    const chips = document.createElement("div");
    chips.className = "chips";
    MATH_TOPICS.filter(x => x.g === g).forEach(x => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `${x.icon} ${esc(x.n[LI[lang]])}${enUnder(x.n[0])}`;
      b.setAttribute("aria-pressed", x.id === topic);
      b.onclick = () => { store.set("mathTopic", x.id); view = null; Speech.stop(); viewMath(); };
      chips.appendChild(b);
    });
    panel.appendChild(chips);
  });
  const body = document.createElement("div");
  body.className = "math-body";
  panel.appendChild(body);
  if (view.round >= view.rounds) {
    body.innerHTML = `<div class="celebrate">🏆 ${esc(t().done(nm()))}${enUnder(UI.en.done(CHILD))}</div>
      <div class="btns"><button class="btn" type="button">${tt("again")}</button></div>`;
    $("button", body).onclick = () => { view = null; viewMath(); };
    say(t().done(nm()));
    confetti();
    return;
  }
  if (!view.q) { const nq = view.q = makeMathQuestion(topic); setTimeout(() => { if (view && view.q === nq) say(nq.speak, { rate: 0.8 }); }, 200); }
  const q = view.q;
  const askNative = mq(...q.ask), askEn = q.askEn || mqEn(...q.ask);
  body.innerHTML = `${progressDots()}
    <p class="math-ask">${esc(askNative)}${showEn() ? `<small class="en">${esc(askEn)}</small>` : ""}</p>
    <div class="math-show">${q.show}</div>
    <div class="choices math-choices"></div><div class="feedback"></div>
    <div class="btns"><button class="btn alt" type="button" id="hearQ">🔊 ${tt("question")}</button></div>`;
  $("#hearQ", body).onclick = () => say(q.speak, { rate: 0.8 });
  const box = $(".choices", body), fb = $(".feedback", body);
  if (q.options.length === 2) box.style.gridTemplateColumns = "repeat(2, 1fr)";
  let locked = false;
  q.options.forEach(v => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = q.label ? q.label(v) : esc(String(v));
    b.onclick = () => {
      if (locked) return;
      const ok = v === q.answer;
      if (ok) {
        locked = true;
        const blank = $(".blank", body);
        if (blank && typeof v === "number") blank.textContent = v;
        b.classList.add("right");
        const m = pick(t().good(nm()));
        fb.className = "feedback good"; fb.innerHTML = "⭐ " + esc(m);
        addStar();
        const said = q.sayAnswer || (typeof v === "number" ? numWord(v) : q.label ? (SHAPES[v] ? SHAPES[v].n[LI[lang]] : mq(v)) : String(v));
        say(said + "! " + m);
        const v0 = view;
        setTimeout(() => { if (view !== v0) return; view.round++; view.q = null; viewMath(); }, 1900);
      } else {
        b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong");
        fb.className = "feedback bad"; fb.innerHTML = esc(t().bad) + enUnder(UI.en.bad);
        say(t().bad);
      }
    };
    box.appendChild(b);
  });
}

/* ---------------------------------------------------------------- colors and numbers */
const COLOR_LIST = [
  { hex: "#e53935", en: "red", fr: "rouge", ta: "சிவப்பு", e: "🍎" },
  { hex: "#1e88e5", en: "blue", fr: "bleu", ta: "நீலம்", e: "🐳" },
  { hex: "#43a047", en: "green", fr: "vert", ta: "பச்சை", e: "🐸" },
  { hex: "#fdd835", en: "yellow", fr: "jaune", ta: "மஞ்சள்", e: "🍌" },
  { hex: "#fb8c00", en: "orange", fr: "orange", ta: "ஆரஞ்சு", e: "🍊" },
  { hex: "#8e24aa", en: "purple", fr: "violet", ta: "ஊதா", e: "🍇" },
  { hex: "#ec407a", en: "pink", fr: "rose", ta: "இளஞ்சிவப்பு", e: "🌸" },
  { hex: "#795548", en: "brown", fr: "marron", ta: "பழுப்பு", e: "🐻" },
  { hex: "#212121", en: "black", fr: "noir", ta: "கருப்பு", e: "🎱" },
  { hex: "#ffffff", en: "white", fr: "blanc", ta: "வெள்ளை", e: "🥛" },
  { hex: "#9e9e9e", en: "gray", fr: "gris", ta: "சாம்பல்", e: "🐘" },
  { hex: "#d4af37", en: "gold", fr: "doré", ta: "தங்கம்", e: "👑" },
  { hex: "#c0c0c0", en: "silver", fr: "argenté", ta: "வெள்ளி", e: "🥄" }
];
function numberTile(n, big) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = big ? "num-tile" : "num-cell";
  b.innerHTML = big
    ? `<span class="digit">${n}</span>${lang === "ta" ? `<span class="tadigit">${taDigits(n)}</span>` : ""}<span class="nw">${esc(numWord(n))}</span>${enUnder(numWord(n, "en"))}`
    : `${n}`;
  return b;
}
function viewColorsNumbers() {
  const mode = store.get("cnMode", 0);
  if (!view || view.kind !== "cn" || view.mode !== mode || view.lang !== lang) view = { kind: "cn", mode, lang, round: 0, rounds: 10 };
  panel.innerHTML = `<h2>${tt("cnH")}</h2>`;
  const chips = document.createElement("div");
  chips.className = "chips";
  t().cnModes.forEach((label, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = esc(label) + enUnder(UI.en.cnModes[i]);
    b.setAttribute("aria-pressed", i === mode);
    b.onclick = () => { store.set("cnMode", i); view = null; Speech.stop(); viewColorsNumbers(); };
    chips.appendChild(b);
  });
  panel.appendChild(chips);
  const body = document.createElement("div");
  panel.appendChild(body);
  if (mode === 0) {
    body.innerHTML = `<p class="hint">${tt("tapHear")}</p><div class="swatches"></div>`;
    COLOR_LIST.forEach(c => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.innerHTML = `<span class="dot" style="background:${c.hex}"></span><span class="sw-e" aria-hidden="true">${safePic(c.e, "")}</span><span class="nw">${esc(c[lang])}</span>${enUnder(c.en)}`;
      b.onclick = () => { say(c[lang]); b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 600); };
      $(".swatches", body).appendChild(b);
    });
  } else if (mode === 1) {
    body.innerHTML = `<p class="hint">${tt("tapHear")}</p><div class="num-grid"></div>`;
    for (let n = 0; n <= 20; n++) {
      const b = numberTile(n, true);
      b.onclick = () => say(numWord(n));
      $(".num-grid", body).appendChild(b);
    }
  } else if (mode === 2) {
    body.innerHTML = `<p class="hint">${tt("tapHear")}</p><div class="num-banner" id="numBanner"></div><div class="hundred"></div>`;
    const banner = $("#numBanner", body);
    const showN = n => {
      banner.innerHTML = `<span class="digit">${n}</span>${lang === "ta" ? `<span class="tadigit">${taDigits(n)}</span>` : ""}<span class="nw">${esc(numWord(n))}</span>${enUnder(numWord(n, "en"))}`;
    };
    showN(view.sel || 1);
    for (let n = 1; n <= 100; n++) {
      const b = numberTile(n, false);
      b.onclick = () => { view.sel = n; showN(n); say(numWord(n)); body.querySelectorAll(".num-cell").forEach(x => x.classList.remove("on")); b.classList.add("on"); };
      $(".hundred", body).appendChild(b);
    }
  } else {
    cnGame(body, mode === 3 ? "color" : "number");
  }
}
function cnGame(body, kind) {
  if (view.round >= view.rounds) {
    body.innerHTML = `<div class="celebrate">🏆 ${esc(t().done(nm()))}${enUnder(UI.en.done(CHILD))}</div>
      <div class="btns"><button class="btn" type="button">${tt("again")}</button></div>`;
    $("button", body).onclick = () => { view = null; viewColorsNumbers(); };
    confetti();
    return;
  }
  if (!view.cur) {
    if (kind === "color") {
      const target = draw("color:" + lang, COLOR_LIST);
      view.cur = { target, options: shuffle([target, ...shuffle(COLOR_LIST.filter(c => c !== target)).slice(0, 3)]) };
      setTimeout(() => say(target[lang]), 200);
    } else {
      const n = Math.random() < .6 ? rand(0, 20) : rand(21, 100);
      view.cur = { target: n, options: nearOptions(n, n > 20 ? 12 : 4, 0, 100) };
      setTimeout(() => say(numWord(n)), 200);
    }
  }
  const { target, options } = view.cur;
  const word = kind === "color" ? target[lang] : numWord(target);
  body.innerHTML = `${progressDots()}
    <p class="math-ask">${tt(kind === "color" ? "findColor" : "findNumber")}</p>
    <div class="quiz-word">${esc(word)}</div>
    <div class="choices${kind === "color" ? " color-choices" : " math-choices"}"></div><div class="feedback"></div>
    <div class="btns"><button class="btn alt" type="button">🔊 ${tt("hear")}</button></div>`;
  $(".btns .btn", body).onclick = () => say(word);
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(o => {
    const b = document.createElement("button");
    b.type = "button";
    if (kind === "color") { b.style.background = o.hex; b.setAttribute("aria-label", o.en); }
    else b.textContent = o;
    b.onclick = () => {
      if (locked) return;
      if (o === target) {
        locked = true;
        b.classList.add("right");
        const meaning = kind === "color" ? o.en : numWord(o, "en");
        if (showEn()) $(".quiz-word", body).insertAdjacentHTML("beforeend", `<small class="gloss">${esc(meaning)}</small>`);
        const m = pick(t().good(nm()));
        fb.className = "feedback good"; fb.innerHTML = "⭐ " + esc(m);
        addStar();
        say(word + "! " + m);
        const v0 = view;
        setTimeout(() => { if (view !== v0) return; view.round++; view.cur = null; viewColorsNumbers(); }, 1800);
      } else {
        b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong");
        fb.className = "feedback bad"; fb.innerHTML = esc(t().bad) + enUnder(UI.en.bad);
        say(t().bad);
      }
    };
    box.appendChild(b);
  });
}

/* ---------------------------------------------------------------- confetti */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("#confetti"), ctx = c.getContext("2d");
  c.width = innerWidth; c.height = innerHeight;
  const bits = Array.from({ length: 120 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * .4,
    vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 3, r: 4 + Math.random() * 6,
    a: Math.random() * 6, col: COLORS[Math.random() * COLORS.length | 0]
  }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    bits.forEach(b => { b.x += b.vx; b.y += b.vy; b.a += .1; ctx.fillStyle = b.col; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore(); });
    if (++f < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

/* ---------------------------------------------------------------- boot */
const VIEWS = [() => lang === "ta" ? viewTamilLetters() : viewLetters(), viewWords, viewRead, viewPlay, viewBooks, viewMath, viewColorsNumbers,
  () => window.AharaWorld.render(), () => window.AharaChess.render()];
// Shared helpers for the sections that live in their own files (world.js, chess.js).
window.Ahara = {
  panel, $, esc, store, shuffle, pick, draw, addStar, confetti, emojiOK, graphemes, say,
  stop: () => Speech.stop(), CHILD, isTab: i => tab === i
};
function render() { renderChrome(); VIEWS[tab](); }
document.querySelectorAll(".lang button").forEach(b => b.onclick = () => {
  lang = b.dataset.lang;
  store.set("lang", lang);
  seqToken++;
  Speech.stop();
  view = null;
  render();
  say(t().hello(nm()));
});
$("#soundBtn").onclick = openSoundCheck;
document.addEventListener("pointerdown", Speech.unlock, { capture: true });
document.addEventListener("keydown", Speech.unlock, { capture: true });
prepareData();
drawBackdrop();
render();
// Installed-app support: save the app on the device so it also works offline.
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  try { navigator.serviceWorker.register("sw.js").catch(() => {}); } catch {}
}
})();
