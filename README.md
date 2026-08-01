# Enda Soccer

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
- The first input starts the fall; subsequent inputs are valid only while the
  ball is crossing the timing zone.
- A valid input queues the juggle: the ball keeps descending to the fixed
  contact point and only then starts its next arc. Clicking earlier or later
  inside the timing window never changes the next arc's origin, height, or
  duration.
- The ball always follows the same scripted vertical axis, and the pointer
  never changes its position or direction.
- In the `HARD` profile, pressing at the wrong time immediately ends the game.
- The game ends when the ball touches the ground.
- The goal is reached at 100 juggles, but play continues in endless mode so you
  can improve your high score.
- The high score is stored only in the browser's `localStorage`.
- Music starts on the seventh juggle with a fade-in. The first gesture primes
  the audio to comply with browser autoplay policies; if playback is blocked,
  the game tries again on the next gesture.

The Canvas uses Pointer Events to handle mouse and touch through one input
system. Only the game area sets `touch-action: none`, preventing accidental
zooming or scrolling during play. Buttons and the rest of the page keep normal
browser behavior and touch targets of at least 44 px.

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

The game includes two profiles:

- `HARD`: a faster cycle, a narrow timing window, downward-only input, and an
  immediate game over when the player presses at the wrong time.
- `ACCESSIBLE`: a slower cycle, a wider timing window, and no immediate penalty
  for an early input.

Change a single line to select a profile:

```js
export const ACTIVE_DIFFICULTY = "ACCESSIBLE";
```

The `trajectory` section controls the fixed apex (`apexY`), contact point
(`contactY`), complete-cycle duration (`cycleDurationMs`), curve shape, and ball
rotation per cycle. Both included profiles currently use a `1000 ms` cycle.
Other configurable values include timing-window size,
cooldown, penalties for incorrect input, target score, the juggle that starts
the music, fade-in duration, volume, and reset behavior. World, ground,
character, HUD, timing-guide, and victory-banner coordinates are also
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
├── Endacopia OST - Soccer Ball [Extended Version].mp3
├── assets/
│   └── sprites/
│       └── ...
└── src/
    ├── config.js
    └── game.js
```

## Free deployment

The project is a static website. No build step is required: the repository root
is the output directory.

### Cloudflare Pages

1. Create a new Pages project and connect the Git repository, or use direct
   upload.
2. If prompted, choose a static project with no framework.
3. Leave the build command empty.
4. Set the output directory to `.` (the repository root).
5. Deploy and use the free `pages.dev` subdomain.

### Vercel

1. Import the repository as a new project.
2. Select `Other` as the framework preset.
3. Do not set a build command.
4. Use `.` as the output/root directory and deploy to the `vercel.app`
   subdomain.

### itch.io

1. Add `index.html`, `styles.css`, `src/`, `assets/`, and any distributable
   audio to a ZIP file, keeping `index.html` at the root of the archive.
2. Create an HTML5 project and upload the ZIP.
3. Select the option to run the game in the browser and use a portrait viewport
   with a 5:8 ratio; `600 × 960` is the ideal reference size.

## Music, assets, and tribute notice

The file `Endacopia OST - Soccer Ball [Extended Version].mp3` was supplied by
the user and is only referenced by the code. **Do not publish or redistribute
it without explicit permission from the copyright owner or a license that
allows it.** Before distributing the game, replace it with original or licensed
music, or obtain the necessary authorization.

Likewise, use only original or properly licensed sprites, names, and interface
elements. A mechanic inspired by another work may be described as an unofficial
tribute without implying affiliation or endorsement.
