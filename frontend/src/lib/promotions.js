// Promotions catalogue + keyword follow-up matcher for the customer widget.
// This flow is deliberately self-contained and does NOT touch Lily's LLM
// pipeline (compose_reply / emotion / memory). It's a simple state machine
// with hardcoded copy that we can swap for a CMS/backend feed later.

export const PROMOTIONS = [
  // PLACEHOLDER copy — swap when real MD88 marketing content arrives.
  {
    id: "welcome_lucky_288",
    title: "288% Welcome Lucky Bonus!",
    detailTitle: "Claim your 288% Welcome Lucky Bonus",
    howToClaim: [
      "Register an account with MD88 if you're not a member yet. https://m.md88top.com/en-MY/sign-up",
      "Make a qualifying first deposit of MYR 30 or more.",
      "Go to the Promotions page and select this bonus.",
      "Read the T&C, click 'Claim' and follow the on-screen instructions.",
      "Your 288% bonus will be credited automatically after your deposit clears.",
    ],
    terms: [
      "New members only",
      "Minimum deposit MYR 30",
      "Wagering requirement 20x (bonus + deposit)",
      "Bonus valid for 30 days",
      "Terms and conditions apply",
    ],
  },
  // ── Verified content from the customer spec ──
  {
    id: "monthly_188_spins",
    title: "Monthly Exclusive 188 Free Spins",
    detailTitle: "Claim 188 Slots Free Spins",
    howToClaim: [
      "Register an account with MD88 if you're not a member yet. https://m.md88top.com/en-MY/sign-up",
      "Transfer a minimum first-time deposit of MYR 50 to Pragmatic Play slots provider wallet.",
      "Go to the [Transfer] page and select \"Transfer\".",
      "Enter the amount from \"Main Wallet\" to [Pragmatic Play] slots provider wallet.",
      "Select the promo code [CLAIM SLOTS FREE SPINS].",
      "Free spins will be credited by 4:00 PM (GMT+8) within the next working day.",
    ],
    terms: [
      "Minimum deposit MYR 50",
      "Valid for Pragmatic Play slots",
      "Free spins valid for 14 days",
      "Terms and conditions apply",
    ],
  },
  // PLACEHOLDER copy — swap when real MD88 marketing content arrives.
  {
    id: "welcome_100_100",
    title: "WELCOME BONUS 100% + 100 FREE SPINS!",
    detailTitle: "Claim 100% Welcome Bonus + 100 Free Spins",
    howToClaim: [
      "Register an account with MD88 if you're not a member yet. https://m.md88top.com/en-MY/sign-up",
      "Make your first deposit of MYR 50 or more.",
      "Go to the Promotions page and select this bonus.",
      "Enter the promo code [WELCOME100] if prompted.",
      "Your 100% bonus + 100 Free Spins will be credited within 24 hours.",
    ],
    terms: [
      "New members only, one claim per account",
      "Minimum deposit MYR 50",
      "Free Spins valid on selected slot titles",
      "Wagering requirement 25x on bonus amount",
      "Terms and conditions apply",
    ],
  },
];

export const PROMOTIONS_PAGE_URL = "https://m.md88top.com/en-MY/promotions";

export function findPromotion(id) {
  return PROMOTIONS.find((p) => p.id === id) || null;
}

// ---------- Step-6 keyword follow-up matcher ----------
// Case-insensitive substring match. Returned action drives the widget:
//   - "acknowledge"    → post Lily's "anything else?" reply
//   - "confirm_handoff"→ post the "connect you to an agent?" reply and show Yes/No buttons
//   - "instant_handoff"→ post the reply then immediately hand off (no confirm)
//   - null             → no match, caller falls back to default behavior
const KEYWORD_GROUPS = [
  {
    action: "acknowledge",
    keywords: ["ok", "okay", "thanks", "thank you", "got it", "done"],
    reply: "Great! Is there anything else I can help you with today?",
  },
  {
    action: "confirm_handoff",
    keywords: ["claim for me", "can you claim", "help me claim"],
    reply:
      "I'm unable to claim bonuses directly, but I can connect you to a live agent who can assist you. Would you like me to connect you to an agent now?",
  },
  {
    action: "confirm_handoff",
    keywords: ["check my bonus", "check status"],
    reply:
      "Let me connect you to a live agent who can check your bonus status. Would you like to speak with an agent now?",
  },
  {
    action: "instant_handoff",
    keywords: ["problem", "issue", "not working"],
    reply:
      "I'm sorry to hear that. Let me connect you to a live agent who can help. I'm connecting you now.",
  },
];

export function matchPromoKeyword(text) {
  if (!text) return null;
  const low = text.toLowerCase();
  for (const g of KEYWORD_GROUPS) {
    if (g.keywords.some((k) => low.includes(k))) {
      return { action: g.action, reply: g.reply };
    }
  }
  return null;
}

// Localized static copy for the promotions flow itself. Kept intentionally
// short — the meaty text lives in PROMOTIONS above.
export const PROMO_UI_I18N = {
  en: {
    stepChooseTitle: "Let's start by choosing how you want to search our promotions by",
    pickPromoBtn: "Pick a Promo 🎁",
    viewPageBtn: "View Promotion Page 🔍",
    pickPromoIntro: "Awesome, we have many promotions available. Which would you like to learn about?",
    dropdownLabel: "Promotion Name",
    dropdownPlaceholder: "Select one",
    dropdownRequired: "Please select a promotion first.",
    sendBtn: "Send",
    neverMindBtn: "Never mind",
    viewPageMsg: `Discover our latest promotions at the MD88 promotions page, where you'll find exciting offers to boost your gaming experience. ${PROMOTIONS_PAGE_URL}`,
    viewPageFollowup: "Any questions, just let us know.",
    howToClaimHeader: "How to claim",
    termsHeader: "Terms",
    claimNowBtn: "Claim now",
    viewOthersBtn: "View other promotions",
    claimIntro: (name) =>
      `Certainly, I'll be happy to assist you.\nHere's how to claim your bonus '${name}':\n1. Log in to your MD88 account.\n2. Head to the Promotions section and select the ${name}.\n3. Read the terms and conditions to make sure you're eligible.\n4. Click 'Claim' and follow the on-screen instructions to complete your claim.\n5. Make your qualifying deposit as required by the promotion.\n6. Once you've completed these steps, your bonus should be credited automatically. If you run into any issues, just let me know.`,
    confirmHandoffYes: "Yes, connect me",
    confirmHandoffNo: "No, thanks",
  },
};

export function promoStrings(lang) {
  // Only English strings for now — other languages fall back until real
  // translations are provided by marketing.
  return PROMO_UI_I18N.en;
}
