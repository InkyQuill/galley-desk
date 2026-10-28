// apps/desktop/src/shared/api.ts
import type { DiagnosticInput } from './diagnostics';
import type { LayoutSettings } from './layout';
export type Entry = {id:string; path:string; title:string; missing:boolean};
export type RecordView = {id:string; kind:'edit'|'signal'; status:'active'|'unavailable'|'conflicting';
  reason:string; from:number|null; to:number|null; before:string; after:string;
  comment:string; signalType:'note'|'change_required'|'warning'|'review'|'good'|'brilliant'|null};
export type Snapshot = {bookId:string; chapterId:string; revision:number; text:string; sourceText:string; title?:string;
  records:RecordView[]; chapterNote:string; readOnlyReason:string|null; recoveryConflict?:boolean; saveState:'saved'|'saving'|'error'|'external';
  canUndoInput:boolean; canRedoInput:boolean; canUndoApply:boolean; canRedoApply:boolean};
export type BookView = {bookId:string; path:string; title:string; entries:Entry[]};
export type Recent = {bookId:string; path:string; title:string; missing:boolean;
  lastChapterId?:string|null; lastAnchor?:number|null; lastScrollTop?:number|null};
export type Command =
 | {type:'text'; changes:{from:number;to:number;insert:string}[]; selection:{anchor:number;head:number};
    group?:string}
 | {type:'signal'; id?:string; from:number;to:number; signalType:'note'|'change_required'|'warning'|'review'|'good'|'brilliant';comment:string}
 | {type:'note';text:string}
 | {type:'metadata';yaml:string;sourceText:string}
 | {type:'remove'|'apply';id:string}
 | {type:'undo-input'|'redo-input'|'undo-apply'|'redo-apply'};
export type AppearanceSettings = {themeId:string; fontFamily:string; fontSize:number; uiFontFamily:string; uiFontSize:number; lineWidth:number};
export type BookChange =
 | {type:'rename';title:string}
 | {type:'create';path:string;title:string}
 | {type:'add';paths:string[]}
 | {type:'reorder';chapterIds:string[]}
 | {type:'remove'|'trash';chapterId:string};
export type ChapterDiscovery = {book:BookView;files:{path:string}[]; error?:string};
export type BookRefreshRequest =
 | { phase: 'prepare' | 'cancel'; bookId: string }
 | { phase: 'complete'; book: BookView };
export type WindowAction = 'minimize'|'toggle-maximize'|'close';
export type WindowState = {maximized:boolean;platform:NodeJS.Platform};
/** Read-only, non-sensitive build/runtime facts shown in the Diagnostics
 * panel. Exactly these fields plus `logging` — never a filesystem path,
 * never book content. main computes this; the renderer never invents it. */
export type DiagnosticInfo = {
  appVersion: string; build: string; platform: string; arch: string;
  electron: string; editor: string; themes: string;
  logging: 'ready' | 'unavailable';
};
export interface DeskApi {
  manageBook(bookId:string,change:BookChange):Promise<BookView>;
  discoverChapters(bookId:string):Promise<ChapterDiscovery>;
  onBookRefresh(listener:(request:BookRefreshRequest)=>Promise<void>):()=>void;
  onCloseRequest(listener:(closing:boolean)=>Promise<void>):()=>void;
  appearance():Promise<AppearanceSettings>;
  setAppearance(value:AppearanceSettings):Promise<void>;
  layout():Promise<LayoutSettings>;
  setLayout(value:LayoutSettings):Promise<void>;
  savePosition(bookId:string,chapterId:string,anchor:number,scrollTop:number):Promise<void>;
  chooseBook():Promise<BookView|null>;
  recent():Promise<Recent[]>;
  openRecent(path:string):Promise<BookView>;
  forgetRecent(path:string):Promise<void>;
  openChapter(bookId:string,chapterId:string):Promise<Snapshot>;
  command(bookId:string,chapterId:string,expectedRevision:number,command:Command):Promise<Snapshot>;
  closeBook(bookId:string):Promise<void>;
  /** main alone resolves the directory from the opaque id of an already-open
   * book (service.getBookRoot) and calls shell.openPath on it; no path
   * parameter exists to redirect this, extra renderer arguments are ignored. */
  openBookFolder(bookId:string):Promise<void>;
  openExternal(url:string):Promise<void>;
  onBookUpdate(listener:(update:ChapterDiscovery)=>void):()=>void;
  onSnapshot(listener:(snapshot:Snapshot)=>void):()=>void;
  resolveExternal(bookId:string,chapterId:string,choice:'open-external'|'export-local'):Promise<Snapshot>;
  windowState():Promise<WindowState>;
  windowAction(action:WindowAction):Promise<WindowState>;
  onWindowState(listener:(state:WindowState)=>void):()=>void;
  /** Fire-and-forget diagnostics report; main revalidates every field and
   * never trusts renderer-side sanitization. Rejections must be swallowed by
   * the caller (see renderer/diagnostics/report-error.ts). */
  reportDiagnostic(input:DiagnosticInput):Promise<void>;
  /** Read-only snapshot for the Diagnostics panel; main revalidates nothing
   * from the renderer here — there is no argument to tamper with. */
  diagnosticInfo():Promise<DiagnosticInfo>;
  /** main alone picks the logs directory (creating it first if missing) and
   * calls shell.openPath; no path parameter exists to redirect this. */
  openLogsFolder():Promise<void>;
  /** main alone composes the clipboard text from diagnosticInfo(); no book
   * text, comments or paths are ever part of it. */
  copyDiagnosticInfo():Promise<void>;
  /** Pushed by the main-process app menu's "Диагностика" item (macOS); the
   * renderer decides how/where to show the panel. */
  onOpenDiagnosticsRequest(listener:()=>void):()=>void;
}
