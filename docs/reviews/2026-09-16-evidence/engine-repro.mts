import { makeAnchor, classifyReview } from '/home/inky/Development/galley-desk/packages/pocket-format/src/index.ts';
import { openChapter, applyEdit, changeText } from '/home/inky/Development/galley-desk/packages/review-engine/src/index.ts';
const encode=(s:string)=>new TextEncoder().encode(s);
const id=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const review=(edits:any[]=[],signals:any[]=[])=>({schema_version:1 as const,chapter_id:id(1),source_path:'01.md',chapter_note:'',edits,signals});
{
 const source=encode('кот'); const anchor=makeAnchor(source,{from:0,to:6});
 const m=openChapter(source,review([{id:id(2),before:'кот',after:'кит',anchor}],[{id:id(3),type:'note',selected_text:'кот',comment:'Keep me',anchor}]));
 console.log('signal-after-apply',applyEdit(m,id(2)).review.signals.length,'expected 1');
}
{
 const source=encode('aa bb');
 const m=openChapter(source,review([{id:id(2),before:'aa',after:'X',anchor:makeAnchor(source,{from:0,to:2})},{id:id(3),before:'bb',after:'aa',anchor:makeAnchor(source,{from:3,to:5})}]));
 const next=applyEdit(m,id(3)); const state=classifyReview(next.source,next.review);
 console.log('preceding-edit-after-apply',{text:next.text,active:[...state.edits.keys()],unavailable:[...state.unavailable.keys()]},'expected text X aa and earlier active');
}
