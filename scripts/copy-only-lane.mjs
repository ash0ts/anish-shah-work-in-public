import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCopyOnlyPackage,
  classifyCopyChanges,
  copyPreviewComment,
  createCopyOnlyPackage,
} from "./lib/copy-only-lane.mjs";

const command = process.argv[2];

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Copy-only lane arguments must be --name value pairs.");
    }
    if (result.has(key)) throw new Error(`Duplicate argument: ${key}`);
    result.set(key, value);
  }
  return result;
}

const args = argumentsMap(process.argv.slice(3));
function required(name) {
  const value = args.get(`--${name}`);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

async function output(name, value) {
  const outputPath = args.get("--github-output");
  if (outputPath) {
    await writeFile(outputPath, `${name}=${value}\n`, { flag: "a" });
  }
}

async function apiEntries(inputPath) {
  const value = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(value)) throw new Error("The PR file response must be an array.");
  return value.map((entry) => ({
    status: entry?.status,
    filename: entry?.filename,
  }));
}

if (command === "classify") {
  const classification = classifyCopyChanges(
    await apiEntries(required("changes-file")),
  );
  await output("eligible", classification.eligible ? "true" : "false");
  await output("reason", classification.reason);
  console.log(JSON.stringify(classification));
} else if (command === "package") {
  const result = await createCopyOnlyPackage({
    candidateRoot: path.resolve(required("candidate-root")),
    baseRoot: path.resolve(required("base-root")),
    baseSha: required("base-sha").toLowerCase(),
    headSha: required("head-sha").toLowerCase(),
    repository: required("repository"),
    prNumber: Number(required("pr-number")),
  });
  await output("eligible", result.eligible ? "true" : "false");
  await output("reason", result.eligible ? "copy_only" : result.reason);
  if (result.eligible) {
    const destination = path.resolve(required("output"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(result.package, null, 2)}\n`, {
      mode: 0o600,
    });
    await output("copy_version", result.package.copyVersion);
    console.log(
      `Validated ${result.package.files.length} copy files at ${result.package.copyVersion}.`,
    );
  } else {
    console.log(`Not eligible for the copy-only lane: ${result.reason}.`);
  }
} else if (command === "apply") {
  const baseRoot = path.resolve(required("base-root"));
  const pristineBaseRoot = path.resolve(required("pristine-base-root"));
  const report = await applyCopyOnlyPackage({
    packagePath: path.resolve(required("package")),
    baseRoot,
    reportPath: path.resolve(required("report")),
    expected: {
      repository: required("repository"),
      prNumber: Number(required("pr-number")),
      baseSha: required("base-sha").toLowerCase(),
      headSha: required("head-sha").toLowerCase(),
      pristineBaseRoot,
      baseRoot,
    },
  });
  await output("copy_version", report.copyVersion);
  console.log(
    `Applied ${report.changedFiles.length} validated copy files at ${report.copyVersion}.`,
  );
} else if (command === "comment") {
  const report = JSON.parse(await readFile(required("report"), "utf8"));
  const screenshot = JSON.parse(
    await readFile(required("screenshot-report"), "utf8"),
  );
  const body = copyPreviewComment({
    report,
    screenshot,
    previewUrl: required("preview-url"),
  });
  await writeFile(path.resolve(required("output")), `${body}\n`, { mode: 0o600 });
} else {
  throw new Error("Use copy-only-lane.mjs classify, package, apply, or comment.");
}
