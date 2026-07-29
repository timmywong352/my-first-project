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
    detailClosingParagraph:
      "Remember that this bonus is valid for 30 days unless stated otherwise, carries a 20x wagering requirement on the bonus and deposit, and there are specific terms and conditions that apply to this promotion.",
    claimClosingParagraph:
      "Your bonus is valid for 30 days unless stated otherwise, and the wagering requirement is 20x on the bonus plus deposit. If you have any questions about the terms or run into any issues, just let me know.",
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
    detailClosingParagraph:
      "Remember that free spins are valid for fourteen days unless stated otherwise, and there are specific terms and conditions that apply to this promotion.",
    claimClosingParagraph:
      "Your free spins are valid for 14 days unless stated otherwise. If you have any questions about the terms or run into any issues, just let me know.",
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
    detailClosingParagraph:
      "Remember that this bonus is for new members only with a minimum deposit of MYR 50, carries a 25x wagering requirement on the bonus amount, and there are specific terms and conditions that apply.",
    claimClosingParagraph:
      "Your 100 Free Spins are valid on selected slot titles and the wagering requirement is 25x on the bonus. If you have any questions about the terms or run into any issues, just let me know.",
  },
];

export const PROMOTIONS_PAGE_URL = "https://m.md88top.com/ms-MY/promotions";

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
    // ── View Promotion Page (Step 2B) — two-bubble sequence ──
    viewPageMsg: `Fantastic! All of our latest promotions can be found here: ${PROMOTIONS_PAGE_URL}`,
    viewPageFollowup: "If you have any questions, just let me know!",
    // ── Promotion Detail (Step 3) — paragraph-style template ──
    detailIntro: "To check the promotion, you can follow these steps:",
    relatedArticlesHeader: "Related Articles:",
    detailFollowup: "Would you like to claim this promo or view others?",
    claimNowBtn: "Claim now",
    viewOthersBtn: "View other promotions",
    // ── Claim Instructions (Step 5) — two-bubble sequence ──
    claimIntro1: "Absolutely, let me guide you",
    claimIntro2: (promo) => {
      const steps = promo.howToClaim
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n");
      return `Here's how to claim your ${promo.title}:\n${steps}\n\n${promo.claimClosingParagraph}`;
    },
    confirmHandoffYes: "Yes, connect me",
    confirmHandoffNo: "No, thanks",
  },
};

export function promoStrings(lang) {
  // Only English strings for now — other languages fall back until real
  // translations are provided by marketing.
  return PROMO_UI_I18N.en;
}
