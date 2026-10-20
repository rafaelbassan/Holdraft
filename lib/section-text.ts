import { stripDebugBlock } from "@/lib/agent/debug-trace";

export const SECTION_MESSAGE_LIMIT = 400;
export const SECTION_GROWING_MESSAGES = 300;
export const SECTION_CHAR_LIMIT = 400_000;
export const SECTION_GROWING_CHARS = 280_000;

const MODEL_TAIL = 32;
const FIRST_USER_CHARS = 32_000;
const LATER_MESSAGE_CHARS = 16_000;
const TITLE_CHARS = 42;
const TITLE_WORDS = 4;

const STOP = new Set([
  "para",
  "como",
  "com",
  "que",
  "por",
  "dos",
  "das",
  "uma",
  "uns",
  "umas",
  "nao",
  "sim",
  "esse",
  "essa",
  "isso",
  "isto",
  "aqui",
  "voce",
  "seu",
  "sua",
  "seus",
  "suas",
  "meu",
  "minha",
  "nos",
  "nas",
  "num",
  "numa",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "quando",
  "onde",
  "quem",
  "qual",
  "quais",
  "mais",
  "menos",
  "muito",
  "tambem",
  "ainda",
  "apenas",
  "sobre",
  "entre",
  "depois",
  "antes",
  "porque",
  "entao",
  "mas",
  "nem",
  "seja",
  "ser",
  "esta",
  "estao",
  "foi",
  "tem",
  "ter",
  "fazer",
  "quero",
  "preciso",
  "queria",
  "gostaria",
  "favor",
  "criar",
  "crie",
  "cria",
  "consulta",
  "consultar",
  "consulte",
  "card",
  "cards",
  "jira",
  "issue",
  "issues",
  "task",
  "tasks",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "want",
  "need",
  "please",
  "new",
  "abrir",
  "open",
]);

export type SectionMatchCandidate = {
  id: number;
  title: string;
  type: "consulta" | "criacao";
  excerpt: string;
  messageCount: number;
  contentChars: number;
};

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokens(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of fold(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw) || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    words.push(raw);
  }
  return words;
}

function labelCase(title: string): string {
  if (!title) {
    return title;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function clipTitle(words: string[]): string {
  let title = "";
  for (const word of words) {
    if (title && (title.split(" ").length >= TITLE_WORDS || `${title} ${word}`.length > TITLE_CHARS)) {
      break;
    }
    if (!title && word.length > TITLE_CHARS) {
      return word.slice(0, TITLE_CHARS);
    }
    title = title ? `${title} ${word}` : word;
  }
  const parts = title.replace(/[.,:;!?]+$/g, "").trim().split(" ").filter(Boolean);
  while (parts.length > 1) {
    const last = fold(parts[parts.length - 1] ?? "").replace(/[^a-z0-9]/g, "");
    if (last.length >= 3 && !STOP.has(last)) {
      break;
    }
    parts.pop();
  }
  return parts.join(" ");
}

export function shortSectionTitle(message: string): string {
  const cleaned = message
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = (cleaned.split(/[.!?\n]/)[0] ?? cleaned).trim();
  const words = sentence.split(" ").filter(Boolean);
  const start = words.findIndex((word) => {
    const token = fold(word).replace(/[^a-z0-9]/g, "");
    return token.length >= 3 && !STOP.has(token);
  });
  const picked = words.slice(start < 0 ? 0 : start);
  const title = clipTitle(picked);
  if (title.length >= 2) {
    return labelCase(title);
  }
  const raw = clipTitle(words);
  if (raw.length >= 2) {
    return labelCase(raw);
  }
  return "Chat";
}

export function cleanSectionTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const title = value.replace(/[#*_`]+/g, " ").replace(/\s+/g, " ").trim();
  const words = title.split(" ").filter(Boolean).slice(0, TITLE_WORDS);
  const short = clipTitle(words);
  if (short.length < 3) {
    return undefined;
  }
  return labelCase(short);
}

export function sectionStats(messages: { content: string }[]): { count: number; chars: number } {
  return {
    count: messages.length,
    chars: messages.reduce((sum, message) => sum + message.content.length, 0),
  };
}

export function sectionIsFull(messages: { content: string }[]): boolean {
  const stats = sectionStats(messages);
  if (stats.count >= SECTION_MESSAGE_LIMIT) {
    return true;
  }
  if (stats.count < 6) {
    return false;
  }
  return stats.chars >= SECTION_CHAR_LIMIT;
}

export function sectionIsGrowing(messages: { content: string }[]): boolean {
  if (sectionIsFull(messages)) {
    return false;
  }
  const stats = sectionStats(messages);
  if (stats.count >= SECTION_GROWING_MESSAGES) {
    return true;
  }
  return stats.count >= 6 && stats.chars >= SECTION_GROWING_CHARS;
}

export function candidateIsFull(candidate: SectionMatchCandidate): boolean {
  if (candidate.messageCount >= SECTION_MESSAGE_LIMIT) {
    return true;
  }
  if (candidate.messageCount < 6) {
    return false;
  }
  return candidate.contentChars >= SECTION_CHAR_LIMIT;
}

export function messagesForModel<T extends { role: string; content: string }>(messages: T[]): T[] {
  const visible = messages.filter((message) => message.role !== "system");
  const firstUser = visible.find((message) => message.role === "user");
  const tail = visible.slice(-MODEL_TAIL);
  const window = firstUser && !tail.includes(firstUser) ? [firstUser, ...tail] : tail;
  return window.map((message) => {
    const stripped = stripDebugBlock(message.content);
    const shown =
      stripped ||
      (message.content.includes("<!-- holdraft-debug -->") ? "(resposta sem texto)" : message.content);
    const limit = message === firstUser ? FIRST_USER_CHARS : LATER_MESSAGE_CHARS;
    if (shown.length <= limit) {
      return shown === message.content ? message : { ...message, content: shown };
    }
    return { ...message, content: `${shown.slice(0, limit)}\n…` };
  });
}

export function findSimilarSection(
  message: string,
  candidates: SectionMatchCandidate[],
): SectionMatchCandidate | null {
  const query = tokens(message.slice(0, 2_000));
  if (query.length < 2) {
    return null;
  }
  const querySet = new Set(query);
  let best: { item: SectionMatchCandidate; score: number } | null = null;

  for (const item of candidates) {
    if (candidateIsFull(item)) {
      continue;
    }
    const titleTokens = tokens(item.title);
    const titleHits = titleTokens.filter((token) => querySet.has(token));
    const excerptHits = tokens(item.excerpt.slice(0, 800)).filter((token) => querySet.has(token));
    const titleScore = titleTokens.length ? titleHits.length / titleTokens.length : 0;
    const singleWord =
      titleTokens.length === 1 &&
      titleTokens[0].length >= 5 &&
      querySet.has(titleTokens[0]) &&
      excerptHits.length >= 2;
    const strongTitle = titleHits.length >= 2 && titleScore >= 0.67;
    const strongBody = excerptHits.length >= 3 && excerptHits.length / query.length >= 0.5;
    if (!strongTitle && !strongBody && !singleWord) {
      continue;
    }
    const score = titleScore * 2 + titleHits.length + excerptHits.length * 0.25;
    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  return best?.item ?? null;
}
