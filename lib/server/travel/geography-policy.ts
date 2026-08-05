import geography from "./geography-policy.generated.json" with { type: "json" };
import type { TravelPlaceInput } from "./policy";

type TrustedPoint = { lat: number; lng: number };
type GeographyEntry = { name: string; point: TrustedPoint };

const countries = geography.countries as Record<string, GeographyEntry>;
const admin1 = geography.admin1 as Record<string, Record<string, GeographyEntry>>;

function normalizedAdminCode(countryCode: string, value: string): string {
  const directory = admin1[countryCode];
  if (!directory) return value;
  if (directory[value]) return value;
  const prefixed = `${countryCode}-${value}`;
  return directory[prefixed] ? prefixed : value;
}

export function normalizeTrustedTravelPlace(
  input: TravelPlaceInput,
): TravelPlaceInput | null {
  const country = countries[input.countryCode];
  if (!country) return null;

  if (input.precision === "country") {
    if (input.admin1Code !== null || input.admin1Name !== null) return null;
    return {
      ...input,
      countryName: country.name,
      admin1Code: null,
      admin1Name: null,
      publicPoint: country.point,
    };
  }

  if ((input.admin1Code === null) !== (input.admin1Name === null)) return null;

  if (input.precision === "region") {
    if (!input.admin1Code || !input.admin1Name) return null;
    const code = normalizedAdminCode(input.countryCode, input.admin1Code);
    const region = admin1[input.countryCode]?.[code];
    if (!region) return null;
    return {
      ...input,
      countryName: country.name,
      admin1Code: code,
      admin1Name: region.name,
      publicPoint: region.point,
    };
  }

  if (input.admin1Code) {
    const code = normalizedAdminCode(input.countryCode, input.admin1Code);
    const directory = admin1[input.countryCode];
    if (!directory) return null;
    const region = directory?.[code];
    if (!region) return null;
    return {
      ...input,
      countryName: country.name,
      admin1Code: code,
      admin1Name: region?.name ?? input.admin1Name,
    };
  }

  return { ...input, countryName: country.name };
}

export function trustedCoarseTravelPlaceIssue(
  input: Pick<
    TravelPlaceInput,
    | "countryCode"
    | "countryName"
    | "admin1Code"
    | "admin1Name"
    | "precision"
    | "publicPoint"
  >,
): string | null {
  if (input.precision === "city_approximate") return null;
  const normalized = normalizeTrustedTravelPlace({
    ...input,
    label: "Trusted geography check",
    sortOrder: 0,
  });
  if (
    !normalized ||
    normalized.countryName !== input.countryName ||
    normalized.admin1Code !== input.admin1Code ||
    normalized.admin1Name !== input.admin1Name ||
    normalized.publicPoint.lat !== input.publicPoint.lat ||
    normalized.publicPoint.lng !== input.publicPoint.lng
  ) {
    return "Country and region pins must use the packaged Natural Earth centroid.";
  }
  return null;
}
