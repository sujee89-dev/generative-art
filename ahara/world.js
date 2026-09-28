// World map: continents, countries, flags and capitals (English section).
(() => {
"use strict";
const W = window.AHARA_WORLD;
const A = () => window.Ahara;
const TAB = 7;

const CONTINENTS = {
  "Africa": { color: "#f4a259", icon: "🦁", fact: "Africa has 54 countries, more than any other continent. The Sahara Desert and the Nile River are here." },
  "Asia": { color: "#e56b6f", icon: "🐼", fact: "Asia is the biggest continent, and more people live here than anywhere else. Mount Everest is in Asia." },
  "Europe": { color: "#5b8def", icon: "🏰", fact: "Europe is a small continent with lots of countries close together. You can visit many countries in one day!" },
  "North America": { color: "#43aa8b", icon: "🦅", fact: "North America has Canada, the United States, Mexico and the countries of Central America and the Caribbean." },
  "South America": { color: "#c9748f", icon: "🦜", fact: "The Amazon rainforest and the Andes, the longest mountain range in the world, are in South America." },
  "Oceania": { color: "#9b72cf", icon: "🦘", fact: "Oceania is Australia, New Zealand and thousands of islands in the Pacific Ocean." },
  "Antarctica": { color: "#b8c7d1", icon: "🐧", fact: "Antarctica is covered in ice and has no countries. Penguins and seals live there." }
};
const CONT_NAMES = Object.keys(CONTINENTS);
const MODES = ["Explore the map", "Continents", "Flag quiz", "Capital quiz", "Find it on the map"];

const byCode = new Map(W.countries.map(c => [c.c, c]));
const countriesIn = k => W.countries.filter(c => c.k === k && c.c !== "AQ");
const state = { mode: 0, zoom: "World", sel: null, cont: null, quiz: null };

function esc(s) { return A().esc(s); }
const flagOf = c => A().emojiOK(c.f) ? c.f : `<span class="flag-code">${c.c}</span>`;
const thingsOf = c => (c.things || []).filter(t => A().emojiOK(A().graphemes(t)[0]));
const listNames = arr => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];

function viewBoxFor(zoom) {
  if (zoom === "World" || !W.zoom[zoom]) return `0 0 ${W.W} ${W.H}`;
  const [x0, y0, x1, y1] = W.zoom[zoom];
  return `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
}
function mapSvg({ viewBox, highlight, dim, id = "worldMap", colorBy = "continent" }) {
  const fillFor = c => {
    if (highlight && highlight.has(c.c)) return "#ffc93c";
    if (dim && !dim(c)) return "#e3ebf0";
    return colorBy === "plain" ? "#cfe3d4" : CONTINENTS[c.k] ? CONTINENTS[c.k].color : "#cfd8dc";
  };
  const paths = W.countries.filter(c => c.d).map(c =>
    `<path d="${c.d}" data-c="${c.c}" fill="${fillFor(c)}"${highlight && highlight.has(c.c) ? ' class="hl"' : ""}><title>${esc(c.n)}</title></path>`).join("");
  // Tiny countries are dots; keep them a tappable size at every zoom level.
  const vbW = +viewBox.split(" ")[2] || W.W;
  const r = vbW < 500 ? vbW / 60 : vbW / 200;
  const dots = W.countries.filter(c => c.dot).map(c =>
    `<circle cx="${c.dot[0]}" cy="${c.dot[1]}" r="${(highlight && highlight.has(c.c) ? r * 1.8 : r).toFixed(2)}" data-r="${r.toFixed(2)}" data-c="${c.c}" fill="${fillFor(c)}" class="dot${highlight && highlight.has(c.c) ? " hl" : ""}"><title>${esc(c.n)}</title></circle>`).join("");
  const others = W.other.map(d => `<path d="${d}" fill="#dfe6ea"/>`).join("");
  return `<svg id="${id}" class="world-map" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map">
    <path d="${W.sphere}" fill="#bfe3f5"/><path d="${W.graticule}" fill="none" stroke="#a9d3ea" stroke-width=".5"/>
    ${others}<g class="countries">${paths}${dots}</g></svg>`;
}
function onMapTap(root, fn) {
  const svg = root.querySelector(".world-map");
  if (!svg) return;
  svg.addEventListener("click", e => {
    const code = e.target && e.target.getAttribute && e.target.getAttribute("data-c");
    if (code && byCode.has(code)) fn(byCode.get(code));
  });
}
function chips(labels, current, onPick, cls = "") {
  const box = document.createElement("div");
  box.className = "chips " + cls;
  labels.forEach(([value, html]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = html;
    b.setAttribute("aria-pressed", value === current);
    b.onclick = () => onPick(value);
    box.appendChild(b);
  });
  return box;
}

/* ---------------------------------------------------------------- country card */
function speakCountry(c) {
  const parts = [c.n + "."];
  if (c.cap) parts.push(`The capital is ${c.cap}.`);
  parts.push(`It is in ${c.k}.`);
  if (c.fact) parts.push(c.fact);
  A().say(parts.join(" "), { lang: "en", rate: 0.9 });
}
function countryCard(c) {
  const [x0, y0, x1, y1] = c.box || [c.dot[0] - 20, c.dot[1] - 12, c.dot[0] + 20, c.dot[1] + 12];
  const pad = Math.max(12, (x1 - x0) * .6, (y1 - y0) * .6);
  const vb = `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
  const things = thingsOf(c);
  const rows = [
    ["🏙️", "Capital city", c.cap || "none"],
    ["🌍", "Continent", c.k + (c.sub && c.sub !== c.k ? ` (${c.sub})` : "")],
    ["🗣️", c.lang.length > 1 ? "Languages" : "Language", listNames(c.lang)],
    ["💰", "Money", listNames(c.cur)],
    ["🤝", c.nb.length === 1 ? "Neighbor" : "Neighbors", c.nb.length ? listNames(c.nb) : (c.land ? "none" : "the sea all around")],
    ["📏", "Size", `${c.area.toLocaleString("en")} km²`]
  ].filter(r => r[2]);
  return `<article class="postcard" style="--cc:${(CONTINENTS[c.k] || {}).color || "#cfd8dc"}">
    <header class="pc-head">
      <span class="pc-flag" aria-hidden="true">${flagOf(c)}</span>
      <div><h3>${esc(c.n)}</h3><p>${c.ind ? "" : "A territory · "}${esc(c.k)}</p></div>
      <button type="button" class="btn" data-speak>🔊 Hear it</button>
    </header>
    <div class="pc-body">
      <div class="pc-map">${mapSvg({ viewBox: vb, highlight: new Set([c.c]), id: "miniMap", colorBy: "plain" })}</div>
      <dl class="pc-facts">${rows.map(([i, k, v]) => `<div><dt>${i} ${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    </div>
    ${things.length ? `<p class="pc-sub">Famous for</p><div class="pc-things">${things.map(t => {
      const [e, ...rest] = A().graphemes(t);
      return `<div class="thing"><span aria-hidden="true">${e}</span><small>${esc(rest.join("").trim())}</small></div>`;
    }).join("")}</div>` : ""}
    ${c.fact ? `<p class="pc-fact">💡 ${esc(c.fact)}</p>` : ""}
    ${c.land ? `<p class="pc-note">🏞️ ${esc(c.n)} is landlocked: it has no sea coast.</p>` : ""}
  </article>`;
}

/* ---------------------------------------------------------------- views */
function render() {
  const panel = A().panel;
  panel.innerHTML = `<h2>World map</h2><p class="hint">Tap a country to see its flag, its capital and what it is famous for.</p>`;
  panel.appendChild(chips(MODES.map((m, i) => [i, m]), state.mode, i => { state.mode = i; state.quiz = null; A().stop(); render(); }));
  const body = document.createElement("div");
  panel.appendChild(body);
  [explore, continents, () => quiz(body, "flag"), () => quiz(body, "capital"), () => quiz(body, "find")][state.mode](body);
}

function explore(body) {
  body.appendChild(chips([["World", "🌍 Whole world"], ...CONT_NAMES.filter(k => k !== "Antarctica").map(k => [k, `${CONTINENTS[k].icon} ${k}`])], state.zoom,
    z => { state.zoom = z; render(); }, "zoom-chips"));
  body.insertAdjacentHTML("beforeend", `<div class="map-wrap">${mapSvg({ viewBox: viewBoxFor(state.zoom), highlight: state.sel ? new Set([state.sel]) : null })}</div>
    <div class="legend">${CONT_NAMES.map(k => `<span><i style="background:${CONTINENTS[k].color}"></i>${k}</span>`).join("")}</div>
    <div class="btns" style="margin:10px 0"><button type="button" class="btn go" id="surprise">🎲 Surprise me</button></div>
    <div id="card"></div>
    <p class="section-title">${state.zoom === "World" ? "All countries" : "Countries in " + state.zoom}</p>
    <div class="country-list"></div>`);
  const pickCountry = c => {
    state.sel = c.c;
    body.querySelectorAll(".world-map .hl").forEach(el => { el.classList.remove("hl"); el.setAttribute("fill", CONTINENTS[byCode.get(el.dataset.c).k].color); if (el.tagName === "circle") el.setAttribute("r", el.dataset.r); });
    const el = body.querySelector(`.world-map [data-c="${c.c}"]`);
    if (el) { el.classList.add("hl"); el.setAttribute("fill", "#ffc93c"); if (el.tagName === "circle") el.setAttribute("r", el.dataset.r * 1.8); }
    showCard(body, c);
    speakCountry(c);
  };
  onMapTap(body, pickCountry);
  const list = body.querySelector(".country-list");
  const pool = W.countries.filter(c => state.zoom === "World" ? c.c !== "AQ" : c.k === state.zoom);
  pool.forEach(c => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span aria-hidden="true">${flagOf(c)}</span> ${esc(c.n)}`;
    b.onclick = () => { pickCountry(c); body.querySelector("#card").scrollIntoView({ behavior: "smooth", block: "start" }); };
    list.appendChild(b);
  });
  body.querySelector("#surprise").onclick = () => { const c = A().draw("world:surprise:" + state.zoom, pool); pickCountry(c); body.querySelector("#card").scrollIntoView({ behavior: "smooth", block: "start" }); };
  if (state.sel && byCode.has(state.sel)) showCard(body, byCode.get(state.sel));
}
function showCard(body, c) {
  const card = body.querySelector("#card");
  card.innerHTML = countryCard(c);
  card.querySelector("[data-speak]").onclick = () => speakCountry(c);
}

function continents(body) {
  const k = state.cont || "Africa";
  body.appendChild(chips(CONT_NAMES.map(n => [n, `${CONTINENTS[n].icon} ${n}`]), k, n => { state.cont = n; render(); A().say(n, { lang: "en" }); }));
  const list = k === "Antarctica" ? [] : countriesIn(k);
  const info = CONTINENTS[k];
  body.insertAdjacentHTML("beforeend", `<div class="map-wrap">${mapSvg({ viewBox: `0 0 ${W.W} ${W.H}`, dim: c => c.k === k, highlight: null })}</div>
    <div class="cont-card" style="--cc:${info.color}"><h3>${info.icon} ${esc(k)}</h3><p>${esc(info.fact)}</p>
    ${list.length ? `<p><b>${list.length}</b> countries</p>` : ""}</div>
    <div id="card"></div>
    <div class="flag-grid"></div>
    <div class="btns" style="margin-top:14px"><button type="button" class="btn" id="contQuiz">🎯 Continent game</button></div>`);
  onMapTap(body, c => { showCard(body, c); speakCountry(c); });
  const grid = body.querySelector(".flag-grid");
  list.forEach(c => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span class="f" aria-hidden="true">${flagOf(c)}</span><small>${esc(c.n)}</small>`;
    b.onclick = () => { showCard(body, c); speakCountry(c); body.querySelector("#card").scrollIntoView({ behavior: "smooth", block: "start" }); };
    grid.appendChild(b);
  });
  body.querySelector("#contQuiz").onclick = () => { state.mode = 5; state.quiz = null; renderContinentGame(); };
}

/* ---------------------------------------------------------------- quizzes */
const QUIZ_POOL = {
  flag: () => W.countries.filter(c => c.ind && c.c !== "AQ" && A().emojiOK(c.f)),
  capital: () => W.countries.filter(c => c.ind && c.cap),
  find: () => W.countries.filter(c => c.d && c.area > 250000 && c.ind),
  continent: () => W.countries.filter(c => c.d && c.area > 150000 && c.ind)
};
function newQuiz(kind) { return { kind, round: 0, rounds: 10, cur: null, tries: 0 }; }
function progress(q) {
  return `<div class="progress">${Array.from({ length: q.rounds }, (_, i) => `<i class="${i < q.round ? "done" : ""}"></i>`).join("")}</div>`;
}
function finishQuiz(body, again) {
  body.innerHTML = `<div class="celebrate">🏆 Well done, ${esc(A().CHILD)}! You are a world explorer!</div>
    <div class="btns"><button class="btn" type="button">Play again</button></div>`;
  body.querySelector("button").onclick = again;
  A().say(`Well done, ${A().CHILD}! You are a world explorer!`, { lang: "en" });
  A().confetti();
}
function nextRound(q, redraw) {
  const token = q;
  setTimeout(() => { if (state.quiz !== token || !A().isTab(TAB)) return; q.round++; q.cur = null; q.tries = 0; redraw(); }, 1900);
}
function praise(fb, extra) {
  const m = A().pick(["Great job!", "Super!", "You got it!", "Brilliant!", "Well done!"]);
  fb.className = "feedback good";
  fb.textContent = "⭐ " + m;
  A().addStar();
  A().say((extra ? extra + ". " : "") + m, { lang: "en" });
}
function oops(fb, text) {
  fb.className = "feedback bad";
  fb.textContent = text || "Try again!";
  A().say(text || "Try again!", { lang: "en" });
}
function quiz(body, kind) {
  if (!state.quiz || state.quiz.kind !== kind) state.quiz = newQuiz(kind);
  const q = state.quiz;
  const redraw = () => { if (state.quiz === q) render(); };
  if (q.round >= q.rounds) return finishQuiz(body, () => { state.quiz = null; render(); });
  const pool = QUIZ_POOL[kind]();
  if (!q.cur) {
    const target = A().draw("world:" + kind, pool);
    const near = pool.filter(c => c !== target && c.k === target.k);
    const others = A().shuffle(near.length >= 3 ? near : pool.filter(c => c !== target)).slice(0, 3);
    q.cur = { target, options: A().shuffle([target, ...others]) };
    if (kind === "find") A().say(`Where is ${target.n}?`, { lang: "en" });
    if (kind === "capital") A().say(`What is the capital of ${target.n}?`, { lang: "en" });
    if (kind === "flag") A().say("Which country has this flag?", { lang: "en" });
  }
  const { target, options } = q.cur;
  if (kind === "find") {
    body.innerHTML = `${progress(q)}<p class="math-ask">Where is <b>${esc(target.n)}</b>? Tap it on the map.</p>
      <div class="chips zoom-chips"></div>
      <div class="map-wrap">${mapSvg({ viewBox: viewBoxFor(state.findZoom || "World") })}</div><div class="feedback"></div>
      <p class="hint">Hint: it is in ${esc(target.k)}.</p>`;
    const zc = body.querySelector(".zoom-chips");
    zc.replaceWith(chips([["World", "🌍 World"], [target.k, `🔍 Zoom to ${target.k}`]], state.findZoom || "World", z => { state.findZoom = z; redraw(); }, "zoom-chips"));
    const fb = body.querySelector(".feedback");
    let locked = false;
    onMapTap(body, c => {
      if (locked) return;
      const el = body.querySelector(`.world-map [data-c="${c.c}"]`);
      if (c === target) {
        locked = true;
        el && (el.setAttribute("fill", "#3fa66b"), el.classList.add("hl"));
        praise(fb, `Yes! That is ${target.n}`);
        state.findZoom = "World";
        nextRound(q, redraw);
      } else {
        q.tries++;
        oops(fb, `That is ${c.n}. Try again!`);
        if (q.tries >= 3) {
          const t = body.querySelector(`.world-map [data-c="${target.c}"]`);
          t && (t.setAttribute("fill", "#ffc93c"), t.classList.add("hl", "blink"));
        }
      }
    });
    return;
  }
  body.innerHTML = kind === "flag"
    ? `${progress(q)}<p class="math-ask">Which country has this flag?</p><div class="big-flag" aria-hidden="true">${flagOf(target)}</div>
       <div class="choices text world-choices"></div><div class="feedback"></div>`
    : `${progress(q)}<p class="math-ask">What is the capital of <b>${esc(target.n)}</b>?</p><div class="big-flag small" aria-hidden="true">${flagOf(target)}</div>
       <div class="choices text world-choices"></div><div class="feedback"></div>`;
  const box = body.querySelector(".choices"), fb = body.querySelector(".feedback");
  let locked = false;
  options.forEach(o => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = kind === "flag" ? o.n : o.cap;
    b.onclick = () => {
      if (locked) return;
      if (o === target) {
        locked = true;
        b.classList.add("right");
        praise(fb, kind === "flag" ? `Yes! It is ${target.n}` : `Yes! ${target.cap} is the capital of ${target.n}`);
        nextRound(q, redraw);
      } else {
        b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong");
        oops(fb, "Not quite. Try again!");
      }
    };
    box.appendChild(b);
  });
}
function renderContinentGame() {
  const panel = A().panel;
  panel.innerHTML = `<h2>Continent game</h2><p class="hint">Tap the right continent on the map.</p>`;
  const back = document.createElement("div");
  back.className = "btns";
  back.innerHTML = `<button type="button" class="btn alt">◀ Back to continents</button>`;
  back.firstElementChild.onclick = () => { state.mode = 1; state.quiz = null; render(); };
  panel.appendChild(back);
  const body = document.createElement("div");
  panel.appendChild(body);
  if (!state.quiz || state.quiz.kind !== "continent") state.quiz = newQuiz("continent");
  const q = state.quiz;
  const redraw = () => { if (state.quiz === q) renderContinentGame(); };
  if (q.round >= q.rounds) return finishQuiz(body, () => { state.quiz = null; renderContinentGame(); });
  if (!q.cur) {
    q.cur = { target: A().draw("world:continent", CONT_NAMES.filter(k => k !== "Antarctica")) };
    A().say(`Where is ${q.cur.target}?`, { lang: "en" });
  }
  const k = q.cur.target;
  body.innerHTML = `${progress(q)}<p class="math-ask">Where is <b>${esc(k)}</b>?</p>
    <div class="map-wrap">${mapSvg({ viewBox: `0 0 ${W.W} ${W.H}`, dim: () => false })}</div><div class="feedback"></div>`;
  const fb = body.querySelector(".feedback");
  let locked = false;
  onMapTap(body, c => {
    if (locked) return;
    if (c.k === k) {
      locked = true;
      body.querySelectorAll(".world-map [data-c]").forEach(el => { if (byCode.get(el.dataset.c).k === k) el.setAttribute("fill", CONTINENTS[k].color); });
      praise(fb, `Yes! That is ${k}`);
      nextRound(q, redraw);
    } else {
      oops(fb, `That is ${c.k}. Try again!`);
    }
  });
}

window.AharaWorld = { render: () => state.mode === 5 ? renderContinentGame() : render() };
})();
