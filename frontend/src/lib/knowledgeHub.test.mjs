/**
 * Standalone runner for knowledgeHub.js calculation + matcher tests.
 *
 * Run: node src/lib/knowledgeHub.test.mjs  (from /app/frontend)
 *
 * NOTE: This is a plain-Node CommonJS-friendly test file — no jest,
 * no react-scripts. It uses ESM dynamic import so the source file can
 * stay ES-module.
 */

/* eslint-disable no-console */

const results = { pass: 0, fail: 0 };

function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    results.pass++;
    console.log(`  ✅ ${label}`);
  } else {
    results.fail++;
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(label, cond) {
  if (cond) {
    results.pass++;
    console.log(`  ✅ ${label}`);
  } else {
    results.fail++;
    console.log(`  ❌ ${label} — condition was false`);
  }
}

async function main() {
  const mod = await import("./knowledgeHub.js");
  const {
    PROMOTIONS_KB, GENERAL_TERMS, findPromoById,
    calculatePromoOutcome, extractDepositAmount, matchKnowledgeHub,
    formatExclusionLine, getPromotionDisplayData,
  } = mod;

  const p288 = findPromoById("welcome_lucky_288");
  const p188fs = findPromoById("monthly_188_spins");
  const pW100 = findPromoById("welcome_100_100");

  console.log("Part 4 — calculation engine");
  {
    const r = calculatePromoOutcome(p288, 50);
    assertEq("(a) 288% @ 50 → bonus=144", r.bonus, 144);
    assertEq("(a) 288% @ 50 → turnover=6790", r.turnover_required, 6790);
  }
  {
    const r = calculatePromoOutcome(p188fs, 50);
    assertEq("(b) 188fs @ 50 → free_spin_value=10", r.free_spin_value, 10);
    assertEq("(b) 188fs @ 50 → turnover=60", r.turnover_required, 60);
  }
  {
    const r = calculatePromoOutcome(pW100, 30);
    assertEq("(c) Welcome100 @ 30 → not eligible",
      { eligible: r.eligible, reason: r.reason },
      { eligible: false, reason: "below minimum deposit" }
    );
  }
  {
    const r = calculatePromoOutcome(pW100, 50);
    assertEq("(d) Welcome100 @ 50 → bonus=50", r.bonus, 50);
    assertEq("(d) Welcome100 @ 50 → free_spin_value=20", r.free_spin_value, 20);
    assertEq("(d) Welcome100 @ 50 → turnover=1800", r.turnover_required, 1800);
  }

  console.log("\nPart 4 — additional edge cases");
  {
    // 288% cap kicks in at deposits over 1000
    const r = calculatePromoOutcome(p288, 2000);
    assertEq("288% @ 2000 caps at max_bonus 2880", r.bonus, 2880);
    // (2000 + 2880) * 35 = 170800
    assertEq("288% @ 2000 turnover=170800", r.turnover_required, 170800);
  }
  {
    // 188fs nearest-tier fallback
    const r = calculatePromoOutcome(p188fs, 300);
    assertTrue("188fs @ 300 picks nearest at-or-below tier (200 → 38 spins)",
      r.spins === 38 && r.free_spin_value === 38);
  }
  {
    // 188fs exact upper tier
    const r = calculatePromoOutcome(p188fs, 1000);
    assertEq("188fs @ 1000 → 188 spins", r.spins, 188);
  }

  console.log("\nPart 5 — matcher");
  {
    // Matched question, no amount → general summary
    const m = matchKnowledgeHub("Tell me about the 288% welcome bonus");
    assertTrue("keyword-only match returns promo", m && m.promo?.id === "welcome_lucky_288");
    assertTrue("no amount → no outcome", m && m.amount == null && m.outcome == null);
    assertTrue("reply mentions minimum deposit", /Minimum deposit/i.test(m.reply));
    assertTrue("reply prompts for amount", /deposit amount/i.test(m.reply));
  }
  {
    // Matched with amount (currency-prefixed)
    const m = matchKnowledgeHub("what do I get with rm100 on welcome bonus?");
    assertTrue("currency-prefixed → matched", m && m.amount === 100);
    assertTrue("welcome 100 outranked by 288% (longer 'welcome bonus' keyword)",
      m.promo.id === "welcome_lucky_288");
  }
  {
    // Should score welcome_100_100 higher via "welcome bonus 100" (longer)
    const m = matchKnowledgeHub("welcome bonus 100 percent details");
    assertEq("longer keyword wins (welcome_100_100)",
      m?.promo?.id, "welcome_100_100");
  }
  {
    // 188 free spin match
    const m = matchKnowledgeHub("how does 188 free spin unlimited work?");
    assertEq("188 free spin → promo id", m?.promo?.id, "monthly_188_spins");
  }
  {
    // Amount + 188fs
    const m = matchKnowledgeHub("188 free spins with deposit 500");
    assertEq("188 free spins @ 500 → 88 spins", m?.outcome?.spins, 88);
  }
  {
    // Unmatched → null
    const m = matchKnowledgeHub("random gibberish text zzz");
    assertEq("unmatched → null", m, null);
  }
  {
    // Below-min amount still produces a calc reply (with eligibility=false)
    const m = matchKnowledgeHub("welcome bonus 100% with RM 30");
    assertTrue("below-min → reply mentions below minimum",
      m && /below the minimum/i.test(m.reply || ""));
  }

  console.log("\nPart 3 — auto-generated exclusion line");
  {
    const line = formatExclusionLine(p288);
    assertTrue("288% exclusion mentions Pussy888", /Pussy888/.test(line));
    assertTrue("288% exclusion mentions 918kiss", /918kiss/.test(line));
    assertTrue("exclusion prefixed with 🚫", line.startsWith("🚫 Excluding: "));
  }
  {
    const line = formatExclusionLine(p188fs);
    assertEq("188fs exclusion = 🚫 Excluding: Pussy888", line, "🚫 Excluding: Pussy888");
  }

  console.log("\nGeneral terms — 10 items present");
  assertEq("GENERAL_TERMS length", GENERAL_TERMS.length, 10);
  assertTrue("first term mentions 1 MD88 member per account",
    /1 MD88 member per account/i.test(GENERAL_TERMS[0]));

  console.log("\nAmount extraction");
  assertEq("'RM50' → 50", extractDepositAmount("RM50"), 50);
  assertEq("'myr 200' → 200", extractDepositAmount("myr 200"), 200);
  assertEq("'deposit 100' → 100", extractDepositAmount("deposit 100"), 100);
  assertEq("'288%' → null (stripped)", extractDepositAmount("what is 288% about?"), null);
  assertEq("bare '50' → 50", extractDepositAmount("welcome bonus 50"), 50);
  assertEq("bare '5' → null (too small)", extractDepositAmount("welcome bonus 5"), null);

  console.log("\nBug 1 fixtures — no-space currency prefix & mixed content");
  assertEq("'rm30' → 30", extractDepositAmount("rm30"), 30);
  assertEq("'RM 30' → 30", extractDepositAmount("RM 30"), 30);
  assertEq("'if i deposit rm30 how much turnover' → 30",
    extractDepositAmount("if i deposit rm30 how much turnover"), 30);
  assertEq("'MYR50' → 50", extractDepositAmount("MYR50"), 50);
  assertEq("'if i deposit 500 what about 288%' → 500",
    extractDepositAmount("if i deposit 500 what about 288%"), 500);

  console.log("\nBug 1 — below-min calc echoes correct deposit (not MYR 0.00)");
  {
    const r = calculatePromoOutcome(p288, 30);
    assertEq("below-min result includes deposit=30", r.deposit, 30);
    const reply = mod.formatKnowledgeHubReply(p288, 30, r);
    assertTrue("reply mentions 'MYR 30' (not 'MYR 0.00')",
      /MYR 30(?:\.00)?/.test(reply) && !/MYR 0\.00/.test(reply));
  }

  console.log("\nBug 2 — successful calc reply is concise (NO full T&Cs)");
  {
    const reply = mod.formatKnowledgeHubReply(p288, 100, calculatePromoOutcome(p288, 100));
    assertTrue("calc reply mentions bonus amount", /Bonus amount: MYR 288/.test(reply));
    assertTrue("calc reply mentions turnover required", /Turnover required: MYR 13,580/.test(reply));
    assertTrue("calc reply does NOT dump GENERAL_TERMS #1",
      !/only available for 1 MD88 member per account/.test(reply));
    assertTrue("calc reply does NOT include exclusion line",
      !/🚫 Excluding/.test(reply));
    assertTrue("calc reply offers to see full terms",
      /Want to see the full terms/i.test(reply));
  }

  console.log("\nBug 2 — general summary (no amount) still includes T&Cs for browsing");
  {
    const reply = mod.formatKnowledgeHubReply(p288, null, null);
    assertTrue("general summary still lists GENERAL_TERMS",
      /only available for 1 MD88 member per account/.test(reply));
    assertTrue("general summary still shows exclusion line",
      /🚫 Excluding/.test(reply));
  }

  console.log("\nBug 3 — vague promo mention returns match with no outcome");
  {
    const m = matchKnowledgeHub("I want to know 288%");
    assertTrue("vague 288% mention matches promo", m?.promo?.id === "welcome_lucky_288");
    assertEq("vague mention has NO outcome (route to Step 1.5)", m?.outcome, null);
  }

  console.log("\nSingle-source-of-truth: getPromotionDisplayData reflects PROMOTIONS_KB");
  {
    const d = getPromotionDisplayData("welcome_lucky_288");
    assertTrue("display data present", d && d.id === "welcome_lucky_288");
    assertEq("min_deposit passes through", d.min_deposit, 50);
    assertTrue("how_to_apply substitutes {{min_deposit}}",
      d.how_to_apply.some((s) => s.includes("MYR 50")));
    assertTrue("how_to_apply substitutes {{bonus_percent}}",
      d.how_to_apply.some((s) => s.includes("288%")));
    assertTrue("detail_closing mentions 35× wagering",
      /35× wagering requirement on \(deposit \+ bonus\)/.test(d.detail_closing_paragraph));
    assertTrue("claim_closing mentions 35× turnover",
      /35× on \(deposit \+ bonus\)/.test(d.claim_closing_paragraph));
    assertTrue("exclusion_line derived from excluded_games",
      d.exclusion_line.startsWith("🚫 Excluding: Pussy888"));
  }

  console.log("\nSingle-source-of-truth: mutating PROMOTIONS_KB flows to all surfaces");
  {
    // Mutate min_deposit for 288% Welcome
    const p = findPromoById("welcome_lucky_288");
    const originalMin = p.min_deposit;
    p.min_deposit = 999;

    // (a) Rich display data reflects the change
    const d = getPromotionDisplayData("welcome_lucky_288");
    assertEq("(a) display.min_deposit reflects mutation", d.min_deposit, 999);
    assertTrue("(a) how_to_apply step 2 shows MYR 999",
      d.how_to_apply[1].includes("MYR 999"));

    // (b) Step 5 claim instructions template pulls from KB via promotions.js
    const promoMod = await import("./promotions.js");
    const claimText = promoMod.PROMO_UI_I18N.en.claimIntro2({ id: "welcome_lucky_288" });
    assertTrue("(b) Step 5 claim text mentions MYR 999",
      claimText.includes("MYR 999"));

    // (c) Knowledge Hub free-text reply reflects the change
    const kb = matchKnowledgeHub("Tell me about the 288% welcome bonus");
    assertTrue("(c) KB summary reply mentions MYR 999",
      /MYR 999/.test(kb.reply));

    // Restore
    p.min_deposit = originalMin;

    // Verify restoration
    const d2 = getPromotionDisplayData("welcome_lucky_288");
    assertEq("min_deposit restored", d2.min_deposit, originalMin);
  }

  console.log("\nSingle-source-of-truth: mutating turnover_multiplier flows through");
  {
    const p = findPromoById("welcome_lucky_288");
    const original = p.turnover_multiplier;
    p.turnover_multiplier = 99;

    const d = getPromotionDisplayData("welcome_lucky_288");
    assertTrue("detail_closing shows 99× wagering",
      /99× wagering requirement on \(deposit \+ bonus\)/.test(d.detail_closing_paragraph));
    assertTrue("turnover_description shows 99×",
      /99× \(deposit \+ bonus\)/.test(d.turnover_description));

    // KB calculation reflects the change
    const kb = matchKnowledgeHub("welcome bonus with RM 100");
    assertTrue("KB reply turnover_required = (100+288)*99 = 38412",
      /MYR 38,412\.00/.test(kb.reply));

    p.turnover_multiplier = original;
  }

  console.log("\nActive-promo calculation matcher (answerCalculationForPromo)");
  const { answerCalculationForPromo } = mod;
  {
    // Bug fixture from the review request
    const r = answerCalculationForPromo(p288, "if i deposit rm50 how many turnover i need to complete?");
    assertTrue("calc question with amount → non-null reply", r != null);
    assertEq("turnover_required = 6790", r?.outcome?.turnover_required, 6790);
    assertTrue("reply mentions MYR 6,790.00", /MYR 6,790\.00/.test(r?.reply || ""));
  }
  {
    // Amount without calc-intent keyword → null (avoid false positives)
    const r = answerCalculationForPromo(p288, "50");
    assertEq("bare number without calc intent → null", r, null);
  }
  {
    // Calc intent without amount → null
    const r = answerCalculationForPromo(p288, "what's the turnover?");
    assertEq("calc keyword without amount → null", r, null);
  }
  {
    // Non-calc chatter → null
    const r = answerCalculationForPromo(p288, "hello there");
    assertEq("chatter → null", r, null);
  }
  {
    // Below-min deposit → calc still runs, returns eligible:false
    const r = answerCalculationForPromo(p288, "if i deposit rm30 how much turnover?");
    assertTrue("below-min → reply mentions below minimum",
      /below the minimum/i.test(r?.reply || ""));
  }
  {
    // 188 free spins active-promo calc
    const r = answerCalculationForPromo(p188fs, "how many free spins with deposit 500?");
    assertEq("188fs @ 500 → 88 spins", r?.outcome?.spins, 88);
  }
  {
    // Null promo (safety)
    const r = answerCalculationForPromo(null, "deposit 50 turnover");
    assertEq("null promo → null", r, null);
  }

  console.log(`\n=== ${results.pass} passed, ${results.fail} failed ===`);
  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
