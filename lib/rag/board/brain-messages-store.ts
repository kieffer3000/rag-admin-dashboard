'use client';

import { useSyncExternalStore } from 'react';
import type { ChatMessage } from '../types';

// ───────────────────────────────────────────────────────────────────────────
// ISOLATED chat-message store. Brain conversations used to live in the board
// context, so a streaming answer (updateBrainMessage ~18-60×/s) re-rendered the
// WHOLE board every tick = the "jitter while an answer streams". Here they live
// in a tiny external store instead: only the ONE brain whose messages changed
// re-renders (via useBrainMessages); board-canvas and every other node never
// re-render on a chat tick. The board store reads these imperatively at SAVE
// time (getAllBrainMessages) and subscribes (subscribeBrainMessages) to debounce
// the chat autosave — without re-rendering.
// ───────────────────────────────────────────────────────────────────────────

type Store = Record<string, ChatMessage[]>;
const EMPTY: ChatMessage[] = [];
let store: Store = {};
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function subscribeBrainMessages(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAllBrainMessages(): Store {
  return store;
}

/** Merge hydrated messages in on project load (keyed by brain id). */
export function mergeBrainMessages(record: Store | undefined | null) {
  if (!record || Object.keys(record).length === 0) return;
  store = { ...store, ...record };
  emit();
}

export function addBrainMessage(brainId: string, m: ChatMessage) {
  store = { ...store, [brainId]: [...(store[brainId] ?? []), m] };
  emit();
}

export function updateBrainMessage(
  brainId: string,
  msgId: string,
  patch: Partial<ChatMessage>
) {
  store = {
    ...store,
    [brainId]: (store[brainId] ?? []).map((m) =>
      m.id === msgId ? { ...m, ...patch } : m
    )
  };
  emit();
}

export function removeBrainMessage(brainId: string, msgId: string) {
  const list = store[brainId] ?? [];
  const idx = list.findIndex((m) => m.id === msgId);
  if (idx === -1) return;
  const drop = new Set([msgId]);
  // Deleting an assistant answer also drops the user question right before it,
  // so the pair vanishes cleanly from the list and the history.
  if (list[idx].role === 'assistant' && idx > 0 && list[idx - 1].role === 'user') {
    drop.add(list[idx - 1].id);
  }
  store = { ...store, [brainId]: list.filter((m) => !drop.has(m.id)) };
  emit();
}

export function clearBrainMessages(brainId: string) {
  store = { ...store, [brainId]: [] };
  emit();
}

/** Subscribe a single brain's messages — re-renders ONLY when THIS brain's
 *  array changes (other brains keep their refs, so their snapshot is stable). */
export function useBrainMessages(brainId: string): ChatMessage[] {
  return useSyncExternalStore(
    subscribeBrainMessages,
    () => store[brainId] ?? EMPTY,
    () => store[brainId] ?? EMPTY
  );
}
