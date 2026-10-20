import type { CreationDraft, DraftIssue } from "./types";

const BUG_TYPE_PATTERN =
  /\b(bug|correção|correcao|defeito|fix|hotfix)\b/i;
const TEST_TYPE_PATTERN = /\btest\b/i;

function isBugIssue(issue: DraftIssue): boolean {
  if (BUG_TYPE_PATTERN.test(issue.issue_type)) {
    return true;
  }
  return BUG_TYPE_PATTERN.test(issue.summary);
}

function isTestIssue(issue: DraftIssue): boolean {
  if (TEST_TYPE_PATTERN.test(issue.issue_type)) {
    return true;
  }
  return /\b(teste|test|reproduzir|reproduce)\b/i.test(issue.summary);
}

/**
 * Validates agent/card-rules.md: every bug fix draft must include a companion test issue.
 */
export function validateCardRules(draft: CreationDraft | undefined): string | null {
  if (!draft?.issues?.length) {
    return null;
  }
  const bugs = draft.issues.filter(isBugIssue);
  if (bugs.length === 0) {
    return null;
  }
  const tests = draft.issues.filter(isTestIssue);
  if (tests.length < bugs.length) {
    return "card-rules.md: todo card de correção de bug exige um card companheiro de teste no rascunho.";
  }
  return null;
}
