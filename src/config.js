/**
 * You Are the Soccer Ball - central configuration.
 *
 * Change ACTIVE_DIFFICULTY to try a different profile. Every value that affects
 * the scripted trajectory, rules, input, scoring, or audio lives here so the
 * game loop contains no gameplay magic numbers.
 */

export const ACTIVE_DIFFICULTY = "ACCESSIBLE"; // "HARD" or "ACCESSIBLE"
export const DEBUG_MODE = false; // true or false

const SHARED = {
  world: {
    // Logical 5:8 portrait world. The Canvas is then scaled to the real DPR.
    width: 600,
    height: 960,
    floorY: 882,
    fixedTimeStep: 1 / 120,
    maxFrameDelta: 0.05,
    maxDevicePixelRatio: 2,
    pauseWhenHidden: true,
  },

  game: {
    targetScore: 100,
    keepPlayingAfterWin: true,
    initialBallX: 195,
    ballRadius: 84,
    playerX: 300,
    playerBottomY: 888,
    playerWidth: 330,
    playerHeight: 330,
    kickPoseDurationMs: 115,
    winBannerDurationMs: 2600,
    storageKey: "enda-soccer-high-score-v1",
    attemptStorageKey: "you-are-the-soccer-ball-attempt-count-v1",
  },

  layout: {
    backgroundShadeOpacity: 0.44,
    kickPrompt: {
      leftX: 4,
      fontSize: 32,
      underlineGap: 2,
      underlineLineWidth: 3,
      fadeOutMs: 700,
    },
    timingZone: {
      visible: false,
      width: 252,
      lineWidth: 4,
      dash: [13, 9],
      tracksBallBottom: true,
    },
    hud: {
      width: 360,
      height: 135,
      y: 24,
      scoreY: 52,
      subtitleY: 105,
      textPadding: 28,
      scoreFontSize: 42,
      scoreMinFontSize: 22,
      subtitleFontSize: 14,
      subtitleMinFontSize: 10,
    },
    medals: {
      size: 54,
      y: 82,
      popDurationMs: 650,
      items: [
        {
          id: "silver",
          score: 50,
          x: 86,
          label: "50",
          face: "#cbd2d9",
          shade: "#7c8794",
          highlight: "#f4f7fa",
          ribbon: "#5168a6",
        },
        {
          id: "gold",
          score: 100,
          x: 514,
          label: "100",
          face: "#f5cf53",
          shade: "#b87922",
          highlight: "#fff1a0",
          ribbon: "#a83d4b",
        },
      ],
    },
    debugFlag: {
      visible: true,
      x: 460,
      y: 914,
      width: 128,
      height: 32,
      label: "AUTO DEBUG",
    },
    winBanner: {
      width: 536,
      height: 112,
      y: 160,
      titleY: 42,
      subtitleY: 79,
    },
  },

  input: {
    acceptPrimaryPointerOnly: true,
    preventContextMenu: true,
    preventDrag: true,
  },

  audio: {
    musicSrc: "assets/audio/Endacopia OST - Soccer Ball [Extended Version].mp3",
    musicStartScore: 7,
    musicVolume: 0.38,
    musicFadeInMs: 1800,
    kickSoundSrc: "assets/audio/kick.mp3",
    kickSoundVolume: 0.72,
    loopMusic: true,
    preload: "auto",
    stopOnGameOver: true,
    resetTrackOnRestart: true,
    retryOnNextGesture: true,
    mutedByDefault: false,
    useWebAudioVolumeFallback: true,
    audioContextLatencyHint: "playback",
  },

  assets: {
    background: "assets/sprites/background.png",
    ball: "assets/sprites/ball.png",
    playerIdle: "assets/sprites/player-idle.png",
    playerKick: "assets/sprites/player-kick.png",
    scorePanel: "assets/sprites/score-panel.png",
  },
};

export const DIFFICULTIES = {
  HARD: {
    label: "Hard",
    trajectory: {
      apexY: 525,
      contactY: 760,
      cycleDurationMs: 640,
    },
    rules: {
      kickCooldownMs: 92,
      requireDescendingBall: true,
      kickWindowTopY: 704,
      kickWindowBottomY: 760,
      failOnMistimedPress: true,
      missFeedbackDurationMs: 160,
    },
  },

  ACCESSIBLE: {
    label: "Accessible",
    trajectory: {
      apexY: 525,
      contactY: 760,
      cycleDurationMs: 640,
    },
    rules: {
      kickCooldownMs: 60,
      requireDescendingBall: true,
      kickWindowTopY: 680,
      kickWindowBottomY: 760,
      failOnMistimedPress: true,
      missFeedbackDurationMs: 220,
    },
  },

};

const SELECTED_DIFFICULTY = ACTIVE_DIFFICULTY;

if (!DIFFICULTIES[SELECTED_DIFFICULTY]) {
  throw new Error(`Unknown difficulty profile: ${SELECTED_DIFFICULTY}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export const CONFIG = deepFreeze({
  ...SHARED,
  debugMode: DEBUG_MODE,
  difficultyName: SELECTED_DIFFICULTY,
  difficultyLabel: DIFFICULTIES[SELECTED_DIFFICULTY].label,
  trajectory: DIFFICULTIES[SELECTED_DIFFICULTY].trajectory,
  rules: {
    ...DIFFICULTIES[SELECTED_DIFFICULTY].rules,
    autoPlay: DEBUG_MODE,
  },
});
