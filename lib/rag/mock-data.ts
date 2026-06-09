import { MediaItem, Prompt } from './types';

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
