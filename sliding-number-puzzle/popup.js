/**
 * Sliding Number Puzzle - popup logic.
 *
 * Board model: a flat array `tiles` of length size*size.
 * `tiles[i]` holds the label shown in cell `i` (1..size*size-1), and the
 * single empty cell holds the value 0. Cell index -> row/col via
 * row = Math.floor(i / size), col = i % size.
 *
 * The board is solved when tiles equals [1, 2, ..., size*size - 1, 0]
 * (i.e. reading left-to-right, top-to-bottom, with the blank last).
 */

const EMPTY = 0;

const boardEl = document.getElementById("board");
const movesEl = document.getElementById("moves-value");
const timeEl = document.getElementById("time-value");
const bestEl = document.getElementById("best-value");
const winBanner = document.getElementById("win-banner");
const winSummary = document.getElementById("win-summary");
const sizeSelect = document.getElementById("size-select");
const newGameBtn = document.getElementById("new-game-btn");

/**
 * @type {{size:number, tiles:number[], blankIndex:number, moves:number,
 *   elapsedBaseMs:number, resumeAt:number, timerId:number|null, solved:boolean}}
 *
 * elapsedBaseMs is how much time had already elapsed before the *current*
 * active run (i.e. since the popup was last opened or the game last
 * resumed); resumeAt is the Date.now() timestamp that run started at. Live
 * elapsed time is always elapsedBaseMs + (Date.now() - resumeAt), which
 * lets a save/restore cycle (closing and reopening the popup) continue the
 * clock without needing to persist a wall-clock start time across sessions.
 */
let game = null;

const STORAGE_KEY = "sliding_puzzle_state";
const VALID_SIZES = [3, 4, 5];

function solvedTiles(size) {
  const total = size * size;
  const tiles = new Array(total);
  for (let i = 0; i < total - 1; i++) tiles[i] = i + 1;
  tiles[total - 1] = EMPTY;
  return tiles;
}

function isSolved(tiles) {
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] !== i + 1) return false;
  }
  return tiles[tiles.length - 1] === EMPTY;
}

/**
 * Build a shuffled, GUARANTEED-solvable board by starting from the solved
 * state and replaying a long sequence of random *legal* slides. Because
 * every intermediate state is reachable by a legal move from the previous
 * one, the resulting board is always solvable - no inversion-parity math
 * needed (and no risk of getting that math wrong).
 */
function shuffledTiles(size) {
  const tiles = solvedTiles(size);
  let blank = tiles.length - 1;
  let lastBlank = -1;
  const shuffleMoves = size * size * size * 20; // plenty of mixing for any size

  for (let step = 0; step < shuffleMoves; step++) {
    const neighbors = neighborIndices(blank, size).filter((n) => n !== lastBlank);
    const next = neighbors[Math.floor(Math.random() * neighbors.length)];
    tiles[blank] = tiles[next];
    tiles[next] = EMPTY;
    lastBlank = blank;
    blank = next;
  }

  // Extremely unlikely, but guard against landing back on the solved board.
  if (isSolved(tiles)) {
    const a = 0;
    const b = tiles.length > 1 ? 1 : 0;
    [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
  }

  return tiles;
}

function neighborIndices(index, size) {
  const row = Math.floor(index / size);
  const col = index % size;
  const result = [];
  if (row > 0) result.push(index - size); // up
  if (row < size - 1) result.push(index + size); // down
  if (col > 0) result.push(index - 1); // left
  if (col < size - 1) result.push(index + 1); // right
  return result;
}

function newGame(size) {
  if (game && game.timerId !== null) clearInterval(game.timerId);

  const tiles = shuffledTiles(size);
  game = {
    size,
    tiles,
    blankIndex: tiles.indexOf(EMPTY),
    moves: 0,
    elapsedBaseMs: 0,
    resumeAt: Date.now(),
    timerId: null,
    solved: false,
  };

  winBanner.hidden = true;
  movesEl.textContent = "0";
  timeEl.textContent = "00:00";
  loadBest(size);
  render();
  startTimer();
  persistState();
}

/** Rebuild an in-progress game from a previously saved, validated state. */
function resumeGame(saved) {
  if (game && game.timerId !== null) clearInterval(game.timerId);
  sizeSelect.value = String(saved.size);

  game = {
    size: saved.size,
    tiles: saved.tiles.slice(),
    blankIndex: saved.blankIndex,
    moves: saved.moves,
    elapsedBaseMs: saved.elapsedMs,
    resumeAt: Date.now(),
    timerId: null,
    solved: saved.solved,
  };

  movesEl.textContent = String(game.moves);
  timeEl.textContent = formatTime(currentElapsedMs());
  loadBest(game.size);
  render();

  if (game.solved) {
    winSummary.textContent = `${game.moves} moves in ${formatTime(game.elapsedBaseMs)}`;
    winBanner.hidden = false;
  } else {
    winBanner.hidden = true;
    startTimer();
  }
}

/** Elapsed play time for the current game, live-updated while unsolved. */
function currentElapsedMs() {
  if (!game) return 0;
  if (game.solved) return game.elapsedBaseMs;
  return game.elapsedBaseMs + (Date.now() - game.resumeAt);
}

function startTimer() {
  game.timerId = setInterval(() => {
    if (!game || game.solved) return;
    timeEl.textContent = formatTime(currentElapsedMs());
    persistState();
  }, 1000);
}

/** Save the current game so it can be picked up again after the popup closes. */
function persistState() {
  if (!game) return;
  chrome.storage.local.set({
    [STORAGE_KEY]: {
      size: game.size,
      tiles: game.tiles,
      blankIndex: game.blankIndex,
      moves: game.moves,
      elapsedMs: currentElapsedMs(),
      solved: game.solved,
    },
  });
}

/** Defend against corrupted/unexpected data in storage (e.g. a future format change). */
function isValidSavedState(saved) {
  if (!saved || typeof saved !== "object") return false;
  if (!VALID_SIZES.includes(saved.size)) return false;

  const total = saved.size * saved.size;
  if (!Array.isArray(saved.tiles) || saved.tiles.length !== total) return false;

  const seen = new Set(saved.tiles);
  if (seen.size !== total) return false;
  for (let value = 0; value < total; value++) {
    if (!seen.has(value)) return false;
  }

  if (saved.tiles[saved.blankIndex] !== EMPTY) return false;
  if (!Number.isInteger(saved.moves) || saved.moves < 0) return false;
  if (typeof saved.elapsedMs !== "number" || saved.elapsedMs < 0) return false;

  return true;
}

/** Entry point: continue a saved game if there is a valid one, else start fresh. */
function initGame() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const saved = result[STORAGE_KEY];
    if (isValidSavedState(saved)) {
      resumeGame(saved);
    } else {
      newGame(Number(sizeSelect.value));
    }
  });
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function render() {
  const { size, tiles } = game;
  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.innerHTML = "";

  tiles.forEach((value, index) => {
    const cell = document.createElement("div");
    cell.setAttribute("role", "gridcell");

    if (value === EMPTY) {
      cell.className = "tile empty";
      cell.setAttribute("aria-hidden", "true");
    } else {
      cell.className = "tile";
      cell.textContent = String(value);
      cell.tabIndex = 0;
      cell.setAttribute("aria-label", `Tile ${value}`);
      cell.addEventListener("click", () => attemptMove(index));
    }

    boardEl.appendChild(cell);
  });
}

/** Try to slide the tile at `index` into the blank, if they're adjacent. */
function attemptMove(index) {
  if (!game || game.solved) return;
  const { blankIndex, size } = game;
  if (!neighborIndices(blankIndex, size).includes(index)) return;

  game.tiles[blankIndex] = game.tiles[index];
  game.tiles[index] = EMPTY;
  game.blankIndex = index;
  game.moves += 1;
  movesEl.textContent = String(game.moves);

  render();
  checkWinCondition();
  persistState();
}

/** Move the blank cell one step in `direction` (used by arrow-key input). */
function moveBlank(direction) {
  if (!game || game.solved) return;
  const { blankIndex, size } = game;
  const row = Math.floor(blankIndex / size);
  const col = blankIndex % size;

  let target = null;
  if (direction === "ArrowUp" && row > 0) target = blankIndex - size;
  else if (direction === "ArrowDown" && row < size - 1) target = blankIndex + size;
  else if (direction === "ArrowLeft" && col > 0) target = blankIndex - 1;
  else if (direction === "ArrowRight" && col < size - 1) target = blankIndex + 1;

  if (target !== null) attemptMove(target);
}

function checkWinCondition() {
  if (!isSolved(game.tiles)) return;

  const elapsedMs = currentElapsedMs();
  game.solved = true;
  game.elapsedBaseMs = elapsedMs; // freeze the clock at the winning moment
  clearInterval(game.timerId);
  timeEl.textContent = formatTime(elapsedMs);

  winSummary.textContent = `${game.moves} moves in ${formatTime(elapsedMs)}`;
  winBanner.hidden = false;

  saveBestIfBetter(game.size, game.moves, elapsedMs);
}

function bestKey(size) {
  return `best_${size}x${size}`;
}

function loadBest(size) {
  chrome.storage.local.get([bestKey(size)], (result) => {
    const best = result[bestKey(size)];
    bestEl.textContent = best ? `${best.moves} mv / ${formatTime(best.timeMs)}` : "-";
  });
}

function saveBestIfBetter(size, moves, timeMs) {
  const key = bestKey(size);
  chrome.storage.local.get([key], (result) => {
    const current = result[key];
    const isBetter = !current || moves < current.moves;
    if (isBetter) {
      chrome.storage.local.set({ [key]: { moves, timeMs } }, () => {
        bestEl.textContent = `${moves} mv / ${formatTime(timeMs)}`;
      });
    }
  });
}

newGameBtn.addEventListener("click", () => {
  newGame(Number(sizeSelect.value));
});

sizeSelect.addEventListener("change", () => {
  newGame(Number(sizeSelect.value));
});

document.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  moveBlank(event.key);
});

initGame();
