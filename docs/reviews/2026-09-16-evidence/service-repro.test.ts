import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { encodeReview, makeAnchor } from '@galley-desk/pocket-format';
import type { Edit, Review, Signal } from '@galley-desk/pocket-format';
import { createBookService } from './book-service';
import { IpcError } from './ipc';
import type { Snapshot } from '../shared/api';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Harness = ReturnType<typeof createBookService> & {
  bookRoot: string;
  appData: string;
  setPicker: (value: string | null) => void;
  setExportPicker: (value: string | null) => void;
  fireWatcher: () => void;
};

async function makeService(bookFiles: Record<string, string> = {}): Promise<Harness> {
  const bookRoot = await tempDir('galley-book-');
  for (const [name, content] of Object.entries(bookFiles)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const appData = await tempDir('galley-appdata-');
  let picked: string | null = bookRoot;
  let exportPicked: string | null = null;
  // Наблюдатель подменяется ручным триггером: тест сам решает, когда корень
  // «изменился», и не держит открытых файловых дескрипторов.
  const watcherEvents = new Map<string, () => void>();
  const service = createBookService({
    appData,
    chooseDirectory: async () => picked,
    chooseExportDestination: async () => exportPicked,
    watchRoot: (root, onEvent) => {
      watcherEvents.set(root, onEvent);
      return () => watcherEvents.delete(root);
    },
  });
  return Object.assign(service, {
    bookRoot,
    appData,
    setPicker(value: string | null) {
      picked = value;
    },
    setExportPicker(value: string | null) {
      exportPicked = value;
    },
    fireWatcher() {
      watcherEvents.get(bookRoot)?.();
    },
  }) as Harness;
}


import { readdir } from 'node:fs/promises';
import { openBook, readPair, writePair, recoverBook } from '@galley-desk/book-storage';
import { writePairImpl } from '../../../../packages/book-storage/src/book';
import { readJournalsForRoot } from '../../../../packages/book-storage/src/journal';
test('audit: failed close retains session and recoverable draft', async () => {
 const h=await makeService({'01.md':'cat'}); const v=(await h.chooseBook())!; const c=v.entries[0]!.id;
 const s=await h.openChapter(v.bookId,c);
 await rename(h.appData,h.appData+'-moved'); tempDirs.push(h.appData+'-moved'); await writeFile(h.appData,'blocked');
 await expect(h.command(v.bookId,c,s.revision,{type:'text',changes:[{from:0,to:3,insert:'dog'}],selection:{anchor:3,head:3}})).rejects.toThrow();
 await expect(h.closeBook(v.bookId)).rejects.toThrow();
 console.log('audit failed close:',{root:h.getBookRoot(v.bookId),appData:await readdir(h.appData+'-moved',{recursive:true})});
 expect(h.getBookRoot(v.bookId)).toBe(h.bookRoot);
});
test('audit: changing a signal preserves id', async()=>{
 const h=await makeService({'01.md':'cat'}); const v=(await h.chooseBook())!; const c=v.entries[0]!.id;
 const s=await h.openChapter(v.bookId,c);
 const a=await h.command(v.bookId,c,s.revision,{type:'signal',from:0,to:3,signalType:'note',comment:'first'});
 const old=a.records[0]!.id;
 const b=await h.command(v.bookId,c,a.revision,{type:'signal',id:old,from:0,to:3,signalType:'warning',comment:'second'});
 expect(b.records[0]!.id).toBe(old);
});
test('audit: missing manifest with existing sidecar must not create new identity',async()=>{
 const h=await makeService({'01.md':'cat','01.review.json':encodeReview({schema_version:1,chapter_id:'00000001-1111-4111-8111-111111111111',source_path:'01.md',chapter_note:'kept note',edits:[],signals:[]})});
 await expect(openBook(h.bookRoot)).rejects.toThrow();
});
test('audit: unresolved third revision must block new writes and preserve journal',async()=>{
 const h=await makeService({'01.md':'cat'}); const book=await openBook(h.bookRoot); const c=book.manifest.chapters[0]!.id;
 const {pair,revision}=await readPair(book,c);
 await expect(writePairImpl(book,c,revision,{...pair,source:new TextEncoder().encode('dog')},h.appData,step=>{if(step==='prepared')throw Error('crash')})).rejects.toThrow();
 await writeFile(path.join(h.bookRoot,'01.md'),'fox');
 expect(await recoverBook(book,h.appData)).toBe('external-change');
 const v=(await h.chooseBook())!; const s=await h.openChapter(v.bookId,c);
 const result=await h.command(v.bookId,c,s.revision,{type:'note',text:'new note'}).then(()=> 'accepted',()=> 'blocked');
 console.log('audit recovery:',{result,journals:(await readJournalsForRoot(h.appData,h.bookRoot)).length});
 expect(result).toBe('blocked');
});
