import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditPublicLanguageOwnership,
  extractLongPublicLanguageLiterals,
  isPublicLanguageSource,
} from "../scripts/lib/public-language-ownership.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const injectedLiteral =
  "This paragraph bypasses the copy deck with enough visible language to change the public narrative without an editorial owner reviewing the change.";

test("new long public prose fails unless its exact source literal is reviewed", () => {
  const file = "app/fixture/page.tsx";
  const source = `export default function Fixture() { return <p>${injectedLiteral}</p>; }`;
  const unowned = auditPublicLanguageOwnership([{ file, source }], []);

  assert.equal(unowned.violations.length, 1);
  assert.equal(unowned.violations[0].literal, injectedLiteral);

  const allowlist = [
    {
      file,
      literal: injectedLiteral,
      reason: "Fixture for a reviewed protected public message.",
    },
  ];
  const reviewed = auditPublicLanguageOwnership([{ file, source }], allowlist);
  assert.deepEqual(reviewed.violations, []);
  assert.deepEqual(reviewed.staleAllowlist, []);
  assert.deepEqual(reviewed.invalidAllowlist, []);

  const changed = auditPublicLanguageOwnership(
    [{ file, source: source.replace("reviewing", "approving") }],
    allowlist,
  );
  assert.equal(changed.violations.length, 1);
  assert.equal(changed.staleAllowlist.length, 1);
});

test("the scanner excludes dormant and non-public contracts", () => {
  assert.equal(isPublicLanguageSource("app/page.tsx"), true);
  assert.equal(isPublicLanguageSource("components/play/MovementStream.tsx"), true);
  assert.equal(isPublicLanguageSource("app/api/simulation/session/route.ts"), false);
  assert.equal(isPublicLanguageSource("app/studio/page.tsx"), false);
  assert.equal(isPublicLanguageSource("app/simulation/page.tsx"), false);
  assert.equal(isPublicLanguageSource("components/simulation/Campaign.tsx"), false);
  assert.equal(
    isPublicLanguageSource("components/play/travel/TravelGlobeStage.tsx"),
    false,
  );
  assert.equal(isPublicLanguageSource("content/canonical/provider-data.ts"), false);

  const dormant = extractLongPublicLanguageLiterals({
    file: "components/simulation/Campaign.tsx",
    source: `export function Campaign() { return <p>${injectedLiteral}</p>; }`,
  });
  assert.deepEqual(dormant, []);
});

test("imports, object keys, and short interface labels are not public prose", () => {
  const findings = extractLongPublicLanguageLiterals({
    file: "components/Fixture.tsx",
    source: [
      'import value from "a-deliberately-long-module-specifier-that-is-not-visible-public-language-and-must-not-trigger-the-guard";',
      "const labels = { \"a-deliberately-long-programmatic-object-key-that-is-never-visible-to-visitors-and-should-not-trigger\": value };",
      'export function Fixture() { return <button aria-label="Open project">Open</button>; }',
    ].join("\n"),
  });
  assert.deepEqual(findings, []);
});

test("copy tests invoke the public-language ownership guard", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.match(
    packageJson.scripts["copy:test"],
    /tests\/public-language-ownership\.test\.mjs/u,
  );
  assert.match(
    packageJson.scripts["copy:check"],
    /check-public-language-ownership\.mjs/u,
  );
});
