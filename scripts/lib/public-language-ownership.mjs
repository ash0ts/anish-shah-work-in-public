import path from "node:path";
import ts from "typescript";

export const PUBLIC_LANGUAGE_MIN_WORDS = 18;
export const PUBLIC_LANGUAGE_MIN_CHARACTERS = 120;

export const PUBLIC_LANGUAGE_EXCLUDED_PREFIXES = Object.freeze([
  {
    prefix: "app/api/",
    reason: "API responses are programmatic contracts, not visible page prose.",
  },
  {
    prefix: "app/studio/",
    reason: "Studio is an owner-only operational surface, not a public page.",
  },
  {
    prefix: "app/simulation/",
    reason: "Simulation is dormant while its experience mode is disabled.",
  },
  {
    prefix: "components/simulation/",
    reason: "Simulation is dormant while its experience mode is disabled.",
  },
  {
    prefix: "components/play/room-3d/",
    reason: "The aria-hidden Canvas contains visual labels, not public semantic prose.",
  },
  {
    prefix: "components/experience-audio/",
    reason: "Audio cue identifiers and state labels are programmatic contracts.",
  },
]);

export const PUBLIC_LANGUAGE_EXCLUDED_FILES = Object.freeze([
  {
    file: "components/play/travel/TravelGlobeStage.tsx",
    reason:
      "This aria-hidden Canvas stage contains shader source and no semantic public prose.",
  },
]);

/**
 * Long literals that cannot live in the copy deck because their exact wording is
 * a protected privacy, consent, attribution, or programmatic contract.
 *
 * Every entry is exact on purpose: editing a literal makes the exemption stale
 * and requires an owner review of both the wording and this rationale.
 */
const PRIVACY_MESSAGE_REASON =
  "Owner-reviewed privacy, retention, consent, deletion, or provider-policy wording must remain outside the editable copy deck.";
const DISCOGS_MESSAGE_REASON =
  "Discogs attribution and collection-count semantics are protected provider wording.";

function reviewedLiteral(file, literal, reason) {
  return Object.freeze({ file, literal, reason });
}

export const PUBLIC_LANGUAGE_LITERAL_ALLOWLIST = Object.freeze([
  reviewedLiteral(
    "app/privacy/page.tsx",
    `What Anish Shah’s connectors and travel atlas store, publish, retain, and delete—and how visitors control third-party loads.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `The site retrieves Anish’s public activity after owner-authorized setup. It does not collect a visitor’s Steam, Spotify, Discogs, MyAnimeList, Hardcover, or Strava account data.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Six connections and one owner-authored atlas each have a narrow input, a bounded public output, and an explicit deletion path.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Studio stores an encrypted app client secret plus renewable access and refresh tokens. A pending authorization stores only a hashed state and encrypted transaction for at most ten minutes. D1 stores a complete sanitized library snapshot so status, genre, era, and score distributions reflect the whole collection. The public endpoint returns those distributions, one bounded gallery page, and a profile link derived from the authorized identity. Cover URLs are reduced to host-free references and served only through the bounded same-origin artwork endpoint while the snapshot remains published.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Studio stores one encrypted owner API token. The authenticated user ID is used only to request the owner library; it is not published. D1 stores a complete sanitized shelf snapshot; the public endpoint returns whole-shelf reading and rating distributions, one bounded gallery page, recent books, and a profile link derived from the authenticated username. Cover URLs are reduced to host-free references and never exposed to browser code.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Studio stores an encrypted app client secret plus renewable access and refresh tokens. It requests only the permissions needed to identify the owner and retrieve Spotify’s Top Tracks affinity for its approximate four-week, six-month, and one-year windows. D1 stores at most twelve ordered tracks per window, reduced artwork references, synchronization dates, and the owner’s separate publication choice. The site does not store play counts, listening history, popularity, preview audio, country, subscription, or raw provider responses; it does not infer listening time, genre, trends, or a taste profile. An optional official track, album, or playlist Embed is blocked until a visitor explicitly chooses to load it.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Studio stores an encrypted consumer secret, access token, and access-token secret after owner-authorized OAuth. D1 stores one sanitized snapshot of the owner’s physical collection. The public endpoint returns titles, artists, release years, normalized physical formats, copy counts, format and decade distributions, and a profile link. Copies and distinct releases remain separate counts. Images, conditions, ratings, notes, acquisition dates, folders, wantlists, inventory, marketplace data, pricing, sales, account identifiers, and raw provider responses are excluded.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Studio encrypts the Web API key and SteamID64 together. D1 stores the complete public game library with rounded hours. The public endpoint returns whole-library totals and playtime bands, one bounded gallery page, and at most eight highlighted titles. Passwords, exact minutes, presence, friends, bans, achievements, inventories, real names, locations, remote artwork URLs, and raw responses are excluded. Documented game icon hashes may be stored as host-free references and served through the same-origin artwork endpoint.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `No Strava API credential or custom activity dataset is stored. Studio keeps the public athlete profile, an optional exact Strava-generated profile-feed, summary, activity, or route iframe URL, and its last anonymous frame check. A redirecting or blocked widget is not shown publicly; visitors receive the athlete-profile link instead. A working third-party iframe remains blocked until a visitor explicitly chooses to load it.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Anish uploads his own historical travel photos through the protected owner Studio. Accepted images are reoriented, stripped of embedded metadata, and stored as metadata-free WebP masters in a private media bucket. The public atlas stores only reviewed trip copy, required alt text, optional captions and tags, and owner-approved geography. Approximate-city pins are rounded to 0.1 degrees; exact GPS, original filenames, camera identifiers, and raw uploads are never stored as public data. Planned and current trips expose only country or region, month-level dates, and no photos.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Watch, Read, Listen, Collect, and Play request only this site’s sanitized first-party snapshots. Discogs data loads only after Collect opens. Spotify artwork loads only after Listen opens. The Spotify player stays blocked until the visitor chooses to load it.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Move first requests the saved embed configuration. No request reaches Strava until the visitor grants consent. The site does not collect a visitor’s provider account data.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Travel requests the published atlas and, after a photo selection, a same-origin processed image. It does not request map tiles, contact a geocoder, expose an original upload, or collect a visitor location. The globe and semantic atlas show the same reviewed places.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `MyAnimeList, Hardcover, Spotify, Discogs, and Steam synchronize only when the protected owner selects Refresh now in Studio. Public reads and scheduled maintenance never request new collection data. Strava checks its saved public widget only when the owner saves it or selects Verify feed now.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `D1 retains at most two complete sanitized snapshots for each collection provider: the current version and one rollback version. A failed request never replaces the last accepted snapshot. With an active owner-recorded publication approval, an accepted collection remains available as a saved snapshot with its actual update time. Age alone never deletes it. Once publication-approval enforcement is active, a missing, disabled, or expired approval withholds public display without deleting the private snapshot. Publication references are encrypted and never returned by Studio, public APIs, health responses, logs, or bundles.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Raw provider responses are processed in memory and discarded. Operational history is limited to provider, result, timestamps, safe error codes, and item counts; it never contains credentials, OAuth codes, or raw payloads.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `A raw Travel upload remains only while its protected upload transaction is processed and is deleted after successful conversion. Failed and abandoned temporary uploads are removed within 24 hours. Processed photo masters remain private while the owner keeps the trip; public variants are served only while their exact photo and digest belong to the active publication. Photo responses ask search engines not to index the images.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Steam is disabled. Before it can be connected or published, the owner must configure the country or countries where its encrypted credential, sanitized snapshots, and operational sync metadata are stored.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Disconnecting a provider removes its encrypted credentials or embed configuration, sanitized snapshots, pending OAuth transaction, sync history, and provider-specific audit history. The public collection becomes unavailable immediately. A minimal deletion event containing no provider values remains.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Replacing credentials invalidates in-flight work, clears the prior provider state, and requires a successful refresh before a new snapshot is public. If Steam stops returning public game details, every prior Steam snapshot is removed and replaced by a non-public visibility marker. Private games are never reconstructed or inferred.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Unpublishing a Travel trip immediately removes the trip and all of its places and photos from the active public atlas. Deleting the trip also schedules its private processed media for removal. There is no per-photo public visibility switch: a reviewed trip publishes or unpublishes as one unit.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `This site targets WCAG 2.2 Level AA and is tested with keyboard, screen-reader, zoom, reduced-motion, and high-contrast settings. That target is an ongoing practice, not a legal certification.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `. Include the page, browser or assistive technology, and the expected result when those details are safe to share.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Spotify content is attributed to Spotify and links back to the corresponding Spotify surface. Top Tracks means Spotify-calculated affinity for the labeled time window, not play counts or a listening-history export. This is a personal, noncommercial Spotify surface. The optional Spotify Embed may set or read provider cookies after consent. Review the`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Discogs data is presented as a personal, noncommercial physical catalog and links back to individual Discogs release pages. This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. Review the`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Data provided by Steam. This independent personal site is not endorsed by or affiliated with Valve. Review the`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "app/privacy/page.tsx",
    `Steam Web API data is shown “as is,” “with all faults,” and “as available,” without warranties of accuracy, availability, or fitness. To the maximum extent permitted by law, Valve, Steam game publishers and developers, and their suppliers are not liable for damages arising from use of the Steam Web API or Steam data.`,
    PRIVACY_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "components/play/DiscogsStream.tsx",
    `. This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. Release links open the corresponding Discogs page.`,
    DISCOGS_MESSAGE_REASON,
  ),
  reviewedLiteral(
    "components/play/DiscogsStream.tsx",
    `Multiple copies count once in releases and once each in physical items. Every distribution below uses the physical-item count.`,
    DISCOGS_MESSAGE_REASON,
  ),
]);

function normalizedPath(file) {
  return file.split(path.sep).join("/").replace(/^\.\//u, "");
}

export function normalizePublicLanguageLiteral(value) {
  return value.replace(/\s+/gu, " ").trim();
}

export function countPublicLanguageWords(value) {
  return (
    normalizePublicLanguageLiteral(value).match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []
  ).length;
}

export function isPublicLanguageSource(file) {
  const normalized = normalizedPath(file);
  if (!/^(?:app|components)\/.+\.tsx$/u.test(normalized)) return false;
  if (
    PUBLIC_LANGUAGE_EXCLUDED_PREFIXES.some(({ prefix }) =>
      normalized.startsWith(prefix),
    )
  ) {
    return false;
  }
  return !PUBLIC_LANGUAGE_EXCLUDED_FILES.some(
    ({ file: excluded }) => normalized === excluded,
  );
}

function isLongPublicLanguageLiteral(value) {
  const normalized = normalizePublicLanguageLiteral(value);
  return (
    countPublicLanguageWords(normalized) >= PUBLIC_LANGUAGE_MIN_WORDS ||
    normalized.length >= PUBLIC_LANGUAGE_MIN_CHARACTERS
  );
}

function isModuleSpecifier(node) {
  return (
    (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) &&
    node.parent.moduleSpecifier === node
  );
}

function isNonVisibleKey(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
    (ts.isLiteralTypeNode(parent) && parent.literal === node)
  );
}

const NON_VISIBLE_JSX_ATTRIBUTES = new Set([
  "accept",
  "action",
  "autoComplete",
  "className",
  "encType",
  "href",
  "id",
  "inputMode",
  "method",
  "name",
  "pattern",
  "rel",
  "role",
  "sizes",
  "src",
  "srcSet",
  "target",
  "type",
  "value",
]);

function isNonVisibleJsxAttribute(node) {
  const parent = node.parent;
  if (!ts.isJsxAttribute(parent) || parent.initializer !== node) return false;
  return NON_VISIBLE_JSX_ATTRIBUTES.has(parent.name.getText());
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function extractLongPublicLanguageLiterals({ file, source }) {
  const normalizedFile = normalizedPath(file);
  if (!isPublicLanguageSource(normalizedFile)) return [];

  const sourceFile = ts.createSourceFile(
    normalizedFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  const seen = new Set();

  function record(node, value, kind) {
    const literal = normalizePublicLanguageLiteral(value);
    if (!literal || !isLongPublicLanguageLiteral(literal)) return;
    const line = lineNumber(sourceFile, node);
    const key = `${line}\0${literal}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      file: normalizedFile,
      line,
      kind,
      literal,
      words: countPublicLanguageWords(literal),
      characters: literal.length,
    });
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      record(node, node.getText(sourceFile), "jsx-text");
    } else if (ts.isStringLiteral(node)) {
      if (
        !isModuleSpecifier(node) &&
        !isNonVisibleKey(node) &&
        !isNonVisibleJsxAttribute(node)
      ) {
        record(node, node.text, "string-literal");
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node, node.text, "template-literal");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function allowlistKey(file, literal) {
  return `${normalizedPath(file)}\0${normalizePublicLanguageLiteral(literal)}`;
}

export function auditPublicLanguageOwnership(
  files,
  allowlist = PUBLIC_LANGUAGE_LITERAL_ALLOWLIST,
) {
  const findings = files.flatMap(extractLongPublicLanguageLiterals);
  const entries = new Map();
  const invalidAllowlist = [];

  for (const entry of allowlist) {
    const file = normalizedPath(entry.file ?? "");
    const literal = normalizePublicLanguageLiteral(entry.literal ?? "");
    const reason = normalizePublicLanguageLiteral(entry.reason ?? "");
    if (!file || !literal || !reason || !isPublicLanguageSource(file)) {
      invalidAllowlist.push({ ...entry, file, literal, reason });
      continue;
    }
    const key = allowlistKey(file, literal);
    if (entries.has(key)) {
      invalidAllowlist.push({ ...entry, file, literal, reason });
      continue;
    }
    entries.set(key, { file, literal, reason });
  }

  const used = new Set();
  const violations = findings.filter((finding) => {
    const key = allowlistKey(finding.file, finding.literal);
    if (!entries.has(key)) return true;
    used.add(key);
    return false;
  });
  const staleAllowlist = [...entries.entries()]
    .filter(([key]) => !used.has(key))
    .map(([, entry]) => entry);

  return {
    findings,
    violations,
    staleAllowlist,
    invalidAllowlist,
  };
}
