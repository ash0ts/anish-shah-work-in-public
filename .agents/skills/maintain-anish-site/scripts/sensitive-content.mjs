const KNOWN_SECRET_PATTERNS = [
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  {
    label: "OpenAI-style API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    label: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    label: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    label: "JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
  },
];

const SECRET_NAME =
  /(?:authorization|bearer|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|encryption[_-]?key|rate[_-]?limit[_-]?salt|private[_-]?key|password)/i;

const LOCAL_PATH_PATTERN =
  /(?:file:\/\/\/)?(?:\/Users\/[^/\s"'<>]+\/|\/home\/[^/\s"'<>]+\/|[A-Za-z]:\\Users\\[^\\\s"'<>]+\\)/g;
const INTERNAL_URL_PATTERN =
  /https?:\/\/(?:[A-Za-z0-9-]+\.)*(?:slack\.com|notion\.so|notion\.site|hex\.tech)\/[^\s"'<>)]*/gi;

function isSyntheticPrivateReference(filePath, value) {
  if (!filePath.startsWith("tests/")) return false;
  return (
    /(?:\/Users\/example\/|\/home\/(?:example|runner)\/|\\Users\\example\\)/i.test(
      value,
    ) ||
    /^https:\/\/(?:company|wandb)\.slack\.com\/archives\/private$/i.test(
      value,
    )
  );
}

function normalizedLiteral(value) {
  return value
    .trim()
    .replace(/^["'`]/, "")
    .replace(/["'`,;\s]+$/, "")
    .trim();
}

function isDocumentedPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (
    /<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|…|\.\.\./.test(normalized)
  ) {
    return true;
  }
  if (
    /^(?:placeholder|replace[-_ ]?me|change[-_ ]?me|development[-_ ]only|your[-_ ][a-z0-9_-]+|example(?:[-_ ][a-z0-9_-]+)?)$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /^(?:(?:safe|test|fake|dummy|mock|sample|never|must-not|must-never|old|new|retry|rotated|revoked|expired|valid|repository|hardcover|mal|spotify|client|access|refresh)[-_])+(?:[a-z0-9]+[-_]?)+$/.test(
    normalized,
  );
}

function literalAfterSecretName(filePath, line) {
  if (!SECRET_NAME.test(line)) return null;

  const quoted = line.match(
    /(?:authorization|bearer|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|encryption[_-]?key|rate[_-]?limit[_-]?salt|private[_-]?key|password)["']?\s*[:=]\s*(["'`])([^"'`\r\n]+)\1/i,
  );
  if (quoted) return normalizedLiteral(quoted[2]);

  const environment = line.match(
    /^\s*[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|ENCRYPTION_KEY|RATE_LIMIT_SALT|PASSWORD)[A-Z0-9_]*\s*=\s*([^#\s]+)\s*$/,
  );
  if (environment) return normalizedLiteral(environment[1]);

  if (/\.ya?ml$/i.test(filePath)) {
    const yaml = line.match(
      /^\s*[A-Za-z0-9_-]*(?:secret|token|api[_-]?key|password)[A-Za-z0-9_-]*\s*:\s*([^#\s]+)\s*$/i,
    );
    if (yaml) return normalizedLiteral(yaml[1]);
  }
  return null;
}

function isUnsafeSecretLiteral(filePath, value) {
  if (!value || isDocumentedPlaceholder(value)) return false;
  if (/^(?:process\.env|runtimeValue\(|env\.|secrets?\.)/.test(value)) return false;
  if (
    filePath.startsWith("tests/") &&
    value.includes("\\n") &&
    /(?:access|refresh)[-_]token/i.test(value)
  ) {
    return false;
  }
  if (
    filePath.startsWith("tests/") &&
    /^[a-z][a-z0-9\\]*(?:[-_][a-z0-9\\]+)*[-_](?:access|refresh)[-_]token(?:[-_][a-z0-9]+)*$/i.test(
      value,
    )
  ) {
    return false;
  }
  if (
    filePath.startsWith("tests/") &&
    new Set(value.replace(/[^A-Za-z0-9]/g, "")).size <= 4
  ) {
    return false;
  }
  if (/^[A-Za-z0-9+/_=-]{16,}$/.test(value)) return true;
  return value.length >= 20 && !/\s/.test(value);
}

function isPublicDataArtifact(filePath) {
  return (
    /^content\/public\/.*\.json$/i.test(filePath) ||
    /^public\/.*\.json$/i.test(filePath)
  );
}

function isDataArtifact(filePath) {
  return (
    /\.json$/i.test(filePath) &&
    filePath !== "package-lock.json" &&
    !/^content\/schema\//.test(filePath) &&
    !/^drizzle\/meta\//.test(filePath) &&
    !filePath.startsWith("tests/")
  );
}

/**
 * Find high-confidence credential and private-source leaks in one text file.
 * The allowlist is deliberately limited to documented placeholders and the
 * repository's synthetic negative fixtures; arbitrary test files are not
 * exempt from known token formats.
 */
export function scanSensitiveContent(filePath, content) {
  if (typeof content !== "string" || content.includes("\0")) return [];

  const findings = [];
  const seen = new Set();
  const add = (lineNumber, detail) => {
    const message = `line ${lineNumber}: ${detail}`;
    if (!seen.has(message)) {
      seen.add(message);
      findings.push(message);
    }
  };

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) {
      add(lineNumber, "private key material must not be tracked");
    }

    for (const { label, pattern } of KNOWN_SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) add(lineNumber, `${label} must not be tracked`);
    }

    const bearer = line.match(/\bBearer\s+([A-Za-z0-9._~+\/-]{20,})\b/i);
    if (bearer && !isDocumentedPlaceholder(bearer[1])) {
      add(lineNumber, "literal bearer credential must not be tracked");
    }

    const secretLiteral = literalAfterSecretName(filePath, line);
    if (secretLiteral && isUnsafeSecretLiteral(filePath, secretLiteral)) {
      add(lineNumber, "literal credential value must be replaced with a documented placeholder");
    }

    LOCAL_PATH_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(LOCAL_PATH_PATTERN)) {
      if (!isSyntheticPrivateReference(filePath, match[0])) {
        add(lineNumber, "machine-local home path may expose private source material");
      }
    }

    INTERNAL_URL_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(INTERNAL_URL_PATTERN)) {
      if (!isSyntheticPrivateReference(filePath, match[0])) {
        add(lineNumber, "internal workspace URL may expose private source material");
      }
    }

    if (
      (isPublicDataArtifact(filePath) || isDataArtifact(filePath)) &&
      /["'](?:evidenceAccess|access)["']\s*:\s*["'](?:company_internal|owner_private)["']/i.test(
        line,
      )
    ) {
      add(lineNumber, "private evidence access marker is forbidden in public data");
    }
  }

  return findings;
}
