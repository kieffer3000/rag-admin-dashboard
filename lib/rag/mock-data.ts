import { MediaItem, Prompt, Project, Note, Agent } from './types';

export const MOCK_MEDIA: MediaItem[] = [
  {
    id: 'm1',
    type: 'document',
    name: 'Atomic Habits',
    description: 'James Clear — full book, 320 pages. Habit formation framework.',
    date: '2026-05-30',
    status: 'indexed',
    chunks: 214,
    sizeLabel: '320 pages',
    source: 'atomic-habits.pdf',
    content:
      'Habits are the compound interest of self-improvement. The same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them...'
  },
  {
    id: 'm2',
    type: 'document',
    name: 'Thinking, Fast and Slow',
    description: 'Daniel Kahneman. System 1 vs System 2 cognition.',
    date: '2026-05-30',
    status: 'indexed',
    chunks: 268,
    sizeLabel: '499 pages',
    source: 'thinking-fast-slow.pdf',
    content:
      'System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control. System 2 allocates attention to the effortful mental activities that demand it...'
  },
  {
    id: 'm3',
    type: 'document',
    name: 'The Lean Startup',
    description: 'Eric Ries. Build-Measure-Learn and validated learning.',
    date: '2026-06-01',
    status: 'indexed',
    chunks: 156,
    sizeLabel: '336 pages',
    source: 'lean-startup.pdf',
    content:
      'The Lean Startup method teaches you how to drive a startup, how to steer, when to turn, and when to persevere—and grow a business with maximum acceleration...'
  },
  {
    id: 'm4',
    type: 'youtube',
    name: 'How to Build Habits — Andrew Huberman',
    description: 'Huberman Lab podcast on neuroscience of habit formation.',
    date: '2026-06-03',
    status: 'indexed',
    chunks: 89,
    durationLabel: '1:54:22',
    source: 'https://youtube.com/watch?v=example1',
    content:
      'There is a neuroscience to habit formation that involves the basal ganglia and dopamine reward prediction. The key window for habit execution is the first phase of your day...'
  },
  {
    id: 'm5',
    type: 'youtube',
    name: 'The Science of Productivity',
    description: 'Talk on focus, deep work, and attention management.',
    date: '2026-06-04',
    status: 'processing',
    chunks: 0,
    durationLabel: '23:11',
    source: 'https://youtube.com/watch?v=example2',
    content: 'Transcript is being extracted and chunked...'
  },
  {
    id: 'm6',
    type: 'audio',
    name: 'Lecture 4 — Cognitive Biases',
    description: 'Recorded class lecture. Anchoring, availability, framing.',
    date: '2026-06-02',
    status: 'indexed',
    chunks: 47,
    durationLabel: '48:30',
    source: 'lecture-04-biases.m4a',
    content:
      'Anchoring is a cognitive bias where an individual depends too heavily on an initial piece of information offered when making decisions...'
  },
  {
    id: 'm7',
    type: 'audio',
    name: 'Interview — Memory Techniques',
    description: 'Conversation with a memory champion on spaced repetition.',
    date: '2026-06-05',
    status: 'indexed',
    chunks: 31,
    durationLabel: '34:07',
    source: 'memory-interview.mp3',
    content:
      'Spaced repetition leverages the psychological spacing effect. Reviews are scheduled at increasing intervals to exploit the forgetting curve...'
  },
  {
    id: 'm8',
    type: 'image',
    name: 'Forgetting Curve Diagram',
    description: 'Ebbinghaus forgetting curve infographic.',
    date: '2026-06-05',
    status: 'indexed',
    chunks: 2,
    sizeLabel: '1.2 MB',
    source: 'forgetting-curve.png',
    content:
      'Image description: A line chart showing memory retention declining exponentially over time, with spaced review sessions flattening the curve.'
  },
  {
    id: 'm9',
    type: 'website',
    name: 'Spaced Repetition — Wikipedia',
    description: 'Reference article on the spacing effect and SRS systems.',
    date: '2026-06-06',
    status: 'indexed',
    chunks: 18,
    source: 'https://en.wikipedia.org/wiki/Spaced_repetition',
    content:
      'Spaced repetition is an evidence-based learning technique that is usually performed with flashcards. Newly introduced and more difficult flashcards are shown more frequently...'
  },
  {
    id: 'm10',
    type: 'text',
    name: 'My Study Notes — Week 3',
    description: 'Pasted personal notes on learning science.',
    date: '2026-06-07',
    status: 'indexed',
    chunks: 6,
    content:
      'Key takeaways: 1) Interleaving beats blocked practice. 2) Retrieval practice > rereading. 3) Sleep consolidates memory. 4) Test yourself before you feel ready.'
  },
  {
    id: 's_invoice_pincay',
    type: 'document',
    name: 'Invoice — PINCAY (TIO Square)',
    description: 'Sample invoice with line-item dollar amounts.',
    date: '2026-06-11',
    status: 'indexed',
    chunks: 1,
    content:
      'TIO Square Inc. INVOICE. File Number 060826-R211100-sur-ny-PINCAY. Date 6/11/2026. Billed to Command Investigations LLC. Total Due 1019.63 dollars. Line items: Surveillance Tuesday June 9 2026 8 hours at 60 dollars per hour equals 480 dollars; Surveillance Wednesday June 10 2026 8 hours at 60 equals 480 dollars; Parking 44.71 dollars; Tolls 14.92 dollars. Subtotal 1019.63. Balance Due 1019.63 dollars.'
  },
  {
    id: 's_q2_budget',
    type: 'document',
    name: 'Q2 2026 Marketing Budget',
    description: 'Sample budget allocation by channel (USD).',
    date: '2026-06-08',
    status: 'indexed',
    chunks: 1,
    content:
      'Q2 2026 Marketing Budget for Acme Co. Allocations by channel: Paid Ads 42000 dollars; Content Marketing 18000 dollars; Events and Conferences 25000 dollars; SEO Tools and Software 9000 dollars; Influencer Partnerships 16000 dollars. Total Q2 marketing budget 110000 dollars. Paid Ads is the largest line at 38 percent of spend.'
  },
  {
    id: 's_monthly_sales',
    type: 'document',
    name: 'Monthly Sales H1 2026',
    description: 'Sample monthly revenue trend (USD).',
    date: '2026-06-09',
    status: 'indexed',
    chunks: 1,
    content:
      'Acme Co monthly revenue, first half of 2026 in USD: January 82000; February 91000; March 104000; April 99000; May 121000; June 138000. Revenue grew 68 percent from January to June, with a small dip in April. Q1 total 277000; Q2 total 358000.'
  },
  {
    id: 's_plan_compare',
    type: 'document',
    name: 'Pricing Plan Comparison',
    description: 'Sample SaaS plans with prices and limits.',
    date: '2026-06-10',
    status: 'indexed',
    chunks: 1,
    content:
      'Pricing plans for the Acme SaaS product. Starter plan: 29 dollars per month, 3 seats, 10 GB storage, 1000 API calls. Pro plan: 79 dollars per month, 10 seats, 100 GB storage, 50000 API calls. Enterprise plan: 249 dollars per month, unlimited seats, 1000 GB storage, unlimited API calls. Pro is the most popular, chosen by 62 percent of customers.'
  }
];

export const MOCK_PROMPTS: Prompt[] = [
  {
    id: 'p1',
    title: 'Explain like a tutor',
    icon: '🎓',
    builtIn: true,
    body: 'Act as a patient tutor. Explain the answer step by step using only the selected sources. Define any jargon, give one concrete example, and cite the source for each claim.'
  },
  {
    id: 'p2',
    title: 'Answer my test',
    icon: '📝',
    builtIn: true,
    body: 'I am attaching a test/quiz. For each question, find the answer in my selected sources, answer it clearly, and cite the exact source and location. If a question cannot be answered from the sources, say so explicitly.'
  },
  {
    id: 'p3',
    title: 'Compare & contrast',
    icon: '⚖️',
    builtIn: true,
    body: 'Compare how the selected sources treat this topic. Build a table of agreements and disagreements, and note which source makes each point. End with a synthesis.'
  },
  {
    id: 'p4',
    title: 'Summarize key ideas',
    icon: '✨',
    builtIn: true,
    body: 'Produce a clean executive summary of the selected sources: the 5 most important ideas, each as a one-sentence headline followed by two sentences of detail, with citations.'
  },
  {
    id: 'p5',
    title: 'Make flashcards',
    icon: '🃏',
    builtIn: false,
    body: 'Create 15 question/answer flashcards covering the most testable facts in the selected sources. Format as Q: / A: pairs and cite the source for each answer.'
  }
];

export const MOCK_AGENTS: Agent[] = [
  {
    id: 'a1',
    name: 'Scholar',
    icon: '🎓',
    builtIn: true,
    systemPrompt:
      'You are a meticulous academic. Answer in a formal, precise tone using only the wired sources. Cite the exact source for every claim, define technical terms, and never speculate beyond the evidence — if the sources are silent, say so.'
  },
  {
    id: 'a2',
    name: 'Explainer',
    icon: '💡',
    builtIn: true,
    systemPrompt:
      'You are a friendly explainer. Answer in plain, everyday language as if talking to a smart beginner. Avoid jargon (or define it in a few words), use a concrete example, and keep it short and clear while still citing the sources.'
  }
];

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj1',
    name: 'Learning Science',
    icon: '🧠',
    description: 'Habits, memory and study technique research.',
    sourceIds: ['m1', 'm2', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 's_invoice_pincay', 's_q2_budget', 's_monthly_sales', 's_plan_compare'],
    createdAt: '2026-05-30'
  },
  {
    id: 'proj2',
    name: 'Startup Playbook',
    icon: '🚀',
    description: 'Lean methodology and product strategy.',
    sourceIds: ['m3'],
    createdAt: '2026-06-01'
  }
];

export const MOCK_NOTES: Note[] = [
  {
    id: 'n1',
    projectId: 'proj1',
    content:
      'Key insight: habit formation is governed by the basal ganglia and dopamine reward prediction — and the best execution window is early in the day. Pair this with Atomic Habits\' systems-over-goals framing for the exam answer.',
    citations: [
      {
        mediaId: 'm4',
        mediaName: 'How to Build Habits — Andrew Huberman',
        type: 'youtube',
        locator: '12:40',
        snippet:
          'There is a neuroscience to habit formation that involves the basal ganglia and dopamine reward prediction.'
      }
    ],
    createdAt: '2026-06-08'
  }
];
