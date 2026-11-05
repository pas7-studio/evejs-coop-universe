"use strict";
// Runs ONE settlement in its own process, so a restart can be tested as a real process boundary
// instead of a require-cache reset. The credit port appends a line to a log, so the caller can count
// how many times the money actually moved.
//
// usage: node settle-once.cjs <spaceDir> <journalFile> <creditLog> <fillID>

const path = require("path");
const fs = require("fs");

const [spaceDir, journalFile, creditLog, fillID] = process.argv.slice(2);
if (!spaceDir || !journalFile || !creditLog || !fillID) {
  console.error("usage: settle-once.cjs <spaceDir> <journalFile> <creditLog> <fillID>");
  process.exit(2);
}

const { createFileJournal } = require(path.join(spaceDir, "coopEconomyJournalFile.js"));
const { createSettlement } = require(path.join(spaceDir, "coopEconomySaleSettlement.js"));

const journal = createFileJournal(journalFile);
const settlement = createSettlement({ journal });

const result = settlement.settle({
  fillID,
  ownerCorpID: "corp-1",
  grossCents: 1000,
  taxCents: 100,
  feeCents: 50,
  walletPort: {
    credit: () => {
      fs.appendFileSync(creditLog, "credit\n");
      return { receiptID: "c-" + Date.now() };
    },
  },
});

process.stdout.write(JSON.stringify({ code: result.code, netCents: result.netCents }) + "\n");
