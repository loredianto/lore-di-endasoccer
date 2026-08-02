import { CONFIG } from "./config.js";

const STATES = Object.freeze({
  READY: "READY",
  PLAYING: "PLAYING",
  WON: "WON",
  FALLING: "FALLING",
  GAME_OVER: "GAME_OVER",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class YouAreTheSoccerBallGame {
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

    this.assets = {};
    this.state = STATES.READY;
    this.score = 0;
    this.highScore = this.readHighScore();
    this.attemptCount = this.readAttemptCount();
    this.ball = this.createBall();
    this.trajectoryProgress = 0;
    this.kickQueued = false;
    this.pendingGameOverReason = null;
    this.lastKickAt = Number.NEGATIVE_INFINITY;
    this.kickPoseUntil = 0;
    this.winBannerUntil = 0;
    this.medalUnlockedAt = {};
    this.missFeedback = null;
    this.lastFrameAt = null;
    this.accumulator = 0;
    this.audioUnlocked = false;
    this.musicStarted = false;
    this.musicPending = false;
    this.audioPlayAttempt = 0;
    this.musicFadeFrame = null;
    this.kickPromptFadeStartedAt = null;
    this.muted = CONFIG.audio.mutedByDefault;
    this.audioContext = null;
    this.musicSourceNode = null;
    this.musicGainNode = null;
    this.kickSourceNode = null;
    this.kickGainNode = null;
    this.pageSuspended = document.hidden;
    this.resumeMusicAfterPageShow = false;

    this.music = new Audio(CONFIG.audio.musicSrc);
    this.music.loop = CONFIG.audio.loopMusic;
    this.music.volume = 0;
    this.music.preload = CONFIG.audio.preload;
    this.music.muted = this.muted;

    this.kickSound = new Audio(CONFIG.audio.kickSoundSrc);
    this.kickSound.volume = CONFIG.audio.kickSoundVolume;
    this.kickSound.preload = CONFIG.audio.preload;
    this.kickSound.muted = this.muted;

    this.frame = this.frame.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handleRetryPointerDown = this.handleRetryPointerDown.bind(this);
    this.handleAudioGesture = this.handleAudioGesture.bind(this);
    this.handleCanvasKeyDown = this.handleCanvasKeyDown.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);
    this.handlePageShow = this.handlePageShow.bind(this);
    this.resizeCanvas = this.resizeCanvas.bind(this);
  }

  async init() {
    this.installEvents();
    this.resizeCanvas();
    this.resetGame();
    await this.preloadAssets();
    if (CONFIG.rules.autoPlay) this.startRound();
    requestAnimationFrame(this.frame);
  }

  installEvents() {
    document.addEventListener("pointerdown", this.handleAudioGesture, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", this.handleAudioGesture, { capture: true });
    this.canvas.addEventListener("pointerdown", this.handlePointerDown, { passive: false });
    this.canvas.addEventListener("keydown", this.handleCanvasKeyDown);
    this.overlay.addEventListener("pointerdown", this.handleRetryPointerDown, { passive: false });

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
      if (this.state === STATES.GAME_OVER) this.retryGame();
    });

    this.muteButton.addEventListener("click", () => {
      this.primeAudio();
      this.muted = !this.muted;
      this.music.muted = this.muted;
      this.kickSound.muted = this.muted;
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

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
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
      y: CONFIG.trajectory.contactY,
      radius: CONFIG.game.ballRadius,
      velocityY: 0,
      isDescending: false,
    };
  }

  resetGame() {
    this.stopMusic(CONFIG.audio.resetTrackOnRestart);
    this.state = STATES.READY;
    this.score = 0;
    this.ball = this.createBall();
    this.trajectoryProgress = 0;
    this.kickQueued = false;
    this.pendingGameOverReason = null;
    this.lastKickAt = Number.NEGATIVE_INFINITY;
    this.kickPoseUntil = 0;
    this.winBannerUntil = 0;
    this.medalUnlockedAt = {};
    this.missFeedback = null;
    this.accumulator = 0;
    this.lastFrameAt = null;
    this.kickPromptFadeStartedAt = null;
    this.showReadyOverlay();
    this.updateScoreAnnouncement();
    this.announceState("Game ready. Tap or click to kick the stationary ball upward.");
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

    if (CONFIG.rules.autoPlay) return;

    if (this.state === STATES.FALLING || this.state === STATES.GAME_OVER) return;

    this.attemptKick(this.pointerToWorld(event), performance.now());
  }

  handleCanvasKeyDown(event) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    this.handleAudioGesture();

    if (CONFIG.rules.autoPlay) return;

    this.attemptKick(
      { x: this.ball.x, y: this.ball.y },
      performance.now(),
    );
  }

  attemptKick(point, now) {
    if (this.state === STATES.FALLING || this.state === STATES.GAME_OVER) return;

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
        this.startBallFall("timing");
      }
      return;
    }

    this.queueKick(now);
  }

  handleRetryPointerDown(event) {
    if (this.state !== STATES.GAME_OVER) return;
    if (
      CONFIG.input.acceptPrimaryPointerOnly &&
      ((!event.isPrimary && event.pointerType !== "mouse") ||
        (event.pointerType === "mouse" && event.button !== 0))
    ) {
      return;
    }

    event.preventDefault();
    this.retryGame();
  }

  retryGame() {
    this.primeAudio();
    this.resetGame();
    this.startRound();
    this.canvas.focus({ preventScroll: true });
  }

  startRound() {
    this.attemptCount += 1;
    this.writeAttemptCount();
    this.updateScoreAnnouncement();
    this.state = STATES.PLAYING;
    this.trajectoryProgress = 0;
    this.kickQueued = false;
    this.pendingGameOverReason = null;
    this.syncBallToTrajectory();
    this.hideOverlay();
    this.kickPoseUntil = performance.now() + CONFIG.game.kickPoseDurationMs;
    this.playKickSound();
    this.announceState(
      "Opening kick complete. Score remains zero until the first timed juggle.",
    );
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
    this.playKickSound();
  }

  tryAutoKick(now = performance.now()) {
    if (CONFIG.rules.autoPlay && this.canKick(now)) {
      this.queueKick(now);
    }
  }

  completeScriptedKick() {
    const now = performance.now();
    this.kickQueued = false;
    this.kickPoseUntil = now + CONFIG.game.kickPoseDurationMs;
    const previousScore = this.score;
    this.score += 1;

    const unlockedMedals = CONFIG.layout.medals.items.filter(
      (medal) => previousScore < medal.score && this.score >= medal.score,
    );
    for (const medal of unlockedMedals) {
      this.medalUnlockedAt[medal.id] = now;
    }

    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.writeHighScore();
    }

    if (
      previousScore < CONFIG.game.targetScore &&
      this.score >= CONFIG.game.targetScore &&
      this.state === STATES.PLAYING
    ) {
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
    if (this.state === STATES.FALLING) {
      this.updateFallingBall(dt);
      return;
    }

    if (this.state !== STATES.PLAYING && this.state !== STATES.WON) return;

    const cycleDurationSeconds = CONFIG.trajectory.cycleDurationMs / 1000;
    this.trajectoryProgress += dt / cycleDurationSeconds;

    if (this.trajectoryProgress >= 1) {
      const overflow = this.trajectoryProgress - 1;
      this.trajectoryProgress = 1;
      this.syncBallToTrajectory();
      this.tryAutoKick(performance.now());

      if (!this.kickQueued) {
        this.startBallFall("ground");
        return;
      }

      // Scoring and the new bounce always happen at exactly contactY. Input
      // timing only decides whether the scripted bounce is allowed to continue.
      this.completeScriptedKick();
      this.trajectoryProgress = overflow;
    }

    this.syncBallToTrajectory();
    this.tryAutoKick(performance.now());
  }

  syncBallToTrajectory() {
    const progress = clamp(this.trajectoryProgress, 0, 1);
    const duration = CONFIG.trajectory.cycleDurationMs / 1000;
    const elapsed = progress * duration;
    const { gravity, launchVelocity } = this.getBallistics();

    this.ball.x = CONFIG.game.initialBallX;
    this.ball.y =
      CONFIG.trajectory.contactY +
      launchVelocity * elapsed +
      0.5 * gravity * elapsed ** 2;
    this.ball.velocityY = launchVelocity + gravity * elapsed;
    this.ball.isDescending = this.ball.velocityY >= 0;
  }

  getBallistics() {
    const duration = CONFIG.trajectory.cycleDurationMs / 1000;
    const height = CONFIG.trajectory.contactY - CONFIG.trajectory.apexY;
    const gravity = (8 * height) / duration ** 2;
    return {
      gravity,
      launchVelocity: (-gravity * duration) / 2,
    };
  }

  startBallFall(reason) {
    if (this.state === STATES.FALLING || this.state === STATES.GAME_OVER) return;
    this.state = STATES.FALLING;
    this.pendingGameOverReason = reason;
    this.kickQueued = false;
    this.announceState(
      reason === "timing" ? "Mistimed press. The ball is falling." : "Missed kick.",
    );
  }

  updateFallingBall(dt) {
    const { gravity } = this.getBallistics();
    this.ball.velocityY += gravity * dt;
    this.ball.y += this.ball.velocityY * dt;
    this.ball.isDescending = this.ball.velocityY >= 0;

    const floorContactY = CONFIG.world.floorY - this.ball.radius;
    if (this.ball.y >= floorContactY) {
      this.ball.y = floorContactY;
      this.ball.velocityY = 0;
      this.finishGame(this.pendingGameOverReason ?? "ground");
    }
  }

  finishGame(reason = "ground") {
    if (this.state === STATES.GAME_OVER) return;
    this.state = STATES.GAME_OVER;
    this.pendingGameOverReason = null;
    if (CONFIG.audio.stopOnGameOver) this.stopMusic(true);
    this.showGameOverOverlay(reason);
    const cause = reason === "timing" ? "Mistimed press." : "The ball hit the ground.";
    this.announceState(`${cause} You scored ${this.score} juggles.`);
  }

  frame(timestamp) {
    if (CONFIG.world.pauseWhenHidden && (document.hidden || this.pageSuspended)) {
      this.lastFrameAt = null;
      this.accumulator = 0;
      requestAnimationFrame(this.frame);
      return;
    }

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
    this.drawPlayer(timestamp);
    if (CONFIG.layout.timingZone.visible) this.drawTimingZone();
    this.drawKickPrompt(timestamp);
    this.drawBall();
    this.drawHud(timestamp);
    if (CONFIG.debugMode && CONFIG.layout.debugFlag.visible) this.drawDebugFlag();

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
      this.drawBackgroundShade();
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

    this.drawBackgroundShade();
  }

  drawBackgroundShade() {
    const opacity = clamp(CONFIG.layout.backgroundShadeOpacity, 0, 1);
    if (opacity === 0) return;
    this.ctx.fillStyle = `rgba(3, 5, 18, ${opacity})`;
    this.ctx.fillRect(0, 0, CONFIG.world.width, CONFIG.world.height);
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

  drawTimingZone() {
    const ctx = this.ctx;
    const { width, lineWidth, dash, tracksBallBottom } = CONFIG.layout.timingZone;
    const visualOffset = tracksBallBottom ? this.ball.radius : 0;
    const top = CONFIG.rules.kickWindowTopY + visualOffset;
    const bottom = CONFIG.rules.kickWindowBottomY + visualOffset;
    const left = CONFIG.game.initialBallX - width / 2;
    const ballIsInside =
      this.ball.y >= CONFIG.rules.kickWindowTopY &&
      this.ball.y <= CONFIG.rules.kickWindowBottomY &&
      (!CONFIG.rules.requireDescendingBall || this.ball.isDescending);

    ctx.save();
    ctx.fillStyle = ballIsInside ? "rgba(32, 196, 199, 0.22)" : "rgba(255, 244, 214, 0.08)";
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = ballIsInside ? "#20c4c7" : "rgba(255, 244, 214, 0.55)";
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + width, top);
    ctx.moveTo(left, bottom);
    ctx.lineTo(left + width, bottom);
    ctx.stroke();
    ctx.restore();
  }

  drawKickPrompt(timestamp) {
    const ctx = this.ctx;
    const prompt = "Kick ↓";
    const { leftX, fontSize, underlineGap, underlineLineWidth, fadeOutMs } =
      CONFIG.layout.kickPrompt;
    const zoneStartY =
      CONFIG.rules.kickWindowTopY +
      (CONFIG.layout.timingZone.tracksBallBottom ? this.ball.radius : 0);
    const baselineY = zoneStartY + fontSize;
    const fadeProgress = this.kickPromptFadeStartedAt === null
      ? 0
      : clamp((timestamp - this.kickPromptFadeStartedAt) / Math.max(1, fadeOutMs), 0, 1);

    if (fadeProgress >= 1) return;

    ctx.save();
    ctx.globalAlpha = 1 - fadeProgress;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    ctx.font = `700 ${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(prompt, leftX, baselineY);

    const underlineWidth = Math.ceil(ctx.measureText(prompt).width);
    const underlineY = baselineY + underlineGap;
    ctx.lineWidth = underlineLineWidth;
    ctx.beginPath();
    ctx.moveTo(leftX, underlineY);
    ctx.lineTo(leftX + underlineWidth, underlineY);
    ctx.stroke();
    ctx.restore();
  }

  drawPlayer(timestamp) {
    const isKicking = timestamp < this.kickPoseUntil;
    const player = isKicking && this.assets.playerKick
      ? this.assets.playerKick
      : this.assets.playerIdle;
    const { playerX, playerBottomY, playerWidth, playerHeight } = CONFIG.game;

    if (player) {
      const imageRatio = player.naturalWidth / player.naturalHeight;
      const boundsRatio = playerWidth / playerHeight;
      const drawWidth = imageRatio > boundsRatio ? playerWidth : playerHeight * imageRatio;
      const drawHeight = imageRatio > boundsRatio ? playerWidth / imageRatio : playerHeight;
      this.ctx.drawImage(
        player,
        playerX - drawWidth / 2,
        playerBottomY - drawHeight,
        drawWidth,
        drawHeight,
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
    const { x, y, radius } = this.ball;
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

  drawHud(timestamp) {
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
    const scoreText = String(this.score).padStart(3, "0");
    const availableTextWidth = panelWidth - CONFIG.layout.hud.textPadding * 2;
    let scoreFontSize = CONFIG.layout.hud.scoreFontSize;
    ctx.font = `900 ${scoreFontSize}px 'Courier New', monospace`;
    while (
      ctx.measureText(scoreText).width > availableTextWidth &&
      scoreFontSize > CONFIG.layout.hud.scoreMinFontSize
    ) {
      scoreFontSize -= 1;
      ctx.font = `900 ${scoreFontSize}px 'Courier New', monospace`;
    }
    ctx.strokeText(
      scoreText,
      CONFIG.world.width / 2,
      panelY + CONFIG.layout.hud.scoreY,
    );
    ctx.fillText(
      scoreText,
      CONFIG.world.width / 2,
      panelY + CONFIG.layout.hud.scoreY,
    );

    const subtitle =
      `TRY: ${String(this.attemptCount).padStart(3, "0")}  ` +
      `RECORD: ${String(this.highScore).padStart(3, "0")}  ` +
      `GOAL: ${CONFIG.game.targetScore}`;
    let subtitleFontSize = CONFIG.layout.hud.subtitleFontSize;
    ctx.font = `700 ${subtitleFontSize}px 'Courier New', monospace`;
    while (
      ctx.measureText(subtitle).width > availableTextWidth &&
      subtitleFontSize > CONFIG.layout.hud.subtitleMinFontSize
    ) {
      subtitleFontSize -= 1;
      ctx.font = `700 ${subtitleFontSize}px 'Courier New', monospace`;
    }
    ctx.lineWidth = 3;
    ctx.strokeText(subtitle, CONFIG.world.width / 2, panelY + CONFIG.layout.hud.subtitleY);
    ctx.fillStyle = "#f5cf53";
    ctx.fillText(subtitle, CONFIG.world.width / 2, panelY + CONFIG.layout.hud.subtitleY);

    for (const medal of CONFIG.layout.medals.items) {
      if (this.score >= medal.score) this.drawMedal(medal, timestamp);
    }
  }

  drawMedal(medal, timestamp) {
    const ctx = this.ctx;
    const { size, y, popDurationMs } = CONFIG.layout.medals;
    const unlockedAt = this.medalUnlockedAt[medal.id] ?? timestamp;
    const progress = clamp((timestamp - unlockedAt) / popDurationMs, 0, 1);
    const entranceScale = clamp(progress * 4, 0, 1);
    const bounce = progress < 1 ? Math.sin(progress * Math.PI) * 0.16 : 0;
    const scale = entranceScale * (1 + bounce);
    const unit = size / 54;

    ctx.save();
    ctx.translate(medal.x, y);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#17131b";
    ctx.fillRect(-17 * unit, -29 * unit, 13 * unit, 29 * unit);
    ctx.fillRect(4 * unit, -29 * unit, 13 * unit, 29 * unit);
    ctx.fillStyle = medal.ribbon;
    ctx.fillRect(-13 * unit, -27 * unit, 9 * unit, 27 * unit);
    ctx.fillRect(4 * unit, -27 * unit, 9 * unit, 27 * unit);

    const points = [
      [-17, -10], [-10, -17], [10, -17], [17, -10],
      [17, 10], [10, 17], [-10, 17], [-17, 10],
    ];
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      const x = px * unit;
      const pointY = (py + 7) * unit;
      if (index === 0) ctx.moveTo(x, pointY);
      else ctx.lineTo(x, pointY);
    });
    ctx.closePath();
    ctx.fillStyle = medal.face;
    ctx.strokeStyle = "#17131b";
    ctx.lineWidth = 5 * unit;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = medal.shade;
    ctx.fillRect(-12 * unit, 13 * unit, 24 * unit, 5 * unit);
    ctx.fillRect(12 * unit, -1 * unit, 5 * unit, 14 * unit);
    ctx.fillStyle = medal.highlight;
    ctx.fillRect(-10 * unit, -7 * unit, 12 * unit, 4 * unit);
    ctx.fillRect(-13 * unit, -3 * unit, 4 * unit, 9 * unit);

    ctx.fillStyle = "#17131b";
    ctx.font = `900 ${medal.label.length > 2 ? 10 : 13}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(medal.label, 0, 8 * unit);
    ctx.restore();
  }

  drawDebugFlag() {
    const ctx = this.ctx;
    const { x, y, width, height, label } = CONFIG.layout.debugFlag;

    ctx.save();
    ctx.fillStyle = "#17131b";
    ctx.fillRect(x - 3, y - 3, width + 6, height + 6);
    ctx.fillStyle = "#d64045";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "#f5cf53";
    ctx.fillRect(x, y, 6, height);
    ctx.fillStyle = "#fff8de";
    ctx.font = "900 15px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2 + 3, y + height / 2 + 1);
    ctx.restore();
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
      "Kick the stationary ball upward, then time every descending kick.";
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
    this.overlayCopy.textContent = `You scored ${this.score} juggles. Tap anywhere to retry.`;
    this.overlayAction.hidden = false;
  }

  updateScoreAnnouncement() {
    this.scoreAnnouncement.textContent =
      `Try ${this.attemptCount}. Score ${this.score}. Record ${this.highScore}.`;
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

  readAttemptCount() {
    try {
      const value = Number.parseInt(
        localStorage.getItem(CONFIG.game.attemptStorageKey) || "0",
        10,
      );
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  writeAttemptCount() {
    try {
      localStorage.setItem(CONFIG.game.attemptStorageKey, String(this.attemptCount));
    } catch {
      // The game remains usable even when localStorage is disabled.
    }
  }

  handleAudioGesture() {
    this.primeAudio();

    if (!this.muted && this.score >= CONFIG.audio.musicStartScore) {
      this.tryStartMusic();
    }
  }

  primeAudio() {
    if (!this.audioUnlocked) {
      this.audioUnlocked = true;
      this.music.load();
      this.kickSound.load();
    }

    this.ensureAudioGraph();

    if (this.audioContext?.state === "suspended" || this.audioContext?.state === "interrupted") {
      this.audioContext.resume().catch(() => {});
    }
  }

  ensureAudioGraph() {
    if (this.musicGainNode && this.kickGainNode) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      this.audioContext = this.audioContext || new AudioContextClass();

      if (!this.musicGainNode) {
        const musicGainNode = this.audioContext.createGain();
        musicGainNode.gain.value = 0;
        const musicSourceNode = this.audioContext.createMediaElementSource(this.music);
        musicSourceNode.connect(musicGainNode);
        musicGainNode.connect(this.audioContext.destination);
        this.musicSourceNode = musicSourceNode;
        this.musicGainNode = musicGainNode;
      }

      if (!this.kickGainNode) {
        const kickGainNode = this.audioContext.createGain();
        kickGainNode.gain.value = CONFIG.audio.kickSoundVolume;
        const kickSourceNode = this.audioContext.createMediaElementSource(this.kickSound);
        kickSourceNode.connect(kickGainNode);
        kickGainNode.connect(this.audioContext.destination);
        this.kickSourceNode = kickSourceNode;
        this.kickGainNode = kickGainNode;
      }

      // iOS does not expose reliable script control over HTMLMediaElement.volume.
      // Keep both elements at unity and control their levels in the Web Audio graph.
      this.music.volume = 1;
      this.kickSound.volume = 1;
      return true;
    } catch {
      // Keep any graph branch that was created successfully; the remaining
      // element continues to use the HTMLAudio fallback.
      if (this.musicGainNode) this.music.volume = 1;
      if (this.kickGainNode) this.kickSound.volume = 1;
      return Boolean(this.musicGainNode || this.kickGainNode);
    }
  }

  setMusicOutputVolume(volume) {
    const nextVolume = clamp(volume, 0, 1);

    if (this.musicGainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      this.musicGainNode.gain.cancelScheduledValues(now);
      this.musicGainNode.gain.setValueAtTime(nextVolume, now);
      return;
    }

    this.music.volume = nextVolume;
  }

  tryStartMusic() {
    if (
      this.muted ||
      this.score < CONFIG.audio.musicStartScore ||
      this.state === STATES.GAME_OVER
    ) {
      return;
    }

    if (!this.audioUnlocked) {
      this.musicPending = CONFIG.audio.retryOnNextGesture;
      return;
    }

    if (!this.music.paused && this.musicStarted) {
      this.musicPending = false;
      return;
    }

    this.cancelMusicFade();
    this.setMusicOutputVolume(0);
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
          if (attemptId !== this.audioPlayAttempt) return;
          this.musicStarted = true;
          this.musicPending = false;
          this.startKickPromptFade();
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
      this.startKickPromptFade();
      this.startMusicFade(attemptId);
    }
  }

  startKickPromptFade() {
    if (this.kickPromptFadeStartedAt === null) {
      this.kickPromptFadeStartedAt = performance.now();
    }
  }

  playKickSound() {
    if (this.muted || !this.audioUnlocked) return;

    try {
      this.kickSound.currentTime = 0;
      const playAttempt = this.kickSound.play();
      if (playAttempt && typeof playAttempt.catch === "function") {
        playAttempt.catch(() => {});
      }
    } catch {
      // A blocked sound effect must never interrupt gameplay.
    }
  }

  startMusicFade(attemptId) {
    const duration = Math.max(0, CONFIG.audio.musicFadeInMs);
    const targetVolume = CONFIG.audio.musicVolume;

    if (this.musicGainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      const gain = this.musicGainNode.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(0, now);
      gain.linearRampToValueAtTime(targetVolume, now + duration / 1000);
      return;
    }

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

    if (this.musicGainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      const currentVolume = this.musicGainNode.gain.value;
      this.musicGainNode.gain.cancelScheduledValues(now);
      this.musicGainNode.gain.setValueAtTime(currentVolume, now);
    }
  }

  stopMusic(resetTrack) {
    this.audioPlayAttempt += 1;
    this.cancelMusicFade();
    this.music.pause();
    this.setMusicOutputVolume(0);
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

  handleVisibilityChange() {
    if (document.hidden) {
      this.suspendForPageLifecycle();
    } else {
      this.resumeFromPageLifecycle();
    }
  }

  handlePageHide() {
    this.suspendForPageLifecycle();
  }

  handlePageShow() {
    this.resumeFromPageLifecycle();
  }

  suspendForPageLifecycle() {
    if (this.pageSuspended) return;
    this.pageSuspended = true;
    this.lastFrameAt = null;
    this.accumulator = 0;
    this.resumeMusicAfterPageShow =
      (this.musicStarted || !this.music.paused) &&
      this.score >= CONFIG.audio.musicStartScore &&
      this.state !== STATES.GAME_OVER;
    this.audioPlayAttempt += 1;

    if (!this.music.paused) this.music.pause();
    if (this.audioContext?.state === "running") {
      this.audioContext.suspend().catch(() => {});
    }
  }

  resumeFromPageLifecycle() {
    const shouldResumeMusic =
      this.resumeMusicAfterPageShow &&
      !this.muted &&
      this.score >= CONFIG.audio.musicStartScore &&
      this.state !== STATES.GAME_OVER;

    this.pageSuspended = false;
    this.resumeMusicAfterPageShow = false;
    this.lastFrameAt = null;
    this.accumulator = 0;

    if (this.audioContext?.state === "suspended" || this.audioContext?.state === "interrupted") {
      this.audioContext.resume().catch(() => {});
    }

    if (!shouldResumeMusic) return;

    const attemptId = ++this.audioPlayAttempt;
    try {
      const playAttempt = this.music.play();
      if (playAttempt && typeof playAttempt.then === "function") {
        playAttempt
          .then(() => {
            if (attemptId !== this.audioPlayAttempt) return;
            this.musicStarted = true;
            this.musicPending = false;
          })
          .catch(() => {
            if (attemptId !== this.audioPlayAttempt) return;
            this.musicPending = CONFIG.audio.retryOnNextGesture;
          });
      }
    } catch {
      if (attemptId === this.audioPlayAttempt) {
        this.musicPending = CONFIG.audio.retryOnNextGesture;
      }
    }
  }

  updateMuteButton() {
    this.muteButton.setAttribute("aria-pressed", String(this.muted));
    this.muteButton.title = this.muted ? "Enable audio" : "Disable audio";
    this.muteIcon.textContent = this.muted ? "×" : "♪";
    this.muteLabel.textContent = this.muted ? "Audio off" : "Audio on";
  }
}

const game = new YouAreTheSoccerBallGame();
game.init().catch((error) => {
  console.error("Unable to initialize You Are the Soccer Ball:", error);
  const announcement = document.querySelector("#state-announcement");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  if (announcement) announcement.textContent = "An error occurred while loading the game.";
  if (overlayTitle) overlayTitle.textContent = "Loading error";
  if (overlayCopy) overlayCopy.textContent = "Reload the page to try again.";
});
