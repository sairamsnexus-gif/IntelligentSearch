/**
 * Small, dependency-free lexicons used by rule-based extraction. They are
 * deliberately conservative — Gemini extraction (optional) broadens coverage.
 */
import { norm } from "./text";

/** Canonical organisation → aliases (all compared normalised). */
export const ORG_ALIASES: Record<string, string[]> = {
  TCS: ["tcs", "tata consultancy services", "tata consultancy"],
  Infosys: ["infosys", "infosys limited", "infosys ltd"],
  Wipro: ["wipro", "wipro limited", "wipro technologies"],
  HCLTech: ["hcl", "hcltech", "hcl technologies", "hcl tech"],
  Cognizant: ["cognizant", "cts", "cognizant technology solutions"],
  "Tech Mahindra": ["tech mahindra", "techm"],
  Accenture: ["accenture"],
  Capgemini: ["capgemini"],
  IBM: ["ibm"],
  Google: ["google", "alphabet"],
  Microsoft: ["microsoft", "msft"],
  Amazon: ["amazon", "aws", "amazon web services"],
  Zoho: ["zoho", "zoho corporation"],
  Freshworks: ["freshworks"],
  Deloitte: ["deloitte"],
  "L&T Technology Services": ["l&t technology services", "ltts"],
  LTIMindtree: ["ltimindtree", "lti", "mindtree"],
  Oracle: ["oracle"],
  SAP: ["sap"],
  Meta: ["meta", "facebook inc"],
};

const aliasIndex = new Map<string, string>();
for (const [canon, aliases] of Object.entries(ORG_ALIASES)) {
  aliasIndex.set(norm(canon), canon);
  for (const a of aliases) aliasIndex.set(norm(a), canon);
}

/** Canonical org name for any alias, or a tidied version of the input. */
export function canonicalOrg(value: string): string {
  const n = norm(value).replace(/\b(pvt|private|ltd|limited|inc|llc|corp|corporation)\b/g, "").trim();
  return aliasIndex.get(n) ?? aliasIndex.get(norm(value)) ?? value.trim();
}

export function orgAliases(value: string): string[] {
  const canon = canonicalOrg(value);
  return ORG_ALIASES[canon] ? [canon, ...ORG_ALIASES[canon]] : [value];
}

export function sameOrg(a: string, b: string): boolean {
  return norm(canonicalOrg(a)) === norm(canonicalOrg(b));
}

export const KNOWN_ORG_PHRASES: string[] = Object.entries(ORG_ALIASES).flatMap(([c, a]) => [c, ...a]);

export const DESIGNATIONS: string[] = [
  "Senior Project Manager",
  "Project Manager",
  "Program Manager",
  "Delivery Manager",
  "Delivery Lead",
  "Engineering Manager",
  "Product Manager",
  "Scrum Master",
  "Technical Architect",
  "Solution Architect",
  "Senior Software Engineer",
  "Software Engineer",
  "Software Developer",
  "Data Scientist",
  "Data Analyst",
  "Data Engineer",
  "DevOps Engineer",
  "QA Engineer",
  "Test Engineer",
  "Business Analyst",
  "Consultant",
  "Director",
  "Vice President",
  "CTO",
  "CEO",
  "Founder",
  "Co-Founder",
  "Photographer",
  "Professor",
  "Teacher",
];

export function sameDesignation(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

export interface Place {
  city: string;
  state: string;
  country: string;
  lat: number;
  lon: number;
  aliases?: string[];
}

export const PLACES: Place[] = [
  { city: "Chennai", state: "Tamil Nadu", country: "India", lat: 13.0827, lon: 80.2707, aliases: ["madras"] },
  { city: "Bengaluru", state: "Karnataka", country: "India", lat: 12.9716, lon: 77.5946, aliases: ["bangalore"] },
  { city: "Hyderabad", state: "Telangana", country: "India", lat: 17.385, lon: 78.4867 },
  { city: "Mumbai", state: "Maharashtra", country: "India", lat: 19.076, lon: 72.8777, aliases: ["bombay"] },
  { city: "Pune", state: "Maharashtra", country: "India", lat: 18.5204, lon: 73.8567 },
  { city: "Delhi", state: "Delhi", country: "India", lat: 28.7041, lon: 77.1025, aliases: ["new delhi"] },
  { city: "Noida", state: "Uttar Pradesh", country: "India", lat: 28.5355, lon: 77.391 },
  { city: "Gurugram", state: "Haryana", country: "India", lat: 28.4595, lon: 77.0266, aliases: ["gurgaon"] },
  { city: "Kolkata", state: "West Bengal", country: "India", lat: 22.5726, lon: 88.3639, aliases: ["calcutta"] },
  { city: "Coimbatore", state: "Tamil Nadu", country: "India", lat: 11.0168, lon: 76.9558 },
  { city: "Madurai", state: "Tamil Nadu", country: "India", lat: 9.9252, lon: 78.1198 },
  { city: "Kochi", state: "Kerala", country: "India", lat: 9.9312, lon: 76.2673, aliases: ["cochin"] },
  { city: "Thiruvananthapuram", state: "Kerala", country: "India", lat: 8.5241, lon: 76.9366, aliases: ["trivandrum"] },
  { city: "Ahmedabad", state: "Gujarat", country: "India", lat: 23.0225, lon: 72.5714 },
  { city: "Jaipur", state: "Rajasthan", country: "India", lat: 26.9124, lon: 75.7873 },
  { city: "London", state: "England", country: "United Kingdom", lat: 51.5072, lon: -0.1276 },
  { city: "Manchester", state: "England", country: "United Kingdom", lat: 53.4808, lon: -2.2426 },
  { city: "New York", state: "New York", country: "United States", lat: 40.7128, lon: -74.006 },
  { city: "San Francisco", state: "California", country: "United States", lat: 37.7749, lon: -122.4194 },
  { city: "Seattle", state: "Washington", country: "United States", lat: 47.6062, lon: -122.3321 },
  { city: "Toronto", state: "Ontario", country: "Canada", lat: 43.6532, lon: -79.3832 },
  { city: "Singapore", state: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198 },
  { city: "Dubai", state: "Dubai", country: "United Arab Emirates", lat: 25.2048, lon: 55.2708 },
  { city: "Sydney", state: "New South Wales", country: "Australia", lat: -33.8688, lon: 151.2093 },
];

export const COUNTRIES: Record<string, string[]> = {
  India: ["india", "bharat"],
  "United Kingdom": ["united kingdom", "uk", "england", "britain"],
  "United States": ["united states", "usa", "us", "america"],
  Canada: ["canada"],
  Singapore: ["singapore"],
  "United Arab Emirates": ["united arab emirates", "uae"],
  Australia: ["australia"],
  Germany: ["germany"],
};

export function canonicalCity(value: string): string {
  const n = norm(value);
  const p = PLACES.find((pl) => norm(pl.city) === n || pl.aliases?.some((a) => norm(a) === n));
  return p ? p.city : value.trim();
}

export function cityAliases(value: string): string[] {
  const canon = canonicalCity(value);
  const p = PLACES.find((pl) => pl.city === canon);
  return p ? [p.city, ...(p.aliases ?? [])] : [value];
}

export function sameCity(a: string, b: string): boolean {
  return norm(canonicalCity(a)) === norm(canonicalCity(b));
}

export function canonicalCountry(value: string): string {
  const n = norm(value);
  for (const [c, aliases] of Object.entries(COUNTRIES)) if (norm(c) === n || aliases.includes(n)) return c;
  return value.trim();
}

export function sameCountry(a: string, b: string): boolean {
  return norm(canonicalCountry(a)) === norm(canonicalCountry(b));
}

export function placeFor(city: string): Place | undefined {
  const canon = canonicalCity(city);
  return PLACES.find((p) => p.city === canon);
}
