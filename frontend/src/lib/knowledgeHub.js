/**
 * knowledgeHub.js
 *
 * Single source of truth for MD88 promotions data + a deterministic
 * calculation engine + keyword-based matcher used by Lily's text-based
 * auto-reply.
 *
 * Design principles:
 *   1. Data-driven — adding a 4th promotion or tweaking a %/max/turnover
 *      is a data-only change.
 *   2. NO LLM involved — money-related answers use predictable math so
 *      they can be unit-tested.
 *   3. Deterministic keyword scoring for the matcher (longer keyword hits
 *      score higher — resolves ambiguity between "welcome bonus" and
 *      "welcome bonus 100%").
 *   4. FAQS[] and POLICIES[] are pre-declared empty arrays so the follow-up
 *      task can drop content in without any refactor.
 */

// ============================================================
// PROMOTIONS — source of truth
// ============================================================

export const PROMOTIONS_KB = [
  {
    id: "welcome_lucky_288",
    title: "288% Welcome Bonus",
    keywords: [
      "288%", "288 percent", "288", "welcome bonus", "welcome lucky",
      "welcome", "lucky bonus", "first deposit bonus",
    ],
    min_deposit: 50,
    bonus_type: "percent",
    bonus_percent: 288,
    max_bonus: 2880,
    free_spin_tiers: null,
    spin_value: null,
    turnover_multiplier: 35,
    claim_limit: "once",
    bonus_validity: "7 days from issuance",
    applicable_games: ["All Webslot games"],
    excluded_games: [
      "Pussy888", "PlayTech", "Asia Gaming", "Relax Gaming", "Mega888",
      "918kiss", "Habanero", "BNG", "Lucky365",
    ],
    credit_timing: "instant",
    // Template placeholders substituted from structured fields at render
    // time — {{min_deposit}}, {{bonus_percent}}, {{max_bonus}}, {{spins}},
    // {{turnover_multiplier}}, {{spin_value}}. See substituteTemplate().
    how_to_apply_steps: [
      "Register an account with MD88 if you're not a member yet. https://m.md88top.com/en-MY/sign-up",
      "Make a qualifying first deposit of MYR {{min_deposit}} or more.",
      "Go to the Promotions page and select this bonus.",
      "Read the T&C, click 'Claim' and follow the on-screen instructions.",
      "Your {{bonus_percent}}% bonus will be credited automatically after your deposit clears.",
    ],
  },
  {
    id: "monthly_188_spins",
    title: "188 Free Spin Unlimited",
    keywords: [
      "188 free spin", "188 free spins", "188 fs", "188 spins", "188",
      "free spin unlimited", "free spins unlimited", "free spin",
      "free spins", "monthly free spin", "monthly free spins", "unlimited",
    ],
    min_deposit: 50,
    bonus_type: "free_spins",
    bonus_percent: null,
    max_bonus: null,
    free_spin_tiers: [
      { deposit: 50, spins: 10 },
      { deposit: 200, spins: 38 },
      { deposit: 500, spins: 88 },
      { deposit: 1000, spins: 188 },
    ],
    spin_value: 1.00,
    turnover_multiplier: 1,
    claim_limit: "monthly",
    bonus_validity: "24 hours from submission",
    applicable_games: [
      "MD88 Starlight Princess", "Gates of Olympus 1000", "Gate of Olympus",
      "Sweet Bonanza", "Sweet Bonanza 1000", "Wisdom of Athena",
      "Mahjong Wins2", "Sugar Rush", "Sugar Rush 1000",
    ],
    excluded_games: ["Pussy888"],
    credit_timing: "within 5 minutes, valid 24 hours from submission",
    how_to_apply_steps: [
      "Register an account with MD88 if you're not a member yet. https://m.md88top.com/en-MY/sign-up",
      "Transfer a minimum first-time deposit of MYR {{min_deposit}} to Pragmatic Play slots provider wallet.",
      "Go to the [Transfer] page and select \"Transfer\".",
      "Enter the amount from \"Main Wallet\" to [Pragmatic Play] slots provider wallet.",
      "Select the promo code [CLAIM SLOTS FREE SPINS].",
      "Free spins will be credited within 5 minutes and are valid for 24 hours from submission.",
    ],
  },
  {
    id: "welcome_100_100",
    title: "Welcome Bonus 100% + 100 Free Spins",
    keywords: [
      "100% + 100", "100%", "welcome 100", "welcome bonus 100",
      "100 free spins", "100 free spin", "welcome plus", "welcome + 100",
      "welcome plus 100",
    ],
    min_deposit: 50,
    bonus_type: "percent_plus_free_spins",
    bonus_percent: 100,
    max_bonus: 500,
    // fixed 100 spins regardless of deposit tier (as long as min_deposit met)
    free_spin_tiers: [{ deposit: 0, spins: 100 }],
    spin_value: 0.20,
    turnover_multiplier: 15,
    claim_limit: "once",
    bonus_validity: "7 days from issuance",
    applicable_games: [
      "MD88 Starlight Princess", "Starlight Princess 1000",
      "Gates of Olympus 1000", "Gates of Olympus Super Scatter",
      "Sweet Bonanza 1000", "Sweet Bonanza Super Scatter", "Sugar Rush 1000",
      "Mahjong Wins 3 Black Scatter", "Mahjong Wins 2",
      "Bigger Barn House Bonanza", "Triple Pot Gold",
      "Gates of Gatotkaca 1000", "Wisdom of Athena 1000",
      "Waves of Poseidon", "5 Lions Megaways",
      "MD88 Gates of Olympus Super Scatter",
    ],
    excluded_games: [
      "918kiss", "Mega888", "fishing games", "table games", "online games",
    ],
    credit_timing:
      "100% bonus instant; 100 free spins credited next day 01:00 AM (GMT+8)",
    how_to_apply_steps: [
      "Register an account with MD88 if you're not a member yet. https://m.md88top.com/en-MY/sign-up",
      "Make your first deposit of MYR {{min_deposit}} or more.",
      "Go to the Promotions page and select this bonus.",
      "Enter the promo code [WELCOME100] if prompted.",
      "Your {{bonus_percent}}% bonus is credited instantly; the {{spins}} free spins are credited next day at 01:00 AM (GMT+8).",
    ],
  },
];

// ============================================================
// GENERAL TERMS — apply to every promotion
// ============================================================

export const GENERAL_TERMS = [
  "This promotion is only available for 1 MD88 member per account.",
  "This promotion is only for all games – 2 categories (slots and tables) included.",
  "All customer offers are limited to one per person — one per family, household address, IP address, email address, telephone number, credit/debit card and/or e-payment account, or shared computer (e.g., school, public library, workplace) – limited to 3 identifiers per household.",
  "Bonuses are valid for seven (7) days upon issuance unless stated otherwise. Money won using bonus funds will be removed from the member's account if conditions are not fulfilled within 7 days.",
  "Any bets resulting in void, tie, cancelled, or made on opposite sides with the same outcome will not count as valid turnover.",
  "Turnover on all non-live table games (Blackjack, Video Poker, Craps, American Roulette, Baccarat, etc.) and non-slot games will not count toward turnover requirements unless specifically stated.",
  "This promotion cannot be used in conjunction with other MD88 promotions.",
  "MD88 reserves the right to alter, cancel, terminate, or suspend the redemption or any part of the terms at any time, with or without prior notice.",
  "Members must accept and comply with these rules plus all other MD88 website rules and terms.",
  "General Terms and Conditions of MD88 apply.",
];

// ============================================================
// FAQS + POLICIES — placeholder for the follow-up task
// ============================================================

export const FAQS = [];
export const POLICIES = [];

// ============================================================
// Helpers
// ============================================================

export function findPromoById(id) {
  return PROMOTIONS_KB.find((p) => p.id === id) || null;
}

// "🚫 Excluding: X, Y, Z" — always derived from excluded_games so any
// update to the data flows to every UI surface that shows it.
export function formatExclusionLine(promo) {
  if (!promo || !Array.isArray(promo.excluded_games) || promo.excluded_games.length === 0) return "";
  return `🚫 Excluding: ${promo.excluded_games.join(", ")}`;
}

// ============================================================
// getPromotionDisplayData — single formatter used by every UI surface
// ============================================================
//
// Reads a promotion from PROMOTIONS_KB and returns a unified display
// payload used by (a) the Step 3 detail chat bubble, (b) Step 5 claim
// instructions, (c) any Knowledge Hub free-text reply. Any string that
// mentions a number is ALWAYS derived from the structured fields — never
// hand-typed — so changing (say) min_deposit for a promo automatically
// updates every UI surface.

function substituteTemplate(str, promo) {
  if (!str) return "";
  const spins = promo.free_spin_tiers?.[0]?.spins ?? 0;
  return String(str)
    .replace(/\{\{min_deposit\}\}/g, promo.min_deposit ?? "")
    .replace(/\{\{bonus_percent\}\}/g, promo.bonus_percent ?? "")
    .replace(/\{\{max_bonus\}\}/g, promo.max_bonus ?? "")
    .replace(/\{\{turnover_multiplier\}\}/g, promo.turnover_multiplier ?? "")
    .replace(/\{\{spin_value\}\}/g, promo.spin_value != null ? promo.spin_value.toFixed(2) : "")
    .replace(/\{\{spins\}\}/g, spins);
}

function claimLimitDisplay(promo) {
  if (promo.claim_limit === "once") return "once per member";
  if (promo.claim_limit === "monthly") return "monthly";
  return String(promo.claim_limit || "");
}

function bonusDescription(promo) {
  if (promo.bonus_type === "percent") {
    return `${promo.bonus_percent}% match on your deposit, up to MYR ${promo.max_bonus.toLocaleString("en-MY")}`;
  }
  if (promo.bonus_type === "free_spins") {
    const ladder = promo.free_spin_tiers
      .map((t) => `MYR ${t.deposit} → ${t.spins} spins`)
      .join(" · ");
    return `Free spins ladder: ${ladder} (each spin worth MYR ${promo.spin_value.toFixed(2)})`;
  }
  if (promo.bonus_type === "percent_plus_free_spins") {
    const spins = promo.free_spin_tiers?.[0]?.spins ?? 0;
    return `${promo.bonus_percent}% match up to MYR ${promo.max_bonus.toLocaleString("en-MY")} + ${spins} free spins @ MYR ${promo.spin_value.toFixed(2)} each`;
  }
  return "";
}

function turnoverDescription(promo) {
  const mult = promo.turnover_multiplier;
  if (promo.bonus_type === "percent") return `${mult}× (deposit + bonus)`;
  if (promo.bonus_type === "free_spins") return `${mult}× (deposit + free-spin value)`;
  if (promo.bonus_type === "percent_plus_free_spins") return `${mult}× (deposit + bonus + free-spin value)`;
  return `${mult}×`;
}

function generatedDetailClosingParagraph(promo) {
  if (promo.bonus_type === "percent") {
    return `Remember that this bonus is valid for ${promo.bonus_validity || "7 days from issuance"} unless stated otherwise, carries a ${promo.turnover_multiplier}× wagering requirement on (deposit + bonus), and can be claimed ${claimLimitDisplay(promo)}. Specific terms and conditions apply to this promotion.`;
  }
  if (promo.bonus_type === "free_spins") {
    return `Remember that free spins are credited ${promo.credit_timing}. This promotion can be claimed ${claimLimitDisplay(promo)}, and there are specific terms and conditions that apply.`;
  }
  if (promo.bonus_type === "percent_plus_free_spins") {
    const spins = promo.free_spin_tiers?.[0]?.spins ?? 0;
    return `Remember that this bonus requires a minimum deposit of MYR ${promo.min_deposit}. The ${promo.bonus_percent}% bonus is capped at MYR ${promo.max_bonus.toLocaleString("en-MY")}, ${spins} free spins are worth MYR ${promo.spin_value.toFixed(2)} each, and the wagering requirement is ${promo.turnover_multiplier}× on (deposit + bonus + free-spin value). ${promo.credit_timing}.`;
  }
  return "";
}

function generatedClaimClosingParagraph(promo) {
  if (promo.bonus_type === "percent") {
    return `Your bonus is valid for ${promo.bonus_validity || "7 days from issuance"} unless stated otherwise, and the wagering requirement is ${promo.turnover_multiplier}× on (deposit + bonus). If you have any questions about the terms or run into any issues, just let me know.`;
  }
  if (promo.bonus_type === "free_spins") {
    return `Your free spins are credited ${promo.credit_timing}. If you have any questions about the terms or run into any issues, just let me know.`;
  }
  if (promo.bonus_type === "percent_plus_free_spins") {
    const spins = promo.free_spin_tiers?.[0]?.spins ?? 0;
    return `Your ${spins} free spins are worth MYR ${promo.spin_value.toFixed(2)} each and the wagering requirement is ${promo.turnover_multiplier}× on (deposit + bonus + free-spin value). If you have any questions about the terms or run into any issues, just let me know.`;
  }
  return "";
}

/**
 * Returns the unified display payload for a promotion. Every downstream
 * UI surface (Step 3 detail bubble, Step 5 claim bubble, KB text replies)
 * MUST read from this — never from separately-typed copy.
 */
export function getPromotionDisplayData(promoIdOrPromo) {
  const promo = typeof promoIdOrPromo === "string"
    ? findPromoById(promoIdOrPromo)
    : promoIdOrPromo;
  if (!promo) return null;
  return {
    id: promo.id,
    title: promo.title,
    min_deposit: promo.min_deposit,
    min_deposit_display: `MYR ${promo.min_deposit}`,
    bonus_type: promo.bonus_type,
    bonus_description: bonusDescription(promo),
    turnover_description: turnoverDescription(promo),
    bonus_validity: promo.bonus_validity || "7 days from issuance",
    claim_limit_display: claimLimitDisplay(promo),
    applicable_games: promo.applicable_games || [],
    excluded_games: promo.excluded_games || [],
    exclusion_line: formatExclusionLine(promo),
    credit_timing: promo.credit_timing || "",
    how_to_apply: (promo.how_to_apply_steps || []).map((s) => substituteTemplate(s, promo)),
    detail_closing_paragraph: generatedDetailClosingParagraph(promo),
    claim_closing_paragraph: generatedClaimClosingParagraph(promo),
  };
}

// ============================================================
// Calculation Engine — deterministic, unit-testable
// ============================================================

/**
 * Compute the bonus outcome for a given promotion + deposit amount.
 *
 * Returns:
 *   { eligible: false, reason }                 if deposit below min
 *   { eligible: true, bonus?, free_spin_value?, turnover_required, ... } otherwise
 */
export function calculatePromoOutcome(promo, depositAmount) {
  if (!promo) return { eligible: false, reason: "unknown promotion" };
  const dep = Number(depositAmount);
  if (!Number.isFinite(dep) || dep <= 0) {
    return { eligible: false, reason: "invalid deposit amount" };
  }
  if (dep < promo.min_deposit) {
    return { eligible: false, reason: "below minimum deposit", min_deposit: promo.min_deposit };
  }

  if (promo.bonus_type === "percent") {
    const rawBonus = dep * (promo.bonus_percent / 100);
    const bonus = Math.min(rawBonus, promo.max_bonus ?? rawBonus);
    const turnover_required = (dep + bonus) * promo.turnover_multiplier;
    return {
      eligible: true,
      deposit: dep,
      bonus: round2(bonus),
      turnover_required: round2(turnover_required),
      credit_timing: promo.credit_timing,
    };
  }

  if (promo.bonus_type === "free_spins") {
    const tier = findMatchingTier(promo.free_spin_tiers, dep);
    if (!tier) {
      // Deposit meets min but doesn't cleanly hit a listed tier — expose the
      // ladder so the customer knows exactly what to deposit.
      return {
        eligible: true,
        deposit: dep,
        approximate: true,
        tiers: promo.free_spin_tiers,
        message: `Deposit exactly one of: ${promo.free_spin_tiers.map((t) => `MYR ${t.deposit} → ${t.spins} spins`).join(" · ")}.`,
      };
    }
    const free_spin_value = tier.spins * promo.spin_value;
    const turnover_required = (dep + free_spin_value) * promo.turnover_multiplier;
    return {
      eligible: true,
      deposit: dep,
      spins: tier.spins,
      free_spin_value: round2(free_spin_value),
      turnover_required: round2(turnover_required),
      credit_timing: promo.credit_timing,
    };
  }

  if (promo.bonus_type === "percent_plus_free_spins") {
    // 100% match capped at max_bonus + fixed 100 free spins as long as
    // min_deposit is met. Free-spin count is taken from the (single-entry)
    // ladder for structural consistency.
    const spins = promo.free_spin_tiers?.[0]?.spins ?? 0;
    const rawBonus = dep * (promo.bonus_percent / 100);
    const bonus = Math.min(rawBonus, promo.max_bonus ?? rawBonus);
    const free_spin_value = spins * promo.spin_value;
    const turnover_required = (dep + bonus + free_spin_value) * promo.turnover_multiplier;
    return {
      eligible: true,
      deposit: dep,
      bonus: round2(bonus),
      spins,
      free_spin_value: round2(free_spin_value),
      turnover_required: round2(turnover_required),
      credit_timing: promo.credit_timing,
    };
  }

  return { eligible: false, reason: "unsupported bonus type" };
}

function findMatchingTier(tiers, dep) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  // Exact match preferred; else nearest tier at-or-below.
  const exact = tiers.find((t) => t.deposit === dep);
  if (exact) return exact;
  const sorted = [...tiers].sort((a, b) => a.deposit - b.deposit);
  let best = null;
  for (const t of sorted) if (t.deposit <= dep) best = t;
  return best;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ============================================================
// Amount extraction — currency / context / bare number
// ============================================================

export function extractDepositAmount(text) {
  if (!text) return null;
  // Strip percentage tokens first ("288%", "100%") so a promo name mention
  // doesn't get misread as a deposit amount.
  const cleaned = String(text).replace(/\d+\s*%/g, " ");
  // Currency-prefixed
  const currency = cleaned.match(/(?:rm|myr|\$)\s*(\d+(?:\.\d+)?)/i);
  if (currency) return parseFloat(currency[1]);
  // Deposit-context
  const context = cleaned.match(/(?:deposit|put|topup|top[-\s]?up|dep|with)\s+(?:of\s+|about\s+)?(\d+(?:\.\d+)?)/i);
  if (context) return parseFloat(context[1]);
  // Bare number fallback — only if it looks like a plausible deposit amount.
  const bare = cleaned.match(/\b(\d+(?:\.\d+)?)\b/);
  if (bare) {
    const n = parseFloat(bare[1]);
    if (n >= 10 && n <= 100000) return n;
  }
  return null;
}

// ============================================================
// Reply formatting
// ============================================================

function fmtMoney(n) {
  if (n == null) return "MYR 0.00";
  return `MYR ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function promoSummaryLines(promo) {
  const lines = [`Here's the summary for our ${promo.title}:`];
  lines.push(`• Minimum deposit: ${fmtMoney(promo.min_deposit)}`);
  if (promo.bonus_type === "percent") {
    lines.push(`• Bonus: ${promo.bonus_percent}% of your deposit${promo.max_bonus ? `, up to ${fmtMoney(promo.max_bonus)}` : ""}`);
  } else if (promo.bonus_type === "free_spins") {
    const ladder = promo.free_spin_tiers.map((t) => `${fmtMoney(t.deposit)} → ${t.spins} spins`).join(" · ");
    lines.push(`• Free spins ladder: ${ladder}`);
    lines.push(`• Spin value: ${fmtMoney(promo.spin_value)} each`);
  } else if (promo.bonus_type === "percent_plus_free_spins") {
    const spins = promo.free_spin_tiers?.[0]?.spins ?? 0;
    lines.push(`• Bonus: ${promo.bonus_percent}% match, up to ${fmtMoney(promo.max_bonus)}`);
    lines.push(`• Free spins: ${spins} spins @ ${fmtMoney(promo.spin_value)} each`);
  }
  lines.push(`• Turnover requirement: ${promo.turnover_multiplier}× (deposit + bonus${promo.bonus_type !== "percent" ? " + free-spin value" : ""})`);
  lines.push(`• Credit timing: ${promo.credit_timing}`);
  lines.push(`• Claim limit: ${promo.claim_limit === "once" ? "once per member" : promo.claim_limit}`);
  return lines;
}

function calcResultLines(promo, outcome) {
  const lines = [];
  if (!outcome.eligible) {
    if (outcome.reason === "below minimum deposit") {
      lines.push(`Unfortunately a deposit of ${fmtMoney(outcome.deposit ?? "")} is below the minimum of ${fmtMoney(outcome.min_deposit)} for our ${promo.title}.`);
      lines.push(`Please increase your deposit to at least ${fmtMoney(outcome.min_deposit)} to qualify.`);
    } else {
      lines.push(`I can't compute an outcome for that deposit amount (${outcome.reason}).`);
    }
    return lines;
  }
  lines.push(`For our ${promo.title}, with a ${fmtMoney(outcome.deposit)} deposit:`);
  if (outcome.approximate) {
    lines.push(outcome.message);
    return lines;
  }
  if (outcome.bonus != null) lines.push(`• Bonus amount: ${fmtMoney(outcome.bonus)}`);
  if (outcome.spins != null) lines.push(`• Free spins: ${outcome.spins} (value ${fmtMoney(outcome.free_spin_value)})`);
  else if (outcome.free_spin_value != null) lines.push(`• Free-spin value: ${fmtMoney(outcome.free_spin_value)}`);
  lines.push(`• Turnover required: ${fmtMoney(outcome.turnover_required)}`);
  lines.push(`• Credit timing: ${outcome.credit_timing}`);
  return lines;
}

function generalTermsBlock(promo) {
  const lines = ["General terms & conditions:"];
  GENERAL_TERMS.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  const excl = formatExclusionLine(promo);
  if (excl) {
    lines.push("");
    lines.push(excl);
  }
  return lines;
}

/**
 * Compose the full knowledge-hub reply for a matched promotion.
 *   - amount+outcome present → calculation reply + terms
 *   - no amount              → general summary + prompt for an amount
 */
export function formatKnowledgeHubReply(promo, amount, outcome) {
  const blocks = [];
  if (amount != null && outcome) {
    blocks.push(calcResultLines(promo, outcome).join("\n"));
    blocks.push("");
    blocks.push(generalTermsBlock(promo).join("\n"));
  } else {
    blocks.push(promoSummaryLines(promo).join("\n"));
    blocks.push("");
    blocks.push("Would you like an exact calculation? Just tell me the deposit amount (e.g. \"RM 100\" or \"deposit 200\").");
    blocks.push("");
    blocks.push(generalTermsBlock(promo).join("\n"));
  }
  return blocks.join("\n");
}

// ============================================================
// Matcher — score-based, longer-keyword-wins
// ============================================================

export function matchKnowledgeHub(text) {
  if (!text || String(text).trim().length < 2) return null;
  const low = String(text).toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const promo of PROMOTIONS_KB) {
    const candidates = [...(promo.keywords || []), promo.title].map((k) => String(k).toLowerCase());
    // Score = length of the LONGEST keyword hit. This resolves ambiguity
    // between overlapping promos (e.g. "welcome bonus" vs "welcome bonus 100")
    // by preferring the most specific match rather than the promo with the
    // most redundant keyword variants.
    let score = 0;
    for (const kw of candidates) {
      if (kw && low.includes(kw)) {
        if (kw.length > score) score = kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = promo;
    }
  }
  if (!best) return null;
  const amount = extractDepositAmount(text);
  const outcome = amount != null ? calculatePromoOutcome(best, amount) : null;
  return {
    promo: best,
    amount,
    outcome,
    reply: formatKnowledgeHubReply(best, amount, outcome),
  };
}

// Calc keywords used to gate active-promo calculation replies. We require
// BOTH an amount AND a calc-intent keyword so a customer typing a bare
// number ("50") without context doesn't accidentally trigger a full calc
// reply mid-conversation.
const CALC_INTENT_KEYWORDS = [
  "turnover", "bonus", "how much", "how many", "eligible", "eligibility",
  "calculate", "calculation", "spins", "spin", "wagering", "rollover",
  "get", "receive", "if i deposit", "deposit ", "with rm", "with myr",
];

/**
 * Answer a calculation question against a SPECIFIC (already-selected)
 * promotion — used by the active-promo Step 6 matcher so the customer
 * stays on-topic without needing to re-mention the promo by name.
 *
 * Returns null unless BOTH:
 *   - a deposit amount is extracted from the text, AND
 *   - the text contains a calc-intent keyword.
 * Otherwise the caller can fall through to keyword-group / handoff logic.
 */
export function answerCalculationForPromo(promo, text) {
  if (!promo || !text) return null;
  const amount = extractDepositAmount(text);
  if (amount == null) return null;
  const low = String(text).toLowerCase();
  const isCalcQuery = CALC_INTENT_KEYWORDS.some((k) => low.includes(k));
  if (!isCalcQuery) return null;
  const outcome = calculatePromoOutcome(promo, amount);
  return {
    promo,
    amount,
    outcome,
    reply: formatKnowledgeHubReply(promo, amount, outcome),
  };
}
