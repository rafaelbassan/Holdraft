import type { JiraCardSummary } from "@/lib/agent/types";

export function priorityRank(priority: string | undefined): number {
  const name = (priority ?? "").trim().toLocaleLowerCase();
  if (/highest|blocker|crític|critic|urgente/.test(name)) {
    return 1;
  }
  if (/high|\balta\b/.test(name)) {
    return 2;
  }
  if (/medium|méd|medi/.test(name)) {
    return 3;
  }
  if (/lowest|mínim|minim/.test(name)) {
    return 5;
  }
  if (/low|\bbaixa\b/.test(name)) {
    return 4;
  }
  return 50;
}

export function issueIsDone(status: string): boolean {
  return /conclu|done|closed|resolv|fechad|cancel/i.test(status);
}

export function orderConsultaCards(cards: JiraCardSummary[]): JiraCardSummary[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const done = Number(issueIsDone(a.card.status)) - Number(issueIsDone(b.card.status));
      if (done !== 0) {
        return done;
      }
      const rank = priorityRank(a.card.priority) - priorityRank(b.card.priority);
      if (rank !== 0) {
        return rank;
      }
      return a.index - b.index;
    })
    .map((item) => item.card);
}
