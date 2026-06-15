'use client';

import { useState } from 'react';
import { AnswerBody } from '@/components/rag/board/markdown';

// Live preview / playground for answer rendering — paste answer content (HTML,
// ```mermaid, ```chart) and see exactly how a brain answer will render it. Lets
// you iterate on chart/diagram formats without running a full RAG query.

const SAMPLE = `<h2>Quarterly Revenue</h2>
<p>Revenue grew steadily through Q2, with <mark>June the strongest month</mark> at $21k [Finance Report].</p>

\`\`\`chart
{"type":"bar","title":"Monthly Revenue (USD)","data":[{"name":"Apr","value":12000},{"name":"May","value":18500},{"name":"Jun","value":21000}]}
\`\`\`

<h3>How the answer is produced</h3>

\`\`\`mermaid
flowchart LR
  Q[Question] --> R[Retrieve chunks]
  R --> G[Generate answer]
  G --> C[Render chart / diagram]
\`\`\`

<p>You can mix HTML, charts and diagrams freely in one answer.</p>`;

export default function PreviewPage() {
  const [content, setContent] = useState(SAMPLE);
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-1 text-xl font-semibold">Answer render preview</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Paste answer content (HTML, <code>```mermaid</code>, <code>```chart</code>)
        on the left — see exactly how the brain will render it on the right.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-[70vh] w-full resize-none rounded-xl border border-[rgb(var(--hairline)/0.2)] bg-card p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:ring-2 focus:ring-accent/40"
        />
        <div className="h-[70vh] overflow-auto rounded-xl border border-[rgb(var(--hairline)/0.2)] bg-card p-4">
          <AnswerBody content={content} />
        </div>
      </div>
    </div>
  );
}
