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
    formatExclusionLine,
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

  console.log(`\n=== ${results.pass} passed, ${results.fail} failed ===`);
  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
