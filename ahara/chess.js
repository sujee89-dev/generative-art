// Chess: lessons, puzzles, and games with a friend or an easy computer (English section).
(() => {
"use strict";
const A = () => window.Ahara;
const TAB = 8;

/* ---------------------------------------------------------------- rules */
// Squares are 0..63: index = rank * 8 + file, a1 = 0, h8 = 63. Pieces are "wK", "bP", ...
const FILES = "abcdefgh";
const sqName = i => FILES[i % 8] + (Math.floor(i / 8) + 1);
const sqIndex = n => FILES.indexOf(n[0]) + (+n[1] - 1) * 8;
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const NAME = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };
const GLYPH = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };
const other = c => c === "w" ? "b" : "w";
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

function startState() {
  const b = Array(64).fill(null);
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  back.forEach((t, f) => { b[f] = "w" + t; b[56 + f] = "b" + t; b[8 + f] = "wP"; b[48 + f] = "bP"; });
  return { b, turn: "w", castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null, half: 0 };
}
function stateFrom(pieces, turn = "w") {
  const b = Array(64).fill(null);
  for (const [sq, p] of Object.entries(pieces)) b[sqIndex(sq)] = p;
  return { b, turn, castle: { wK: false, wQ: false, bK: false, bQ: false }, ep: null, half: 0 };
}
const clone = s => ({ b: s.b.slice(), turn: s.turn, castle: { ...s.castle }, ep: s.ep, half: s.half });

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function attacked(s, sq, by) {
  const f = sq % 8, r = Math.floor(sq / 8), b = s.b;
  const at = (ff, rr) => onBoard(ff, rr) ? b[rr * 8 + ff] : undefined;
  const dir = by === "w" ? -1 : 1; // pawns of `by` sit one rank behind the square they attack
  if (at(f - 1, r + dir) === by + "P" || at(f + 1, r + dir) === by + "P") return true;
  for (const [df, dr] of KNIGHT) if (at(f + df, r + dr) === by + "N") return true;
  for (const [df, dr] of KING) if (at(f + df, r + dr) === by + "K") return true;
  const slide = (dirs, types) => dirs.some(([df, dr]) => {
    let ff = f + df, rr = r + dr;
    while (onBoard(ff, rr)) {
      const p = b[rr * 8 + ff];
      if (p) return p[0] === by && types.includes(p[1]);
      ff += df; rr += dr;
    }
    return false;
  });
  return slide(ROOK_DIRS, "RQ") || slide(BISHOP_DIRS, "BQ");
}
const kingSq = (s, c) => s.b.indexOf(c + "K");
const inCheck = (s, c) => { const k = kingSq(s, c); return k >= 0 && attacked(s, k, other(c)); };

function pseudoMoves(s, from) {
  const p = s.b[from];
  if (!p) return [];
  const c = p[0], t = p[1], f = from % 8, r = Math.floor(from / 8), moves = [];
  const add = (to, extra = {}) => moves.push({ from, to, ...extra });
  const target = (ff, rr) => s.b[rr * 8 + ff];
  if (t === "P") {
    const dir = c === "w" ? 1 : -1, startRank = c === "w" ? 1 : 6, lastRank = c === "w" ? 7 : 0;
    const push = (to) => Math.floor(to / 8) === lastRank ? ["Q", "R", "B", "N"].forEach(pr => add(to, { promo: pr })) : add(to);
    if (onBoard(f, r + dir) && !target(f, r + dir)) {
      push((r + dir) * 8 + f);
      if (r === startRank && !target(f, r + 2 * dir)) add((r + 2 * dir) * 8 + f, { double: true });
    }
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, r + dir)) continue;
      const to = (r + dir) * 8 + f + df, q = s.b[to];
      if (q && q[0] !== c) push(to);
      if (s.ep === to) add(to, { ep: true });
    }
  } else if (t === "N" || t === "K") {
    for (const [df, dr] of t === "N" ? KNIGHT : KING) {
      if (!onBoard(f + df, r + dr)) continue;
      const q = target(f + df, r + dr);
      if (!q || q[0] !== c) add((r + dr) * 8 + f + df);
    }
    if (t === "K" && from === (c === "w" ? 4 : 60) && !attacked(s, from, other(c))) {
      const base = c === "w" ? 0 : 56;
      if (s.castle[c + "K"] && !s.b[base + 5] && !s.b[base + 6] && s.b[base + 7] === c + "R" &&
          !attacked(s, base + 5, other(c)) && !attacked(s, base + 6, other(c))) add(base + 6, { castle: "K" });
      if (s.castle[c + "Q"] && !s.b[base + 3] && !s.b[base + 2] && !s.b[base + 1] && s.b[base] === c + "R" &&
          !attacked(s, base + 3, other(c)) && !attacked(s, base + 2, other(c))) add(base + 2, { castle: "Q" });
    }
  } else {
    const dirs = t === "R" ? ROOK_DIRS : t === "B" ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (onBoard(ff, rr)) {
        const q = target(ff, rr);
        if (q && q[0] === c) break;
        add(rr * 8 + ff);
        if (q) break;
        ff += df; rr += dr;
      }
    }
  }
  return moves;
}
function makeMove(s, m) {
  const n = clone(s), p = n.b[m.from], c = p[0];
  n.half = (p[1] === "P" || n.b[m.to]) ? 0 : n.half + 1;
  if (m.ep) n.b[m.to + (c === "w" ? -8 : 8)] = null;
  n.b[m.to] = m.promo ? c + m.promo : p;
  n.b[m.from] = null;
  if (m.castle) {
    const base = c === "w" ? 0 : 56;
    if (m.castle === "K") { n.b[base + 5] = c + "R"; n.b[base + 7] = null; }
    else { n.b[base + 3] = c + "R"; n.b[base] = null; }
  }
  if (p[1] === "K") { n.castle[c + "K"] = false; n.castle[c + "Q"] = false; }
  for (const [sq, key] of [[0, "wQ"], [7, "wK"], [56, "bQ"], [63, "bK"]]) if (m.from === sq || m.to === sq) n.castle[key] = false;
  n.ep = m.double ? (m.from + m.to) / 2 : null;
  n.turn = other(c);
  return n;
}
function legalMoves(s, from) {
  const froms = from === undefined ? [...s.b.keys()].filter(i => s.b[i] && s.b[i][0] === s.turn) : [from];
  return froms.flatMap(f => pseudoMoves(s, f)).filter(m => !inCheck(makeMove(s, m), s.turn));
}
function status(s) {
  const moves = legalMoves(s);
  if (!moves.length) return inCheck(s, s.turn) ? "checkmate" : "stalemate";
  const left = s.b.filter(Boolean).filter(p => p[1] !== "K");
  if (!left.length || (left.length === 1 && "BN".includes(left[0][1]))) return "draw";
  if (s.half >= 100) return "draw";
  return inCheck(s, s.turn) ? "check" : "play";
}

/* ---------------------------------------------------------------- board widget */
// options: { state, flip, interactive, moveFilter, onMove, stars, marks, last, freeTurn, labels }
function boardEl(o) {
  const wrap = document.createElement("div");
  wrap.className = "chess-board" + (o.small ? " small" : "");
  let sel = null, targets = [];
  const drawBoard = () => {
    wrap.innerHTML = "";
    const s = o.state;
    const checkSq = (s.b.includes("wK") && inCheck(s, "w")) ? kingSq(s, "w") : (s.b.includes("bK") && inCheck(s, "b")) ? kingSq(s, "b") : -1;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const r = o.flip ? row : 7 - row, f = o.flip ? 7 - col : col, i = r * 8 + f;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "sq " + ((r + f) % 2 ? "light" : "dark");
        if (o.last && (o.last.from === i || o.last.to === i)) cell.classList.add("last");
        if (i === sel) cell.classList.add("sel");
        if (i === checkSq) cell.classList.add("check");
        if (o.marks && o.marks.has(i)) cell.classList.add("mark");
        const p = s.b[i];
        if (p) cell.innerHTML = `<span class="pc ${p[0] === "w" ? "white" : "black"}">${GLYPH[p[1]]}︎</span>`;
        else if (o.stars && o.stars.has(i)) cell.innerHTML = `<span class="star">⭐</span>`;
        const tgt = targets.find(m => m.to === i);
        if (tgt) cell.insertAdjacentHTML("beforeend", `<i class="${p ? "cap" : "dot"}"></i>`);
        if (col === 0) cell.insertAdjacentHTML("beforeend", `<small class="rk">${r + 1}</small>`);
        if (row === 7) cell.insertAdjacentHTML("beforeend", `<small class="fl">${FILES[f]}</small>`);
        cell.setAttribute("aria-label", sqName(i) + (p ? " " + (p[0] === "w" ? "white " : "black ") + NAME[p[1]] : ""));
        cell.onclick = () => tap(i);
        wrap.appendChild(cell);
      }
    }
  };
  const tap = i => {
    if (o.onSquare) o.onSquare(i);
    if (!o.interactive || !o.interactive()) return;
    const s = o.state;
    const tgt = targets.filter(m => m.to === i);
    if (sel !== null && tgt.length) {
      const go = m => { sel = null; targets = []; o.onMove(m); };
      if (tgt.length > 1 && tgt[0].promo) return choosePromotion(wrap, s.turn, pr => go(tgt.find(m => m.promo === pr)));
      return go(tgt[0]);
    }
    const p = s.b[i];
    if (p && p[0] === s.turn) {
      sel = i;
      targets = o.freeTurn ? pseudoMoves(s, i) : legalMoves(s, i);
      if (o.moveFilter) targets = targets.filter(o.moveFilter);
      if (o.onSelect) o.onSelect(i, targets);
    } else { sel = null; targets = []; }
    drawBoard();
  };
  wrap.redraw = () => { sel = null; targets = []; drawBoard(); };
  drawBoard();
  return wrap;
}
function choosePromotion(board, color, done) {
  const box = document.createElement("div");
  box.className = "promo";
  box.innerHTML = `<p>Your pawn becomes…</p>` + ["Q", "R", "B", "N"].map(t => `<button type="button" data-t="${t}"><span class="pc ${color === "w" ? "white" : "black"}">${GLYPH[t]}︎</span><small>${NAME[t]}</small></button>`).join("");
  box.querySelectorAll("button").forEach(b => b.onclick = () => { box.remove(); done(b.dataset.t); });
  board.appendChild(box);
}

/* ---------------------------------------------------------------- lessons */
const LESSONS = [
  { id: "board", title: "The board", icon: "🔲", text: [
    "A chess board has 64 squares: 8 rows and 8 columns.",
    "Each square has a name: a letter for the column and a number for the row, like e4.",
    "When you start, the bottom right corner square must be light. Remember: light on the right!"
  ], kind: "names" },
  { id: "K", title: "The king", icon: "♚", text: [
    "The king is the most important piece. If your king is trapped, you lose!",
    "The king moves one square in any direction.",
    "Tap the king, then tap a square with a dot. Catch all the stars!"
  ], piece: "wK", at: "d4", stars: ["d5", "e6", "f5", "e4"] },
  { id: "R", title: "The rook", icon: "♜", text: [
    "The rook looks like a castle tower. It is worth 5 points.",
    "It moves in straight lines: up, down, left or right, as far as it likes.",
    "Catch all the stars!"
  ], piece: "wR", at: "a1", stars: ["a6", "f6", "f2", "h2"] },
  { id: "B", title: "The bishop", icon: "♝", text: [
    "The bishop is worth 3 points. It moves diagonally, as far as it likes.",
    "A bishop always stays on the same color of square.",
    "Catch all the stars!"
  ], piece: "wB", at: "c1", stars: ["f4", "d6", "b4", "e1"] },
  { id: "Q", title: "The queen", icon: "♛", text: [
    "The queen is the strongest piece. She is worth 9 points.",
    "She moves like a rook and a bishop together: straight or diagonal, as far as she likes.",
    "Catch all the stars!"
  ], piece: "wQ", at: "d1", stars: ["d5", "h1", "e2", "a5", "a8"] },
  { id: "N", title: "The knight", icon: "♞", text: [
    "The knight looks like a horse. It is worth 3 points.",
    "It moves in an L shape: two squares one way, then one square to the side.",
    "The knight is the only piece that can jump over other pieces. Catch the stars!"
  ], piece: "wN", at: "b1", stars: ["c3", "e4", "g5", "f7"] },
  { id: "P", title: "The pawn", icon: "♟", text: [
    "Pawns are worth 1 point. They move forward one square, never backwards.",
    "On its very first move, a pawn may move two squares.",
    "Pawns capture diagonally, one square forward. Catch the star, then capture the black pawn!"
  ], piece: "wP", at: "e2", stars: ["e4"], enemies: { "f5": "bP" } },
  { id: "capture", title: "Capturing", icon: "⚔️", text: [
    "You capture by moving onto a square with an enemy piece. It leaves the board.",
    "Use the rook to capture all the black pieces!"
  ], piece: "wR", at: "d4", stars: [], enemies: { "d7": "bP", "a7": "bN", "a1": "bB", "g1": "bQ" } },
  { id: "check", title: "Check and checkmate", icon: "👑", text: [
    "When a piece attacks the king, it is called check. The king must get safe right away!",
    "You can get out of check by moving the king, blocking, or capturing the attacker.",
    "If the king cannot escape, that is checkmate, and the game is over.",
    "On this board the black king is in checkmate: the queen attacks it and the white king protects the queen."
  ], show: { "e8": "bK", "e7": "wQ", "e6": "wK" } },
  { id: "special", title: "Special moves", icon: "✨", text: [
    "Castling: the king moves two squares toward a rook, and the rook jumps to the other side of the king. It keeps the king safe.",
    "You may castle only if the king and that rook have not moved yet, nothing is between them, and the king is not in check.",
    "Promotion: when a pawn reaches the other end of the board, it becomes a queen, rook, bishop or knight.",
    "Try it: tap the king and castle, or push the pawn to the end!"
  ], setup: { "e1": "wK", "h1": "wR", "a1": "wR", "g7": "wP", "e8": "bK" }, castle: true },
  { id: "setup", title: "Starting the game", icon: "🏁", text: [
    "White always moves first. Players take turns, one move each.",
    "The queen goes on her own color: the white queen on a light square, the black queen on a dark square.",
    "Piece points: queen 9, rook 5, bishop 3, knight 3, pawn 1. The king is priceless!"
  ], start: true }
];
const PUZZLES = [
  { title: "The back row", hint: "Use the rook to trap the king on the back row.", pos: { "g1": "wK", "a1": "wR", "g8": "bK", "f7": "bP", "g7": "bP", "h7": "bP" } },
  { title: "Queen and king team", hint: "Put the queen right next to the black king, where your king protects her.", pos: { "g6": "wK", "a7": "wQ", "h8": "bK" } },
  { title: "Two rooks", hint: "One rook blocks a row, the other gives check.", pos: { "a1": "wK", "a7": "wR", "b1": "wR", "h8": "bK" } },
  { title: "The jumping knight", hint: "The black king is stuck. Only a knight can reach it.", pos: { "a1": "wK", "e5": "wN", "h8": "bK", "g8": "bR", "g7": "bP", "h7": "bP" } },
  { title: "Queen to the front", hint: "The white king already guards the squares in front of the black king.", pos: { "e6": "wK", "h4": "wQ", "e8": "bK" } },
  { title: "Bishop helps", hint: "Capture a pawn with the queen. The bishop protects her.", pos: { "g1": "wK", "g4": "wQ", "b2": "wB", "h8": "bK", "g7": "bP", "h7": "bP" } }
];

/* ---------------------------------------------------------------- views */
const MODES = ["Learn", "Puzzles", "Play a friend", "Play the computer"];
const st = { mode: 0, lesson: 0, puzzle: 0 };
const esc = s => A().esc(s);
function speak(t) { A().say(t, { lang: "en", rate: 0.9 }); }

function render() {
  const panel = A().panel;
  panel.innerHTML = `<h2>Chess</h2><p class="hint">Learn how every piece moves, solve puzzles, then play a real game.</p>`;
  const chips = document.createElement("div");
  chips.className = "chips";
  MODES.forEach((m, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = m;
    b.setAttribute("aria-pressed", i === st.mode);
    b.onclick = () => { st.mode = i; A().stop(); render(); };
    chips.appendChild(b);
  });
  panel.appendChild(chips);
  const body = document.createElement("div");
  panel.appendChild(body);
  [learn, puzzles, b => play(b, false), b => play(b, true)][st.mode](body);
}

function learn(body) {
  const chips = document.createElement("div");
  chips.className = "chips lesson-chips";
  const done = A().store.get("chessLessons", {});
  LESSONS.forEach((l, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `${l.icon.length === 1 ? `<span class="pc white mini">${l.icon}︎</span>` : l.icon} ${esc(l.title)}${done[l.id] ? " ✓" : ""}`;
    b.setAttribute("aria-pressed", i === st.lesson);
    b.onclick = () => { st.lesson = i; A().stop(); render(); };
    chips.appendChild(b);
  });
  body.appendChild(chips);
  const l = LESSONS[st.lesson];
  const card = document.createElement("div");
  card.className = "lesson";
  card.innerHTML = `<h3>${l.icon.length === 1 ? `<span class="pc white mini">${l.icon}︎</span>` : l.icon} ${esc(l.title)}</h3>
    ${l.text.map(p => `<p>${esc(p)}</p>`).join("")}
    <div class="btns"><button type="button" class="btn alt" data-read>🔊 Read to me</button></div>
    <div class="lesson-status feedback"></div>`;
  card.querySelector("[data-read]").onclick = () => speak(l.text.join(" "));
  body.appendChild(card);
  const statusEl = card.querySelector(".lesson-status");
  const markDone = () => { const d = A().store.get("chessLessons", {}); d[l.id] = 1; A().store.set("chessLessons", d); };

  if (l.kind === "names") {
    let target = null;
    const s = stateFrom({});
    const newTarget = () => { target = Math.floor(Math.random() * 64); statusEl.className = "lesson-status feedback"; statusEl.textContent = `Find square ${sqName(target)}!`; speak(`Find ${sqName(target).split("").join(" ")}`); };
    const board = boardEl({ state: s, interactive: () => false, onSquare: i => {
      if (target === null) { speak(sqName(i).split("").join(" ")); statusEl.textContent = `That square is ${sqName(i)}.`; return; }
      if (i === target) { statusEl.className = "lesson-status feedback good"; statusEl.textContent = `⭐ Yes, that is ${sqName(i)}!`; A().addStar(); markDone(); speak("Yes!"); setTimeout(newTarget, 1400); }
      else { statusEl.className = "lesson-status feedback bad"; statusEl.textContent = `That is ${sqName(i)}. Find ${sqName(target)}!`; }
    } });
    body.appendChild(board);
    const btn = document.createElement("div");
    btn.className = "btns";
    btn.innerHTML = `<button type="button" class="btn go">🎯 Square game</button>`;
    btn.firstElementChild.onclick = newTarget;
    body.appendChild(btn);
    statusEl.textContent = "Tap any square to hear its name.";
    return;
  }
  if (l.show) { body.appendChild(boardEl({ state: stateFrom(l.show, "b"), interactive: () => false })); markDone(); return; }
  if (l.start) { body.appendChild(boardEl({ state: startState(), interactive: () => false })); markDone(); return; }
  if (l.setup) {
    const s0 = stateFrom(l.setup);
    s0.castle = { wK: true, wQ: true, bK: false, bQ: false };
    // Rebuild with a shared move handler so every new board keeps working.
    const mount = (state, last) => {
      const el = boardEl({ state, last, interactive: () => true, onMove: m => {
        const n = makeMove(state, m); n.turn = "w";
        if (m.castle) { statusEl.className = "lesson-status feedback good"; statusEl.textContent = "⭐ You castled! The rook jumped over the king."; A().addStar(); markDone(); speak("You castled!"); }
        else if (m.promo) { statusEl.className = "lesson-status feedback good"; statusEl.textContent = `⭐ Your pawn became a ${NAME[m.promo]}!`; A().addStar(); markDone(); speak(`Your pawn became a ${NAME[m.promo]}!`); }
        el.replaceWith(mount(n, m));
      } });
      return el;
    };
    body.appendChild(mount(s0, null));
    const reset = document.createElement("div");
    reset.className = "btns";
    reset.innerHTML = `<button type="button" class="btn alt">↺ Start again</button>`;
    reset.firstElementChild.onclick = () => render();
    body.appendChild(reset);
    return;
  }
  // Star hunt and capture lessons.
  const stars = new Set(l.stars.map(sqIndex));
  const enemies = Object.keys(l.enemies || {}).length;
  let captured = 0, moves = 0;
  const mount = (state, last) => {
    const el = boardEl({ state, last, stars, freeTurn: true, interactive: () => true, onMove: m => {
      const n = makeMove(state, m); n.turn = "w"; moves++;
      if (state.b[m.to]) { captured++; speak(`You captured the ${NAME[state.b[m.to][1]]}!`); }
      if (stars.has(m.to)) { stars.delete(m.to); speak("Star!"); }
      const left = stars.size + (enemies - captured);
      if (!left) { statusEl.className = "lesson-status feedback good"; statusEl.textContent = `⭐ You did it in ${moves} moves!`; A().addStar(2); markDone(); A().confetti(); speak(`You did it, ${A().CHILD}!`); }
      else { statusEl.className = "lesson-status feedback"; statusEl.textContent = `${left} left to go.`; }
      el.replaceWith(mount(n, m));
    } });
    return el;
  };
  const s0 = stateFrom({ [l.at]: l.piece, ...(l.enemies || {}) });
  body.appendChild(mount(s0, null));
  statusEl.textContent = "Tap the white piece to see where it can go.";
  const reset = document.createElement("div");
  reset.className = "btns";
  reset.innerHTML = `<button type="button" class="btn alt">↺ Start again</button>${st.lesson < LESSONS.length - 1 ? `<button type="button" class="btn go" data-next>Next lesson ▶</button>` : ""}`;
  reset.firstElementChild.onclick = () => render();
  const nx = reset.querySelector("[data-next]");
  if (nx) nx.onclick = () => { st.lesson++; render(); };
  body.appendChild(reset);
}

function puzzles(body) {
  const p = PUZZLES[st.puzzle];
  const solved = A().store.get("chessPuzzles", {});
  const chips = document.createElement("div");
  chips.className = "chips";
  PUZZLES.forEach((q, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = `${i + 1}${solved[i] ? " ✓" : ""}`;
    b.setAttribute("aria-pressed", i === st.puzzle);
    b.onclick = () => { st.puzzle = i; render(); };
    chips.appendChild(b);
  });
  body.appendChild(chips);
  body.insertAdjacentHTML("beforeend", `<div class="lesson"><h3>Puzzle ${st.puzzle + 1}: ${esc(p.title)}</h3>
    <p>White to move. Find the move that gives <b>checkmate</b>!</p><p class="hint">💡 ${esc(p.hint)}</p>
    <div class="lesson-status feedback"></div></div>`);
  const statusEl = body.querySelector(".lesson-status");
  const s0 = stateFrom(p.pos, "w");
  const mount = (state, last, locked) => {
    const el = boardEl({ state, last, interactive: () => !locked, onMove: m => {
      const n = makeMove(state, m);
      if (status(n) === "checkmate") {
        statusEl.className = "lesson-status feedback good"; statusEl.textContent = "⭐ Checkmate! You solved it!";
        const sv = A().store.get("chessPuzzles", {}); sv[st.puzzle] = 1; A().store.set("chessPuzzles", sv);
        A().addStar(3); A().confetti(); speak(`Checkmate! Brilliant, ${A().CHILD}!`);
        el.replaceWith(mount(n, m, true));
      } else {
        statusEl.className = "lesson-status feedback bad"; statusEl.textContent = inCheck(n, "b") ? "Check, but the king can still escape. Try again!" : "Not checkmate yet. Try again!";
        speak("Not quite. Try again!");
        const shown = mount(n, m, true);
        el.replaceWith(shown);
        setTimeout(() => { if (A().isTab(TAB) && shown.isConnected) shown.replaceWith(mount(s0, null, false)); }, 1500);
      }
    } });
    return el;
  };
  body.appendChild(mount(s0, null, false));
  const nav = document.createElement("div");
  nav.className = "btns";
  nav.innerHTML = `<button type="button" class="btn alt" data-d="-1"${st.puzzle ? "" : " disabled"}>◀ Previous</button><button type="button" class="btn go" data-d="1"${st.puzzle < PUZZLES.length - 1 ? "" : " disabled"}>Next puzzle ▶</button>`;
  nav.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { st.puzzle += +b.dataset.d; render(); });
  body.appendChild(nav);
}

/* ---------------------------------------------------------------- games */
function saved(vsComputer) {
  const g = A().store.get(vsComputer ? "chessGameCpu" : "chessGame", null);
  return g && g.s && Array.isArray(g.s.b) ? g : { s: startState(), hist: [], last: null, flip: false, autoFlip: false };
}
function save(vsComputer, g) {
  A().store.set(vsComputer ? "chessGameCpu" : "chessGame", { ...g, hist: g.hist.slice(-120) });
}
function computerMove(s) {
  const moves = legalMoves(s);
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const n = makeMove(s, m);
    let score = Math.random() * 3;
    const victim = m.ep ? "P" : s.b[m.to] && s.b[m.to][1];
    if (victim) score += VALUE[victim] * 10;
    if (m.promo) score += m.promo === "Q" ? 80 : 20;
    const st2 = status(n);
    if (st2 === "checkmate") score += 1000;
    if (st2 === "check") score += 2;
    if (attacked(n, m.to, n.turn)) score -= VALUE[(m.promo || s.b[m.from][1])] * 9;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
function play(body, vsComputer) {
  const g = saved(vsComputer);
  const who = c => vsComputer ? (c === "w" ? A().CHILD : "Computer") : (c === "w" ? "White" : "Black");
  const captured = c => {
    const counts = { Q: 1, R: 2, B: 2, N: 2, P: 8 };
    g.s.b.forEach(p => { if (p && p[0] === c && counts[p[1]] !== undefined) counts[p[1]]--; });
    return Object.entries(counts).flatMap(([t, n]) => Array(Math.max(0, n)).fill(`<span class="pc ${c === "w" ? "white" : "black"}">${GLYPH[t]}︎</span>`)).join("");
  };
  const stat = status(g.s);
  const msg = stat === "checkmate" ? `Checkmate! ${who(other(g.s.turn))} wins! 🏆`
    : stat === "stalemate" ? "Stalemate. It's a draw! 🤝"
    : stat === "draw" ? "It's a draw! 🤝"
    : (stat === "check" ? "Check! " : "") + `${who(g.s.turn)}'s turn` + (vsComputer && g.s.turn === "b" ? "… thinking" : "");
  body.innerHTML = `<div class="game-top">
      <p class="turn ${g.s.turn === "w" ? "t-white" : "t-black"} ${stat === "check" ? "is-check" : ""}">${esc(msg)}</p>
      <div class="taken">${captured("b")}</div>
    </div>
    <div class="board-slot"></div>
    <div class="taken">${captured("w")}</div>
    <div class="btns game-btns">
      <button type="button" class="btn alt" data-undo${g.hist.length ? "" : " disabled"}>↶ Undo</button>
      ${vsComputer ? "" : `<button type="button" class="btn alt" data-flip>🔄 Turn board</button>`}
      <button type="button" class="btn" data-new>New game</button>
    </div>
    ${vsComputer ? `<p class="hint">You play White. The computer is a beginner too.</p>` : `<label class="auto-flip"><input type="checkbox" id="autoFlip"${g.autoFlip ? " checked" : ""}> Turn the board after every move (for playing face to face)</label>
    <p class="hint">Take turns on the same tablet. Tap a piece to see where it can go.</p>`}`;
  const flip = vsComputer ? false : (g.autoFlip ? g.s.turn === "b" : g.flip);
  const over = stat === "checkmate" || stat === "stalemate" || stat === "draw";
  const board = boardEl({ state: g.s, flip, last: g.last, interactive: () => !over && !(vsComputer && g.s.turn === "b"), onMove: m => {
    g.hist.push({ s: g.s, last: g.last });
    g.s = makeMove(g.s, m);
    g.last = m;
    save(vsComputer, g);
    const st2 = status(g.s);
    if (st2 === "checkmate") { A().addStar(3); A().confetti(); speak(`Checkmate! ${who(other(g.s.turn))} wins!`); }
    else if (st2 === "check") speak("Check!");
    play(body, vsComputer);
  } });
  body.querySelector(".board-slot").appendChild(board);
  body.querySelector("[data-undo]").onclick = () => {
    let steps = vsComputer && g.hist.length >= 2 && g.s.turn === "w" ? 2 : 1;
    while (steps-- && g.hist.length) { const h = g.hist.pop(); g.s = h.s; g.last = h.last; }
    save(vsComputer, g); play(body, vsComputer);
  };
  body.querySelector("[data-new]").onclick = () => {
    const fresh = { s: startState(), hist: [], last: null, flip: false, autoFlip: g.autoFlip };
    save(vsComputer, fresh); play(body, vsComputer);
  };
  const fl = body.querySelector("[data-flip]");
  if (fl) fl.onclick = () => { g.flip = !g.flip; g.autoFlip = false; save(vsComputer, g); play(body, vsComputer); };
  const af = body.querySelector("#autoFlip");
  if (af) af.onchange = () => { g.autoFlip = af.checked; save(vsComputer, g); play(body, vsComputer); };
  if (vsComputer && g.s.turn === "b" && !over) {
    const before = g.s;
    setTimeout(() => {
      if (!A().isTab(TAB) || st.mode !== 3 || g.s !== before || !body.isConnected) return;
      const m = computerMove(g.s);
      if (!m) return;
      g.hist.push({ s: g.s, last: g.last });
      g.s = makeMove(g.s, m); g.last = m;
      save(vsComputer, g);
      const st2 = status(g.s);
      if (st2 === "checkmate") speak("Checkmate! The computer wins this time.");
      else if (st2 === "check") speak("Check!");
      play(body, vsComputer);
    }, 700);
  }
}

window.AharaChess = { render, _rules: { startState, stateFrom, legalMoves, makeMove, status, sqIndex, sqName, computerMove } };
})();
