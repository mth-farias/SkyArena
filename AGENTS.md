# AGENTS.md

Guidance for AI assistants working in **SkyArena**, and for the participants
building with them. This file is the contract. Keep it under 150 lines;
procedures belong in the `fly-*` prompts.

## What this is

SkyArena is a finished interactive piece, described in [`README.md`](README.md):
a real night sky drawn in 8-bit style, with flies, fish, and live earthquakes.
It lives in `app/` and opens with `SkyArena.bat` on http://127.0.0.1:5444/app/.
The participant builds on it alongside the assistant, in VS Code with GitHub
Copilot. There are no lessons in this repo.

## Before you start

- Python **3.11+** on `PATH`, [Git](https://git-scm.com/), and
  [VS Code](https://code.visualstudio.com/) with GitHub Copilot.
- The OpenRouter API key handed out at the session. Copy `.env.example` to
  `.env` and paste the key after `OPENROUTER_API_KEY=`. `.env` is gitignored;
  never commit it.
- Do not install packages into the system Python. Setup creates a repo `.venv`.

## Setup

1. Open this folder in VS Code.
2. In Copilot Chat, run `/fly-setup`. It creates `.venv`, installs `pyarrow`
   and `gdown`, downloads the raw packs, and curates `data/curated/`. It takes
   a few minutes and is safe to run twice. Re-running skips what is already
   present, so it is also the recovery path when data looks wrong.
3. Double-click `SkyArena.bat`.

## How to reply

- Lead with the answer. No preamble, no restating the question.
- Short by default. Complete sentences. Expand only when a decision needs
  evidence.
- Cite paths. Do not paste large files or tool traces.

## Ask before acting

- Use `/fly-confirm-align` whenever the participant is describing a goal or
  brainstorming. Agree on the goal in chat, then stop.
- Use `/fly-plan` before a change that touches more than one or two files.
- Ask when two or more reasonable options exist and the choice matters. Put the
  question in Copilot chat, not buried in prose. Mark a recommended option.

## Session workflow

`fly-onboard` → `fly-confirm-align` → `fly-plan` → *build* →
`fly-review-session` → `fly-handoff`

| Prompt | Use it when |
|---|---|
| `/fly-setup` | Once, to install and fetch everything |
| `/fly-onboard` | At the start of a session, to catch up on where you left off |
| `/fly-confirm-align` | You are describing a goal, and want the assistant to check its understanding first |
| `/fly-plan` | A change will touch more than a couple of files |
| `/fly-review-session` | Before closing the session, to audit what was built |
| `/fly-handoff` | To write the handoff and get a suggested commit message |

The prompts live in `.github/prompts/` and run with a leading slash in Copilot
Chat. The handoff is `.github/handoff.md`, gitignored.

## Layout

- `SkyArena.bat` — starts the server and opens the piece
- `app/` — the piece
  - `index.html`, `view.js` — the page and the drawing and game code
  - `mesh.js` — the Voronoi mesh that carves the sky into cells
  - `palette.js`, `planets.js`, `trails.js` — the locked palette, the planet
    color schemes, the animal trails
  - `fonts/` — Press Start 2P
  - `utils/` — the getters behind the API (`get_data.py`, `data_lookup/`) and
    the sprite art (`sprites/`, with a neon "cyber" set kept beside the
    default one)
- `data/raw/` — downloaded raw packs. Gitignored, except `capitals/`.
- `data/curated/` — the five curated files the app reads. Committed.
- `scripts/data/` — the download and curation pipeline
- `scripts/` — `setup.py` (setup), `serve.py` and `viewer_lock.py` (the viewer)
- `.env` — the OpenRouter API key. Gitignored.

## Rules

- Use the repo `.venv`. Never install into the system Python.
- Never read, print, or commit the contents of `.env`. Point at the path
  instead. `.env.example` shows the key name only.
- HTTP is `127.0.0.1:5444` only. Stop a leftover viewer before starting one
  (`SkyArena.bat` does), and leave 5440, 5442, and 8792 alone.
- Surgical changes. Touch only what the task needs, and match the existing
  style. No drive-by refactors.
- Keep every pixel on the locked palette in `app/palette.js`. Draw new art with
  colors from its ramps, and do not add a color without saying so.
- Python and JavaScript follow Google style. Python is 80 columns, 4 spaces,
  Google docstrings. `ruff` is configured in `pyproject.toml`.
- Verify before calling anything done. Run the command; do not assume.
- The participant owns `git commit`. Suggest a message; do not commit for them.
- Third-party sources: see [`NOTICE`](NOTICE).

## Verify

There is no test suite. The checks that exist:

- `.venv\Scripts\python.exe scripts\setup.py` rebuilds `data/curated/`.
- `.venv\Scripts\python.exe -m pip install ruff`, then `python -m ruff check .`
  lints the Python. Setup does not install `ruff`; install it when you need it.
- `SkyArena.bat` serves the piece. Open it, press PRESS START, and check the
  change on screen. A page error shows in the browser console.
- `git status` shows nothing unexpected.

## Data

`data/raw/capitals/locations.json` and the five curated files in
`data/curated/` ship with the repo, so the piece runs without a download. The
other raw packs are downloaded by `/fly-setup` and curated into `data/curated/`.

Sources: CDS V/50 stars, EMSC/SeismicPortal quakes (a fixed set for 2026-06-21
plus a live feed), and the idtracker.ai Drosophila and zebrafish CSVs. Details
in [`NOTICE`](NOTICE).
