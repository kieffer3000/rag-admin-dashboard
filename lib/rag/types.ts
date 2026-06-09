// Core data model for the RAG dashboard.

export type MediaType =
  | 'youtube'
  | 'image'
  | 'audio'
  | 'document'
  | 'text'
  | 'website';

export type MediaStatus = 'processing' | 'indexed' | 'failed';

export interface MediaItem {
  id: string;
  type: MediaType;
  name: string;
  description: string;
  /** ISO date string (YYYY-MM-DD) the user can edit. */
  date: string;
  status: MediaStatus;
  /** Number of vector chunks this item produced once indexed. */
  chunks: number;
  /** Short preview / extracted text used for the "copy content" action. */
  content: string;
  /** Type-specific source reference (URL for youtube/website, filename for files). */
  source?: string;
  /** Approximate size label, e.g. "2.4 MB" or "312 pages". */
  sizeLabel?: string;
  /** For YouTube: duration label like "12:04". For audio: same. */
  durationLabel?: string;
}

export interface Prompt {
  id: string;
  title: string;
  body: string;
  /** Optional emoji/icon shown on the prompt card. */
  icon?: string;
  /** True for the built-in starter prompts. */
  builtIn?: boolean;
}

export type QueryScope = 'selected' | 'everything';

export interface Citation {
  mediaId: string;
  mediaName: string;
  type: MediaType;
  /** e.g. "p. 42", "04:31", "§3" */
  locator: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  /** Media ids that were in context when this message was sent. */
  contextIds?: string[];
  /** Optional attached comparison file name (e.g. an uploaded quiz). */
  attachment?: string;
  createdAt: string;
}
