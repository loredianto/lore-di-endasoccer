/**
 * Enda Soccer - central configuration.
 *
 * Change ACTIVE_DIFFICULTY to try a different profile. Every value that affects
 * the scripted trajectory, rules, input, scoring, or audio lives here so the
 * game loop contains no gameplay magic numbers.
 */

export const ACTIVE_DIFFICULTY = "ACCESSIBLE"; // "HARD" or "ACCESSIBLE"

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
    initialBallX: 300,
    ballRadius: 36,
    playerX: 300,
    playerBottomY: 888,
    playerWidth: 270,
    playerHeight: 270,
    kickPoseDurationMs: 115,
    winBannerDurationMs: 2600,
    storageKey: "enda-soccer-high-score-v1",
  },

  layout: {
    timingGuideWidth: 252,
    timingGuideLineWidth: 4,
    timingGuideLabelGap: 10,
    hud: {
      width: 300,
      height: 112,
      y: 24,
      scoreY: 44,
      subtitleY: 84,
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
    musicSrc: "Endacopia OST - Soccer Ball [Extended Version].mp3",
    musicStartScore: 7,
    musicVolume: 0.38,
    musicFadeInMs: 1800,
    loopMusic: true,
    preload: "auto",
    stopOnGameOver: true,
    resetTrackOnRestart: true,
    retryOnNextGesture: true,
    mutedByDefault: false,
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
      apexY: 330,
      contactY: 800,
      cycleDurationMs: 1000,
      curveExponent: 2,
      rotationRadiansPerCycle: 4.2,
    },
    rules: {
      kickCooldownMs: 128,
      requireDescendingBall: true,
      kickWindowTopY: 700,
      kickWindowBottomY: 764,
      failOnMistimedPress: true,
      missFeedbackDurationMs: 130,
    },
  },

  ACCESSIBLE: {
    label: "Accessible",
    trajectory: {
      apexY: 330,
      contactY: 800,
      cycleDurationMs: 1000,
      curveExponent: 2,
      rotationRadiansPerCycle: 3.4,
    },
    rules: {
      kickCooldownMs: 92,
      requireDescendingBall: false,
      kickWindowTopY: 676,
      kickWindowBottomY: 792,
      failOnMistimedPress: false,
      missFeedbackDurationMs: 160,
    },
  },
};

if (!DIFFICULTIES[ACTIVE_DIFFICULTY]) {
  throw new Error(`Unknown difficulty profile: ${ACTIVE_DIFFICULTY}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export const CONFIG = deepFreeze({
  ...SHARED,
  difficultyName: ACTIVE_DIFFICULTY,
  difficultyLabel: DIFFICULTIES[ACTIVE_DIFFICULTY].label,
  trajectory: DIFFICULTIES[ACTIVE_DIFFICULTY].trajectory,
  rules: DIFFICULTIES[ACTIVE_DIFFICULTY].rules,
});
