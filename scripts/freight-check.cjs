#!/usr/bin/env node
// One rule, in its own file so it can be tested: a freight row must have a real settlement
// behind it. A hull that reports a paid trip with no settlement is a book that lies.
// Freight rows must be backed by real settlements: a hull that reports a paid trip with no
// settlement behind it is a book that lies. This compares the two durable records by hull, so
// a missing row (or an invented one) is named instead of averaged away.
function reconcileFreight(rows, settlements) {
  const paidByHull = new Map();
  for (const row of settlements || []) {
    if (String(row.status) !== "SOLD") continue;
    const id = Number(row.haulerID) || 0;
    paidByHull.set(id, (paidByHull.get(id) || 0) + 1);
  }
  const rowsByHull = new Map();
  let deliveries = 0;
  for (const row of rows || []) {
    // A delivery proven only by an empty hold is not a payment: it has no amount to match.
    const status = row.status === undefined || row.status === null ? "SOLD" : String(row.status);
    if (status !== "SOLD") { deliveries += 1; continue; }
    const id = Number(row.haulerID) || 0;
    rowsByHull.set(id, (rowsByHull.get(id) || 0) + 1);
  }
  const problems = [];
  for (const [id, count] of rowsByHull) {
    const paid = paidByHull.get(id) || 0;
    if (count > paid) problems.push({haulerID: id, rows: count, settlements: paid,
      reason: "FREIGHT_ROW_WITHOUT_SETTLEMENT"});
  }
  return {ok: problems.length === 0, problems, deliveries};
}

module.exports = {reconcileFreight};
