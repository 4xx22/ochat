/* Plays verified local videos inside their file card. Bytes are loaded only after a click. */
(() => {
  const VIDEO_NAME=/\.(mp4|m4v|mov|webm|ogv)$/i,JUMP_SECONDS=10,KEY_SECONDS=5,IDLE_MS=2500;
  const ICONS={
    play:'M8 5v14l11-7z',
    pause:'M6 5h4v14H6zm8 0h4v14h-4z',
    volume:'M4 9v6h4l5 4V5L8 9H4zm12 .5v5a3.5 3.5 0 0 0 0-5zM16 5.3v2.1a7 7 0 0 1 0 9.2v2.1a9 9 0 0 0 0-13.4z',
    muted:'M4 9v6h4l5 4V5L8 9H4zm11.5.4 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1z',
    fullscreen:'M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 3v-3h2v5h-5v-2z'
  };
  let api=null,epoch=0,active=null,volume=1,muted=false;
  const sources=new WeakMap();

  function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;}
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',ICONS[name]);svg.append(path);return svg;}
  function setIcon(button,name,label){button.replaceChildren(icon(name));button.title=label;button.setAttribute('aria-label',label);}
  function iconButton(name,label,run){const button=node('button','chat-video-button');button.type='button';setIcon(button,name,label);button.onclick=event=>{event.stopPropagation();run();};return button;}
  function textButton(text,label,run){const button=node('button','chat-video-button chat-video-jump',text);button.type='button';button.title=label;button.setAttribute('aria-label',label);button.onclick=event=>{event.stopPropagation();run();};return button;}
  function range(className,label,max,step){const input=node('input','chat-video-range '+className);input.type='range';input.min='0';input.max=String(max);input.step=String(step);input.value='0';input.setAttribute('aria-label',label);return input;}
  function fill(input){input.style.setProperty('--fill',(Number(input.value)/Number(input.max||1))*100+'%');}
  function clock(seconds){if(!Number.isFinite(seconds)||seconds<0)return '0:00';const whole=Math.floor(seconds),hours=Math.floor(whole/3600),minutes=Math.floor(whole/60)%60,rest=String(whole%60).padStart(2,'0');return hours?`${hours}:${String(minutes).padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;}

  function unload(player){
    player.load++;if(active===player)active=null;
    if(window.OchatFullscreen?.active()&&player.root.classList.contains('ochat-fullscreen'))window.OchatFullscreen.exit().catch(()=>{});
    clearTimeout(player.idle);player.video.pause();player.video.removeAttribute('src');player.video.load();
    if(player.url){URL.revokeObjectURL(player.url);player.url='';}
    player.root.classList.remove('chat-video-idle');player.root.style.removeProperty('aspect-ratio');
  }
  function show(player,state,message=''){player.root.dataset.state=state;player.status.textContent=message;player.status.hidden=!message;}
  function fail(player,message,retry=true){unload(player);show(player,'error',message);player.start.hidden=!retry;}
  function releaseDetached(){if(active&&!active.root.isConnected)unload(active);}

  async function start(player){
    if(active&&active!==player){const previous=active;unload(previous);show(previous,'idle');}
    const run=++player.load,session=epoch,alive=()=>run===player.load&&session===epoch&&player.root.isConnected;
    active=player;show(player,'loading','Loading video…');player.start.hidden=true;
    try{
      const info=await api.invoke('chat_video_info',player.scope);
      if(!alive())return;
      if(!info)return fail(player,'This video is no longer available on this device.',false);
      if(info.too_large)return fail(player,'This video is too large to play in chat. Open the saved file instead.',false);
      const parts=[];let offset=0;
      while(offset<info.size){
        // Tauri delivers an ArrayBuffer or, over Linux's fallback IPC, a plain number array.
        const chunk=new Uint8Array(await api.invoke('chat_video_chunk',{...player.scope,offset}));
        if(!alive())return;
        if(!chunk.length)throw Error('The video ended unexpectedly.');
        parts.push(new Blob([chunk]));offset+=chunk.length;
        show(player,'loading',`Loading video… ${Math.floor(offset*100/info.size)}%`);
      }
      player.url=URL.createObjectURL(new Blob(parts,{type:info.mime}));
      player.video.src=player.url;player.video.volume=volume;player.video.muted=muted;
      show(player,'ready');paint(player);
      // A long load can outlive the click's activation: stay ready and let the user press play.
      await player.video.play().catch(()=>{});
      if(alive())player.root.focus({preventScroll:true});
    }catch(error){if(alive())fail(player,String(error?.message||error));}
  }

  function paint(player){
    const {video,seek,clockLabel,toggle,mute,loudness}=player,duration=Number.isFinite(video.duration)?video.duration:0;
    if(!player.dragging){seek.value=String(duration?Math.round(video.currentTime/duration*1000):0);fill(seek);}
    clockLabel.textContent=`${clock(video.currentTime)} / ${clock(duration)}`;
    seek.setAttribute('aria-valuetext',clock(video.currentTime));
    setIcon(toggle,video.paused?'play':'pause',video.paused?'Play':'Pause');
    setIcon(mute,video.muted||!video.volume?'muted':'volume',video.muted?'Unmute':'Mute');
    loudness.value=String(video.muted?0:video.volume);fill(loudness);
  }
  function jump(player,seconds){const {video}=player,limit=Number.isFinite(video.duration)?video.duration:video.currentTime+Math.max(seconds,0);video.currentTime=Math.min(limit,Math.max(0,video.currentTime+seconds));paint(player);}
  function playOrPause(player){if(player.video.paused)player.video.play().catch(error=>api.toast(error));else player.video.pause();}
  function setVolume(player,value){volume=Math.min(1,Math.max(0,value));muted=volume===0;player.video.volume=volume;player.video.muted=muted;paint(player);}
  function toggleMute(player){muted=!player.video.muted;if(!muted&&!player.video.volume){volume=.5;player.video.volume=volume;}player.video.muted=muted;paint(player);}
  async function toggleFullscreen(player){try{await window.OchatFullscreen.toggle(player.root);player.root.focus({preventScroll:true});}catch(error){api.toast(error);}}
  function wake(player){
    player.root.classList.remove('chat-video-idle');clearTimeout(player.idle);
    if(!player.video.paused)player.idle=setTimeout(()=>{if(!player.root.matches(':hover')||player.root.classList.contains('ochat-fullscreen'))player.root.classList.add('chat-video-idle');},IDLE_MS);
  }
  function onKey(player,event){
    if(player.root.dataset.state!=='ready'||event.ctrlKey||event.metaKey||event.altKey)return;
    const onSlider=event.target.matches?.('input[type=range]'),onButton=event.target.closest?.('button'),key=event.key.toLowerCase();
    if((key===' '&&!onButton)||key==='k')playOrPause(player);
    else if(key==='m')toggleMute(player);
    else if(key==='f')toggleFullscreen(player);
    else if(key==='arrowleft'&&!onSlider)jump(player,-KEY_SECONDS);
    else if(key==='arrowright'&&!onSlider)jump(player,KEY_SECONDS);
    else if(key==='arrowup'&&!onSlider)setVolume(player,player.video.volume+.1);
    else if(key==='arrowdown'&&!onSlider)setVolume(player,player.video.volume-.1);
    else return;
    event.preventDefault();event.stopPropagation();wake(player);
  }

  function create(card,source){
    const root=node('div','chat-video'),video=node('video'),begin=iconButton('play','Play video',()=>start(player)),status=node('div','chat-video-status'),controls=node('div','chat-video-controls');
    root.tabIndex=0;root.setAttribute('role','group');root.setAttribute('aria-label','Video player: '+source.name);
    begin.classList.add('chat-video-start');status.hidden=true;status.setAttribute('role','status');video.playsInline=true;video.preload='auto';video.disablePictureInPicture=true;
    const seek=range('chat-video-seek','Seek',1000,1),clockLabel=node('span','chat-video-clock','0:00 / 0:00'),loudness=range('chat-video-volume','Volume',1,.01);
    const toggle=iconButton('play','Play',()=>playOrPause(player)),back=textButton('−10',`Back ${JUMP_SECONDS} seconds`,()=>jump(player,-JUMP_SECONDS)),forward=textButton('+10',`Forward ${JUMP_SECONDS} seconds`,()=>jump(player,JUMP_SECONDS)),mute=iconButton('volume','Mute',()=>toggleMute(player)),expand=iconButton('fullscreen','Fullscreen',()=>toggleFullscreen(player));
    const player={root,video,start:begin,status,seek,clockLabel,toggle,mute,loudness,scope:{room:source.room,peer:source.peer,id:source.id},load:0,url:'',dragging:false,idle:0};
    seek.oninput=()=>{player.dragging=true;fill(seek);const duration=video.duration;if(Number.isFinite(duration)){clockLabel.textContent=`${clock(Number(seek.value)/1000*duration)} / ${clock(duration)}`;}};
    seek.onchange=()=>{player.dragging=false;if(Number.isFinite(video.duration))video.currentTime=Number(seek.value)/1000*video.duration;paint(player);};
    loudness.oninput=()=>setVolume(player,Number(loudness.value));
    const right=node('div','chat-video-right');right.append(mute,loudness,expand);
    controls.append(toggle,back,forward,seek,clockLabel,right);controls.onclick=event=>event.stopPropagation();controls.ondblclick=event=>event.stopPropagation();
    root.append(video,status,begin,controls);
    video.onclick=()=>{if(root.dataset.state==='ready')playOrPause(player);};
    video.ondblclick=()=>{if(root.dataset.state==='ready')toggleFullscreen(player);};
    video.onloadedmetadata=()=>{if(video.videoWidth&&video.videoHeight)root.style.aspectRatio=String(Math.min(2.4,Math.max(.8,video.videoWidth/video.videoHeight)));paint(player);window.OchatTimeline?.settle?.();};
    video.ontimeupdate=()=>{if(!root.isConnected){unload(player);return;}paint(player);};
    video.ondurationchange=()=>paint(player);
    video.onplay=()=>{paint(player);wake(player);};
    video.onpause=()=>{paint(player);wake(player);};
    video.onended=()=>{paint(player);wake(player);};
    video.onerror=()=>{if(video.getAttribute('src'))fail(player,'This device cannot play this video format. Open the saved file in a video player instead.',false);};
    root.onpointermove=()=>wake(player);
    root.onfocusin=()=>wake(player);
    root.addEventListener('keydown',event=>onKey(player,event));
    show(player,'idle');
    card.querySelector('.file-progress').before(root);card.classList.add('has-video');window.OchatTimeline?.settle?.();
  }

  function insert(card){const source=sources.get(card);if(source&&card.isConnected&&!card.querySelector('.chat-video'))create(card,source);}
  function attach(card,source){
    if(!api||!VIDEO_NAME.test(source.name||''))return;
    releaseDetached();sources.set(card,source);
    const session=epoch;
    api.invoke('chat_video_info',{room:source.room,peer:source.peer,id:source.id}).then(info=>{if(info&&session===epoch)insert(card);},()=>{});
  }
  function reset(){epoch++;if(active)unload(active);active=null;volume=1;muted=false;}
  window.OchatChatVideo=Object.freeze({init(callbacks){api=callbacks;},attach,received:insert,reset});
})();
