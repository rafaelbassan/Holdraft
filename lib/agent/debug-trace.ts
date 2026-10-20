export function clipText(text: string, max = 4000): string {
  const value = text.replace(/\0/g, "").trim();
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n… (${value.length} caracteres)`;
}

export function textFromModelContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

function debugLabels(uiLanguage: string): {
  thinking: string;
  modelText: string;
  debug: string;
  empty: string;
} {
  if (uiLanguage.startsWith("en")) {
    return {
      thinking: "Thinking",
      modelText: "Model text",
      debug: "What happened",
      empty: "Nothing was recorded.",
    };
  }
  if (uiLanguage.startsWith("es")) {
    return {
      thinking: "Pensamiento",
      modelText: "Texto del modelo",
      debug: "Qué pasó",
      empty: "No quedó registro.",
    };
  }
  return {
    thinking: "Pensamento",
    modelText: "Texto do modelo",
    debug: "O que aconteceu",
    empty: "Nada foi registrado.",
  };
}

export const DEBUG_MARKER = "<!-- holdraft-debug -->";

export function failureLead(uiLanguage: string): string {
  if (uiLanguage.startsWith("en")) {
    return "The reply failed before it was ready.";
  }
  if (uiLanguage.startsWith("es")) {
    return "La respuesta falló antes de quedar lista.";
  }
  return "A resposta falhou antes de ficar pronta.";
}

export function withDebugBlock(message: string, debug: string): string {
  const block = `${DEBUG_MARKER}\n\n${debug.trim()}`;
  const body = message.trim();
  return body ? `${body}\n\n${block}` : block;
}

export function stripDebugBlock(content: string): string {
  const cut = content.indexOf(DEBUG_MARKER);
  const text = (cut >= 0 ? content.slice(0, cut) : content).trim();
  return text;
}

export class AgentTrace {
  private steps: string[] = [];
  raw = "";
  reasoning = "";

  step(line: string): void {
    const value = line.trim();
    if (value) {
      this.steps.push(value);
    }
  }

  noteModelText(content: string, reasoning: string): void {
    if (content.trim()) {
      this.raw = content;
    }
    if (reasoning.trim()) {
      this.reasoning = reasoning;
    }
  }

  toMarkdown(uiLanguage: string): string {
    const labels = debugLabels(uiLanguage);
    const parts: string[] = [];
    if (this.reasoning.trim()) {
      parts.push(`**${labels.thinking}**\n\n${clipText(this.reasoning, 6000)}`);
    }
    if (this.raw.trim()) {
      parts.push(`**${labels.modelText}**\n\n\`\`\`\n${clipText(this.raw, 6000)}\n\`\`\``);
    }
    if (this.steps.length) {
      const lines = this.steps.map((step) => (step.includes("\n") ? step : `- ${step}`));
      parts.push(`**${labels.debug}**\n\n${lines.join("\n")}`);
    }
    if (!parts.length) {
      parts.push(`**${labels.debug}**\n\n- ${labels.empty}`);
    }
    return parts.join("\n\n");
  }
}

export class AgentRunError extends Error {
  readonly source: unknown;
  readonly debugMarkdown: string;

  constructor(source: unknown, debugMarkdown: string) {
    super("agent_failed");
    this.name = "AgentRunError";
    this.source = source;
    this.debugMarkdown = debugMarkdown;
  }
}
