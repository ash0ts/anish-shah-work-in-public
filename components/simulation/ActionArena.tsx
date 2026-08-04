"use client";

import Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import type {
  ArenaProgress,
  SimulationDifficulty,
  SimulationSceneId,
} from "./types";
import { ENCOUNTERS } from "./types";
import styles from "@/app/simulation/simulation.module.css";

type Direction = "up" | "down" | "left" | "right";

const initialProgress: ArenaProgress = {
  context: 3,
  signalsFound: 0,
  elapsedSeconds: 0,
  recalibrations: 0,
};

function seedFor(sceneId: SimulationSceneId, difficulty: SimulationDifficulty) {
  return [...`${sceneId}:${difficulty}`].reduce(
    (seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0,
    0x4a314e53,
  );
}

function durationFor(difficulty: SimulationDifficulty) {
  if (difficulty === "story") return 70;
  if (difficulty === "expert") return 125;
  return 100;
}

function minimumDurationFor(difficulty: SimulationDifficulty) {
  if (difficulty === "story") return 45;
  if (difficulty === "expert") return 90;
  return 70;
}

function targetFor(difficulty: SimulationDifficulty) {
  if (difficulty === "story") return 3;
  if (difficulty === "expert") return 6;
  return 4;
}

export default function ActionArena({
  sceneId,
  difficulty,
  onComplete,
  onFeedback,
}: {
  sceneId: SimulationSceneId;
  difficulty: SimulationDifficulty;
  onComplete: (progress: ArenaProgress) => void;
  onFeedback?: (
    kind: "hit" | "evidence" | "near-miss" | "recalibrate",
  ) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const completionRef = useRef(onComplete);
  const feedbackRef = useRef(onFeedback);
  const virtualInputRef = useRef<Record<Direction, boolean>>({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const [progress, setProgress] = useState(initialProgress);
  const [paused, setPaused] = useState(false);
  const [announcement, setAnnouncement] = useState(
    "Action channel ready. Collect cyan signals and preserve context.",
  );

  useEffect(() => {
    completionRef.current = onComplete;
    feedbackRef.current = onFeedback;
  }, [onComplete, onFeedback]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const encounter = ENCOUNTERS[sceneId];
    const duration = durationFor(difficulty);
    const minimumDuration = minimumDurationFor(difficulty);
    const target = targetFor(difficulty);
    const virtualInput = virtualInputRef.current;

    class EncounterScene extends Phaser.Scene {
      private player!: Phaser.GameObjects.Triangle;
      private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
      private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
      private threats: Array<{
        object: Phaser.GameObjects.Text;
        vx: number;
        vy: number;
        nearMissed: boolean;
      }> = [];
      private signals: Phaser.GameObjects.Text[] = [];
      private context = 3;
      private found = 0;
      private recalibrations = 0;
      private elapsed = 0;
      private lastSecond = -1;
      private completed = false;
      private invulnerableUntil = 0;
      private lastNearMissAt = -1_000;
      private seed = seedFor(sceneId, difficulty);
      private pressure = 1;

      constructor() {
        super({ key: `simulation-${sceneId}` });
      }

      private random() {
        this.seed = (1664525 * this.seed + 1013904223) >>> 0;
        return this.seed / 0x100000000;
      }

      private report() {
        setProgress({
          context: this.context,
          signalsFound: this.found,
          elapsedSeconds: Math.floor(this.elapsed / 1000),
          recalibrations: this.recalibrations,
        });
      }

      create() {
        this.cameras.main.setBackgroundColor("#050912");
        this.add
          .rectangle(240, 135, 458, 248, 0x08111f)
          .setStrokeStyle(1, 0x3b526f, 1);
        this.add.grid(240, 135, 456, 246, 24, 24, 0x08111f, 0, 0x172a42, 0.22);

        this.player = this.add
          .triangle(240, 205, 0, 17, 9, 0, 18, 17, 0x55e4d0)
          .setStrokeStyle(2, 0xf7f1df, 0.9);
        this.add
          .text(18, 14, `${encounter.actLabel.toUpperCase()} // ${encounter.arenaLabel.toUpperCase()}`, {
            color: "#ff9c58",
            fontFamily: "monospace",
            fontSize: "9px",
          })
          .setAlpha(0.9);
        this.add
          .text(462, 14, "COLLECT SIGNAL · PRESERVE CONTEXT", {
            align: "right",
            color: "#93a2b0",
            fontFamily: "monospace",
            fontSize: "8px",
          })
          .setOrigin(1, 0);

        this.cursorKeys = this.input.keyboard!.createCursorKeys();
        this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.wasd;
        this.input.keyboard!.on("keydown-ESC", () => {
          if (this.scene.isPaused()) this.scene.resume();
          else this.scene.pause();
          setPaused(this.scene.isPaused());
        });

        this.time.addEvent({
          delay: difficulty === "expert" ? 520 : difficulty === "story" ? 950 : 720,
          loop: true,
          callback: () => this.spawnThreat(),
        });
        this.time.addEvent({
          delay: difficulty === "story" ? 2700 : 3300,
          loop: true,
          callback: () => {
            if (this.signals.length < 2) this.spawnSignal();
          },
        });
        this.spawnSignal();
        this.report();
      }

      private spawnThreat() {
        if (this.random() > this.pressure) return;
        const side = Math.floor(this.random() * 4);
        const speed =
          ((difficulty === "expert" ? 86 : difficulty === "story" ? 54 : 70) +
            this.random() * 18) *
          this.pressure;
        let x = 0;
        let y = 0;
        let vx = 0;
        let vy = 0;
        if (side === 0 || side === 1) {
          x = side === 0 ? 14 : 466;
          y = 40 + this.random() * 190;
          vx = side === 0 ? speed : -speed;
          vy = (this.random() - 0.5) * 32;
        } else {
          x = 30 + this.random() * 420;
          y = side === 2 ? 30 : 246;
          vx = (this.random() - 0.5) * 32;
          vy = side === 2 ? speed : -speed;
        }
        const word = encounter.threatWords[
          Math.floor(this.random() * encounter.threatWords.length)
        ];
        const object = this.add
          .text(x, y, word, {
            backgroundColor: "#f04e85",
            color: "#050912",
            fontFamily: "monospace",
            fontSize: "8px",
            padding: { x: 4, y: 3 },
          })
          .setOrigin(0.5);
        this.threats.push({ object, vx, vy, nearMissed: false });
      }

      private spawnSignal() {
        const glyph = encounter.signalGlyphs[
          Math.floor(this.random() * encounter.signalGlyphs.length)
        ];
        const signal = this.add
          .text(45 + this.random() * 390, 55 + this.random() * 160, `◇ ${glyph}`, {
            color: "#55e4d0",
            fontFamily: "monospace",
            fontSize: "9px",
            stroke: "#0b1421",
            strokeThickness: 3,
          })
          .setOrigin(0.5);
        this.tweens.add({
          targets: signal,
          alpha: { from: 0.45, to: 1 },
          yoyo: true,
          repeat: -1,
          duration: 480,
        });
        this.signals.push(signal);
      }

      update(_time: number, delta: number) {
        if (this.completed) return;
        this.elapsed += delta;
        const seconds = Math.floor(this.elapsed / 1000);
        if (seconds !== this.lastSecond) {
          this.lastSecond = seconds;
          this.report();
        }

        const horizontal =
          Number(this.cursorKeys.right.isDown || this.wasd.D.isDown || virtualInput.right) -
          Number(this.cursorKeys.left.isDown || this.wasd.A.isDown || virtualInput.left);
        const vertical =
          Number(this.cursorKeys.down.isDown || this.wasd.S.isDown || virtualInput.down) -
          Number(this.cursorKeys.up.isDown || this.wasd.W.isDown || virtualInput.up);
        const magnitude = Math.hypot(horizontal, vertical) || 1;
        const step = (difficulty === "story" ? 150 : 132) * (delta / 1000);
        this.player.x = Phaser.Math.Clamp(
          this.player.x + (horizontal / magnitude) * step,
          22,
          458,
        );
        this.player.y = Phaser.Math.Clamp(
          this.player.y + (vertical / magnitude) * step,
          35,
          248,
        );

        this.threats = this.threats.filter((threat) => {
          threat.object.x += threat.vx * (delta / 1000);
          threat.object.y += threat.vy * (delta / 1000);
          const outside =
            threat.object.x < -80 ||
            threat.object.x > 560 ||
            threat.object.y < -40 ||
            threat.object.y > 320;
          if (outside) {
            threat.object.destroy();
            return false;
          }
          const distance = Phaser.Math.Distance.Between(
            threat.object.x,
            threat.object.y,
            this.player.x,
            this.player.y,
          );
          if (
            this.time.now > this.invulnerableUntil &&
            distance < 21
          ) {
            threat.object.destroy();
            this.context -= 1;
            feedbackRef.current?.("hit");
            setAnnouncement("A reductive label cost one context point.");
            this.invulnerableUntil = this.time.now + 850;
            this.cameras.main.flash(90, 240, 78, 133, false);
            if (this.context <= 0) {
              this.context = 2;
              this.recalibrations += 1;
              this.pressure = Math.max(0.48, this.pressure * 0.72);
              feedbackRef.current?.("recalibrate");
              setAnnouncement(
                "Context recalibrated. The next attack pattern is easier.",
              );
              this.threats.forEach((entry) => entry.object.destroy());
              this.threats = [];
            }
            this.report();
            return false;
          }
          if (
            !threat.nearMissed &&
            distance < 34 &&
            this.time.now - this.lastNearMissAt >= 700
          ) {
            threat.nearMissed = true;
            this.lastNearMissAt = this.time.now;
            feedbackRef.current?.("near-miss");
          }
          return true;
        });

        this.signals = this.signals.filter((signal) => {
          if (
            Phaser.Math.Distance.Between(
              signal.x,
              signal.y,
              this.player.x,
              this.player.y,
            ) < 23
          ) {
            signal.destroy();
            this.found += 1;
            feedbackRef.current?.("evidence");
            setAnnouncement(
              `Public signal recovered. ${this.found} of ${target} found.`,
            );
            this.cameras.main.flash(80, 85, 228, 208, false);
            this.report();
            return false;
          }
          return true;
        });

        if (
          (this.found >= target && seconds >= minimumDuration) ||
          seconds >= duration
        ) {
          this.completed = true;
          setAnnouncement("Encounter complete. The debrief is opening.");
          const finalProgress = {
            context: this.context,
            signalsFound: this.found,
            elapsedSeconds: seconds,
            recalibrations: this.recalibrations,
          };
          this.report();
          this.time.delayedCall(320, () => completionRef.current(finalProgress));
        }
      }
    }

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: mount,
      width: 480,
      height: 270,
      transparent: false,
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      banner: false,
      audio: { noAudio: true },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 480,
        height: 270,
      },
      scene: EncounterScene,
      input: { activePointers: 1 },
      render: { powerPreference: "high-performance" },
    });
    gameRef.current = game;

    const clearVirtualInput = () => {
      Object.keys(virtualInput).forEach((key) => {
        virtualInput[key as Direction] = false;
      });
    };
    const pauseForVisibility = () => {
      if (document.hidden) {
        clearVirtualInput();
        game.scene.pause(`simulation-${sceneId}`);
        setPaused(true);
      }
    };
    const clearForBlur = () => clearVirtualInput();
    document.addEventListener("visibilitychange", pauseForVisibility);
    window.addEventListener("blur", clearForBlur);

    return () => {
      document.removeEventListener("visibilitychange", pauseForVisibility);
      window.removeEventListener("blur", clearForBlur);
      game.destroy(true);
      gameRef.current = null;
      clearVirtualInput();
    };
  }, [difficulty, sceneId]);

  const setDirection = (direction: Direction, active: boolean) => {
    virtualInputRef.current[direction] = active;
  };

  const togglePause = () => {
    const scene = gameRef.current?.scene.getScene(`simulation-${sceneId}`);
    if (!scene) return;
    if (scene.scene.isPaused()) {
      scene.scene.resume();
      setAnnouncement("Action channel resumed.");
    } else {
      Object.keys(virtualInputRef.current).forEach((key) => {
        virtualInputRef.current[key as Direction] = false;
      });
      scene.scene.pause();
      setAnnouncement("Action channel paused.");
    }
    setPaused(scene.scene.isPaused());
  };

  return (
    <section
      className={styles.actionArena}
      aria-labelledby={`${sceneId}-action-title`}
      data-simulation-action-arena
      tabIndex={-1}
    >
      <div className={styles.arenaHeading}>
        <div>
          <p>Action channel · {difficulty}</p>
          <h3 id={`${sceneId}-action-title`}>{ENCOUNTERS[sceneId].arenaLabel}</h3>
        </div>
        <button type="button" onClick={togglePause} aria-pressed={paused}>
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      <div className={styles.canvasShell}>
        <div ref={mountRef} aria-hidden="true" />
        {paused ? <p className={styles.pausePlate}>Signal paused</p> : null}
      </div>

      <div className={styles.arenaStatus}>
        <span>Context {progress.context}/3</span>
        <span>Signals {progress.signalsFound}/{targetFor(difficulty)}</span>
        <span>{progress.elapsedSeconds}s elapsed</span>
        {progress.recalibrations ? (
          <span>{progress.recalibrations} recalibration</span>
        ) : null}
      </div>

      <p className={styles.srAnnouncement} role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className={styles.actionHelp}>
        <p>
          Move the query cursor with arrow keys or WASD. Collect cyan signals;
          avoid magenta labels. Escape pauses.
        </p>
        <div className={styles.directionPad} aria-label="Touch movement controls">
          {(["up", "left", "down", "right"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              aria-label={`Move ${direction}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDirection(direction, true);
              }}
              onPointerUp={(event) => {
                setDirection(direction, false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                setDirection(direction, false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onLostPointerCapture={() => setDirection(direction, false)}
            >
              {{ up: "↑", down: "↓", left: "←", right: "→" }[direction]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
