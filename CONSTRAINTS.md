# CONSTRAINTS.md

The quality bar for this repo. **Tracked in git on purpose** — it is part of the
repo's contract, not local session state. Keep it short enough to read.

Three skills read this file: `tg-plan` names which constraints a change puts at
risk; `tg-review-plan` / `tg-review-last` / `tg-review-session` check that a diff
did not *lower* the bar to reach green.

## Gates

The commands that must pass. This repo has no test suite, so the gates are lint,
data rebuild, and a manual check of the running piece.

| Gate | Command |
|---|---|
| lint | `.venv\Scripts\python.exe -m pip install ruff`, then `.venv\Scripts\python.exe -m ruff check .` — setup does not install ruff, so the install is part of the gate |
| data (only if `scripts/data/` or the curated inputs changed) | `.venv\Scripts\python.exe scripts\setup.py` — must end with a line starting `Done.` |
| on-screen (only if `app/` changed) | `SkyArena.bat`, then press PRESS START and check the change in the browser; page errors show in the browser console |
| working tree | `git status` shows nothing unexpected |

The tracked contract is [`AGENTS.md`](AGENTS.md), which carries the setup steps
and the on-screen check in full.

## Non-negotiables

Things a change must not weaken.

- **No new suppressions.** No `# noqa`, no `ruff: noqa` file headers, no
  `.ruff.toml` rule removals added to silence an existing failure. `select` in
  `pyproject.toml` covers `E`, `F`, `I`, and `D`; narrowing it is a bar change.
  If a suppression is genuinely correct, say why in the diff.
- **No swallowed errors.** No bare `except: pass`, no empty `catch {}`.
- **No widened gates for a green run.** Do not relax `line-length`, drop a ruff
  rule, or delete a `[fail]` check in `scripts/setup.py` to make a command pass.
- **The palette stays locked.** Every pixel comes from a ramp in
  `app/palette.js`. A new color is a scope change — say so, do not slip it in.
- **No secrets in the repo.** No keys, tokens, or `.env` content committed.
  `.env` stays gitignored; point at the path, never quote the value.
- **The port stays `127.0.0.1:5444`.** Leave 5440, 5442, and 8792 alone.

## Ownership

Who is allowed to change the bar, and how.

- Only the user may *lower* a gate. The agent may propose it in the plan; it may
  never do it silently mid-execution.
- A change that needs a lower bar is a **scope change**, not an implementation
  detail. Stop and ask.
- The user owns `git commit`. Suggest a message; do not commit for them.

## Change log

Append when a gate or non-negotiable changes, and why. A bar that moves silently
is worse than no bar — this is the record that makes weakening visible.

| Date | Change | Why |
|---|---|---|
| 2026-09-25 | Created | Seeded from the Rules and Verify sections of `AGENTS.md` during the [Claude Code setup](AGENTS.md). |
