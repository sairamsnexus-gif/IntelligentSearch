/** Lightweight, client-safe labels (no heavy deps). */
import type { AttributeKind } from "./types";

export const PURPOSES = [
  "due_diligence",
  "recruitment_verification",
  "reconnect",
  "self_monitoring",
  "research",
  "other",
] as const;

export const ATTRIBUTE_LABEL: Record<AttributeKind, string> = {
  name: "Name",
  city: "City",
  state: "State",
  country: "Country",
  organization: "Company",
  designation: "Designation",
  previous_organization: "Previous company",
  school: "School / College",
  age: "Approx. age",
  email: "Email",
  phone: "Phone",
  website: "Website",
  event: "Event",
  other: "Other",
};
