import { CONFIG } from "./config.js";

const STATES = Object.freeze({
  READY: "READY",
  PLAYING: "PLAYING",
  WON: "WON",
  GAME_OVER: "GAME_OVER",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class EndaSoccerGame {
  constructor() {
    this.canvas = document.querySelector("#game-canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.stage = document.querySelector("#game-stage");
    this.overlay = document.querySelector("#game-overlay");
    this.overlayKicker = document.querySelector("#overlay-kicker");
    this.overlayTitle = document.querySelector("#overlay-title");
    this.overlayCopy = document.querySelector("#overlay-copy");
    this.overlayAction = document.querySelector("#overlay-action");
    this.restartButton = document.querySelector("#restart-button");
    this.muteButton = document.querySelector("#mute-button");
    this.muteIcon = document.querySelector("#mute-icon");
    this.muteLabel = document.querySelector("#mute-label");
    this.scoreAnnouncement = document.querySelector("#score-announcement");
    this.stateAnnouncement = document.querySelector("#state-announcement");
    this.difficultyLabel = document.querySelector("#difficulty-label");

    this.assets = {};
    this.state = STATES.READY;
    this.score = 0;
    this.highScore = this.readHighScore();
    this.ball = this.createBall();
    this.trajectoryProgress = 0.5;
    this.kickQueued = false;
    this.lastKickAt = Number.NEGATIVE_INFINITY;
    this.kickPoseUntil = 0;
    this.winBannerUntil = 0;
    this.missFeedback = null;
    this.lastFrameAt = null;
    this.accumulator = 0;
    this.audioUnlocked = false;
    this.musicStarted = false;
    this.musicPending = false;
    this.audioPlayAttempt = 0;
    this.musicFadeFrame = null;
    this.muted = CONFIG.audio.mutedByDefault;
    this.audioContext = null;

    this.music = new Audio(CONFIG.audio.musicSrc);
    this.music.loop = CONFIG.audio.loopMusic;
    this.music.volume = 0;
    this.music.preload = CONFIG.audio.preload;
    this.music.muted = this.muted;

    this.frame = this.frame.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.resizeCanvas = this.resizeCanvas.bind(this);
  }

  async init() {
    this.difficultyLabel.textContent = `Difficulty: ${CONFIG.difficultyLabel}`;
    this.installEvents();
    this.resizeCanvas();
    this.resetGame();
    await this.preloadAssets();
    requestAnimationFrame(this.frame);
  }

  installEvents() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown, { passive: false });

    if (CONFIG.input.preventContextMenu) {
      this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    if (CONFIG.input.preventDrag) {
      this.canvas.addEventListener("dragstart", (event) => event.preventDefault());
    }

    this.restartButton.addEventListener("click", () => {
      this.primeAudio();
      this.resetGame();
    });

    this.overlayAction.addEventListener("click", () => {
      this.primeAudio();
      this.resetGame();
      this.canvas.focus({ preventScroll: true });
    });

    this.muteButton.addEventListener("click", () => {
      this.primeAudio();
      this.muted = !this.muted;
      this.music.muted = this.muted;
      this.updateMuteButton();

      if (!this.muted && this.score >= CONFIG.audio.musicStartScore) {
        this.tryStartMusic();
      }
    });

    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(this.resizeCanvas);
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener("resize", this.resizeCanvas, { passive: true });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && CONFIG.world.pauseWhenHidden) {
        this.lastFrameAt = null;
        this.accumulator = 0;
      }
    });
  }

  async preloadAssets() {
    const entries = Object.entries(CONFIG.assets);
    await Promise.all(
      entries.map(
        ([name, source]) =>
          new Promise((resolve) => {
            const image = new Image();
            image.decoding = "async";
            image.addEventListener(
              "load",
              () => {
                this.assets[name] = image;
                resolve();
              },
              { once: true },
            );
            image.addEventListener("error", resolve, { once: true });
            image.src = source;
          }),
      ),
    );
  }

  createBall() {
    return {
      x: CONFIG.game.initialBallX,
      y: CONFIG.trajectory.apexY,
      radius: CONFIG.game.ballRadius,
      velocityX: 0,
      velocityY: 0,
      isDescending: true,
      rotation: 0,
    };
  }

  resetGame() {
    this.stopMusic(CONFIG.audio.resetTrackOnRestart);
    this.state = STATES.READY;
    this.score = 0;
    this.ball = this.createBall();
    this.trajectoryProgress = 0.5;
    this.kickQueued = false;
    this.lastKickAt = Number.NEGATIVE_INFINITY;
    this.kickPoseUntil = 0;
    this.winBannerUntil = 0;
    this.missFeedback = null;
    this.accumulator = 0;
    this.lastFrameAt = null;
    this.showReadyOverlay();
    this.updateScoreAnnouncement();
    this.announceState("Game ready. Tap or click the play area to start.");
    this.updateMuteButton();
  }

  handlePointerDown(event) {
    if (
      CONFIG.input.acceptPrimaryPointerOnly &&
      ((!event.isPrimary && event.pointerType !== "mouse") ||
        (event.pointerType === "mouse" && event.button !== 0))
    ) {
      return;
    }

    event.preventDefault();
    this.primeAudio();

    if (this.musicPending && CONFIG.audio.retryOnNextGesture) {
      this.tryStartMusic();
    }

    if (this.state === STATES.GAME_OVER) return;

    const point = this.pointerToWorld(event);
    const now = performance.now();

    if (this.state === STATES.READY) {
      this.startRound();
      return;
    }

    // One successful input is enough for this cycle. The ball still travels to
    // the configured contact point before the next bounce begins.
    if (this.kickQueued) return;

    if (!this.canKick(now)) {
      this.missFeedback = {
        x: point.x,
        y: point.y,
        until: now + CONFIG.rules.missFeedbackDurationMs,
      };

      if (CONFIG.rules.failOnMistimedPress) {
        this.finishGame("timing");
      }
      return;
    }

    this.queueKick(now);
  }

  startRound() {
    this.state = STATES.PLAYING;
    this.trajectoryProgress = 0.5;
    this.kickQueued = false;
    this.syncBallToTrajectory();
    this.hideOverlay();
    this.announceState("Game started. Press when the ball crosses the timing zone.");
  }

  pointerToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CONFIG.world.width,
      y: ((event.clientY - rect.top) / rect.height) * CONFIG.world.height,
    };
  }

  canKick(now) {
    if (this.kickQueued) return false;
    if (now - this.lastKickAt < CONFIG.rules.kickCooldownMs) return false;
    if (this.ball.y < CONFIG.rules.kickWindowTopY) return false;
    if (this.ball.y > CONFIG.rules.kickWindowBottomY) return false;

    return !CONFIG.rules.requireDescendingBall || this.ball.isDescending;
  }

  queueKick(now) {
    this.kickQueued = true;
    this.lastKickAt = now;
    this.missFeedback = null;
  }

  completeScriptedKick() {
    const now = performance.now();
    this.kickQueued = false;
    this.kickPoseUntil = now + CONFIG.game.kickPoseDurationMs;
    this.score += 1;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.writeHighScore();
    }

    if (this.score === CONFIG.game.targetScore && this.state === STATES.PLAYING) {
      this.state = STATES.WON;
      this.winBannerUntil = now + CONFIG.game.winBannerDurationMs;
      this.announceState(
        `Goal reached: ${CONFIG.game.targetScore} juggles. Keep playing to improve your record.`,
      );
    }

    this.updateScoreAnnouncement();

    if (this.score >= CONFIG.audio.musicStartScore) {
      this.tryStartMusic();
    }
  }

  update(dt) {
    if (this.state !== STATES.PLAYING && this.state !== STATES.WON) return;

    const cycleDurationSeconds = CONFIG.trajectory.cycleDurationMs / 1000;
    this.trajectoryProgress += dt / cycleDurationSeconds;
    this.ball.rotation +=
      (CONFIG.trajectory.rotationRadiansPerCycle / cycleDurationSeconds) * dt;

    if (this.trajectoryProgress >= 1) {
      const overflow = this.trajectoryProgress - 1;
      this.trajectoryProgress = 1;
      this.syncBallToTrajectory();

      if (!this.kickQueued) {
        this.ball.y = CONFIG.world.floorY - this.ball.radius;
        this.ball.velocityY = 0;
        this.finishGame("ground");
        return;
      }

      // Scoring and the new bounce always happen at exactly contactY. Input
      // timing only decides whether the scripted bounce is allowed to continue.
      this.completeScriptedKick();
      this.trajectoryProgress = overflow;
    }

    this.syncBallToTrajectory();
  }

  syncBallToTrajectory() {
    const progress = clamp(this.trajectoryProgress, 0, 1);
    const distanceFromApex = Math.abs(progress * 2 - 1);
    const curve = distanceFromApex ** CONFIG.trajectory.curveExponent;
    const travel = CONFIG.trajectory.contactY - CONFIG.trajectory.apexY;
    const cycleDurationSeconds = CONFIG.trajectory.cycleDurationMs / 1000;
    const direction = progress < 0.5 ? -1 : 1;
    const derivative =
      (travel * CONFIG.trajectory.curveExponent *
        distanceFromApex ** (CONFIG.trajectory.curveExponent - 1) * 2) /
      cycleDurationSeconds;

    this.ball.x = CONFIG.game.initialBallX;
    this.ball.y = CONFIG.trajectory.apexY + travel * curve;
    this.ball.velocityX = 0;
    this.ball.velocityY = derivative * direction;
    this.ball.isDescending = progress >= 0.5;
  }

  finishGame(reason = "ground") {
    if (this.state === STATES.GAME_OVER) return;
    this.state = STATES.GAME_OVER;
    if (CONFIG.audio.stopOnGameOver) this.stopMusic(true);
    this.showGameOverOverlay(reason);
    const cause = reason === "timing" ? "Mistimed press." : "The ball hit the ground.";
    this.announceState(`${cause} You scored ${this.score} juggles.`);
  }

  frame(timestamp) {
    if (this.lastFrameAt === null) this.lastFrameAt = timestamp;
    const elapsed = Math.min(
      (timestamp - this.lastFrameAt) / 1000,
      CONFIG.world.maxFrameDelta,
    );
    this.lastFrameAt = timestamp;
    this.accumulator += elapsed;

    while (this.accumulator >= CONFIG.world.fixedTimeStep) {
      this.update(CONFIG.world.fixedTimeStep);
      this.accumulator -= CONFIG.world.fixedTimeStep;
    }

    this.render(timestamp);
    requestAnimationFrame(this.frame);
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.world.maxDevicePixelRatio);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  render(timestamp) {
    const { width, height } = CONFIG.world;
    this.ctx.setTransform(this.canvas.width / width, 0, 0, this.canvas.height / height, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.drawBackground();
    this.drawTimingGuide();
    this.drawPlayer(timestamp);
    this.drawBall();
    this.drawHud();

    if (this.missFeedback && timestamp < this.missFeedback.until) {
      this.drawMissFeedback(timestamp);
    }

    if (this.state === STATES.WON && timestamp < this.winBannerUntil) {
      this.drawWinBanner();
    }
  }

  drawBackground() {
    const background = this.assets.background;
    if (background) {
      this.drawImageCover(background, 0, 0, CONFIG.world.width, CONFIG.world.height);
      return;
    }

    const ctx = this.ctx;
    const { width, height, floorY } = CONFIG.world;
    const sky = ctx.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, "#55445f");
    sky.addColorStop(0.58, "#8b6874");
    sky.addColorStop(1, "#e0a36c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, floorY);

    ctx.fillStyle = "rgba(255, 219, 151, 0.35)";
    ctx.beginPath();
    ctx.arc(width * 0.78, height * 0.17, width * 0.09, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#3d3442";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.6);
    ctx.lineTo(width * 0.12, height * 0.48);
    ctx.lineTo(width * 0.28, height * 0.62);
    ctx.lineTo(width * 0.43, height * 0.45);
    ctx.lineTo(width * 0.61, height * 0.63);
    ctx.lineTo(width * 0.78, height * 0.49);
    ctx.lineTo(width, height * 0.64);
    ctx.lineTo(width, floorY);
    ctx.lineTo(0, floorY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#312d36";
    const postSpacing = width / 7;
    for (let x = postSpacing * 0.25; x < width; x += postSpacing) {
      const stagger = Math.round(x / postSpacing) % 2;
      ctx.fillRect(x, height * 0.58 + stagger * 24, 10, floorY - height * 0.58);
      ctx.beginPath();
      ctx.arc(x + 5, height * 0.575 + stagger * 24, 29, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#524a45";
    ctx.fillRect(0, floorY, width, height - floorY);
    ctx.fillStyle = "#786a58";
    ctx.fillRect(0, floorY, width, 6);
    ctx.fillStyle = "rgba(30, 25, 30, 0.2)";
    for (let x = 0; x < width; x += 48) {
      ctx.fillRect(x, floorY + 26 + ((x / 48) % 2) * 15, 29, 4);
    }
  }

  drawImageCover(image, x, y, width, height) {
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = width / height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;

    if (imageRatio > targetRatio) {
      sourceWidth = image.naturalHeight * targetRatio;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = image.naturalWidth / targetRatio;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    this.ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      x,
      y,
      width,
      height,
    );
  }

  drawTimingGuide() {
    const ctx = this.ctx;
    const top = CONFIG.rules.kickWindowTopY;
    const bottom = CONFIG.rules.kickWindowBottomY;
    const width = CONFIG.layout.timingGuideWidth;
    const left = CONFIG.game.initialBallX - width / 2;
    const ballIsInside =
      this.ball.y >= top &&
      this.ball.y <= bottom &&
      (!CONFIG.rules.requireDescendingBall || this.ball.isDescending);

    ctx.save();
    ctx.fillStyle = ballIsInside ? "rgba(32, 196, 199, 0.22)" : "rgba(255, 244, 214, 0.08)";
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = ballIsInside ? "#20c4c7" : "rgba(255, 244, 214, 0.55)";
    ctx.lineWidth = CONFIG.layout.timingGuideLineWidth;
    ctx.setLineDash([13, 9]);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + width, top);
    ctx.moveTo(left, bottom);
    ctx.lineTo(left + width, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ballIsInside ? "#20c4c7" : "rgba(255, 244, 214, 0.75)";
    ctx.font = "700 18px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("PRESS", CONFIG.game.initialBallX, top - CONFIG.layout.timingGuideLabelGap);
    ctx.restore();
  }

  drawPlayer(timestamp) {
    const isKicking = timestamp < this.kickPoseUntil;
    const player = isKicking && this.assets.playerKick
      ? this.assets.playerKick
      : this.assets.playerIdle;
    const { playerX, playerBottomY, playerWidth, playerHeight } = CONFIG.game;

    if (player) {
      this.ctx.drawImage(
        player,
        playerX - playerWidth / 2,
        playerBottomY - playerHeight,
        playerWidth,
        playerHeight,
      );
      return;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(playerX, playerBottomY);

    ctx.fillStyle = "rgba(19, 16, 22, 0.32)";
    ctx.beginPath();
    ctx.ellipse(0, 2, 78, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#17131b";
    ctx.lineWidth = 24;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(-18, -77);
    ctx.lineTo(isKicking ? -64 : -29, isKicking ? -42 : -4);
    ctx.moveTo(18, -77);
    ctx.lineTo(isKicking ? 82 : 29, isKicking ? -66 : -4);
    ctx.stroke();

    ctx.fillStyle = "#25202b";
    ctx.fillRect(-55, -191, 110, 117);
    ctx.fillStyle = "#dac39f";
    ctx.fillRect(-36, -245, 72, 62);
    ctx.fillStyle = "#342936";
    ctx.fillRect(-42, -251, 84, 24);
    ctx.fillRect(-52, -234, 18, 34);
    ctx.fillStyle = "#eee3c9";
    ctx.fillRect(-19, -222, 7, 7);
    ctx.fillRect(14, -222, 7, 7);
    ctx.fillStyle = "#a55345";
    ctx.fillRect(-8, -204, 17, 5);
    ctx.restore();
  }

  drawBall() {
    const { x, y, radius, rotation } = this.ball;
    const ctx = this.ctx;

    ctx.save();
    ctx.translate(x + 7, CONFIG.world.floorY + 5);
    const shadowScale = clamp(1 - (CONFIG.world.floorY - y) / 650, 0.3, 0.9);
    ctx.scale(shadowScale, 1);
    ctx.fillStyle = "rgba(15, 12, 18, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.05, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    if (this.assets.ball) {
      ctx.drawImage(this.assets.ball, -radius, -radius, radius * 2, radius * 2);
      ctx.restore();
      return;
    }

    ctx.fillStyle = "#eee8d6";
    ctx.strokeStyle = "#17131b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#28232a";
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const px = Math.cos(angle) * radius * 0.26;
      const py = Math.sin(angle) * radius * 0.26;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#514a50";
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.3, Math.sin(angle) * radius * 0.3);
      ctx.lineTo(Math.cos(angle) * radius * 0.78, Math.sin(angle) * radius * 0.78);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHud() {
    const ctx = this.ctx;
    const panelWidth = CONFIG.layout.hud.width;
    const panelHeight = CONFIG.layout.hud.height;
    const panelX = (CONFIG.world.width - panelWidth) / 2;
    const panelY = CONFIG.layout.hud.y;

    if (this.assets.scorePanel) {
      ctx.drawImage(this.assets.scorePanel, panelX, panelY, panelWidth, panelHeight);
    } else {
      ctx.fillStyle = "rgba(27, 21, 34, 0.9)";
      ctx.strokeStyle = "#120f17";
      ctx.lineWidth = 5;
      ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
      ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
      ctx.fillStyle = "#f5cf53";
      ctx.fillRect(panelX + 7, panelY + 7, 5, panelHeight - 14);
      ctx.fillRect(panelX + panelWidth - 12, panelY + 7, 5, panelHeight - 14);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff8de";
    ctx.strokeStyle = "#17131b";
    ctx.lineWidth = 6;
    ctx.font = "900 42px 'Courier New', monospace";
    ctx.strokeText(
      String(this.score).padStart(3, "0"),
      CONFIG.world.width / 2,
      panelY + CONFIG.layout.hud.scoreY,
    );
    ctx.fillText(
      String(this.score).padStart(3, "0"),
      CONFIG.world.width / 2,
      panelY + CONFIG.layout.hud.scoreY,
    );

    ctx.font = "700 17px 'Courier New', monospace";
    ctx.lineWidth = 3;
    const subtitle = `RECORD ${String(this.highScore).padStart(3, "0")}  •  GOAL ${CONFIG.game.targetScore}`;
    ctx.strokeText(subtitle, CONFIG.world.width / 2, panelY + CONFIG.layout.hud.subtitleY);
    ctx.fillStyle = "#f5cf53";
    ctx.fillText(subtitle, CONFIG.world.width / 2, panelY + CONFIG.layout.hud.subtitleY);
  }

  drawMissFeedback(timestamp) {
    const ctx = this.ctx;
    const remaining = Math.max(0, this.missFeedback.until - timestamp);
    const progress = remaining / CONFIG.rules.missFeedbackDurationMs;
    ctx.save();
    ctx.globalAlpha = progress;
    ctx.translate(this.missFeedback.x, this.missFeedback.y);
    ctx.strokeStyle = "#ff756d";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(10, 10);
    ctx.moveTo(10, -10);
    ctx.lineTo(-10, 10);
    ctx.stroke();
    ctx.restore();
  }

  drawWinBanner() {
    const ctx = this.ctx;
    const width = CONFIG.layout.winBanner.width;
    const x = (CONFIG.world.width - width) / 2;
    const y = CONFIG.layout.winBanner.y;
    ctx.fillStyle = "rgba(24, 18, 31, 0.92)";
    ctx.strokeStyle = "#f5cf53";
    ctx.lineWidth = 5;
    ctx.fillRect(x, y, width, CONFIG.layout.winBanner.height);
    ctx.strokeRect(x, y, width, CONFIG.layout.winBanner.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff8de";
    ctx.font = "900 25px 'Courier New', monospace";
    ctx.fillText(
      `${CONFIG.game.targetScore}! GOAL REACHED`,
      CONFIG.world.width / 2,
      y + CONFIG.layout.winBanner.titleY,
    );
    ctx.fillStyle = "#f5cf53";
    ctx.font = "700 14px 'Courier New', monospace";
    ctx.fillText(
      "KEEP GOING TO IMPROVE YOUR RECORD",
      CONFIG.world.width / 2,
      y + CONFIG.layout.winBanner.subtitleY,
    );
  }

  showReadyOverlay() {
    this.overlay.className = "game-overlay is-passive";
    this.overlay.setAttribute("aria-hidden", "false");
    this.overlayKicker.textContent = `Goal: ${CONFIG.game.targetScore}`;
    this.overlayTitle.textContent = "Keep the ball in the air";
    this.overlayCopy.textContent =
      "Press to start, then press when the ball crosses the timing zone.";
    this.overlayAction.hidden = true;
  }

  hideOverlay() {
    this.overlay.className = "game-overlay is-hidden";
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlayAction.hidden = true;
  }

  showGameOverOverlay(reason) {
    this.overlay.className = "game-overlay is-result";
    this.overlay.setAttribute("aria-hidden", "false");
    this.overlayKicker.textContent = `Record: ${this.highScore}`;
    this.overlayTitle.textContent = reason === "timing" ? "Bad timing!" : "Ball dropped!";
    this.overlayCopy.textContent = `You scored ${this.score} juggles.`;
    this.overlayAction.hidden = false;
  }

  updateScoreAnnouncement() {
    this.scoreAnnouncement.textContent = `Score ${this.score}. Record ${this.highScore}.`;
  }

  announceState(message) {
    this.stateAnnouncement.textContent = message;
  }

  readHighScore() {
    try {
      const value = Number.parseInt(localStorage.getItem(CONFIG.game.storageKey) || "0", 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  writeHighScore() {
    try {
      localStorage.setItem(CONFIG.game.storageKey, String(this.highScore));
    } catch {
      // The game remains usable even when localStorage is disabled.
    }
  }

  primeAudio() {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    this.music.load();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        this.audioContext = this.audioContext || new AudioContextClass();
        if (this.audioContext.state === "suspended") {
          this.audioContext.resume().catch(() => {});
        }
      } catch {
        // Some browsers can deny AudioContext; HTMLAudio will retry later.
      }
    }
  }

  tryStartMusic() {
    if (
      this.muted ||
      this.score < CONFIG.audio.musicStartScore ||
      this.state === STATES.GAME_OVER ||
      (!this.audioUnlocked && !CONFIG.audio.retryOnNextGesture)
    ) {
      return;
    }

    if (!this.music.paused && this.musicStarted) {
      this.musicPending = false;
      return;
    }

    this.cancelMusicFade();
    this.music.volume = 0;
    this.music.muted = this.muted;
    const attemptId = ++this.audioPlayAttempt;
    let playAttempt;
    try {
      playAttempt = this.music.play();
    } catch {
      this.musicStarted = false;
      this.musicPending = CONFIG.audio.retryOnNextGesture;
      return;
    }

    if (playAttempt && typeof playAttempt.then === "function") {
      playAttempt
        .then(() => {
          if (attemptId !== this.audioPlayAttempt) {
            this.music.pause();
            return;
          }
          this.musicStarted = true;
          this.musicPending = false;
          this.startMusicFade(attemptId);
        })
        .catch(() => {
          if (attemptId !== this.audioPlayAttempt) return;
          this.musicStarted = false;
          this.musicPending = CONFIG.audio.retryOnNextGesture;
        });
    } else {
      this.musicStarted = true;
      this.musicPending = false;
      this.startMusicFade(attemptId);
    }
  }

  startMusicFade(attemptId) {
    const duration = Math.max(0, CONFIG.audio.musicFadeInMs);
    const targetVolume = CONFIG.audio.musicVolume;

    if (duration === 0) {
      this.music.volume = targetVolume;
      return;
    }

    const startedAt = performance.now();
    const updateFade = (now) => {
      if (
        attemptId !== this.audioPlayAttempt ||
        this.state === STATES.GAME_OVER ||
        this.music.paused
      ) {
        this.musicFadeFrame = null;
        return;
      }

      const progress = clamp((now - startedAt) / duration, 0, 1);
      this.music.volume = targetVolume * progress;

      if (progress < 1) {
        this.musicFadeFrame = requestAnimationFrame(updateFade);
      } else {
        this.musicFadeFrame = null;
      }
    };

    this.musicFadeFrame = requestAnimationFrame(updateFade);
  }

  cancelMusicFade() {
    if (this.musicFadeFrame !== null) {
      cancelAnimationFrame(this.musicFadeFrame);
      this.musicFadeFrame = null;
    }
  }

  stopMusic(resetTrack) {
    this.audioPlayAttempt += 1;
    this.cancelMusicFade();
    this.music.pause();
    this.music.volume = 0;
    if (resetTrack) {
      try {
        this.music.currentTime = 0;
      } catch {
        // Metadata may not be available yet.
      }
    }
    this.musicStarted = false;
    this.musicPending = false;
  }

  updateMuteButton() {
    this.muteButton.setAttribute("aria-pressed", String(this.muted));
    this.muteButton.title = this.muted ? "Enable music" : "Disable music";
    this.muteIcon.textContent = this.muted ? "×" : "♪";
    this.muteLabel.textContent = this.muted ? "Audio off" : "Audio on";
  }
}

const game = new EndaSoccerGame();
game.init().catch((error) => {
  console.error("Unable to initialize Enda Soccer:", error);
  const announcement = document.querySelector("#state-announcement");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  if (announcement) announcement.textContent = "An error occurred while loading the game.";
  if (overlayTitle) overlayTitle.textContent = "Loading error";
  if (overlayCopy) overlayCopy.textContent = "Reload the page to try again.";
});
