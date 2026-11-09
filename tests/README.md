# tests

Checks run by hand against the live stack. There's no unit test suite (see "Verifying changes" in `CLAUDE.md`).

## layout/: phone and desktop layout check

Opens each tab (Home, Agent, Rooms, Routines, Settings) of the deployed dashboard in headless Chrome at 360×740, 390×844 and 1280×800. It saves a screenshot of each and fails if:

- the page scrolls sideways, or anything sticks out past the right edge (except inside a sideways-scrolling strip);
- the phone bottom nav isn't pinned to the bottom of the screen, or `main` runs under it;
- the desktop sidebar isn't full height;
- any of the five nav tabs is missing or off-screen;
- the Add device / pairing button covers the nav.

Known gap: a box with `overflow: auto` counts as a sideways scroller, and each tab's scrolling area is one, so content too wide for the screen *inside* a tab can still pass (see Testing gaps in `docs/ux-review.md`).

Run it after deploying a frontend change, from Git Bash at the repo root:

```sh
SMARTHOME_HOST=<pi-host>.<tailnet>.ts.net tests/layout/run.sh [out-dir]
```

- `run.sh` uses `ssh smarthome-pi` (override with `SMARTHOME_SSH`) to mint a 15-minute session token inside `home_gateway` for the first active user. The token goes to a private temp file that's deleted on exit and is never printed.
- Needs Node 22+ and Chrome. Set `CHROME` if Chrome isn't at the default Windows path.
- The screenshots go to `out-dir`, or to a new temp folder if you don't give one. The script prints where.
- Exit codes: 0 = pass, 1 = layout failures (listed), 2 = setup problem.
- It only reads. Opening the tabs sends no device commands. The Agent tab opens a chat socket but sends nothing.
