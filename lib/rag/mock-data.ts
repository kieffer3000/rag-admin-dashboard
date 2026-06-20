import { MediaItem, Project, Note, Agent } from './types';

export const MOCK_MEDIA: MediaItem[] = [];

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
