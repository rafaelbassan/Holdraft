"use client";

import { useEffect, useId, useRef } from "react";
import { DEBUG_MARKER } from "@/lib/agent/debug-trace";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
  className?: string;
};

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const diagramId = `mermaid-${reactId.replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      if (!containerRef.current || cancelled) {
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
        });
        const { svg } = await mermaid.render(diagramId, code.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.textContent = code;
        }
      }
    }
    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code, diagramId]);

  return (
    <div
      ref={containerRef}
      className="my-3 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
      aria-label="Mermaid diagram"
    />
  );
}

function MarkdownBody({ content, className = "" }: MarkdownMessageProps) {
  return (
    <div className={`prose prose-slate max-w-none text-sm ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClass, children }) {
            const text = String(children).replace(/\n$/, "");
            const isBlock = text.includes("\n") || Boolean(codeClass);
            const isMermaid =
              codeClass?.includes("language-mermaid") ||
              (isBlock && text.startsWith("graph "));
            if (isMermaid && isBlock) {
              return <MermaidBlock code={text} />;
            }
            if (isBlock) {
              return (
                <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-slate-100">
                  <code className={codeClass}>{text}</code>
                </pre>
              );
            }
            return (
              <code className="rounded bg-slate-100 px-1 py-0.5">{children}</code>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownMessage({ content, className = "" }: MarkdownMessageProps) {
  const cut = content.indexOf(DEBUG_MARKER);
  const answer = cut >= 0 ? content.slice(0, cut).trim() : content;
  const debug = cut >= 0 ? content.slice(cut + DEBUG_MARKER.length).trim() : "";
  return (
    <>
      {answer ? <MarkdownBody content={answer} className={className} /> : null}
      {debug ? (
        <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">
            Depuração
          </summary>
          <MarkdownBody content={debug} className={className} />
        </details>
      ) : null}
    </>
  );
}
