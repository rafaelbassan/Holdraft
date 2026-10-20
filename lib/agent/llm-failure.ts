export const STORED_LLM_FAILURE_PREFIXES = [
  "LLM error",
  "MODEL_NOT_CONFIGURED",
  "Failed to parse",
  "LLM empty",
  "Invalid intent",
  "Invalid status",
  "Missing message_markdown",
] as const;

export function isStoredLlmFailure(content: string): boolean {
  return STORED_LLM_FAILURE_PREFIXES.some((prefix) => content.startsWith(prefix));
}

export function storedFailureLooksBusy(content: string): boolean {
  return /503|429|529|UNAVAILABLE|high demand|overloaded/i.test(content);
}
