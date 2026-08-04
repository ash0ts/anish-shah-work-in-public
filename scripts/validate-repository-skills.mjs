#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

const expectedSkills = ["maintain-anish-site", "edit-anish-site-copy"];

function relativeToRoot(root, value) {
  return path.relative(root, value).replaceAll(path.sep, "/");
}

function parseFrontmatter(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return { attributes: null, body: normalized, error: "missing YAML frontmatter" };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { attributes: null, body: normalized, error: "unterminated YAML frontmatter" };
  }

  const attributes = new Map();
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      return { attributes: null, body: normalized, error: `invalid frontmatter line: ${line}` };
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value || attributes.has(key)) {
      return { attributes: null, body: normalized, error: `invalid or duplicate frontmatter key: ${key}` };
    }
    attributes.set(key, value.replace(/^(["'])(.*)\1$/u, "$2"));
  }
  return { attributes, body: normalized.slice(end + 5), error: null };
}

function parseQuotedYamlString(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  }
  if (/^'[^'\n]+'$/u.test(value)) return value.slice(1, -1);
  return null;
}

function validateAgentYaml(source, label) {
  const errors = [];
  const allowed = new Map([
    ["interface", new Set(["display_name", "short_description", "default_prompt"])],
    ["policy", new Set(["allow_implicit_invocation"])],
  ]);
  const sections = new Map();
  let activeSection = null;

  for (const [index, line] of source.replaceAll("\r\n", "\n").split("\n").entries()) {
    if (line.trim() === "") continue;
    if (line.includes("\t")) {
      errors.push(`${label}:${index + 1}: tabs are not allowed`);
      continue;
    }
    const sectionMatch = line.match(/^([a-z_]+):$/u);
    if (sectionMatch) {
      activeSection = sectionMatch[1];
      if (!allowed.has(activeSection)) {
        errors.push(`${label}:${index + 1}: unknown top-level key ${activeSection}`);
        continue;
      }
      if (sections.has(activeSection)) {
        errors.push(`${label}:${index + 1}: duplicate top-level key ${activeSection}`);
        continue;
      }
      sections.set(activeSection, new Map());
      continue;
    }
    const fieldMatch = line.match(/^  ([a-z_]+):\s+(.+)$/u);
    if (!fieldMatch || !activeSection || !sections.has(activeSection)) {
      errors.push(`${label}:${index + 1}: invalid narrow YAML structure`);
      continue;
    }
    const [, key, value] = fieldMatch;
    if (!allowed.get(activeSection).has(key)) {
      errors.push(`${label}:${index + 1}: unknown ${activeSection} key ${key}`);
      continue;
    }
    const fields = sections.get(activeSection);
    if (fields.has(key)) {
      errors.push(`${label}:${index + 1}: duplicate ${activeSection} key ${key}`);
      continue;
    }
    fields.set(key, value.trim());
  }

  for (const [section, keys] of allowed) {
    const fields = sections.get(section);
    if (!fields) {
      errors.push(`${label}: missing top-level key ${section}`);
      continue;
    }
    for (const key of keys) {
      if (!fields.has(key)) errors.push(`${label}: missing ${section}.${key}`);
    }
  }
  return { errors, sections };
}

function walkFiles(directory, errors, root) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) {
      errors.push(`${relativeToRoot(root, absolute)}: repository skills may not contain symbolic links`);
      continue;
    }
    if (stats.isDirectory()) walkFiles(absolute, errors, root);
  }
}

function validateRelativeLinks(skillDirectory, markdownPath, source, errors, root) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of source.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/gu, "").split(/\s+["']/u)[0];
    if (!rawTarget || /^(?:https?:|mailto:|#)/iu.test(rawTarget)) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(rawTarget.split("#", 1)[0]);
    } catch {
      errors.push(`${relativeToRoot(root, markdownPath)}: invalid encoded link ${rawTarget}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(markdownPath), decoded);
    const relativeSkillPath = path.relative(skillDirectory, resolved);
    if (
      relativeSkillPath === ".." ||
      relativeSkillPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeSkillPath)
    ) {
      errors.push(`${relativeToRoot(root, markdownPath)}: link escapes the skill directory: ${rawTarget}`);
      continue;
    }
    if (!existsSync(resolved) || !lstatSync(resolved).isFile()) {
      errors.push(`${relativeToRoot(root, markdownPath)}: broken local link: ${rawTarget}`);
    }
  }
}

export function validateSkillDirectory(skillDirectory, expectedName, root = defaultRoot) {
  const errors = [];
  if (!existsSync(skillDirectory) || !lstatSync(skillDirectory).isDirectory()) {
    return [`${relativeToRoot(root, skillDirectory)}: skill directory is missing`];
  }
  walkFiles(skillDirectory, errors, root);

  const skillPath = path.join(skillDirectory, "SKILL.md");
  if (!existsSync(skillPath) || !lstatSync(skillPath).isFile()) {
    errors.push(`${relativeToRoot(root, skillPath)}: required file is missing`);
  } else {
    const source = readFileSync(skillPath, "utf8");
    const parsed = parseFrontmatter(source);
    if (parsed.error) {
      errors.push(`${relativeToRoot(root, skillPath)}: ${parsed.error}`);
    } else {
      const keys = [...parsed.attributes.keys()].sort();
      if (keys.join(",") !== "description,name") {
        errors.push(`${relativeToRoot(root, skillPath)}: frontmatter may contain only name and description`);
      }
      if (parsed.attributes.get("name") !== expectedName) {
        errors.push(`${relativeToRoot(root, skillPath)}: name must equal directory name ${expectedName}`);
      }
      const description = parsed.attributes.get("description") ?? "";
      if (description.length < 40 || description.length > 1024) {
        errors.push(`${relativeToRoot(root, skillPath)}: description must be 40–1024 characters`);
      }
      if (!/^#\s+\S+/mu.test(parsed.body)) {
        errors.push(`${relativeToRoot(root, skillPath)}: body requires a top-level heading`);
      }
      validateRelativeLinks(skillDirectory, skillPath, source, errors, root);
    }
  }

  const agentPath = path.join(skillDirectory, "agents/openai.yaml");
  if (!existsSync(agentPath) || !lstatSync(agentPath).isFile()) {
    errors.push(`${relativeToRoot(root, agentPath)}: required file is missing`);
  } else {
    const yaml = readFileSync(agentPath, "utf8");
    const label = relativeToRoot(root, agentPath);
    const parsed = validateAgentYaml(yaml, label);
    errors.push(...parsed.errors);
    const interfaceFields = parsed.sections.get("interface") ?? new Map();
    for (const key of ["display_name", "short_description", "default_prompt"]) {
      if (interfaceFields.has(key) && !parseQuotedYamlString(interfaceFields.get(key))) {
        errors.push(`${label}: interface.${key} must be a nonempty quoted string`);
      }
    }
    const implicitInvocation = parsed.sections
      .get("policy")
      ?.get("allow_implicit_invocation");
    if (implicitInvocation !== "true") {
      errors.push(`${label}: policy.allow_implicit_invocation must be true`);
    }
    const defaultPrompt = parseQuotedYamlString(
      interfaceFields.get("default_prompt") ?? "",
    );
    if (defaultPrompt && !defaultPrompt.includes(`$${expectedName}`)) {
      errors.push(`${label}: default prompt must name $${expectedName}`);
    }
  }

  const referencesDirectory = path.join(skillDirectory, "references");
  if (!existsSync(referencesDirectory) || !lstatSync(referencesDirectory).isDirectory()) {
    errors.push(`${relativeToRoot(root, referencesDirectory)}: references directory is required`);
  } else {
    for (const entry of readdirSync(referencesDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const referencePath = path.join(referencesDirectory, entry.name);
      validateRelativeLinks(
        skillDirectory,
        referencePath,
        readFileSync(referencePath, "utf8"),
        errors,
        root,
      );
    }
  }

  return errors;
}

export function validateRepositorySkills(root = defaultRoot) {
  const skillsRoot = path.join(root, ".agents/skills");
  return expectedSkills.flatMap((name) =>
    validateSkillDirectory(path.join(skillsRoot, name), name, root),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const errors = validateRepositorySkills();
  if (errors.length > 0) {
    console.error("Repository skill validation failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Validated ${expectedSkills.length} repository skills.`);
}
