import Phaser from "phaser";
import type { Battle } from "@/lib/simulation/network/battle";
import type { CharacterId } from "@/lib/simulation/network/characters";
export type WorldView = {
  position: { x: number; y: number };
  battle: Battle | null;
  fighting: boolean;
  paused: boolean;
  character: CharacterId;
  chips: Array<{ id: string; domain: string }>;
  highlightIds: string[];
};
export type WorldRenderer = { update(view: WorldView): void; destroy(): void };
const NPCS = [
  { id: "patch", x: 1, y: 2, frame: 4 },
  { id: "index", x: 7, y: 2, frame: 8 },
  { id: "loop", x: 5, y: 7, frame: 12 },
] as const;
const iso = (x: number, y: number) => ({
  x: 480 + (x - y) * 47,
  y: 92 + (x + y) * 25,
});

/** One isolated instance. Sleeping between input-driven redraws is intentional. */
export function createNetworkRenderer(
  parent: HTMLElement,
  initial: WorldView,
  move: (x: number, y: number) => void,
  meet: (character: CharacterId) => void,
  inspect: (id: string) => void,
  fail: () => void,
): WorldRenderer {
  let current = initial;
  let scene: NetworkScene | undefined;
  let disposed = false;
  let playerSprite: Phaser.GameObjects.Sprite | undefined;
  let gestureCancelled = false;
  const pointers = new Set<number>();
  class NetworkScene extends Phaser.Scene {
    preload() {
      this.load.spritesheet("cast", "/assets/simulation/network-cast-v1.webp", {
        frameWidth: 256,
        frameHeight: 256,
      });
      this.load.on("loaderror", fail);
      this.load.spritesheet(
        "props",
        "/assets/simulation/network-props-v1.webp",
        { frameWidth: 256, frameHeight: 256 },
      );
    }
    create() {
      if (!this.textures.exists("cast") || !this.textures.exists("props")) {
        fail();
        return;
      }
      // The React bridge retains exactly this scene until instance disposal.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      scene = this;
      parent.dataset.rendererReady = "true";
      let frames = 0;
      this.events.on("postupdate", () => {
        parent.dataset.renderFrames = String(++frames);
      });
      this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
        if (
          current.paused ||
          current.fighting ||
          gestureCancelled ||
          p.getDistance() > 12
        )
          return;
        const x = Math.round(((p.x - 480) / 47 + (p.y - 92) / 25) / 2);
        const y = Math.round(((p.y - 92) / 25 - (p.x - 480) / 47) / 2);
        if (x < 0 || x > 8 || y < 0 || y > 8) return;
        const npc = NPCS.find(
          (n) => Math.abs(n.x - x) + Math.abs(n.y - y) <= 1,
        );
        const chip = positionedChips().find((c) => c.x === x && c.y === y);
        move(x, y);
        if (chip) inspect(chip.id);
        else if (npc) meet(npc.id);
      });
      draw(false);
    }
  }
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: 960,
    height: 620,
    backgroundColor: "#080d26",
    pixelArt: true,
    antialias: false,
    audio: { noAudio: true },
    loader: { imageLoadType: "HTMLImageElement" },
    fps: { target: 60, smoothStep: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { keyboard: false, activePointers: 1 },
    scene: NetworkScene,
    callbacks: {
      postBoot: (g) => {
        g.canvas.setAttribute("aria-hidden", "true");
      },
    },
  });
  // Phaser queues pointer input. Wake it for the gesture, never for idle time.
  let gestureTimer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    if (disposed || current.paused) return;
    game.loop.wake();
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      if (!disposed) game.loop.sleep();
    }, 600);
  };
  parent.addEventListener("pointerdown", wake);
  parent.addEventListener("pointerup", wake);
  const down = (event: PointerEvent) => {
    if (!pointers.size) gestureCancelled = false;
    pointers.add(event.pointerId);
    if (pointers.size > 1 || !event.isPrimary) gestureCancelled = true;
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
  };
  const cancel = () => {
    gestureCancelled = true;
    pointers.clear();
  };
  parent.addEventListener("pointerdown", down, true);
  parent.addEventListener("pointerup", up, true);
  parent.addEventListener("pointercancel", cancel, true);
  parent.addEventListener("lostpointercapture", cancel, true);
  window.addEventListener("resize", cancel);
  function positionedChips() {
    const areas = [
      current.chips.filter((c) => c.domain === "work"),
      current.chips.filter((c) =>
        ["myanimelist", "hardcover", "steam"].includes(c.domain),
      ),
      current.chips.filter((c) => ["spotify", "discogs"].includes(c.domain)),
    ];
    const cells = [
      [
        { x: 2, y: 3 },
        { x: 3, y: 2 },
      ],
      [
        { x: 6, y: 3 },
        { x: 7, y: 4 },
      ],
      [
        { x: 3, y: 6 },
        { x: 5, y: 6 },
      ],
    ];
    return areas.flatMap((items, zone) =>
      items
        .slice(0, 2)
        .map((item, index) => ({ ...item, ...cells[zone][index] })),
    );
  }
  function draw(animate: boolean) {
    if (!scene || disposed) return;
    game.loop.wake();
    const from = playerSprite?.active
      ? { x: playerSprite.x, y: playerSprite.y }
      : null;
    playerSprite = undefined;
    scene.tweens.killAll();
    scene.time.removeAllEvents();
    scene.children.removeAll(true);
    const s = scene,
      g = s.add.graphics();
    for (let i = 0; i < 58; i++) {
      g.fillStyle(i % 7 ? 0x34528c : 0xa9daff, i % 7 ? 0.5 : 0.8);
      g.fillRect((i * 163 + 29) % 960, (i * 97 + 13) % 620, i % 7 ? 1 : 2, 2);
    }
    if (current.fighting && current.battle) {
      const b = current.battle;
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 6; x++) {
          const danger = b.danger.some((c) => c.x === x && c.y === y);
          g.fillStyle(
            danger
              ? b.phase === "warning"
                ? 0xc57a1b
                : 0xb5265c
              : x < 3
                ? 0x214e9f
                : 0x643b86,
          );
          g.fillRoundedRect(100 + x * 126, 230 + y * 78, 118, 70, 6);
          g.lineStyle(2, danger ? 0xffec90 : 0x9cc7f8, 0.8);
          g.strokeRoundedRect(100 + x * 126, 230 + y * 78, 118, 70, 6);
        }
      const avatar = s.add
        .sprite(
          158 + b.player.x * 126,
          260 + b.player.y * 78,
          "cast",
          b.event === "moved" ? 1 : 0,
        )
        .setDisplaySize(110, 110)
        .setOrigin(0.5, 0.8);
      const enemyX = 158 + b.enemy.x * 126,
        enemyY = 254 + b.enemy.y * 78;
      g.fillStyle(0xf7c4ff);
      g.fillTriangle(
        enemyX,
        enemyY - 44,
        enemyX - 34,
        enemyY + 17,
        enemyX + 34,
        enemyY + 17,
      );
      g.fillStyle(0x311344);
      g.fillRect(enemyX - 12, enemyY - 5, 7, 9);
      g.fillRect(enemyX + 7, enemyY - 5, 7, 9);
      if (animate)
        s.tweens.add({
          targets: avatar,
          y: avatar.y - 9,
          duration: 90,
          yoyo: true,
        });
    } else {
      for (let y = 0; y < 9; y++)
        for (let x = 0; x < 9; x++) {
          const p = iso(x, y),
            zone = y > 5 ? 2 : x > 4 ? 1 : 0;
          const colors = [0x174ba4, 0x423891, 0x175f6a];
          const path = x === 4 || y === 4;
          g.fillStyle(path ? 0x5276ae : colors[zone], 0.95);
          const corners = [
            new Phaser.Math.Vector2(p.x, p.y),
            new Phaser.Math.Vector2(p.x + 45, p.y + 24),
            new Phaser.Math.Vector2(p.x, p.y + 48),
            new Phaser.Math.Vector2(p.x - 45, p.y + 24),
          ];
          g.fillPoints(corners, true);
          g.lineStyle(1, path ? 0xc4f484 : 0x6a9ae6, 0.6);
          g.strokePoints(corners, true);
        }
      // Original fictional architecture; no building stands in for fabricated data.
      for (const [x, y, frame] of [
        [1, 1, 0],
        [7, 1, 1],
        [6, 7, 2],
      ]) {
        const p = iso(x, y);
        s.add
          .image(p.x, p.y + 20, "props", frame)
          .setDisplaySize(170, 170)
          .setOrigin(0.5, 0.9);
      }
      for (const chip of positionedChips()) {
        const p = iso(chip.x, chip.y);
        if (current.highlightIds.includes(chip.id)) {
          g.lineStyle(3, 0xd5ff80);
          g.strokeCircle(p.x, p.y + 20, 30);
        }
        s.add.image(p.x, p.y + 20, "props", 3).setDisplaySize(48, 48);
      }
      const entities = [
        ...NPCS.map((n) => ({ ...n, player: false })),
        {
          id: "4n1sh",
          ...current.position,
          frame: animate ? 1 : 0,
          player: true,
        },
      ].sort((a, b) => a.x + a.y - b.x - b.y);
      for (const entity of entities) {
        const p = iso(entity.x, entity.y);
        g.fillStyle(0x020817, 0.5);
        g.fillEllipse(p.x, p.y + 31, 60, 18);
        const sprite = s.add
          .sprite(p.x, p.y + 31, "cast", entity.frame)
          .setDisplaySize(entity.player ? 106 : 116, entity.player ? 106 : 116)
          .setOrigin(0.5, 0.9);
        if (entity.player) playerSprite = sprite;
        if (entity.player && animate) {
          const target = { x: sprite.x, y: sprite.y };
          if (from) sprite.setPosition(from.x, from.y);
          s.tweens.add({
            targets: sprite,
            ...target,
            duration: 180,
            onComplete: () => sprite.setFrame(0),
          });
        }
      }
    }
    // Render the final pose, then park the engine. React owns combat time.
    s.time.delayedCall(animate ? 230 : 40, () => game.loop.sleep());
  }
  return {
    update(view) {
      if (JSON.stringify(current) === JSON.stringify(view)) return;
      const changed =
        JSON.stringify(current.position) !== JSON.stringify(view.position) ||
        current.battle?.event !== view.battle?.event;
      current = view;
      draw(changed && !view.paused);
    },
    destroy() {
      disposed = true;
      clearTimeout(gestureTimer);
      parent.removeEventListener("pointerdown", wake);
      parent.removeEventListener("pointerup", wake);
      parent.removeEventListener("pointerdown", down, true);
      parent.removeEventListener("pointerup", up, true);
      parent.removeEventListener("pointercancel", cancel, true);
      parent.removeEventListener("lostpointercapture", cancel, true);
      window.removeEventListener("resize", cancel);
      scene = undefined;
      game.destroy(true);
    },
  };
}
