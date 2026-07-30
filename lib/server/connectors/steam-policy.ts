import { runtimeValue } from "../runtime-env";

const UNSPECIFIED_STORAGE_VALUES = new Set([
  "global",
  "tbd",
  "unknown",
  "worldwide",
]);

export function steamStorageCountries(): string | null {
  const configured = runtimeValue("STEAM_DATA_STORAGE_COUNTRIES");
  if (!configured || configured.length > 200) return null;

  const countries = configured.split(",").map((country) => country.trim());
  if (
    countries.length === 0 ||
    countries.some(
      (country) =>
        country.length < 2 ||
        country.length > 64 ||
        !/^[a-z][a-z .'-]*$/i.test(country) ||
        UNSPECIFIED_STORAGE_VALUES.has(country.toLowerCase()),
    )
  ) {
    return null;
  }

  return countries.join(", ");
}
