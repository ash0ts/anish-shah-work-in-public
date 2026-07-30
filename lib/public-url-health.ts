const knownUnavailablePublicUrls = new Set([
  "https://raysummit23.anyscale.com/agenda",
  "https://www.getprog.ai/profile/93145909",
]);

export function isKnownUnavailablePublicUrl(url: string): boolean {
  return knownUnavailablePublicUrls.has(url);
}
