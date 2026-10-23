import { useSyncExternalStore } from 'react';
import { Topic } from '@taucad/events';

// Opt-in inspection for this page only; no preference or execution state is persisted.
let enabled = false;
const changes = new Topic<void>({ name: 'agent-technical-details' });
const read = (): boolean => enabled;
const serverRead = (): boolean => false;
const subscribe = (listener: () => void): (() => void) => changes.subscribe(listener);

/** Toggle diagnostics only through the command palette, leaving the designer's default quiet. */
export function setAgentTechnicalDetails(value: boolean): void {
  enabled = value;
  changes.emit();
}

/** The command palette and transcript share one explicit inspection choice. */
export function useAgentTechnicalDetails(): boolean {
  return useSyncExternalStore(subscribe, read, serverRead);
}
