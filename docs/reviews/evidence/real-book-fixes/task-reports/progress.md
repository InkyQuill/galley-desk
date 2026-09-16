# SDD ledger — plan: docs/superpowers/plans/2026-09-16-real-book-fixes.md

Base 279eca8; branch codex/desk-real-book-fixes; checkout /home/inky/Development/galley-desk.
Ruling: reuse current checkout on a fresh feature branch — existing dependencies, ignored prototype and user branding are required; no main edits, installed app uses separate versioned path — cost if wrong: move branch to worktree later.
Ruling: current user's sixteen requirements override prior inline-comment/deletion non-goals — direct latest instruction — cost: revise old visual tests.
Ruling: frontmatter save is explicit source-author action; normal typing remains suggestions — requested metadata editing — cost: UX clarification if wanted proposals there too.
Ruling: chapter removal vs trash deletion distinct actions with confirmation — fulfills delete without silently destroying books — cost: one extra explicit choice.
Spec authority: user's 16-item report; plan records exact mapping, older specs apply to compatibility only.

| Tasks | Shared surface / producer → consumer | Check |
|---|---|---|
| 1/2 | Derived edit composition → editor snapshots | Preserve coordinates; consistent |
| 1/3 | Nonempty storage anchor → trimmed visual ranges | No schema change; consistent |
| 1/4 | Engine rebasing → metadata source update | Preserve prior deletions; task4 must reuse guarded apply/rebase |
| 1/5 | Storage sessions → deletion flush | Consistent |
| 2/3 | ReviewEditor callbacks and viewport → annotations | Sequential; decorations cannot force passive scrolling |
| 2/4 | Snapshot sync → metadata offsets | Metadata stays in source coordinates; consistent |
| 2/5 | FIFO flushPending → management | Consistent |
| 3/4 | BookWindow/CSS/ReviewEditor | Sequential; metadata must preserve comments and marker offsets |
| 3/5 | BookWindow controls | Sequential; accessible icon vocabulary preserved |
| 3/6 | Header/CSS/popups | Window drag excludes interactive controls |
| 4/5 | Title resolver/service/API/storage | Task5 consumes task4 helper; no auto-manifest rewrite |
| 4/6 | IPC/preload/API | Narrow additive APIs, no generic channel |
| 5/6 | IPC/preload/API/BookWindow | Close keeps flush/error behavior |
| 1 | Engine tests/source coverage | Self-consistent, no UI claim |
| 2 | Viewport regression/CM sync | Self-consistent, tests geometry not only scrollTop |
| 3 | UI widgets/trimmed ranges | Self-consistent, stored anchors unchanged |
| 4 | Parse/display/save YAML | Self-consistent, explicit source action plus conflict guard |
| 5 | Discovery/add/trash/rename | Self-consistent, cancel and failures tested |
| 6 | Frame/icon/platform checks | Self-consistent, no macOS runtime claim |

Task 1: pending. Task 2: pending. Task 3: pending. Task 4: pending. Task 5: pending. Task 6: pending.

Task 1 BASE: 36b0c5f. Dispatching engine implementer.

Ruling: #1 cursor means pointer as well as text caret; edit action popover leaves-anchor/popup dismissal with grace, signal drafts kept — user says mouse leaves or outside click — cost: tune delay from actual interaction. Task3 text clarified before dispatch.

Task 1 implementer real_books_engine DONE 95fdf15, 63 engine tests green. Review in progress real_books_engine_review.

Task 1: complete — 95fdf15; reviewer real_books_engine_review: spec compliant, quality approved, no findings.
Task 2 BASE: 95fdf15.

Task 2 RED: actual Electron undo after paragraph90 deletion moves caret by 11904px offscreen; whole-document replacement collapses CM viewport mapping and reuses unmapped numeric caret. Worker preparing bounded change + mapped selection/scroll snapshot.

Task 2 initial GREEN: long-chapter Electron deletion/undo/redo/undo text+caret geometry; 17 mapping/adapter tests, typecheck. Worker running focused existing interaction regressions.

Task 2 implementation committed c9e03ee; review package generated review-95fdf15..c9e03ee.diff. Awaiting final implementer report before review.

Task 2 report DONE_WITH_CONCERNS effectively: c9e03ee, 17unit/26Electron/6finalElectron/typecheck green; reviewer real_books_viewport_review active. Ruling: single-span diff acceptable for contiguous reported deletion/history; no multi-hunk framework requested — arbitrary distant simultaneous edits not this regression — cost: improve diff mapping if real case occurs. Linux CtrlShiftZ behavior recorded for review; supported CtrlY used.

Task 2: complete — c9e03ee; reviewer real_books_viewport_review: spec compliant, quality approved. Minor: Linux CtrlShiftZ trial unresolved, CtrlY verified, mac runtime unverified. Track focused key event reproduction during final integration (not claim tested).
Task 3 BASE: c9e03ee.

Controller focused keymap probe (/tmp/desk-keymap-probe.mts, actual installed CM state/view, no GUI): {key:'z',shiftKey:true,ctrlKey:true} triggers undo; uppercase key:'Z' triggers redo. Need exact failed Playwright string before treating shortcut report as app defect. Probe initial .ts run mixed CJS/ESM caused duplicate-extension error; .mts corrected loader and succeeded. No source changes.

Task 2 minor clarification from original implementer: failed string was ControlOrMeta+Shift+z (lowercase). Installed CM probe confirms this synthetic event invokes undo; physical uppercase Z invokes redo. Ruling: treat as test artifact, not established production bug; Task6/final real Electron uppercase shortcut check remains appropriate. No shortcut code change authorized by this evidence alone.

Task 3 first packaged interaction run 6/9: viewport regression caught 4px inherited global-button padding on trash widget; worker fixing dimensions without weakening assertion. Other old expectations updated only where superseded (inline comment count/support suffix).

Task 3 core interaction tests GREEN; deletion widget needed WidgetType.coordsAt using adjacent text geometry (icon rect displaced caret/scroll anchor), not only CSS. Viewport/gutter assertions unchanged. Worker capturing screenshots/self-review.

Task 2 minor resolved: actual Electron packaged .vite at c44b2b0, isolated Xvfb/profile/temp book; type X → Ctrl+z restores abc → Control+Shift+Z restores abcX. Captured key:'Z', code:'KeyZ',ctrl:true,shift:true. /tmp/desk-uppercase-redo.mts passed, no code changes. Root GUI slot released.
Task 3 c44b2b0: 12unit, typecheck, 10focusedElectron green; visual screenshots inspected light/dark, no blocking visual issues. Task reviewer real_books_annotations_review active, potential delayed-snapshot popup coordinate risk under inspection.

Task 3 fix round 1 BASE c44b2b0: reviewer found P2 exclusive paragraph endpoint, P2 visual trimming after storage-range mapping stale prefix, P2 popup caret uses snapshot coordinates. All accepted; resuming original worker per task-3-fix-round-1.md.

Task 3 fix round1 f78aa2b DONE: all3P2 RED reproduced; 15units/typecheck/8Electron and2enhanced delayedACK green. Scoped rereview real_books_annotations_review pending. mappedVisualRecords now carries live presentation positions; popup caret resolves editor field by ID.

Task 3: complete — c44b2b0 + f78aa2b. Scoped rereviewer approved spec+quality, all3P2 resolved.
Task 4 BASE: f78aa2b.

## Controller resume notes
Current task4 implementer real_books_metadata active, BASEf78aa2b. Owns GUI/build exclusively; no root GUI until release. Task5/6 briefs pre-generated, append exact produced interfaces after task4. Root-owned uncommitted docs: plan clarification, review report, visual spec addendum, user-guide annotation section, release ZIP section. Do not include them in worker commits. Existing user assets/ADR still untracked for task6 intentional integration, design-inspiration stays untouched.
Final visual synthetic book prepared by /tmp/desk-realbook-visual-fixture.ts → /tmp/galley-desk-realbook-visual; safe generated text only. Capture script /tmp/desk-capture-realbooks.mts uses actual packaged executable via GALLEY_PACKAGED_EXECUTABLE, isolated recent/profile, produces docs/reviews/evidence/real-book-fixes/light.png and dark.png. Not run yet.
Final pending: all unit/type/contracts, final package+actual executable check, full native E2E with packaged smoke, separate performance, scanner afterward (Playwright resets test-results), actual screenshot inspect, broad branch review once, focused fixes/review as needed, docs evidence, native ZIP, versioned local install+current symlink without stopping user's older running installed instance. Linux only; macOS checklist prepared, no runtime claims.

Task5 preflight refinement: explicit remove-spine/re-add must preserve valid sidecar chapter_id; otherwise new UUID invalidates retained reviews. Added bounded acceptance test/identity validation to task5 brief; no schema registry.

Task4 status: 88focusedunit/typecheck and5Electron (metadata workflow +4Task3 regressions) green, actual executable exists; watcher-adopted stale form→Save refusal→Cancel→Close book test added. Benign metadata validation rejection no longer poisons BookWindow saveError; real persistence failures retain close protection. Worker self-review/commit/report pending.

Task4 committed42f6ec0, reviewer real_books_metadata_review active; worker GUI released. Root isolated production executable screenshot capture has no renderer errors.

Task4 fix round1 BASE42f6ec0: reviewer P1 BOM-stripping sourceText creates byteEnd19 vs actual22 and corrupts metadata save; P2 CRLF/indented Setext underline leaks into title. Both accepted; original worker resumed. Cross-task FIFO/IME coverage deferred to controller full native suite as planned.

Task4 fix round1 expansion: actual BOM+CRLF+typing RED showed byteOffsetInSlice strips BOM yet starts at0, inserts3bytes early. Bounded engine forward/inverse BOM accounting included to preserve existing BOM-free derived/CM convention; worker must report paths/tests for scoped rereview.

Task4 fix round1/5: 2addressed0open,42f6ec0..0ca6eaa; reviewer approved spec+quality. Task4 complete (f78aa2b..0ca6eaa, review clean). Task5 BASE0ca6eaa.

Ruling: trash source then associated sidecar, mutate spine only after both succeed; partial failure retains manifest entry and reports moved/remain, recover through OS trash — bounded recoverable filesystem semantics without rollback framework — cost if second trash fails: user restores moved file from trash; missing entry shown until restored/refreshed. Task5 adds injected second-trash failure test.

Task5 native-trash diagnosis: root direct gio synthetic probe /tmp failed internal mount; ~/.cache succeeded. Official Electron source delegates to gio by default; issue28045 documents tmpfs behavior. Worker moving native-success fixture to homefilesystem, no product fallback needed. Root probe trashed only own synthetic file.

Task5 nativeKDE6 defaults noELECTRON_TRASHoverride: full managementElectron GREEN1/1, realMD+sidecartrash after injectedfailure/cancel, missingnoncurrent removal. 99affectedunit/typecheck/package green; actualproductionexecutable flow finalrunning. No product environment fallback required.

Task5 b20a311 DONE,99unit/typecheck/package,2Electronintegration+actualhardenedpackagedmanagementpass. Reviewer real_books_management_review active (0ca6eaa..b20a311). GUIreleased.

Task6 preparation: root installed openbox3.6.1-14.1 + startup-notification via authorized sudo pacman; no desktop session changes. Enables actual Xvfb window-manager maximize/minimize checks.

Task5 fixround1 BASEb20a311: reviewerP1 session retired before storagevalidation/trash, failedmanagementlosesundo and lowerrev1 snapshotsignored/missingcachedsession on failedreconcile. Accepted; originalworker resumed with service+Electron failedtrash continuedtyping/undo and externalmanifestfailedremove regressions.

Task5fixround1 RED: failedtrash/manifestconflict BOOK_MISSING; partialtrash rev1<=oldrev5; nativefailedtrash losesundo and externalmanifest subsequenttypingunsaved. GREEN55service/storage+typecheck; retiredeferreduntilsuccess, storageflagspartialmoves, partialreplacementpreviousrevision+1/pushedsnapshot. NativeGREENpending.

Task5 fixround1/5:1addressed0open,b20a311..ea8bb86, reviewerapprovedspec+quality. Task5 complete (0ca6eaa..ea8bb86, reviewclean). Task6 BASEea8bb86.

Task6 initialGREEN15focusedwindow/IPC+typecheck. FramelessLinux/globaltitlebar/Zen, closeviawindow.close, nativeLinuxmenuremoval/machiddenInset/brandingwired; worker package/OpenboxGUIverification active.

Task6 nativeXvfb/Openbox:5focusedpass including actualhardenedpackageCDP/windowstates/icon/customcloseflush/failedclosestaysopen/lifecycle; uppercaseRedo1pass. Artifactchecks/report/commit pending. Screenshot initially lost to subsequentPlaywrightreset; asked worker preserve /tmp before next run.

Task6 fixround1 BASEac9b86e: reviewerP2fixedrootclipsmanyrecentbookswelcomescreenatcompactheight; accepted, originalworkerresume reachabletopscrollregression. macruntimeunverifiedplanned; iconPNGcontroller visuallyinspected/ICNSworkerstructuralcheck resolvesavailableverification. Initialfullunit377pass/typecheckpass. Contracts stoppedbeforeexecution: oldcachef3012aa vs baselinef4aa28e; preparingseparatedetachedpinnedcheckoutwithenvoverride, leavingexistingcacheandrealPocketcheckoutuntouched.

ControllercontractsPASS: JDK17/ANDROID_HOME explicit, POCKET_EDITOR_DIR=.cache/contracts/pocket-editor-realbooks-f4aa28e verified exactbaselinef4aa28e; Kotlinbuild+21TSexchange tests. Originalcacheunchanged. Logs persisted docs/reviews/evidence/real-book-fixes.

Task6 fixround1/5:1addressed0open,ac9b86e..21ce42d; scopedreviewapproved. Task6 complete ea8bb86..21ce42d. ControllerfinalpackagePASS actualexecutableexists; fullnativeunderXvfb+Openboxrunning.
Finalintegrationrisk forwholebranchreview: window-frame.spec.ts unconditionally usesxdotool/xprop andLinuxcontrols onmacOS; .github/workflows/desktop.yml Linux startsXvfbwithoutOpenbox/installtools. Rootreadtest topreparecommand thenfocusedCIcheckconfirmed no platformguard/WMsetup. Needs finalfixwave; no broadsource rereviewbyroot.

Finalsuite initial failures observed: edit-and-reopen.spec:222 exactbuttonГлава no longer matches title+filename accessibletext; external-change.spec:257 exactwarning label no longer matches Russian colorediconlabel. Assertions need locatorupdates preserving race/recovery tests, finalfixwave. Fullsuitecontinuing. Errorcontexts/docs copiedafterfinish before nextPlaywright.

Controllerfullnative21ce42d:62pass5fail1perfskip. Failures: chapterexactlocators edit-and-reopen222/review-actions304; warningRussianiconlabel externalchange257; menuinitialfocus nowmanagement searchappearance; hoverДо правки missing searchappearance needs diagnosis(not assume locator). Preserved fullinitiallog+errorcontexts docs/reviews/evidence/real-book-fixes. Finalfixwave afterbroadreview will handleall.

Finalperformance21ce42d isolatednative/Openbox: FAILinputDOMp95=70.2000000178814ms >50ms budget; openchapter assertionpassed butmetricswriteoccursafterp95assert sofulljsonmissing. Must diagnose actualhotpath, preservebudgets andcollectmetrics onfail; finalonefixwave handles. No concurrentheavyworkduringrun.

Controllersecurity21ce42d:6findings inclHighcontextIsolation +Mediumsandbox becausehelperopaque; checkedwindow.ts andactual getLastWebPreferences onisolatedElectron:contextIsolationtrue,sandboxtrue,nodeIntegrationfalse. No parsererrors, translationsnetworkwarning. JSON/SARIF/runtimeevidence persisted; security.md updated (rootowned).

Finalwholebranchreview real_books_final_review active BASE279eca8 HEADce617d9; rootfreshlight/darkpackagedscreenshots noerrors, saveduntrackedrootartifacts. Reviewer investigatingadditional staleAppTitleBarbooknameafterrename + metadata parsing/encodingpertransaction aslikelyperformancehotpath. AwaitcompletefindingsbeforeONEfixdispatch.

FinalbroadreviewDONE:4P2accepted (performance, platformCIinclMaccustomclose,5staleassertionswithexclusiveendpreview, renamedAppTitleBarstale). Noadditionalconfirmeddataloss. ONEfinalfixworker real_books_final_fixes BASEce617d9 dispatched usingfinal-fix-brief; ownsGUI/build. Rootdoesdocs/ops only. Mustonescopedrereviewafterfixreportcoveringtests; nosecondbroadreview.

FinalfixRED reproducedprofiledp95=75.7ms, renameheaderchangesbutTitleBarstale. ActualCPUprofilemajorrenderercostgutterperline500recordfilter/DOMrebuild, notonlymetadata. Workerextendingboundedscope markerlookup/equality preservingwrappedgeometryand500records; allinonewave.

Rootread-onlyuser-servicecheck: galley-desk-local.service inactive/MainPID0/noExecMainStartTimestamp now. We didnotstopit. Finalinstallation stillpreservesoldversiondirectory anddoesnotforcecloseprocesses; manualinstancesmayexist.

Finalfixfirstbuild packaged, focusedunits/typecheckpass. Gutterreuse handlerresolveslivebyID/equalitycoversDOMfields; WeakMapimmutablebytes sourcecache; CMstatefrontmatterboundary. Isolatedprofilecomparisonrunning beforefocusednative; finalstatsnotyet.

FinalfixperformanceGREEN isolated: p95=40.1ms,median31.6ms,open1080ms;100chapters/1048645bytes/500records/24inputs unchangedsource/exactsidecar/reopenpass. Firstprofileopt75.7→51.6ms; secondgutterDOMidentityremovedposition resolvingcurrentstategeometry. Focusednativeallspecsaffectedrunning.

Finalfixfollowupsresolved: switchtestexplicitlyrevealsvirtualizedstartafterlegitrestoredendcaret; stablegutterDOMrefreshespositiondatasetfromlivegeometry fordelayedACK. Finalcodeunit383/typecheckpass; isolatedperf40.7p95,max41.7,open1123ms; metrics final-evidence/performance-final-verified.json. Singlefullnativefinalbuildrunning.

Final scoped review: ce617d9..48246d4 approved; all four findings addressed, no new scoped issues. 383 units / 67 native + separate performance passed.
