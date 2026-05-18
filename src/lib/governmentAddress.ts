export type GovernmentAddressMode = "postal" | "street";

export type GovernmentAddressFields = {
  addressMode: GovernmentAddressMode;
  postalCode: string;
  city: string;
  country: string;
  street: string;
  streetNumber: string;
};

const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  INDONESIA: "id",
  FINLAND: "fi",
  "UNITED STATES": "us",
  "UNITED STATES OF AMERICA": "us",
  USA: "us",
  "UNITED KINGDOM": "gb",
  UK: "gb",
  GERMANY: "de",
  FRANCE: "fr",
  AUSTRALIA: "au",
  JAPAN: "jp",
  SINGAPORE: "sg",
  MALAYSIA: "my",
  NETHERLANDS: "nl",
  SWEDEN: "se",
  NORWAY: "no",
  DENMARK: "dk",
  CANADA: "ca",
  UKRAINE: "ua",
  INDIA: "in",
  CHINA: "cn",
  "SOUTH KOREA": "kr",
  KOREA: "kr",
  THAILAND: "th",
  PHILIPPINES: "ph",
  VIETNAM: "vn",
  SPAIN: "es",
  ITALY: "it",
  BRAZIL: "br",
  MEXICO: "mx",
};

function cleanPart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function countryToIso2(country: string): string | null {
  const raw = cleanPart(country);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) {
    return upper.toLowerCase();
  }
  return COUNTRY_NAME_TO_ISO2[upper] ?? null;
}

/** Client-side hint only; server resolves any country via OpenStreetMap. */
export function isKnownCountryLabel(country: string): boolean {
  return countryToIso2(country) != null;
}

export function buildGovernmentReferenceId(
  fields: GovernmentAddressFields,
): string {
  const country =
    countryToIso2(fields.country) ?? fields.country.trim().toUpperCase();
  const city = cleanPart(fields.city).toUpperCase();
  const postal = cleanPart(fields.postalCode).toUpperCase();
  if (fields.addressMode === "street") {
    const street = cleanPart(fields.street).toUpperCase();
    const number = cleanPart(fields.streetNumber).toUpperCase();
    return [country, street, number, postal, city].join("|");
  }
  if (postal && city) {
    return [country, postal, city].join("|");
  }
  if (postal) {
    return `${country}|${postal}`;
  }
  return country;
}

export function governmentAddressFromConfig(
  config: Record<string, unknown>,
): GovernmentAddressFields {
  const modeRaw = config.address_mode;
  const mode: GovernmentAddressMode =
    modeRaw === "street" ? "street" : "postal";
  return {
    addressMode: mode,
    postalCode:
      typeof config.postal_code === "string" ? config.postal_code : "",
    city: typeof config.city === "string" ? config.city : "",
    country: typeof config.country === "string" ? config.country : "",
    street: typeof config.street === "string" ? config.street : "",
    streetNumber:
      typeof config.street_number === "string" ? config.street_number : "",
  };
}

export function governmentReferenceIdFromConfig(
  config: Record<string, unknown>,
): string {
  if (typeof config.country === "string" && config.country.trim()) {
    return buildGovernmentReferenceId(governmentAddressFromConfig(config));
  }
  const raw = config.local_code ?? config.area_code;
  return typeof raw === "string"
    ? raw.replace(/\s+/g, "").toUpperCase()
    : "";
}

export function governmentAddressMatchesValidation(
  fields: GovernmentAddressFields,
  referenceId: string,
): boolean {
  return buildGovernmentReferenceId(fields) === referenceId;
}

export function isGovernmentAddressComplete(
  fields: GovernmentAddressFields,
): boolean {
  if (!fields.country.trim()) return false;
  if (fields.addressMode === "street") {
    return Boolean(
      fields.street.trim() &&
        fields.postalCode.trim() &&
        fields.city.trim(),
    );
  }
  return Boolean(fields.postalCode.trim() && fields.city.trim());
}

export function governmentAddressToConfig(
  fields: GovernmentAddressFields,
): Record<string, string> {
  const iso2 = countryToIso2(fields.country);
  return {
    local_code: buildGovernmentReferenceId(fields),
    area_code: buildGovernmentReferenceId(fields),
    address_mode: fields.addressMode,
    postal_code: fields.postalCode.trim(),
    city: fields.city.trim(),
    country: fields.country.trim(),
    country_code: iso2 ?? "",
    street: fields.street.trim(),
    street_number: fields.streetNumber.trim(),
    code_type: fields.addressMode === "street" ? "street" : "postal",
  };
}

export function governmentAddressValidatePayload(
  fields: GovernmentAddressFields,
) {
  return {
    zone_type: "government_local_code" as const,
    address_mode: fields.addressMode,
    postal_code: fields.postalCode.trim(),
    city: fields.city.trim(),
    country: fields.country.trim(),
    street: fields.street.trim(),
    street_number: fields.streetNumber.trim(),
    reference_id: buildGovernmentReferenceId(fields),
  };
}

export function applyGovernmentFieldsFromConfig(
  config: Record<string, unknown>,
): GovernmentAddressFields {
  return governmentAddressFromConfig(config);
}
