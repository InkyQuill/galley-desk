import { EditorSelection, EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { frontmatter } from '../../shared/metadata';
import { fromSnapshot } from './transaction-adapter';

function metadataEnd(state: EditorState): number {
  // Most chapters have no metadata. Avoid flattening their entire CM rope.
  if (!/^(?:\uFEFF)?---[ \t]*$/.test(state.doc.line(1).text)) return 0;
  return frontmatter(state.doc.toString())?.end ?? 0;
}
const boundary = StateField.define<number>({
  create: metadataEnd,
  update(end, tr) {
    if (!tr.docChanged) return end;
    let touchesPrefix = end === 0 || end === tr.startState.doc.length;
    tr.changes.iterChangedRanges((from) => { if (from < end) touchesPrefix = true; });
    return touchesPrefix ? metadataEnd(tr.state) : end;
  },
});
const hidden = StateField.define({
  create(state) {
    return decorations(state);
  },
  update(value, tr) {
    return tr.startState.field(boundary) !== tr.state.field(boundary) ? decorations(tr.state) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
function decorations(state: EditorState) {
  const end = state.field(boundary);
  return end
    ? Decoration.set([Decoration.replace({ block: true }).range(0, end)])
    : Decoration.none;
}
/** Keep absolute source coordinates. Crossing edits are rejected, never clipped or moved. */
export function protectedFrontmatter() {
  return [
    boundary,
    hidden,
    EditorState.transactionFilter.of((tr) => {
      if (tr.annotation(fromSnapshot)) return tr;
      const end = tr.startState.field(boundary);
      if (!end) return tr;
      let crosses = false;
      tr.changes.iterChangedRanges((from) => {
        if (from < end) crosses = true;
      });
      if (crosses) return [];
      if (tr.newSelection.ranges.some((range) => range.from < end)) {
        return [
          tr,
          {
            selection: EditorSelection.create(
              tr.newSelection.ranges.map((range) =>
                EditorSelection.range(
                  Math.max(end, range.anchor),
                  Math.max(end, range.head),
                ),
              ),
              tr.newSelection.mainIndex,
            ),
            sequential: true,
          },
        ];
      }
      return tr;
    }),
  ];
}
