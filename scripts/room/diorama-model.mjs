/** Original miniature geometry. No provider artwork, remote textures, or fonts. */
import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const P = {
  cream: "#eadcc3", ink: "#222a39", mint: "#79b9ab", coral: "#e98d76",
  wood: "#aa7959", paleWood: "#cfaa7c", violet: "#8683a9", paper: "#f3e8ce",
  screen: "#334f53", light: "#afd8bc", brass: "#d9ae65", shadow: "#5f5c60",
};
// The miniature's light is baked into vertex colors. An unlit material avoids
// recalculating physical lighting six times per desktop cube-camera frame.
const material = new T.MeshBasicMaterial({ vertexColors: true });
const lightDirection = new T.Vector3(3, 6, 4).normalize();

function builder() {
  const geometries = [];
  const add = (geometry, color, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    g = g.clone();
    g.deleteAttribute("uv");
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(...position),
      new T.Quaternion().setFromEuler(new T.Euler(...rotation)), new T.Vector3(1, 1, 1)));
    const c = new T.Color(P[color] ?? color);
    const normal = g.getAttribute("normal");
    const colors = [];
    for (let i = 0; i < g.getAttribute("position").count; i++) {
      // A small deterministic ambient tint makes edge planes legible without
      // real-time shadows or an additional texture/material per prop.
      const n = new T.Vector3().fromBufferAttribute(normal, i);
      const shade = .62 + .38 * Math.max(0, n.dot(lightDirection));
      colors.push(c.r * shade, c.g * shade, c.b * shade);
    }
    g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geometries.push(g);
  };
  const box = (size, position, color, radius = .025, rotation) => add(
    radius ? new RoundedBoxGeometry(...size, 1, Math.min(radius, ...size.map(n => n / 3))) : new T.BoxGeometry(...size),
    color, position, rotation,
  );
  const cylinder = (radius, height, position, color, rotation, segments = 12) =>
    add(new T.CylinderGeometry(radius, radius, height, segments), color, position, rotation);
  const sphere = (radius, position, color, segments = 12) =>
    add(new T.SphereGeometry(radius, segments, 6), color, position);
  const ring = (radius, tube, position, color, rotation = [0, 0, 0]) =>
    add(new T.TorusGeometry(radius, tube, 4, 24), color, position, rotation);
  const finish = (name) => {
    const mesh = new T.Mesh(mergeGeometries(geometries), material);
    mesh.name = name;
    for (const geometry of geometries) geometry.dispose();
    return mesh;
  };
  return { add, box, cylinder, sphere, ring, finish };
}

export const PROP_LAYOUT = {
  watch: { position: [-3.22, .56, -2.82], rotation: .18, scale: 1.12, hit: [0, 1.12, 0], size: [1.72, 2.12, 1] },
  read: { position: [-.35, 0, -2.94], rotation: 0, scale: 1.06, hit: [0, 1.5, 0], size: [2.08, 3.05, .86] },
  listen: { position: [-1.28, 0, -.42], rotation: .16, scale: 1.2, hit: [0, 1.05, 0], size: [1.18, 1.85, .88] },
  collect: { position: [-2.82, 0, 1.54], rotation: .12, scale: 1.08, hit: [0, .68, 0], size: [1.7, 1.42, 1.32] },
  play: { position: [1.48, 0, 1.12], rotation: .22, scale: .92, hit: [-.04, 1.48, 0], size: [2.45, 1.92, 1.28] },
  move: { position: [3.48, 0, -1.95], rotation: .12, scale: 1.12, hit: [0, 1.12, -.34], size: [1.58, 2.22, 2.68] },
  travel: { position: [1.48, 0, -2.75], rotation: -.08, scale: .94, hit: [0, 1.45, 0], size: [1.45, 2.55, 1.35] },
};

function shell() {
  const b = builder();
  b.box([9.8, .42, 7.2], [0, -.24, 0], "cream", .12);
  b.box([9.45, 5.35, .28], [0, 2.5, -3.42], "cream", .07);
  b.box([.26, 4.65, 6.2], [-4.76, 2.15, -.2], "cream", .07);
  b.box([.24, 4.35, 5.35], [4.76, 2.05, -.55], "cream", .07);
  for (let x = -4.5; x < 4.6; x += .5) {
    b.box([.48, .04, 6.6], [x, -.005, 0], Math.round(x * 2) % 3 ? "paleWood" : "wood", 0);
  }
  b.box([3.1, .025, 2], [.3, .03, .85], "violet", .01);
  for (let z = -.02; z < 1.8; z += .2) b.box([2.9, .008, .035], [.3, .05, z], "cream", 0);
  // Original wall print: blocks and a rising sun, not a fabricated screenshot.
  b.box([2.2, 2.9, .08], [2.95, 2.9, -3.22], "wood", .015);
  b.box([2, 2.7, .03], [2.95, 2.9, -3.165], "paper", 0);
  b.cylinder(.55, .025, [2.95, 3.45, -3.14], "coral", [Math.PI / 2, 0, 0], 24);
  for (let i = 0; i < 4; i++) b.box([1.65, .12, .025], [2.95, 2.8 - i * .25, -3.12], "mint", 0);
  // Deep-set window, mullions, sill, and warm reflected light.
  b.box([3.15, 1.6, .1], [-2.5, 3.1, -3.23], "wood", .015);
  b.box([2.95, 1.4, .04], [-2.5, 3.1, -3.16], "mint", 0);
  b.box([.06, 1.4, .06], [-2.5, 3.1, -3.1], "cream", 0);
  b.box([2.95, .06, .06], [-2.5, 3.1, -3.1], "cream", 0);
  b.box([3.3, .12, .3], [-2.5, 2.3, -3.05], "paleWood");
  // Low bed, folded blanket, stitched cushion, and a plant.
  b.box([1.55, .35, 2.62], [-4, .15, .48], "wood", .05);
  b.box([1.4, .2, 2.45], [-4, .4, .48], "paper", .07);
  b.box([1.42, .05, 1.25], [-4, .53, 1], "mint", .02);
  for (let i = 0; i < 4; i++) b.box([1.4, .008, .025], [-4, .56, .5 + i * .27], "cream", 0);
  b.box([1.1, .2, .55], [-4, .6, -.35], "coral", .08);
  b.cylinder(.22, .35, [-4, .18, -2.15], "coral");
  for (let i = 0; i < 5; i++) {
    const angle = i * 1.26;
    b.box([.09, .7, .2], [-4 + Math.sin(angle) * .12, .68, -2.15 + Math.cos(angle) * .1], "mint", .025, [Math.sin(angle) * .3, angle, Math.cos(angle) * .3]);
  }
  return b.finish("room-shell");
}

function television(body, motion) {
  body.box([1.95, .15, .9], [0, -.08, 0], "wood");
  body.box([1.62, .58, .82], [0, .32, 0], "coral");
  body.box([1.55, 1.28, .76], [0, 1.25, -.02], "cream", .1);
  body.box([1.2, .94, .05], [-.1, 1.29, .38], "ink", .06);
  body.box([1.06, .77, .04], [-.13, 1.29, .42], "screen", .06);
  for (let i = 0; i < 5; i++) body.box([.16, .025, .02], [.57, 1.05 + i * .075, .4], "ink", 0);
  body.cylinder(.09, .07, [.58, 1.65, .43], "brass", [Math.PI / 2, 0, 0]);
  body.cylinder(.018, .62, [-.19, 2.15, -.08], "ink", [0, 0, -.52], 6);
  body.cylinder(.018, .62, [.19, 2.15, -.08], "ink", [0, 0, .52], 6);
  motion.box([.87, .025, .008], [-.13, 1.3, .447], "light", 0);
  motion.box([.13, .04, .008], [-.45, 1.53, .448], "light", 0);
}
function shelf(body, motion) {
  for (const x of [-.94, .94]) body.box([.13, 2.9, .66], [x, 1.5, 0], "wood");
  for (const y of [.18, 1.05, 1.93, 2.9]) body.box([2, .13, .7], [0, y, 0], "paleWood");
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    const book = row === 1 && i === 2 ? motion : body;
    const x = -.72 + i * .28, y = .26 + row * .88, h = .55 + (i % 3) * .09;
    book.box([.22, h, .46], [x, y + h / 2, .04], ["coral", "violet", "mint", "cream", "brass", "ink"][i], .009);
    book.box([.16, .025, .01], [x, y + h - .08, .278], "paper", 0);
    book.box([.16, .018, .01], [x, y + .1, .278], "paper", 0);
  }
}
function player(body, motion) {
  body.box([1.15, .74, .8], [0, .42, 0], "wood");
  body.box([1.18, .08, .83], [0, .82, 0], "paleWood");
  body.box([.75, 1.08, .22], [0, 1.38, .04], "violet", .055);
  body.box([.51, .34, .025], [0, 1.63, .165], "screen");
  for (let i = 0; i < 4; i++) body.box([.04, .04 + i * .04, .012], [-.15 + .1 * i, 1.6, .185], "light", 0);
  body.ring(.19, .05, [0, 1.15, .17], "cream");
  motion.cylinder(.12, .035, [0, 1.15, .18], "paper", [Math.PI / 2, 0, 0]);
  body.ring(.43, .025, [0, 1.52, -.1], "ink");
  for (const x of [-.43, .43]) body.box([.12, .24, .15], [x, 1.35, -.1], "ink");
}
function records(body, motion) {
  body.box([1.5, .16, 1.1], [0, .1, 0], "wood");
  for (const x of [-.67, .67]) for (let y = .3; y < 1; y += .24) body.box([.12, .16, 1.1], [x, y, 0], "paleWood", .012);
  for (const z of [-.5, .5]) for (let y = .3; y < 1; y += .24) body.box([1.45, .16, .1], [0, y, z], "wood", .012);
  for (let i = 0; i < 5; i++) body.box([1.08, 1.1, .045], [0, .9, -.38 + i * .18], ["violet", "cream", "mint", "brass", "coral"][i], .01);
  // Disc is centered on the motion node so rotation has a single pivot.
  motion.cylinder(.48, .028, [0, 0, 0], "ink", [Math.PI / 2, 0, 0], 24);
  motion.cylinder(.14, .032, [0, 0, .005], "brass", [Math.PI / 2, 0, 0], 16);
  motion.ring(.36, .008, [0, 0, .023], "shadow");
}
function computer(body, motion) {
  body.box([2.45, .2, 1.12], [0, 1.03, 0], "paleWood");
  for (const x of [-1.12, 1.12]) for (const z of [-.42, .42]) body.box([.14, 1, .14], [x, .52, z], "wood");
  body.box([1.34, 1.12, .6], [.2, 1.78, -.15], "cream", .07);
  body.box([1.08, .8, .025], [.2, 1.82, .17], "screen", .04);
  body.box([.52, 1.02, .65], [-.88, 1.55, -.08], "cream");
  body.box([.4, .035, .025], [-.88, 1.8, .26], "ink", 0);
  body.box([.36, .035, .025], [-.88, 1.65, .26], "ink", 0);
  body.box([1.28, .09, .39], [.3, 1.14, .38], "cream");
  for (let row = 0; row < 3; row++) for (let k = 0; k < 10; k++) body.box([.09, .015, .06], [-.24 + k * .12, 1.195, .27 + row * .1], "paleWood", 0);
  for (let i = 0; i < 5; i++) motion.box([.35 + (i % 3) * .18, .018, .01], [.05, 2.05 - i * .09, .19], "light", 0);
  body.box([.15, .07, .25], [1.08, 1.17, .38], "cream");
}
function treadmill(body, motion) {
  body.box([1.2, .22, 2.4], [0, .2, .35], "cream");
  body.box([.95, .08, 1.9], [0, .33, .33], "ink");
  for (let i = 0; i < 7; i++) body.box([.9, .009, .02], [0, .375, -.4 + i * .24], "shadow", 0);
  for (const x of [-.5, .5]) {
    body.cylinder(.055, 1.45, [x, .85, -.5], "cream");
    body.box([.11, .11, 1.2], [x, 1.45, -.95], "ink", .025, [.72, 0, 0]);
  }
  body.box([1.36, .84, .3], [0, 2.03, -1.1], "ink");
  body.box([1.06, .58, .025], [0, 2.04, -.935], "screen");
  for (let i = 0; i < 5; i++) motion.box([.1, .1 + (i % 3) * .07, .015], [-.3 + i * .15, 2.02, -.915], "light", 0);
  body.cylinder(.07, .02, [.45, 1.73, -.93], "coral", [Math.PI / 2, 0, 0]);
}
function globe(body, motion) {
  body.cylinder(.67, .18, [0, .12, 0], "wood");
  body.cylinder(.08, 1, [0, .66, 0], "brass");
  body.ring(.69, .035, [0, 1.58, 0], "brass", [0, .2, -.24]);
  motion.sphere(.59, [0, 0, 0], "mint", 20);
  for (const [x, y, z] of [[-.2, .3, .44], [.25, -.16, .47], [.3, .25, -.43], [-.4, -.23, -.34]]) {
    motion.sphere(.17, [x, y, z], "cream", 6);
  }
  motion.ring(.592, .007, [0, 0, 0], "brass", [Math.PI / 2, 0, 0]);
  motion.ring(.592, .007, [0, 0, 0], "brass");
}

const makers = { watch: television, read: shelf, listen: player, collect: records, play: computer, move: treadmill, travel: globe };
export function createDiorama() {
  const scene = new T.Scene();
  scene.name = "My Room — original miniature";
  scene.add(shell());
  for (const [id, make] of Object.entries(makers)) {
    const body = builder(), motion = builder();
    make(body, motion);
    const root = new T.Group();
    root.name = `OBJ__${id}`;
    const layout = PROP_LAYOUT[id];
    root.position.set(...layout.position);
    root.rotation.y = layout.rotation;
    root.scale.setScalar(layout.scale);
    const moving = motion.finish(`motion__${id}`);
    if (id === "collect") moving.position.set(0, 1.35, .48);
    if (id === "travel") moving.position.set(0, 1.58, 0);
    root.add(body.finish(`body__${id}`), moving);
    scene.add(root);
  }
  return scene;
}
