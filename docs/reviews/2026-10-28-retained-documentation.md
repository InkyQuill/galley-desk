# Review of retained design and documentation

Reviewed the documentation from local commits `29155f4` and `0a1ec2b` against
PR #6's implementation and pinned Galley packages on 2026-10-28.

## Retained and refreshed

- `apps/desktop/PRODUCT.md`: useful product scope, editor/author workflow,
  source preservation, portability and accessibility principles.
- `apps/desktop/DESIGN.md`: current design reference. Updated package pins,
  theme count, book identity typography, search geometry, review-list icons,
  fixed-width gutter stacks, panel triggers, notifications, flyout transitions
  and diagnostics drag exclusion against the implementation.
- `.impeccable/config.json` and `design.json`: code-based design workflow and
  ten reusable HTML/CSS examples. Component references remain valid; flyout
  motion now reflects the current stylesheet. These are documentation, not
  application runtime components.
- `docs/design-system-transfer.md`: useful shared-theme and sibling-product
  boundaries; distinguishes the current 0.17.0 dependency from historical
  0.15.0 exports.
- September design screenshots and measurements: retained as explicitly dated
  evidence. They are not current screenshots or new verification claims.
- RU/EN plan: retained as a proposal, not an implemented or scheduled feature.
- `AGENTS.md`: retained with current Node requirements, dependency-audit
  guidance and canonical isolated GUI commands. The old Electronegativity
  instructions were superseded by the current local guide.
- README links make the product, design, transfer and proposed localization
  documents discoverable.

## Left out

- The September 19 code-review verdict, probes and raw performance/test logs:
  historical findings against `849b35d`, older dependencies and earlier
  verification conditions. They are not a current defect list. They remain
  available in the original local commit.
- The old screenshot capture script: obsolete selectors, hard-coded 0.15.0
  metadata and output paths that would overwrite the dated evidence. New
  captures must use a new output directory and the isolated GUI wrapper.

## Validation

- Compared the documented source snapshot with current CSS, title bar,
  workspace, layout, notification, appearance and tooltip implementations.
- Parsed DESIGN frontmatter and all retained JSON; checked ten component
  examples against frontmatter references.
- Checked 66 relative Markdown links: all targets exist.
- Compared 22 documented base-theme values with installed 0.17.0 exports:
  all match. All variables in the 13 historical themes are unchanged;
  Edda and Thoth add four themes, giving 17 now.
- `git diff --check`: PASS.
- No runtime files changed in this documentation addition. No new screenshot
  capture, GUI run or macOS verification is claimed; the preceding runtime
  verification remains in the [binder/dependency report](2026-10-28-external-binder-refresh.md).
