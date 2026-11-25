/**
 * Loading the test set.
 *
 * Its own module rather than part of the runner, because the tests need the
 * scenarios and importing the runner would start a run.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Scenario } from "./types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadScenarios(dir = join(ROOT, "scenarios")): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Scenario);
}

export function scenarioById(id: string, all = loadScenarios()): Scenario {
  const found = all.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario with id ${id}`);
  return found;
}
