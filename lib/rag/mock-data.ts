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

// One clean, empty default project so the app bootstraps (the store seeds the
// active project from MOCK_PROJECTS[0]). Real sources reattach on hydrate; users
// add their own projects. No sample sourceIds/notes — those were stale mock data.
export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj1',
    name: 'My Workspace',
    icon: '📁',
    description: '',
    sourceIds: [],
    createdAt: '2026-06-20'
  }
];

export const MOCK_NOTES: Note[] = [];
