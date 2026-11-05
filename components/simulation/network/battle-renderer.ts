import Phaser from "phaser";
import {
  CHARGE_TICKS,
  type Battle,
  type Cell,
} from "@/lib/simulation/network/battle";
export const combatPoint = ({ x, y }: Cell) => ({
  x: 130 + x * 140,
  y: 162 + y * 90,
});
export const combatCell = (x: number, y: number) => ({
  x: Math.floor((x - 60) / 140),
  y: Math.floor((y - 118) / 90),
});

/** Short interpolated effects follow authoritative state; never change the rules. */
export function drawBattle(
  s: Phaser.Scene,
  b: Battle,
  from: Cell | null,
  animate: boolean,
) {
  const g = s.add.graphics();
  // A side-on, staggered panel field. Ownership is visible in both color and rails.
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 6; x++) {
      const p = combatPoint({ x, y }),
        danger = b.danger.some((c) => c.x === x && c.y === y);
      const left = p.x - 66,
        top = p.y - 36;
      g.fillStyle(0x03091b);
      g.fillRect(left + 2, top + 10, 132, 76);
      g.fillStyle(danger ? 0xce7d27 : x < 3 ? 0x245cb2 : 0x823c80);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(left + 10, top),
          new Phaser.Math.Vector2(left + 132, top),
          new Phaser.Math.Vector2(left + 122, top + 74),
          new Phaser.Math.Vector2(left, top + 74),
        ],
        true,
      );
      g.lineStyle(2, danger ? 0xffdc8e : x < 3 ? 0x73b5ff : 0xee94cc);
      g.strokePoints(
        [
          new Phaser.Math.Vector2(left + 10, top),
          new Phaser.Math.Vector2(left + 132, top),
          new Phaser.Math.Vector2(left + 122, top + 74),
          new Phaser.Math.Vector2(left, top + 74),
        ],
        true,
      );
      g.fillStyle(0xffffff, 0.12);
      g.fillRect(left + 16, top + 6, 108, 3);
      if (danger) {
        g.lineStyle(4, 0xffe3a3, 0.85);
        g.lineBetween(left + 49, top + 27, left + 69, top + 47);
        g.lineBetween(left + 69, top + 27, left + 49, top + 47);
      }
    }
  const pp = combatPoint(b.player);
  g.fillStyle(0x020819, 0.5);
  g.fillEllipse(pp.x, pp.y + 17, 75, 20);
  const avatar = s.add
    .sprite(
      pp.x,
      pp.y + 20,
      "cast",
      b.charging ? 2 : b.event === "moved" ? 1 : 0,
    )
    .setDisplaySize(124, 124)
    .setOrigin(0.5, 0.85);
  if (b.invulnerableUntil > b.tick) avatar.setTint(0xb7e9ff);
  if (from && animate) {
    avatar.setPosition(from.x, from.y);
    s.tweens.add({ targets: avatar, x: pp.x, y: pp.y + 20, duration: 65 });
  }
  if (b.charge) {
    g.lineStyle(
      b.charge >= CHARGE_TICKS ? 5 : 2,
      b.charge >= CHARGE_TICKS ? 0xd8ff77 : 0x74cfff,
    );
    g.strokeCircle(pp.x + 28, pp.y - 30, 12 + b.charge);
  }
  if (b.shieldUntil > b.tick) {
    g.lineStyle(5, 0x8ee9ff);
    g.strokeEllipse(pp.x, pp.y - 20, 100, 124);
  }
  for (const enemy of b.enemies) {
    if (!enemy.health) continue;
    const p = combatPoint(enemy),
      large = enemy.kind === "warden",
      r = large ? 48 : 33;
    const tint =
      enemy.hitUntil > b.tick
        ? 0xffe2aa
        : enemy.stunnedUntil > b.tick
          ? 0x8ca9cd
          : large
            ? 0xa978de
            : enemy.kind === "skater"
              ? 0xfa7f72
              : 0xffc46b;
    g.fillStyle(0x03091b, 0.6);
    g.fillEllipse(p.x, p.y + 20, r * 2.1, 22);
    g.fillStyle(0x26364e);
    g.fillRoundedRect(p.x - r - 6, p.y - r * 1.5 - 6, r * 2 + 12, r * 1.9, 7);
    g.fillStyle(tint);
    g.fillRoundedRect(p.x - r, p.y - r * 1.5, r * 2, r * 1.7, large ? 5 : 15);
    g.fillStyle(0x17253e);
    g.fillRect(p.x - r + 7, p.y - r, r * 2 - 14, 22);
    g.fillStyle(enemy.phase === "windup" ? 0xffe6b5 : 0xd8ff83);
    g.fillRect(p.x - 18, p.y - r + 6, 10, 8);
    g.fillRect(p.x + 8, p.y - r + 6, 10, 8);
    if (enemy.kind === "skater") {
      g.lineStyle(6, 0xe9f3ff);
      g.lineBetween(p.x - 40, p.y + 10, p.x + 40, p.y + 10);
    }
    if (large) {
      g.fillStyle(0xdbc4ff);
      g.fillTriangle(p.x - 32, p.y - 75, p.x - 18, p.y - 98, p.x - 8, p.y - 75);
      g.fillTriangle(p.x + 8, p.y - 75, p.x + 18, p.y - 98, p.x + 32, p.y - 75);
    }
    g.fillStyle(0x152039);
    g.fillRect(p.x - 30, p.y + 24, 60, 6);
    g.fillStyle(0xd6ff8c);
    g.fillRect(p.x - 30, p.y + 24, (60 * enemy.health) / enemy.maxHealth, 6);
    s.add
      .text(p.x, p.y + 34, String(enemy.health), {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#e9f5ff",
      })
      .setOrigin(0.5, 0);
  }
  for (const shot of b.projectiles) {
    const p = combatPoint(shot),
      color =
        shot.side === "player"
          ? shot.damage >= 30
            ? 0xd8ff7c
            : 0x93e7ff
          : 0xffa165;
    const projectile = s.add.graphics({ x: p.x, y: p.y - 24 });
    projectile.fillStyle(color, 0.24);
    projectile.fillEllipse(0, 0, shot.damage >= 30 ? 70 : 40, 28);
    projectile.fillStyle(color);
    projectile.fillRoundedRect(-18, -6, 36, 12, 5);
    projectile.fillStyle(0xffffff);
    projectile.fillRect(-10, -2, 21, 4);
    if (animate)
      s.tweens.add({
        targets: projectile,
        x: p.x + (shot.side === "player" ? 1 : -1) * shot.speed * 140,
        duration: 50,
      });
  }
  for (const fx of b.effects) {
    const p = combatPoint(fx),
      remaining = (fx.until - b.tick) / 7;
    g.lineStyle(
      fx.kind === "sweep" ? 8 : 3,
      fx.kind === "repair" ? 0xcfff89 : fx.kind === "hit" ? 0xffd68d : 0xa8e9ff,
      remaining,
    );
    if (fx.kind === "dash") g.lineBetween(p.x, p.y - 22, 820, p.y - 22);
    else if (fx.kind === "sweep") {
      g.lineBetween(p.x - 32, p.y - 100, p.x + 70, p.y + 65);
      g.lineBetween(p.x + 12, p.y - 100, p.x + 110, p.y + 65);
    } else g.strokeCircle(p.x, p.y - 22, 14 + (1 - remaining) * 40);
  }
  s.add.text(65, 78, "YOUR PANELS", {
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#abd2ff",
  });
  s.add
    .text(900, 78, "HOSTILE PANELS", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#ffc4e8",
    })
    .setOrigin(1, 0);
  return avatar;
}
