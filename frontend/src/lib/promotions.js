// Promotions catalogue + keyword follow-up matcher for the customer widget.
//
// SINGLE SOURCE OF TRUTH: all promotion data (title, min_deposit, bonus %,
// max_bonus, turnover multiplier, applicable/excluded games, credit timing,
// how-to-apply steps) lives in /lib/knowledgeHub.js's PROMOTIONS_KB. This
// module derives the shape historically used by ChatWidget's guided
// Promotions flow from that single source via getPromotionDisplayData().
//
// If you find yourself hand-typing promo copy in this file, STOP — add the
// field to PROMOTIONS_KB instead so every UI surface stays in sync.

import {
  PROMOTIONS_KB,
  getPromotionDisplayData,
} from "./knowledgeHub.js";

// Derive the runtime PROMOTIONS list from PROMOTIONS_KB. Each entry keeps
// the legacy shape (id, title, howToClaim, detailClosingParagraph,
// claimClosingParagraph) so existing consumers don't need to change, but
// every string is now computed from the KB data (no hand-typed numbers).
export const PROMOTIONS = PROMOTIONS_KB.map((kb) => {
  const d = getPromotionDisplayData(kb);
  return {
    id: d.id,
    title: d.title,
    detailTitle: `Claim your ${d.title}`,
    // template-substituted from PROMOTIONS_KB.how_to_apply_steps
    howToClaim: d.how_to_apply,
    // auto-generated from structured fields
    detailClosingParagraph: d.detail_closing_paragraph,
    claimClosingParagraph: d.claim_closing_paragraph,
    // Passing through KB fields for consumers that want the raw data
    // (e.g. ChatWidget's promoConfirmPick reads excluded_games).
    excluded_games: d.excluded_games,
    exclusion_line: d.exclusion_line,
  };
});

export const PROMOTIONS_PAGE_URL = "https://m.md88-safe.com/en-MY/promotions";

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

// Localized static copy for the promotions flow chrome itself (buttons,
// dropdown labels, intro strings). The per-promo copy lives in
// PROMOTIONS_KB and is fetched via getPromotionDisplayData.
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
    // claimIntro2 now sources from getPromotionDisplayData so numbers stay
    // in sync with PROMOTIONS_KB.
    claimIntro1: "Absolutely, let me guide you",
    claimIntro2: (promo) => {
      const d = getPromotionDisplayData(promo.id) || {};
      const steps = (d.how_to_apply || [])
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n");
      return `Here's how to claim your ${d.title}:\n${steps}\n\n${d.claim_closing_paragraph}`;
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
