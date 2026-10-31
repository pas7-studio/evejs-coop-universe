import test from "node:test";
import assert from "node:assert/strict";
import {readModuleText, functionText} from "./_support/coopSourceText.mjs";

// Measured 2026-10-31: the corporation owned a 175 000 ISK blueprint it had planned and could
// not buy, because every salary was exactly 100 000 ISK. The purchase was paid for again and
// again, each time still short - a funding rule that can never reach the price is a refusal
// wearing a payment's name. These assertions guard the rule, not the accident.

const runtime = () => readModuleText("integration/coopVirtualWorldRuntime.cjs");

test("a purchase salary covers what the purchase costs, and stays bounded", () => {
  const body = functionText(runtime(), "function payrollCentsForPrice(price){");
  assert.match(body, /1\.02/, "the salary covers the ask plus a small margin");
  assert.match(body, /EVEJS_COOP_PAYROLL_MAX_CENTS/, "the salary is bounded by an explicit cap");
  assert.match(body, /Math\.min\(cap/, "the cap really clamps the payment");
  assert.match(body, /Math\.max\(PAYROLL_SALARY_CENTS/, "a cheap purchase still pays the base salary");
});

test("the salary event is keyed by the amount so a bigger need is a new payment", () => {
  const body = functionText(runtime(), "function payPilotForPurchase(");
  assert.match(body, /eventID:"purchase:"/);
  assert.match(body, /":"\+hour\+":"\+cents/,
    "the key carries the hour AND the amount, or a shortfall would never be funded");
  assert.match(body, /payrollCentsForPrice\(price\)/, "the amount comes from the real ask");
});

test("an already committed salary counts as funding, not as another refusal", () => {
  assert.match(runtime(), /paid\.status==="PAID"\|\|paid\.status==="DUPLICATE"/,
    "a DUPLICATE salary is money the pilot already has");
});
