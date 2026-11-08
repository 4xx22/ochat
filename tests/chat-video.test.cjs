const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(t,{info={size:6,mime:'video/mp4',too_large:false},chunks=[new Uint8Array([1,2,3,4]).buffer,[5,6]]}={}){
 const {Window}=await import('happy-dom');const w=new Window({url:'http://tauri.localhost',settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 w.document.body.innerHTML='<div id="host"><div class="file-card"><strong>clip.mp4</strong><div class="file-progress"></div></div></div>';
 const calls=[],blobs=[],revoked=[],toasts=[];let next=0;
 w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:video-'+blobs.length;};w.URL.revokeObjectURL=url=>revoked.push(url);
 w.HTMLMediaElement.prototype.load=function(){};w.HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new w.Event('pause'));};
 w.HTMLMediaElement.prototype.play=async function(){this.__paused=false;this.dispatchEvent(new w.Event('play'));};
 Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{configurable:true,get(){return this.__paused!==false;}});
 Object.defineProperty(w.HTMLMediaElement.prototype,'duration',{configurable:true,get(){return this.__duration??100;}});
 const fullscreen=[];w.OchatFullscreen={active:()=>false,exit:async()=>{},toggle:async target=>fullscreen.push(target)};
 w.eval(fs.readFileSync('ui/chat-video.js','utf8'));
 const invoke=async(command,args)=>{calls.push([command,args]);if(command==='chat_video_info')return info;if(command==='chat_video_chunk')return chunks[next++];throw Error('Unexpected '+command);};
 w.OchatChatVideo.init({invoke,toast:message=>toasts.push(String(message))});
 const card=w.document.querySelector('.file-card'),source={room:'room-a',peer:'peer-a',id:'file-a',name:'clip.mp4'};
 return {w,card,source,calls,blobs,revoked,toasts,fullscreen,player:()=>card.querySelector('.chat-video'),video:()=>card.querySelector('video')};
}
const click=(s,selector)=>s.card.querySelector(selector).dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));
async function started(s){s.w.OchatChatVideo.attach(s.card,s.source);await tick();click(s,'.chat-video-start');for(let i=0;i<6;i++)await tick();}

test('a video file gains a player and loads nothing until the user presses play',async t=>{
 const s=await setup(t);s.w.OchatChatVideo.attach(s.card,s.source);await tick();
 assert.ok(s.player());assert.equal(s.player().dataset.state,'idle');assert.ok(s.card.classList.contains('has-video'));
 assert.deepEqual(s.calls.map(c=>c[0]),['chat_video_info']);assert.equal(s.blobs.length,0);
 assert.equal(s.card.querySelector('.chat-video').nextElementSibling,s.card.querySelector('.file-progress'));
});
test('other files and offers the backend cannot play stay plain file cards',async t=>{
 const other=await setup(t);other.w.OchatChatVideo.attach(other.card,{...other.source,name:'notes.pdf'});await tick();assert.equal(other.player(),null);assert.equal(other.calls.length,0);
 const missing=await setup(t,{info:null});missing.w.OchatChatVideo.attach(missing.card,missing.source);await tick();assert.equal(missing.player(),null);
});
test('a finished download shows the player without waiting for the saved path',async t=>{
 const s=await setup(t,{info:null});s.w.OchatChatVideo.attach(s.card,s.source);await tick();assert.equal(s.player(),null);
 s.w.OchatChatVideo.received(s.card);assert.ok(s.player());s.w.OchatChatVideo.received(s.card);assert.equal(s.card.querySelectorAll('.chat-video').length,1);
});
test('pressing play assembles every chunk into one typed blob and accepts each IPC binary shape',async t=>{
 const s=await setup(t);await started(s);
 assert.deepEqual(s.calls.filter(c=>c[0]==='chat_video_chunk').map(c=>c[1].offset),[0,4]);
 assert.deepEqual({...s.calls.at(-1)[1]},{room:'room-a',peer:'peer-a',id:'file-a',offset:4});
 assert.equal(s.blobs.length,1);assert.equal(s.blobs[0].type,'video/mp4');assert.equal(s.blobs[0].size,6);
 assert.equal(s.video().getAttribute('src'),'blob:video-1');assert.equal(s.player().dataset.state,'ready');assert.equal(s.video().paused,false);
});
test('the controls drive playback, seeking, volume and fullscreen',async t=>{
 const s=await setup(t);await started(s);const video=s.video();
 click(s,'.chat-video-controls .chat-video-button');assert.equal(video.paused,true);
 video.currentTime=50;click(s,'.chat-video-jump:nth-of-type(2)');assert.equal(video.currentTime,40);
 video.currentTime=95;click(s,'.chat-video-jump:nth-of-type(3)');assert.equal(video.currentTime,100);
 const seek=s.card.querySelector('.chat-video-seek');seek.value='250';seek.dispatchEvent(new s.w.Event('input'));seek.dispatchEvent(new s.w.Event('change'));assert.equal(video.currentTime,25);
 const volume=s.card.querySelector('.chat-video-volume');volume.value='0.25';volume.dispatchEvent(new s.w.Event('input'));assert.equal(video.volume,.25);
 click(s,'.chat-video-right .chat-video-button');assert.equal(video.muted,true);
 click(s,'.chat-video-right .chat-video-button:last-child');await tick();assert.deepEqual(s.fullscreen,[s.player()]);
});
test('keyboard shortcuts stay inside the focused player and leave sliders alone',async t=>{
 const s=await setup(t);await started(s);let escaped=0;s.w.document.body.addEventListener('keydown',()=>escaped++);const video=s.video(),press=(target,key)=>target.dispatchEvent(new s.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 video.currentTime=50;press(s.player(),'ArrowLeft');assert.equal(video.currentTime,45);press(s.player(),'k');assert.equal(video.paused,true);press(s.player(),'m');assert.equal(video.muted,true);assert.equal(escaped,0);
 press(s.card.querySelector('.chat-video-seek'),'ArrowLeft');assert.equal(video.currentTime,45);assert.equal(escaped,1);
 press(s.player(),'x');assert.equal(escaped,2);
});
test('only one video stays loaded and a detached player releases its memory',async t=>{
 const s=await setup(t,{chunks:[[1,2,3,4,5,6],[1,2,3,4,5,6]]});await started(s);
 const second=s.card.cloneNode(false);second.innerHTML='<div class="file-progress"></div>';s.card.parentElement.append(second);s.w.OchatChatVideo.attach(second,{...s.source,id:'file-b'});await tick();
 second.querySelector('.chat-video-start').dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();
 assert.deepEqual(s.revoked,['blob:video-1']);assert.equal(s.player().dataset.state,'idle');assert.equal(s.video().getAttribute('src'),null);assert.equal(second.querySelector('.chat-video').dataset.state,'ready');
 second.remove();second.querySelector('video').dispatchEvent(new s.w.Event('timeupdate'));assert.deepEqual(s.revoked,['blob:video-1','blob:video-2']);
});
test('removing a card while loading abandons the remaining chunks',async t=>{
 const s=await setup(t);s.w.OchatChatVideo.attach(s.card,s.source);await tick();click(s,'.chat-video-start');s.card.remove();for(let i=0;i<6;i++)await tick();
 assert.equal(s.calls.filter(c=>c[0]==='chat_video_chunk').length,0);assert.equal(s.blobs.length,0);
});
test('locking the account stops playback and frees the blob',async t=>{
 const s=await setup(t);await started(s);s.w.OchatChatVideo.reset();assert.deepEqual(s.revoked,['blob:video-1']);assert.equal(s.video().paused,true);assert.equal(s.video().getAttribute('src'),null);
});
test('oversized and unreadable videos explain why and never reach the player',async t=>{
 const big=await setup(t,{info:{size:9e9,mime:'video/mp4',too_large:true}});await started(big);assert.equal(big.player().dataset.state,'error');assert.match(big.card.querySelector('.chat-video-status').textContent,/too large/);assert.ok(!big.calls.some(c=>c[0]==='chat_video_chunk'));assert.equal(big.card.querySelector('.chat-video-start').hidden,true);
 const bad=await setup(t);await started(bad);bad.video().dispatchEvent(new bad.w.Event('error'));assert.equal(bad.player().dataset.state,'error');assert.match(bad.card.querySelector('.chat-video-status').textContent,/cannot play/);assert.deepEqual(bad.revoked,['blob:video-1']);
});
