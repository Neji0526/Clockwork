import {
  todayLocal,
  prevDay,
  nextDay,
  startOfWeekET,
  startOfMonthET,
  endOfMonthET,
} from "../src/lib/reporting";
import { resolveRange, PRESET_LABEL, type RangePreset } from "../src/lib/dashboard-range";

function show(label: string, val: unknown) {
  console.log(`  ${label.padEnd(28)} ${JSON.stringify(val)}`);
}

console.log("=== Direct helper checks ===\n");

console.log("prevDay across month boundary:");
show("prevDay('2026-06-01')", prevDay("2026-06-01"));
show("prevDay('2026-03-01')", prevDay("2026-03-01"));
show("prevDay('2026-01-01')", prevDay("2026-01-01"));
show("prevDay('2024-03-01') (leap)", prevDay("2024-03-01"));
show("prevDay('2025-03-01') (non-leap)", prevDay("2025-03-01"));

console.log("\nstartOfWeekET (should be Monday):");
for (const d of ["2026-06-18", "2026-06-15", "2026-06-14", "2026-06-21", "2026-06-01"]) {
  show(`startOfWeekET('${d}')`, startOfWeekET(d));
}

console.log("\nstartOfMonthET / endOfMonthET:");
for (const d of ["2026-06-18", "2026-02-15", "2024-02-15", "2025-02-15", "2026-01-31", "2026-12-31"]) {
  show(`start('${d}')`, startOfMonthET(d));
  show(`end  ('${d}')`, endOfMonthET(d));
}

console.log("\n=== Preset resolution (anchored at today = 2026-06-18 ET) ===\n");
const TODAY = "2026-06-18";
const presets: RangePreset[] = [
  "today", "yesterday", "this-week", "last-week", "this-month", "last-month",
];
for (const p of presets) {
  const r = resolveRange(p, { from: TODAY, to: TODAY }, TODAY);
  console.log(`  ${PRESET_LABEL[p].padEnd(14)} -> from=${r.from}  to=${r.to}`);
}

console.log("\n=== Preset resolution from March 5 (verifies 'last month' = Feb 1..Feb 28) ===\n");
const MAR = "2026-03-05";
for (const p of presets) {
  const r = resolveRange(p, { from: MAR, to: MAR }, MAR);
  console.log(`  ${PRESET_LABEL[p].padEnd(14)} -> from=${r.from}  to=${r.to}`);
}

console.log("\n=== Preset resolution from March 5, 2024 (LEAP — last month = Feb 1..Feb 29) ===\n");
const MAR_LEAP = "2024-03-05";
for (const p of presets) {
  const r = resolveRange(p, { from: MAR_LEAP, to: MAR_LEAP }, MAR_LEAP);
  console.log(`  ${PRESET_LABEL[p].padEnd(14)} -> from=${r.from}  to=${r.to}`);
}

console.log("\n=== Custom range spanning a month boundary ===\n");
const custom = { from: "2026-05-28", to: "2026-06-03" };
const r = resolveRange("custom", custom, TODAY);
show("custom from/to", r);

console.log("\n=== Live 'today' (whatever it is now in ET) ===");
show("todayLocal()", todayLocal());
show("nextDay(todayLocal())", nextDay(todayLocal()));
show("prevDay(todayLocal())", prevDay(todayLocal()));
