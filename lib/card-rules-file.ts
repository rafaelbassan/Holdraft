import fs from "node:fs";
import path from "node:path";

export const CARD_RULES_PATH = path.join(process.cwd(), "agent", "card-rules.md");

export function readCardRulesFile(): string {
  try {
    return fs.readFileSync(CARD_RULES_PATH, "utf8");
  } catch {
    return "";
  }
}

export function writeCardRulesFile(content: string): void {
  fs.mkdirSync(path.dirname(CARD_RULES_PATH), { recursive: true });
  fs.writeFileSync(CARD_RULES_PATH, content, "utf8");
}
