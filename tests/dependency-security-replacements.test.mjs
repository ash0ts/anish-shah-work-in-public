import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const braces = require("braces");

test("the build resolves the reviewed local braces patch, not an advisory waiver", async () => {
  const manifest = require("braces/package.json");
  const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@anish-site/braces-bounded");
  assert.equal(manifest.version, "3.0.3-site.1");
  assert.equal(root.overrides.braces, "$braces");
  assert.equal(root.devDependencies.braces, "file:vendor/braces-bounded");
});

test("bounded braces preserves glob compilation, expansion, and downstream matching", () => {
  assert.deepEqual(braces("src/{app,lib}/**/*.{ts,tsx}"), ["src/(app|lib)/**/*.(ts|tsx)"]);
  assert.deepEqual(braces.expand("{a,b}/{01..03}"), ["a/01", "a/02", "a/03", "b/01", "b/02", "b/03"]);
  assert.deepEqual(braces.expand("{a,{b,c}}"), ["a", "b", "c"]);
  assert.deepEqual(braces.expand("{a,a,}", { nodupes: true, noempty: true }), ["a"]);
  assert.equal(braces.stringify(braces.parse("src/{a,b}.ts")), "src/{a,b}.ts");
  assert.throws(() => braces.expand("{1..10001}"), /range limit/);
  const micromatch = require("micromatch");
  assert.deepEqual(micromatch(["app/page.tsx", "lib/data.ts", "notes.md"], "{app,lib}/**/*.{ts,tsx}"), ["app/page.tsx", "lib/data.ts"]);
  assert.deepEqual(micromatch.braceExpand("{app,lib}/*.ts"), ["app/*.ts", "lib/*.ts"]);
  const matches = require("fast-glob").sync("{app,lib}/**/*.{ts,tsx}");
  assert.ok(matches.includes("app/page.tsx"));
  assert.ok(matches.some((file) => file.startsWith("lib/")));
});

test("deep strings, supplied ASTs, and parent cycles fail before stack exhaustion", () => {
  // A separate process bounds regression failures, including an accidentally
  // reintroduced parent-chain infinite loop. Never raise Node's stack size.
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require('node:assert/strict');
    const braces = require('braces');
    const rejected = fn => assert.throws(fn, error => error instanceof SyntaxError && /maximum nesting depth/.test(error.message));
    for (const input of ['{'.repeat(4000) + 'a,b' + '}'.repeat(4000), '('.repeat(4000) + 'x' + ')'.repeat(4000), '{'.repeat(4000)]) {
      for (const name of ['parse', 'compile', 'expand', 'stringify', 'create']) {
        rejected(() => braces[name](input, { maxDepth: Infinity, maxLength: Infinity }));
      }
      rejected(() => braces(input));
      rejected(() => braces([input], { expand: true }));
    }
    for (const name of ['compile', 'expand', 'stringify']) {
      const root = { type: 'root', nodes: [] };
      let parent = root;
      for (let i = 0; i < 4000; i++) {
        const child = { type: 'paren', nodes: [], parent };
        parent.nodes.push(child);
        parent = child;
      }
      rejected(() => braces[name](root));
      rejected(() => require('braces/lib/' + name)(root));
    }
    const cycle = { type: 'paren', nodes: [] };
    cycle.parent = cycle;
    rejected(() => braces.expand(cycle));
    const childrenCycle = { type: 'root', nodes: [] };
    childrenCycle.nodes.push(childrenCycle);
    rejected(() => braces.compile(childrenCycle));
    rejected(() => braces.stringify(childrenCycle));
    let array = ['value'];
    for (let i = 0; i < 4000; i++) array = [array];
    rejected(() => require('braces/lib/utils').flatten(array));
    assert.equal(braces.stringify(braces.parse('{'.repeat(30) + 'a,b' + '}'.repeat(30))).length, 63);
    // Long quoted/escaped literals are not structural nesting.
    assert.equal(braces.stringify('"' + '{'.repeat(1000) + '"').length, 1000);
    assert.deepEqual(braces.expand('\\\\{a,b\\\\}'), ['{a,b}']);
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("the official js-yaml security release resolves ordered maps linearly", async () => {
  const packageManifest = JSON.parse(
    await readFile(
      new URL("../node_modules/js-yaml/package.json", import.meta.url),
      "utf8",
    ),
  );
  const source = await readFile(
    new URL("../node_modules/js-yaml/lib/type/omap.js", import.meta.url),
    "utf8",
  );

  assert.equal(packageManifest.version, "4.3.2");
  assert.match(source, /Object\.defineProperty\(objectKeys, pairKey/);
  assert.match(source, /_hasOwnProperty\.call\(objectKeys, pairKey\)/);
  assert.doesNotMatch(source, /objectKeys\.indexOf/);

  assert.deepEqual(yaml.load("!!omap\n- first: 1\n- second: 2\n"), [
    { first: 1 },
    { second: 2 },
  ]);
  assert.throws(
    () => yaml.load("!!omap\n- repeated: 1\n- repeated: 2\n"),
    /cannot resolve a node with !<tag:yaml\.org,2002:omap> explicit tag/,
  );
});
