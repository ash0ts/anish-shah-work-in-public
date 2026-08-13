import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import yaml from "js-yaml";

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

  assert.equal(packageManifest.version, "4.3.1");
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
