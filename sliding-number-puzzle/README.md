# Sliding Number Puzzle (Chrome Extension)

A classic 15-puzzle — slide numbered tiles around a grid until they're back in
order — playable straight from the Chrome toolbar. Manifest V3, no build
step, no external dependencies.

![size](https://img.shields.io/badge/sizes-3x3%20%7C%204x4%20%7C%205x5-4c51bf)

## Features

- 3x3, 4x4 (classic 15-puzzle), and 5x5 boards, switchable from a dropdown.
- Click/tap a tile next to the empty slot, or use the **arrow keys**, to
  slide it.
- Move counter and a live timer.
- Per-size "best score" (fewest moves) saved locally via `chrome.storage.local`.
- **Resumable:** close the popup mid-game and reopen it (even after restarting
  Chrome) — your board, move count, and timer pick up right where you left
  off.
- Every shuffle is **guaranteed solvable** (see [How the shuffle
  works](#how-the-shuffle-works) below) — you will never get stuck on an
  unsolvable board.
- Light/dark theme, follows your OS preference.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge,
   Brave, etc. use the same flow).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `sliding-number-puzzle` folder.
4. Pin the extension (puzzle-piece icon in the toolbar → pin) so it's always
   one click away.
5. Click the toolbar icon to open the puzzle.

No `npm install`, no bundler — it's plain HTML/CSS/JS, loaded directly by
Chrome.

## How to play

The goal is to arrange the numbered tiles in order — left to right, top to
bottom — with the empty space ending up in the bottom-right corner. For a
4x4 board that means:

```
 1  2  3  4
 5  6  7  8
 9 10 11 12
13 14 15  ·
```

- **Mouse/touch:** click or tap any tile that is directly above, below, left
  of, or right of the empty slot. It slides into the empty slot.
- **Keyboard:** press `↑ ↓ ← →`. The arrow key moves the *empty slot* in
  that direction (equivalently, the tile on that side slides into it). This
  matches the usual "move the hole" mental model used by most sliding-puzzle
  games.
- Click **New Game** at any time to reshuffle the current size. Changing the
  size dropdown also starts a fresh game.
- Moves and elapsed time are tracked while you play; when the board is
  solved you get a "Solved!" banner with your final move count and time,
  and your best (lowest move count) result for that board size is
  remembered for next time.

## Project structure

```
sliding-number-puzzle/
├── manifest.json     # Manifest V3 config: toolbar action + icons + storage permission
├── popup.html         # Markup for the popup window (board, header, stats)
├── popup.css          # Styling, including a dark-mode variant
├── popup.js           # All game logic (see "How the script works" below)
├── icons/              # Toolbar/extension icons (16/48/128 px)
└── README.md
```

## How the script works (`popup.js`)

The whole game lives in one file, `popup.js`, loaded by `popup.html`. Here's
the mental model:

### Board representation

The board is a flat JavaScript array `tiles` of length `size * size`.

- `tiles[i]` is the number shown in cell `i` (`1` .. `size*size - 1`).
- The single empty cell holds the sentinel value `0` (`EMPTY`).
- A cell index maps to a row/column with plain integer math:
  `row = Math.floor(i / size)`, `col = i % size`.

The board is **solved** when `tiles` equals
`[1, 2, 3, ..., size*size - 1, 0]` — i.e. every tile is one more than its
index, and the last cell is the empty slot. That's exactly what
`isSolved()` checks.

### How the shuffle works

Generating a *guaranteed solvable* shuffle is the one part of a sliding
puzzle that's easy to get subtly wrong: a puzzle produced by randomly
permuting all tiles is **only solvable half the time** (there's a
mathematical parity invariant — see the classic 15-puzzle proof). Rather
than implement and trust that parity formula by hand, this game sidesteps
the problem entirely:

> Start from the **solved** board, then make a long sequence of random but
> **legal slides** (exactly the moves a player could make), and use
> whatever board you land on as the shuffled starting position.

Because every board in that sequence is reached by a legal move from the
previous (solvable) one, the final board is *always* solvable — there's no
separate correctness proof needed, and no way for the parity math to be
subtly wrong. `shuffledTiles()` does this: it runs `size^3 * 20` random
legal moves (never immediately undoing the previous move, so it doesn't
just wiggle back and forth), which thoroughly mixes even the 5x5 board.

This was verified in isolation before shipping: a standalone script
cross-checked thousands of shuffled boards, for every supported size,
against the textbook inversion-count/blank-row-parity solvability formula,
and separately BFS-solved a sample 3x3 shuffle end-to-end to confirm a
solution actually exists.

### Moving tiles

- `neighborIndices(index, size)` returns the up/down/left/right neighbor
  cell indices for a given cell, respecting the board edges.
- `attemptMove(index)` is called when a tile is clicked. It only allows the
  move if `index` is an orthogonal neighbor of the current blank cell, then
  swaps the tile into the blank slot, updates the blank's position, and
  bumps the move counter.
- `moveBlank(direction)` handles arrow-key input by translating a direction
  into the target cell index and delegating to `attemptMove()`.

### Resuming after the popup closes

A Chrome popup's page (and all its JS state) is torn down the instant it
loses focus, so "remembering" the game means writing it to
`chrome.storage.local` and reading it back on the next open — there is no
persistent background state to fall back on. `persistState()` saves the full
board (`size`, `tiles`, `blankIndex`, `moves`, elapsed time, and `solved`)
under one storage key after every move and once a second while the timer is
running (so at most ~1 second of play is ever "lost" if the browser itself
crashes between writes).

The elapsed-time bookkeeping needs a small trick because there is no
reliable moment to intercept "the popup is about to close" and no
wall-clock start time that would survive Chrome (or the whole machine) being
shut down for hours: `currentElapsedMs()` is always computed as
`elapsedBaseMs + (Date.now() - resumeAt)`, where `resumeAt` is simply "when
this open of the popup began." Every time the popup opens, `resumeAt` is
reset to `Date.now()` and `elapsedBaseMs` is seeded from whatever was last
persisted — so the displayed time keeps counting up seamlessly across a
close/reopen without ever having to compare timestamps across a browser
restart.

On startup, `initGame()` reads the saved state and hands it to
`resumeGame()` only if `isValidSavedState()` confirms it's well-formed (right
size, tiles are exactly one each of `0..size²-1`, the blank position
actually matches, sane move/time values); this guards against a corrupted
or unexpected-shape record (e.g. from a future version of the extension) —
if validation fails for any reason, it falls back to `newGame()` instead of
throwing. Starting a new game (via the **New Game** button or changing the
size) simply overwrites the saved state with the fresh board.

### Win detection, timer, and best score

- After every move, `checkWinCondition()` calls `isSolved()`; if the board
  is solved it stops the timer, shows the win banner with the final
  move/time summary, and calls `saveBestIfBetter()`.
- The timer is a simple `setInterval` updating a `mm:ss` label once per
  second while the puzzle is unsolved.
- Best scores are stored per board size (e.g. `best_4x4`) in
  `chrome.storage.local`, and only overwritten when a new result has a
  *lower move count* than the stored one.

### Rendering

`render()` rebuilds the grid's DOM every time the board state changes: it
sets `grid-template-columns` to match the current size and creates one
`div.tile` per cell (or `div.tile.empty` for the blank slot, which is
unclickable and hidden from screen readers via `aria-hidden`).

## Permissions

The manifest requests exactly one permission: `storage`, used only to save
your per-size best score locally on your device (`chrome.storage.local`).
Nothing is sent over the network — the extension has no host permissions
and makes no network requests at all.

## Customizing

- **Add another size:** add an `<option>` to the `#size-select` dropdown in
  `popup.html`; the game logic is already generic over `size`.
- **Change tile colors/theme:** edit the CSS custom properties at the top of
  `popup.css` (`:root` for light mode, the `prefers-color-scheme: dark`
  block for dark mode).
- **Change the shuffle difficulty:** tweak the `shuffleMoves` multiplier in
  `shuffledTiles()` inside `popup.js`.
