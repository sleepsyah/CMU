export const sourceExcerpts = {
  paraphraseWithQuotedFragment: "Indian foreign ministry said it had summoned the deputy chief of mission of the Iranian embassy to register ‘a strong protest’ against the attacks.",
  actualDirectQuote: "The Indian foreign ministry said, ‘We have registered a strong protest.’",
  longInstitutionName: "India’s Ministry of External Affairs said the official had been summoned.",
  unresolvedPassive: "It was said that further action would follow.",
  cbsInvertedVia: "\"At 19:00, a location on Qeshm Island was struck by projectiles from the American enemy,\" Hormozgan governor's office said, according to IRIB.",
  cbsAttributiveReportingVerb: "Shipping industry analysts and logistics companies balked on Tuesday at Mr. Trump's stated intention to impose a fee to cover U.S. security costs incurred as the \"guardian\" of the strait, calling it illegal and estimating the cost per ship at upwards of $30 million for large tankers."
} as const;

export function longLiveBlogFixture() {
  const filler = Array.from({ length: 460 }, (_, index) =>
    `Update ${index + 1}: Commercial traffic continued through the waterway while crews monitored conditions and published routine navigation notices for mariners.`
  );
  return [
    "Opening update: U.S. Central Command said shipping lanes remained open.",
    ...filler,
    "Final update: The Maritime Safety Board said crews had completed the last inspection.",
    "CENTCOM said it would publish another navigation notice."
  ].join("\n\n");
}
