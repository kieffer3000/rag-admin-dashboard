import { MediaItem, Prompt, Project, Note, Agent } from './types';

export const MOCK_MEDIA: MediaItem[] = [];

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
