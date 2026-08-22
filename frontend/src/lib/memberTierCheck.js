// Mock member-tier lookup used by the Birthday Bonus eligibility flow.
// Replace with a real backend API call once the endpoint is available.
//
// Contract: `checkMemberTier(username)` returns `{ tier }` where tier
// is one of "bronze" | "silver" | "gold" | "platinum".

const FORCED_TEST_TIERS = {
  test_bronze: "bronze",
  test_silver: "silver",
  test_gold: "gold",
  test_platinum: "platinum",
};

// MOCK - replace with real backend API call once available.
export function checkMemberTier(username) {
  const key = String(username || "").trim().toLowerCase();
  if (FORCED_TEST_TIERS[key]) return { tier: FORCED_TEST_TIERS[key] };
  // Default fallback for any other username while backend isn't ready.
  return { tier: "bronze" };
}

export function isTierEligibleForBirthdayBonus(tier) {
  return tier === "silver" || tier === "gold" || tier === "platinum";
}
