import { EditorSelection, EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { frontmatter } from '../../shared/metadata';
import { fromSnapshot } from './transaction-adapter';

const hidden = StateField.define({
  create(state) {
    return decorations(state);
  },
  update(value, tr) {
    return tr.docChanged ? decorations(tr.state) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
function decorations(state: EditorState) {
  const end = frontmatter(state.doc.toString())?.end ?? 0;
  return end
    ? Decoration.set([Decoration.replace({ block: true }).range(0, end)])
    : Decoration.none;
}
/** Keep absolute source coordinates. Crossing edits are rejected, never clipped or moved. */
export function protectedFrontmatter() {
  return [
    hidden,
    EditorState.transactionFilter.of((tr) => {
      if (tr.annotation(fromSnapshot)) return tr;
      const end = frontmatter(tr.startState.doc.toString())?.end ?? 0;
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
