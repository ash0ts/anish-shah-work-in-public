import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXPECTED_REPOSITORY_SKILLS,
  validateRepositorySkills,
  validateSkillDirectory,
} from "../scripts/validate-repository-skills.mjs";

test("both repository skills satisfy the structural contract", () => {
  assert.deepEqual(EXPECTED_REPOSITORY_SKILLS, [
    "maintain-anish-site",
    "edit-anish-site-copy",
  ]);
  assert.deepEqual(validateRepositorySkills(), []);
});

test("repository validation rejects any third skill", () => {
  const root = mkdtempSync(path.join(tmpdir(), "anish-skill-validator-"));
  for (const name of EXPECTED_REPOSITORY_SKILLS) {
    mkdirSync(path.join(root, `.agents/skills/${name}`), { recursive: true });
  }
  mkdirSync(path.join(root, ".agents/skills/unexpected-skill"), {
    recursive: true,
  });

  const errors = validateRepositorySkills(root);
  assert.match(errors.join("\n"), /unexpected repository skill/u);
  rmSync(root, { recursive: true, force: true });
});

test("skill validation rejects unsafe metadata, implicit policy, and broken links", () => {
  const root = mkdtempSync(path.join(tmpdir(), "anish-skill-validator-"));
  const skillDirectory = path.join(root, ".agents/skills/example-skill");
  mkdirSync(path.join(skillDirectory, "agents"), { recursive: true });
  mkdirSync(path.join(skillDirectory, "references"), { recursive: true });
  writeFileSync(
    path.join(skillDirectory, "SKILL.md"),
    [
      "---",
      "name: wrong-name",
      "description: This deliberately long description is valid in length but not in identity.",
      "extra: unsafe",
      "---",
      "# Example",
      "Read [missing](references/missing.md).",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(skillDirectory, "agents/openai.yaml"),
    [
      "interface:",
      '  display_name: "Example"',
      '  short_description: "Example skill"',
      '  default_prompt: "Use $example-skill safely."',
      '  extra_key: "unsafe"',
      "policy:",
      "  allow_implicit_invocation: false",
      "policy:",
      "  allow_implicit_invocation: true",
      "",
    ].join("\n"),
  );

  const errors = validateSkillDirectory(skillDirectory, "example-skill", root);
  assert.match(errors.join("\n"), /frontmatter may contain only name and description/);
  assert.match(errors.join("\n"), /name must equal directory name example-skill/);
  assert.match(errors.join("\n"), /broken local link/);
  assert.match(errors.join("\n"), /unknown interface key extra_key/);
  assert.match(errors.join("\n"), /duplicate top-level key policy/);
  assert.match(errors.join("\n"), /allow_implicit_invocation must be true/);
  rmSync(root, { recursive: true, force: true });
});
