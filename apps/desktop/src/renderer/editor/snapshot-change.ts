import { ChangeSet } from '@codemirror/state';

/** Keep unchanged text outside the snapshot mutation available for CM mapping. */
export function snapshotChange(before: string, after: string): ChangeSet {
  // Match complete lines first. Character-only trimming would treat the "Re"
  // in "Remove\nReading" → "Reading" as an unchanged prefix and move a
  // selection at the start of Reading two characters into the surviving line.
  const oldLines = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const newLines = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let first = 0;
  let from = 0;
  while (first < oldLines.length && first < newLines.length && oldLines[first] === newLines[first]) {
    from += oldLines[first]!.length;
    first++;
  }
  let oldLast = oldLines.length;
  let newLast = newLines.length;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldLast > first && newLast > first && oldLines[oldLast - 1] === newLines[newLast - 1]) {
    oldEnd -= oldLines[--oldLast]!.length;
    newEnd -= newLines[--newLast]!.length;
  }
  while (from < oldEnd && from < newEnd && before.charCodeAt(from) === after.charCodeAt(from)) from++;
  while (oldEnd > from && newEnd > from && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  return ChangeSet.of({ from, to: oldEnd, insert: after.slice(from, newEnd) }, before.length);
}
