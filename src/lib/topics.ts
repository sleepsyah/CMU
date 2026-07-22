// Keyword classifier mapping article text onto Unframed's civic-profile
// interest-area taxonomy, so the reading digest's topic breakdown lines up
// with the categories used for legislation relevance on the dashboard.
// Keep this list in sync with unframed/lib/civicProfileOptions.ts
// (INTEREST_AREAS) and unframed/lib/billTopics.ts (TOPIC_KEYWORDS).
export type InterestArea =
  | "housing"
  | "healthcare"
  | "education"
  | "immigration"
  | "environment"
  | "labor"
  | "criminal_justice"
  | "taxation"
  | "reproductive_rights"
  | "social_security"
  | "veterans_affairs";

export const INTEREST_AREAS: InterestArea[] = [
  "housing",
  "healthcare",
  "education",
  "immigration",
  "environment",
  "labor",
  "criminal_justice",
  "taxation",
  "reproductive_rights",
  "social_security",
  "veterans_affairs"
];

const TOPIC_KEYWORDS: Record<InterestArea, string[]> = {
  housing: ["housing", "rent", "tenant", "landlord", "eviction", "zoning", "homeless"],
  healthcare: ["health", "medicaid", "medicare", "insurance", "hospital", "mental health"],
  education: ["education", "school", "student", "tuition", "college", "university", "financial aid"],
  immigration: ["immigration", "visa", "asylum", "daca", "border", "refugee", "deportation"],
  environment: ["environment", "climate", "emission", "pollution", "clean energy", "conservation"],
  labor: ["labor", "employment", "wage", "workplace", "union", "worker"],
  criminal_justice: ["criminal justice", "police", "sentencing", "incarceration", "prison", "bail"],
  taxation: ["tax", "taxation", "revenue", "irs"],
  reproductive_rights: ["abortion", "reproductive", "contraception", "pregnancy"],
  social_security: ["social security", "retirement benefit", "ssi", "ssdi"],
  veterans_affairs: ["veteran", "military benefit", "va health", "veterans affairs"]
};

/** Maps free-form article text (title + summary) to matched interest areas. */
export function matchTopics(text: string): InterestArea[] {
  const haystack = text.toLowerCase();
  return INTEREST_AREAS.filter((area) =>
    TOPIC_KEYWORDS[area].some((keyword) => haystack.includes(keyword))
  );
}
