import type { ChapterModel } from './model';

type Entry = { before: ChapterModel; after: ChapterModel; group: string };

/**
 * Per-chapter, session-only input history: full model snapshots (which carry
 * the selection), so undo/redo restore both text state and cursor. Caller
 * contract for the group key: rotate the key per typing burst — consecutive
 * pushes with the same key merge into one undo entry, a push with a new key
 * starts a new undo step (one IME composition or continuous typing burst is
 * one group; a selection change is a new group key). Any push clears the redo
 * stack and clear() empties both. Purely in memory — no file persistence, and
 * a freshly constructed history is empty.
 */
export class InputHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  push(before: ChapterModel, after: ChapterModel, group: string): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top !== undefined && top.group === group) {
      top.after = after;
    } else {
      this.undoStack.push({ before, after, group });
    }
    this.redoStack = [];
  }

  undo(current: ChapterModel): ChapterModel {
    const entry = this.undoStack.pop();
    if (entry === undefined) return current;
    this.redoStack.push({ before: current, after: entry.after, group: entry.group });
    return entry.before;
  }

  redo(current: ChapterModel): ChapterModel {
    const entry = this.redoStack.pop();
    if (entry === undefined) return current;
    this.undoStack.push({ before: current, after: entry.after, group: entry.group });
    return entry.after;
  }

  /** True, когда есть шаг для undo (не считая объединённых в шаги правок). */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** True, когда есть шаг для redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
