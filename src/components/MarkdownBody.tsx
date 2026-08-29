"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import "katex/dist/katex.min.css";

const components: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noreferrer" />;
  },
  table({ node: _node, ...props }) {
    return (
      <div className="table-wrap">
        <table {...props} />
      </div>
    );
  },
};

/** Convert grok LaTeX \( \) / \[ \] to $$ so remark-math can parse them. Skip fenced code. */
function grokMathToDollars(markdown: string): string {
  const parts: string[] = [];
  const fenceRe = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(markdown))) {
    parts.push(rewriteMath(markdown.slice(last, m.index)));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(rewriteMath(markdown.slice(last)));
  return parts.join("");
}

function rewriteMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr: string) => `\n\n$$\n${expr.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, expr: string) => `$$${expr.trim()}$$`);
}

export function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="msg-body md-body">
      <Markdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {grokMathToDollars(text)}
      </Markdown>
    </div>
  );
}
