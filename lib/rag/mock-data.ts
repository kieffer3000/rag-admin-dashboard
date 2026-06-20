import { MediaItem, Project, Note, Agent } from './types';

export const MOCK_MEDIA: MediaItem[] = [];

// Start with zero agents — users create their own (each has a name + system
// prompt). The store persists them to Neon, so the empty start is only the
// very-first-run seed before anything is saved.
export const MOCK_AGENTS: Agent[] = [];

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
