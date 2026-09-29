---
description: Set up this repo: venv, dependencies, raw data, curated data
name: fly-setup
agent: agent
---

# Set up SkyArena

Goal: leave a fresh clone ready to run. When you finish, `.venv` exists, the
five curated files are in `data/curated/`, and the participant knows how to
open the piece. One script does the work, so run it and check the result.

## Steps

1. Check the prerequisite. Python must be 3.11 or newer.

   ```
   python --version
   ```

   On Windows, `py -3 --version` also works. On macOS and Linux, use
   `python3`. If Python is missing or older than 3.11, tell the participant to
   install it from https://www.python.org/downloads/, and stop.

2. Run the setup script from the repo root. Use the interpreter from step 1.

   ```
   python scripts/setup.py
   ```

   The script creates `.venv`, installs `pyarrow` and `gdown` into it,
   downloads the raw packs into `data/raw/` (about 70 MB, so it needs an
   internet connection and takes a few minutes), and writes the five curated
   files into `data/curated/`. It skips what is already present, so it is safe
   to run twice.

3. Check the result. All of these must be true:

   - `.venv` exists in the repo root.
   - `data/curated/` holds `capitals.json`, `stars_catalog`,
     `quakes_21062026.json`, `fly.parquet`, and `fish.parquet`.
   - The script's last line starts with `Done.`

4. Tell the participant how to open the piece, which serves it at
   http://127.0.0.1:5444/app/:

   - Windows: double-click `SkyArena.bat` in the repo root.
   - macOS and Linux: run `.venv/bin/python scripts/serve.py --open`.

   Then press PRESS START in the browser.

## If it fails

Show the participant the `[fail]` line and stop. The usual causes:

- No internet connection, or a network that blocks Google Drive. The data
  downloads use it.
- Python older than 3.11.
- Port 5444 held by another program. That affects only step 4. Do not stop a
  process you did not start.

Fix the cause and run step 2 again.

## Rules

- Use the repo `.venv`. Do not install packages into the system Python.
- Do not edit the files under `scripts/data/` to make a download succeed.
- Do not read or print `.env`. Setup does not need it.
