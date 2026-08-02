# You Are the Soccer Ball

A small, mobile-first browser juggling game with no dependencies. It is built
with HTML, CSS, and vanilla JavaScript and rendered on a Canvas, so it requires
no backend, account, or database. Gameplay uses a logical `600 × 960` portrait
world (5:8), designed first for phones from 320 to 430 px wide and displayed as
a centered vertical cabinet on desktop as well.

## Running locally

JavaScript modules must be served over HTTP; do not open `index.html` directly
through `file://`. The project includes a small dependency-free local server:

```powershell
node server.mjs
```

Then visit <http://127.0.0.1:8080>.

If you prefer Python and have it installed:

```powershell
python -m http.server 8080
```

Alternatively, you can use an external static server:

```powershell
npx serve .
```

## Controls and rules

- PC: left-click anywhere in the game area.
- Smartphone/tablet: tap anywhere in the game area.
- The ball waits motionless near the player's foot. The first input kicks it
  upward but does not increase the score.
- The counter begins with the first correctly timed juggle after the opening
  kick. Subsequent inputs are valid only while the descending ball crosses the
  timing zone.
- A valid input queues the juggle: the ball keeps descending to the fixed
  contact point and only then starts its next arc. Clicking earlier or later
  inside the timing window never changes the next arc's origin, height, or
  duration.
- The ball always follows the same scripted vertical axis, and the pointer
  never changes its position or direction.
- In both profiles, pressing at the wrong time drops the ball and ends the run
  when it reaches the floor.
- After game over, tap or left-click anywhere on the game overlay to reset and
  perform the next opening kick immediately.
- The game ends when the ball touches the ground.
- The goal is reached at 100 juggles, but play continues in endless mode so you
  can improve your high score.
- A silver pixel medal appears at `50` juggles and a gold medal at `100`; both
  remain visible beside the score panel for the rest of the run.
- The high score is stored only in the browser's `localStorage`.
- `TRY: xxx` counts every started run and is stored separately in the browser's
  `localStorage`, so it persists after reloading or closing the page.
- Music starts on the seventh juggle with a fade-in. The first gesture anywhere
  on the page primes the audio to comply with browser autoplay policies. If
  automatic debug play has already passed seven juggles, that same gesture
  starts the pending music immediately without toggling the audio button.
- A successful timed kick immediately plays `assets/audio/kick.mp3`.

The Canvas uses Pointer Events to handle mouse and touch through one input
system. The entire game stage sets `touch-action: none`, preventing accidental
scrolling or double-tap zoom during rapid kicks. The mobile viewport disables
page scaling, while buttons retain touch targets of at least 44 px.

## Portrait and smartphone layout

- The 5:8 ratio never changes, so the Canvas is not stretched on any display.
- `svh` and `dvh` account for dynamic mobile browser bars and device safe areas.
- On portrait phones, the game uses all available width while height allows it;
  on shorter displays, it scales down to remain fully visible.
- In landscape, the cabinet adapts to the available height without distorting
  the scene; on desktop, it remains vertical and centered.
- Rendering accounts for the device pixel ratio up to the configured limit,
  staying sharp without multiplying the rendering workload unnecessarily.

For realistic manual testing, try CSS widths of at least `320`, `360`, `390`,
and `430` px with the browser bars both visible and hidden.

## Difficulty configuration

All parameters affecting gameplay, the scripted trajectory, input rules, the
target, and audio are collected in [`src/config.js`](src/config.js).

The game includes two normal profiles:

- `HARD`: a narrow timing window while the ball is descending.
- `ACCESSIBLE`: the same trajectory with a slightly wider timing
  window. In both modes, pressing outside the window drops the ball and ends
  the run when it reaches the floor.

Change a single line to select a profile:

```js
export const ACTIVE_DIFFICULTY = "ACCESSIBLE";
```

For a fast test run, change `DEBUG_MODE` near the top of the same file:

```js
export const DEBUG_MODE = true;
```

`DEBUG_MODE` is not a separate difficulty profile. It starts automatically and
reuses the profile selected by `ACTIVE_DIFFICULTY` without changing its
trajectory, timing window, cooldown or failure rules. Its only difference is
supplying the kick input automatically when that profile's real timing window
is valid. It still awards the normal `1` point per juggle and continues beyond
`100`, so milestones and endless mode can be observed without clicking. Set it
back to `false` to restore manual input.
When debug mode is active, the Canvas displays an `AUTO DEBUG` flag in the
lower-right corner. Set `layout.debugFlag.visible` to `false` to hide only this
flag without disabling automatic play.

The `trajectory` section controls the fixed apex (`apexY`), contact point
(`contactY`) and complete-cycle duration (`cycleDurationMs`). The vertical path
is calculated from constant gravity and launch velocity, the ball keeps a fixed
orientation, and both profiles use a `640 ms` cycle with a `235 px` vertical
rise.
Set `layout.timingZone.visible` to `true` to display the exact timing area while
testing; it is disabled by default, leaving only the underlined `Kick ↓` prompt.
Other configurable values include timing-window size,
cooldown, penalties for incorrect input, target score, the juggle that starts
the music, fade-in duration, volume, and reset behavior. World, ground,
character, HUD, kick-prompt, and victory-banner coordinates are also
centralized in `world`, `game`, and `layout`, so you do not need to edit the game
loop to realign them.

## Graphics assets

The game also works without images thanks to Canvas fallbacks. When present, it
automatically loads these files:

```text
assets/sprites/background.png
assets/sprites/ball.png
assets/sprites/player-idle.png
assets/sprites/player-kick.png   (optional)
assets/sprites/score-panel.png
```

PNG files with transparency are recommended for the ball, character, and score
panel. The background is cropped using `cover`; other sprites are scaled to the
dimensions defined in the configuration.

## Project structure

```text
endasoccer/
├── index.html
├── styles.css
├── README.md
├── server.mjs
├── assets/
│   ├── audio/
│   │   ├── Endacopia OST - Soccer Ball [Extended Version].mp3
│   │   └── kick.mp3
│   ├── images/
│   │   └── Immagine 2026-08-01 224033.png
│   └── sprites/
│       └── ...
└── src/
    ├── config.js
    └── game.js
```

## Music, assets, and tribute notice

The files in `assets/audio/` were supplied by the user and are only referenced
by the code. **Do not publish or redistribute them without explicit permission
from their copyright owners or licenses that allow it.** Before distributing
the game, replace them with original or licensed audio, or obtain the necessary
authorization.

Likewise, use only original or properly licensed sprites, names, and interface
elements. A mechanic inspired by another work may be described as an unofficial
tribute without implying affiliation or endorsement.
