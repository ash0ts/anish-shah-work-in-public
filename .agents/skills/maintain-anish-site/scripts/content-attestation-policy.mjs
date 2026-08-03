import { createHash } from "node:crypto";

export function verifyAttestedArtifacts(attestationText, artifacts) {
  let attestation;
  try {
    attestation = JSON.parse(attestationText);
  } catch {
    return ["Public content attestation is not valid JSON."];
  }
  if (!Array.isArray(attestation?.artifacts)) {
    return ["Public content attestation has no artifact inventory."];
  }

  const violations = [];
  for (const [artifactPath, content] of artifacts) {
    const record = attestation.artifacts.find(
      (candidate) => candidate?.path === artifactPath,
    );
    if (!record || typeof record.sha256 !== "string") {
      violations.push(`${artifactPath} is missing from the public content attestation.`);
      continue;
    }
    const bytes = Buffer.byteLength(content);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (record.bytes !== bytes || record.sha256 !== sha256) {
      violations.push(`${artifactPath} does not match its attested bytes and SHA-256.`);
    }
  }
  return violations;
}
