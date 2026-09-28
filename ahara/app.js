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
let tab = Math.min(4, Math.max(0, store.get("tab", 0) | 0));
let stars = store.get("stars", 0) | 0;
const nm = () => NAMES[lang] || CHILD;
const fillName = s => s.replaceAll("{n}", nm());

/* ---------------------------------------------------------------- text */
const UI = {
  en: {
    hello: n => `Hello, ${n}!`, sub: "Reading Room", sound: "Sound",
    tabs: ["Letters", "Words", "Read", "Play", "Books"],
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
    tabs: ["Lettres", "Mots", "Lire", "Jouer", "Livres"],
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
    tabs: ["எழுத்து", "சொல்", "படி", "விளையாடு", "புத்தகம்"],
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
const TAB_ICONS = ["🔤", "🧩", "💬", "🎯", "📚"];
const TAB_COLORS = ["#2f8fd8", "#3fa66b", "#8a5cc7", "#f28a2e", "#e84a7f"];

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
    const syl = s.split("|");
    const w = syl.join("");
    return { w, syl, lvl: levelOf(l, syl, w), pic: picByWord[l].get(w.toLowerCase()) || "" };
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
  fr: [
    p => p.c !== "people" && `Je vois ${G.fr.un(p)}.`,
    p => p.c !== "people" && `Regarde ${G.fr.le(p)} !`,
    p => p.c !== "people" && `Où est ${G.fr.le(p)} ?`,
    p => p.c !== "people" && `Voici ${G.fr.un(p)}.`,
    p => p.c !== "people" && `J'aime ${G.fr.le(p)}.`,
    p => ["animal", "thing", "clothes"].includes(p.c) && `{n} a ${G.fr.un(p)}.`,
    p => ["animal", "thing", "vehicle", "nature", "place"].includes(p.c) && !p.frm && `${cap(G.fr.le(p))} est ${G.fr.adj(p, "grand", "grande")}.`,
    p => ["animal", "thing", "vehicle", "food"].includes(p.c) && !p.frm && `${cap(G.fr.le(p))} est ${G.fr.adj(p, "petit", "petite")}.`,
    p => p.c === "animal" && `${cap(G.fr.le(p))} dort.`,
    p => p.c === "animal" && `${cap(G.fr.le(p))} a faim.`,
    p => p.c === "animal" && `${cap(G.fr.le(p))} est ${G.fr.adj(p, "content", "contente")}.`,
    p => p.c === "animal" && !frElide(p.fr) && `Bonjour, ${G.fr.adj(p, "petit", "petite")} ${p.fr} !`,
    p => p.c === "food" && `{n} mange ${G.fr.un(p)}.`,
    p => p.c === "food" && `Miam ! ${cap(G.fr.le(p))} est ${G.fr.adj(p, "bon", "bonne")}.`,
    p => p.c === "drink" && `{n} boit ${G.fr.du(p)}.`,
    p => p.c === "vehicle" && `${cap(G.fr.le(p))} va vite.`,
    p => p.c === "clothes" && `{n} met ${G.fr.son(p)}.`,
    p => (p.c === "thing" || p.c === "body") && `C'est ${G.fr.mon(p)}.`,
    p => p.c === "body" && `Je touche ${G.fr.mon(p)}.`,
    p => p.c === "nature" && `${cap(G.fr.le(p))} est ${G.fr.adj(p, "joli", "jolie")}.`,
    p => p.c === "place" && `{n} va ${G.fr.au(p)}.`,
    p => FAMILY.has(p.e) && `J'aime ${G.fr.mon(p)}.`,
    p => FAMILY.has(p.e) && `Bonjour, ${p.fr} !`
  ],
  ta: [
    p => p.c !== "people" && `இது ஒரு ${p.ta}.`,
    p => p.c !== "people" && `அங்கே ஒரு ${p.ta} இருக்கிறது.`,
    p => p.c !== "people" && `${p.ta} எங்கே?`,
    p => p.c !== "people" && `இதோ ஒரு ${p.ta}!`,
    p => p.c !== "people" && `பார்! ஒரு ${p.ta}!`,
    p => p.c !== "body" && (p.c !== "people" || FAMILY.has(p.e)) && `${G.ta.join("எனக்கு", p.ta)} பிடிக்கும்.`,
    p => ["animal", "thing", "vehicle", "nature", "place"].includes(p.c) && `${p.ta} பெரியது.`,
    p => ["animal", "thing", "vehicle", "food"].includes(p.c) && `${p.ta} சிறியது.`,
    p => ["animal", "nature", "place", "thing"].includes(p.c) && `${p.ta} அழகாக இருக்கிறது.`,
    p => p.c === "animal" && `${p.ta} தூங்குகிறது.`,
    p => p.c === "animal" && `${p.ta} விளையாடுகிறது.`,
    p => (p.c === "animal" || FAMILY.has(p.e)) && `வணக்கம், ${p.ta}!`,
    p => p.c === "food" && `{n} ${p.ta} சாப்பிடுகிறாள்.`,
    p => p.c === "drink" && `{n} ${p.ta} குடிக்கிறாள்.`,
    p => p.c === "vehicle" && `${p.ta} வேகமாகப் போகிறது.`,
    p => ["thing", "clothes", "body"].includes(p.c) && `இது என் ${p.ta}.`,
    p => ["thing", "clothes"].includes(p.c) && `{n}விடம் ஒரு ${p.ta} இருக்கிறது.`
  ]
};
const HANDWRITTEN = {
  en: ["{n} can read!", "The cat is on the mat.", "The dog runs fast.", "I see the big sun.", "{n} likes to jump.",
    "The fish can swim.", "Good night, {n}. I love you.", "We go to the park.", "The bird is in the tree.",
    "Mom and Dad love {n}.", "It is a sunny day.", "The frog can hop.", "I have a red hat.", "The bus is big and yellow.",
    "Can you see the moon?", "We like to play.", "The duck is in the pond.", "{n} reads a book.", "The baby is sleeping.",
    "Look at the rainbow!"],
  fr: ["{n} sait lire !", "Le chat est sur le tapis.", "Le chien court vite.", "Je vois le grand soleil.", "{n} aime sauter.",
    "Le poisson nage.", "Bonne nuit, {n}.", "Nous allons au parc.", "L'oiseau est dans l'arbre.", "Papa et maman aiment {n}.",
    "Il fait beau aujourd'hui.", "La grenouille saute.", "J'ai un chapeau rouge.", "Le bus est grand et jaune.",
    "Tu vois la lune ?", "Nous aimons jouer.", "Le canard est dans la mare.", "{n} lit un livre.", "Le bébé dort.",
    "Regarde l'arc-en-ciel !"],
  ta: ["{n} படிக்கிறாள்!", "பூனை பாயில் இருக்கிறது.", "நாய் வேகமாக ஓடுகிறது.", "நான் பெரிய சூரியனைப் பார்க்கிறேன்.",
    "{n}வுக்குக் குதிக்கப் பிடிக்கும்.", "மீன் நீந்துகிறது.", "இனிய இரவு, {n}.", "நாங்கள் பூங்காவுக்குப் போகிறோம்.",
    "பறவை மரத்தில் இருக்கிறது.", "அம்மாவும் அப்பாவும் {n}வை நேசிக்கிறார்கள்.", "இன்று நல்ல வெயில்.", "தவளை குதிக்கிறது.",
    "என்னிடம் ஒரு சிவப்புத் தொப்பி இருக்கிறது.", "பேருந்து பெரியது.", "நிலாவைப் பார்த்தாயா?", "எங்களுக்கு விளையாடப் பிடிக்கும்.",
    "வாத்து குளத்தில் இருக்கிறது.", "{n} புத்தகம் படிக்கிறாள்.", "குழந்தை தூங்குகிறது.", "வானவில்லைப் பார்!"]
};
const sentencePools = {};
function sentencesFor(l) {
  if (sentencePools[l]) return sentencePools[l];
  const out = HANDWRITTEN[l].map(s => ({ text: s, pic: "" }));
  for (const p of pictures[l]) {
    if (l === "fr" && FR_PLURAL.has(p.fr)) continue;
    for (const f of SENTENCES[l]) {
      const s = f(p);
      if (s) out.push({ text: s, pic: p.e });
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
  fr: {
    zoo: ["{n} au zoo", "{n} va au zoo.", [p => `{n} voit ${G.fr.un(p)}.`, p => `Regarde, ${G.fr.un(p)} !`, p => `Bonjour, ${G.fr.le(p)} !`], "Au revoir, le zoo ! À bientôt !"],
    farm: ["{n} à la ferme", "{n} visite la ferme.", [p => `{n} voit ${G.fr.un(p)}.`, p => `Voici ${G.fr.un(p)}.`, p => `Bonjour, ${G.fr.le(p)} !`], "Au revoir, la ferme !"],
    sea: ["{n} sous la mer", "{n} plonge dans la mer. Plouf !", [p => `{n} voit ${G.fr.un(p)}.`, p => `Regarde, ${G.fr.un(p)} !`, p => `Bonjour, ${G.fr.le(p)} !`], "Il est temps de rentrer !"],
    garden: ["Le jardin de {n}", "{n} va dans le jardin.", [p => `{n} trouve ${G.fr.un(p)}.`, p => `Regarde, ${G.fr.un(p)} !`, p => `Voici ${G.fr.un(p)}.`], "Quel joli jardin !"],
    market: ["{n} au marché", "{n} va au marché avec maman.", [p => `{n} achète ${G.fr.un(p)}.`, p => `Voici ${G.fr.un(p)}.`, p => `Maman achète ${G.fr.un(p)}.`], "Le panier est plein ! Miam !"],
    toys: ["Les jouets de {n}", "{n} ouvre son coffre à jouets.", [p => `{n} trouve ${G.fr.un(p)}.`, p => `Voici ${G.fr.un(p)}.`, p => `{n} joue avec ${G.fr.le(p)}.`], "C'est l'heure de ranger !"],
    sky: ["{n} regarde le ciel", "{n} regarde le ciel.", [p => `{n} voit ${G.fr.un(p)}.`, p => `Regarde, ${G.fr.un(p)} !`], "Que le ciel est grand !"],
    town: ["{n} en ville", "{n} se promène en ville.", [p => `{n} voit ${G.fr.un(p)}.`, p => `Voici ${G.fr.un(p)}.`, p => `Regarde, ${G.fr.un(p)} !`], "On rentre à la maison !"],
    home: ["{n} à la maison", "{n} fait le tour de la maison.", [p => `Voici ${G.fr.un(p)}.`, p => `{n} voit ${G.fr.un(p)}.`], "On est bien chez soi !"]
  },
  ta: {
    zoo: ["மிருகக்காட்சிசாலையில் {n}", "{n} மிருகக்காட்சிசாலைக்குப் போகிறாள்.", [p => `இதோ ஒரு ${p.ta}!`, p => `பார்! ஒரு ${p.ta}!`, p => `அங்கே ஒரு ${p.ta} இருக்கிறது.`, p => `வணக்கம், ${p.ta}!`], "டாட்டா! மீண்டும் வருவோம்."],
    farm: ["பண்ணையில் {n}", "{n} பண்ணைக்குப் போகிறாள்.", [p => `இதோ ஒரு ${p.ta}!`, p => `பார்! ஒரு ${p.ta}!`, p => `அங்கே ஒரு ${p.ta} இருக்கிறது.`], "டாட்டா, பண்ணை!"],
    sea: ["கடலுக்கு அடியில் {n}", "{n} கடலுக்குள் நீந்துகிறாள்.", [p => `இதோ ஒரு ${p.ta}!`, p => `பார்! ஒரு ${p.ta}!`, p => `அங்கே ஒரு ${p.ta} இருக்கிறது.`], "வீட்டுக்குப் போகும் நேரம்!"],
    garden: ["{n}வின் தோட்டம்", "{n} தோட்டத்துக்குப் போகிறாள்.", [p => `இதோ ஒரு ${p.ta}!`, p => `பார்! ஒரு ${p.ta}!`, p => `அங்கே ஒரு ${p.ta} இருக்கிறது.`], "எவ்வளவு அழகான தோட்டம்!"],
    market: ["சந்தையில் {n}", "{n} அம்மாவுடன் சந்தைக்குப் போகிறாள்.", [p => `{n} ${p.ta} வாங்குகிறாள்.`, p => `இதோ ${p.ta}!`, p => `அம்மா ${p.ta} வாங்குகிறார்.`], "பை நிறைந்துவிட்டது!"],
    toys: ["{n}வின் பொம்மைப் பெட்டி", "{n} தன் பொம்மைப் பெட்டியைத் திறக்கிறாள்.", [p => `இதோ ஒரு ${p.ta}!`, p => `{n}விடம் ஒரு ${p.ta} இருக்கிறது.`, p => `பார்! ஒரு ${p.ta}!`], "எல்லாவற்றையும் எடுத்து வைப்போம்!"],
    sky: ["வானத்தைப் பார்!", "{n} வானத்தைப் பார்க்கிறாள்.", [p => `பார்! ஒரு ${p.ta}!`, p => `வானத்தில் ஒரு ${p.ta}!`], "வானம் எவ்வளவு பெரியது!"],
    town: ["ஊரில் {n}", "{n} ஊரைச் சுற்றிப் பார்க்கிறாள்.", [p => `இதோ ஒரு ${p.ta}!`, p => `பார்! ஒரு ${p.ta}!`, p => `அங்கே ஒரு ${p.ta} இருக்கிறது.`], "வீட்டுக்குத் திரும்புவோம்!"],
    home: ["வீட்டில் {n}", "{n} வீட்டைச் சுற்றிப் பார்க்கிறாள்.", [p => `இதோ ஒரு ${p.ta}.`, p => `இது நம் ${G.ta.join("வீட்டு", p.ta)}.`], "வீடு எவ்வளவு இனிமையானது!"]
  }
};
function themeItems(theme, l) {
  const set = theme.pool ? new Set(graphemes(theme.pool)) : null;
  return pictures[l].filter(p => set ? set.has(p.e) : theme.cats.includes(p.c));
}
function makeStory(l) {
  const theme = draw("theme:" + l, THEMES);
  const [title, intro, lines, end] = STORY[l][theme.id];
  const items = themeItems(theme, l);
  const chosen = [];
  for (let i = 0; i < 6 && chosen.length < Math.min(5, items.length); i++) {
    const p = draw("story:" + theme.id + ":" + l, items);
    if (!chosen.includes(p)) chosen.push(p);
  }
  const pages = [[theme.cover, intro]];
  chosen.forEach((p, i) => pages.push([p.e, lines[i % lines.length](p)]));
  pages.push(["👋", end]);
  return { level: 1, cover: theme.cover, title, pages, generated: true };
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
  t().tabs.forEach((label, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", i === tab);
    b.style.setProperty("--tab", TAB_COLORS[i]);
    b.innerHTML = `<span class="ic" aria-hidden="true">${TAB_ICONS[i]}</span><span>${esc(label)}</span>`;
    b.onclick = () => { tab = i; store.set("tab", tab); Speech.stop(); view = null; render(); };
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
    b.textContent = i ? "⭐".repeat(i) + " " + label : label;
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
  panel.innerHTML = `
    <h2>${esc(t().lettersH)}</h2>
    <p class="hint">${esc(t().lettersHint(nm()))}</p>
    <div class="letter-card">
      <div class="big-letter">${L}${L.toLowerCase() !== L ? `<small>${L.toLowerCase()}</small>` : ""}</div>
      <div>
        <div class="row"><span class="pic" aria-hidden="true">${safePic(pic, "")}</span><span class="word">${wordHtml}</span></div>
        ${inName.has(L) ? `<p class="note">💖 ${esc(t().inName())}</p>` : ""}
        <div class="row" style="margin-top:12px"><button class="btn" id="hearL" type="button">🔊 ${esc(t().hear)}</button></div>
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
function speakLetter() {
  const [L, word] = LETTERS[lang][view.idx];
  say(t().isFor(L, word));
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
    <h2>${esc(t().wordsH)}</h2>
    <p class="hint">${esc(t().wordsHint)}</p>`;
  panel.appendChild(levelChips("words", () => { view = null; viewWords(); }));
  const stage = document.createElement("div");
  stage.className = "word-stage";
  stage.innerHTML = `
    <div class="pic${item.pic ? "" : " none"}" aria-hidden="true">${item.pic || "✏️"}</div>
    <div class="syll"></div>
    <div class="btns">
      <button class="btn alt" id="prevW" type="button"${view.at ? "" : " disabled"}>◀ ${esc(t().prev)}</button>
      <button class="btn" id="hearW" type="button">🔊 ${esc(t().hear)}</button>
      <button class="btn go" id="nextW" type="button">${esc(t().next)} ▶</button>
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
    <h2>${esc(t().readH)}</h2>
    <p class="hint">${esc(t().readHint)}</p>
    <div class="sentence-card">
      <div class="pic" aria-hidden="true">${safePic(item.pic || "💬", "💬")}</div>
      <div class="words"></div>
      <div class="btns">
        <button class="btn" id="readMe" type="button">🔊 ${esc(t().readMe)}</button>
        <button class="btn go" id="nextS" type="button">${esc(t().next)} ▶</button>
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
  panel.innerHTML = `<h2>${esc(t().playH)}</h2>`;
  const chips = document.createElement("div");
  chips.className = "chips";
  t().modes.forEach((label, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    b.setAttribute("aria-pressed", i === mode);
    b.onclick = () => { store.set("playMode", i); view = null; Speech.stop(); viewPlay(); };
    chips.appendChild(b);
  });
  panel.appendChild(chips);
  const body = document.createElement("div");
  panel.appendChild(body);
  if (view.round >= view.rounds) {
    body.innerHTML = `<div class="celebrate">🏆 ${esc(t().done(nm()))}</div>
      <div class="btns"><button class="btn" id="again" type="button">${esc(t().again)}</button></div>`;
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
function answer(btn, right, feedback, spoken) {
  if (right) {
    btn.classList.add("right");
    const msgs = t().good(nm()), m = pick(msgs);
    feedback.className = "feedback good"; feedback.textContent = "⭐ " + m;
    addStar();
    say((spoken ? spoken + "! " : "") + m);
    setTimeout(() => { view.round++; view.cur = null; viewPlay(); }, 1800);
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
  body.innerHTML = `<p class="hint">${esc(t().pictureHint)}</p>${progressDots()}
    <div class="quiz-word">${esc(target[lang])}</div>
    <div class="choices"></div><div class="feedback"></div>
    <div class="btns"><button class="btn alt" id="helpQ" type="button">🔊 ${esc(t().help)}</button></div>`;
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(p => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.e;
    b.onclick = () => { if (locked) return; const ok = p === target; if (ok) locked = true; answer(b, ok, fb, target[lang]); };
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
  body.innerHTML = `<p class="hint">${esc(t().listenHint)}</p>${progressDots()}
    <button class="big-ear" id="ear" type="button" aria-label="${esc(t().hear)}">👂🔊</button>
    <div class="choices text"></div><div class="feedback"></div>`;
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(w => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = w.w;
    b.onclick = () => { if (locked) return; const ok = w === target; if (ok) locked = true; answer(b, ok, fb, target.w); };
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
  body.innerHTML = `<p class="hint">${esc(t().missingHint)}</p>${progressDots()}
    <div class="pic" style="text-align:center;font-size:4.5rem" aria-hidden="true">${target.e}</div>
    <div class="quiz-word">${shown}</div>
    <div class="choices text"></div><div class="feedback"></div>
    <div class="btns"><button class="btn alt" id="helpQ" type="button">🔊 ${esc(t().help)}</button></div>`;
  const box = $(".choices", body), fb = $(".feedback", body);
  let locked = false;
  options.forEach(g => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = g;
    b.onclick = () => {
      if (locked) return;
      const ok = g === right;
      if (ok) { locked = true; $(".blank", body).textContent = letters[at]; }
      answer(b, ok, fb, target[lang]);
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
  return (BOOKS[l] || []).map(([level, cover, title, pages], i) => ({ id: l + ":" + i, level, cover, title, pages }));
}
function viewBooks() {
  if (view && view.book) return viewReader();
  const lvl = store.get("level:books", 0);
  const list = booksFor(lang).filter(b => !lvl || b.level === lvl);
  const read = store.get("booksRead", {});
  panel.innerHTML = `<h2>${esc(t().booksH)}</h2><p class="hint">${esc(t().booksHint)}</p>`;
  panel.appendChild(levelChips("books", () => { view = null; viewBooks(); }));
  const shelf = document.createElement("div");
  shelf.className = "shelf";
  const machine = document.createElement("button");
  machine.type = "button";
  machine.className = "book machine";
  machine.innerHTML = `<span class="cover" aria-hidden="true">🎲</span><span class="t">${esc(t().machine)}</span><span class="lv">${esc(t().machineSub)}</span>`;
  machine.onclick = () => { view = { book: makeStory(lang), page: 0 }; viewReader(); };
  shelf.appendChild(machine);
  list.forEach(b => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "book";
    el.innerHTML = `${read[b.id] ? `<span class="done">✓</span>` : ""}<span class="cover" aria-hidden="true">${safePic(b.cover)}</span>
      <span class="t">${esc(fillName(b.title))}</span><span class="lv">${"⭐".repeat(b.level)} ${esc(t().level(b.level))}</span>`;
    el.onclick = () => { view = { book: b, page: 0 }; viewReader(); };
    shelf.appendChild(el);
  });
  panel.appendChild(shelf);
  const libs = LIBRARIES.filter(x => x.langs.includes(lang));
  const more = document.createElement("div");
  more.innerHTML = `<p class="section-title">${esc(t().more)}</p><p class="hint">${esc(t().moreHint)}</p>
    <div class="links">${libs.map(x => `<a href="${x.url}" target="_blank" rel="noopener"><b>${esc(x.name)} ↗</b><span>${esc(x.note[lang] || x.note.en)}</span></a>`).join("")}</div>`;
  panel.appendChild(more);
}
function viewReader() {
  const b = view.book;
  const total = b.pages.length;
  panel.innerHTML = `
    <div class="reader-top">
      <button class="btn alt" id="shelfBtn" type="button">◀ ${esc(t().backToShelf)}</button>
      <span class="page-num">${view.page < total ? esc(t().page(view.page + 1, total)) : ""}</span>
    </div>
    <h2>${esc(fillName(b.title))}</h2>`;
  $("#shelfBtn", panel).onclick = () => { Speech.stop(); view = null; viewBooks(); };
  const card = document.createElement("div");
  card.className = "sentence-card page-card";
  panel.appendChild(card);
  if (view.page >= total) {
    card.innerHTML = `<div class="pic" aria-hidden="true">🌟</div><div class="the-end">${esc(t().theEnd)}</div>
      <div class="btns"><button class="btn alt" id="again" type="button">${esc(t().readAgain)}</button>
      <button class="btn go" id="shelf2" type="button">${esc(t().backToShelf)}</button></div>`;
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
  const [pic, raw] = b.pages[view.page];
  const text = fillName(raw);
  card.innerHTML = `<div class="pic" aria-hidden="true">${safePic(pic, safePic(b.cover))}</div><div class="words"></div>
    <div class="btns">
      <button class="btn alt" id="prevP" type="button"${view.page ? "" : " disabled"}>◀</button>
      <button class="btn" id="readP" type="button">🔊 ${esc(t().readMe)}</button>
      <button class="btn go" id="nextP" type="button">▶</button>
    </div>
    <div class="btns"><button class="btn alt" id="readAll" type="button">📖 ${esc(t().readAll)}</button></div>`;
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
const VIEWS = [viewLetters, viewWords, viewRead, viewPlay, viewBooks];
function render() { renderChrome(); VIEWS[tab](); }
document.querySelectorAll(".lang button").forEach(b => b.onclick = () => {
  lang = b.dataset.lang;
  store.set("lang", lang);
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
})();
