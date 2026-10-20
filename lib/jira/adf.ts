type AdfNode = Record<string, unknown>;

const MERMAID_FENCE = /^```mermaid[\s\S]*?```\s*$/gim;

function stripMermaidBlocks(markdown: string): string {
  return markdown.replace(MERMAID_FENCE, "").trim();
}

function textNode(text: string, marks?: AdfNode[]): AdfNode {
  const node: AdfNode = { type: "text", text };
  if (marks?.length) {
    node.marks = marks;
  }
  return node;
}

function paragraph(content: AdfNode[]): AdfNode {
  return { type: "paragraph", content: content.length ? content : undefined };
}

function heading(level: number, text: string): AdfNode {
  return {
    type: "heading",
    attrs: { level: Math.min(6, Math.max(1, level)) },
    content: [textNode(text)],
  };
}

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(textNode(text.slice(last, m.index)));
    }
    if (m[2] !== undefined) {
      nodes.push(textNode(m[2], [{ type: "strong" }]));
    } else if (m[3] !== undefined && m[4] !== undefined) {
      nodes.push({
        type: "text",
        text: m[3],
        marks: [{ type: "link", attrs: { href: m[4] } }],
      });
    } else if (m[5] !== undefined) {
      nodes.push(textNode(m[5], [{ type: "code" }]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(textNode(text.slice(last)));
  }
  return nodes.length ? nodes : [textNode("")];
}

function codeBlock(code: string, language?: string): AdfNode {
  return {
    type: "codeBlock",
    attrs: language ? { language } : undefined,
    content: [textNode(code.replace(/\n$/, ""))],
  };
}

function bulletList(items: string[]): AdfNode {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(parseInline(item.trim()))],
    })),
  };
}

/**
 * Simple markdown → Atlassian Document Format for issue descriptions.
 * Skips mermaid fenced blocks.
 */
export function markdownToAdf(markdown: string): { version: 1; type: "doc"; content: AdfNode[] } {
  const cleaned = stripMermaidBlocks(markdown);
  const content: AdfNode[] = [];
  const lines = cleaned.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fenceMatch = line.match(/^```(\w*)?/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      content.push(codeBlock(codeLines.join("\n"), lang));
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push(heading(headingMatch[1].length, headingMatch[2].trim()));
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      content.push(bulletList(items));
      continue;
    }

    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^[-*]\s+/) &&
      !lines[i].startsWith("```")
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    content.push(paragraph(parseInline(paraLines.join(" "))));
  }

  if (content.length === 0) {
    content.push(paragraph([textNode("")]));
  }

  return { version: 1, type: "doc", content };
}
