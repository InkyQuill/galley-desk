import type { Pair } from './book';

type Entry = { before: Pair; after: Pair };

/**
 * Session-scoped undo history of applied corrections over whole chapter
 * pairs. `undoTarget`/`redoTarget` only peek at the pair that has to be
 * written next — the cursor moves solely through `didUndo`/`didRedo`, which
 * the session calls after the target pair was written successfully. Any
 * `push` clears the redo branch; `clear` empties both stacks. Purely in
 * memory: a freshly constructed history is empty and nothing persists.
 */
export class ApplyHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  /** Records one applied transition; a new branch drops the redo stack. */
  push(before: Pair, after: Pair): void {
    this.undoStack.push({ before, after });
    this.redoStack = [];
  }

  /** The pair an undo would write, without consuming the undo entry. */
  undoTarget(): Pair | undefined {
    return this.undoStack[this.undoStack.length - 1]?.before;
  }

  /** The pair a redo would write, without consuming the redo entry. */
  redoTarget(): Pair | undefined {
    return this.redoStack[this.redoStack.length - 1]?.after;
  }

  /** Commits a successful undo: the undone transition becomes redoable. */
  didUndo(): void {
    const entry = this.undoStack.pop();
    if (entry !== undefined) this.redoStack.push(entry);
  }

  /** Commits a successful redo: the redone transition becomes undoable. */
  didRedo(): void {
    const entry = this.redoStack.pop();
    if (entry !== undefined) this.undoStack.push(entry);
  }

  /** True, когда есть применённая правка для undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** True, когда есть отменённая правка для redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
