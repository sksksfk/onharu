/* Onharu Web Push. Device credentials stay in this browser and are excluded from backups. */
(()=>{
 'use strict';
 const API='https://onharu-push.sportsn.workers.dev';
 const STORE='onharu-push-v1',ZONE='Asia/Seoul';
 const LIVE=location.origin==='https://sksksfk.github.io'&&location.pathname.startsWith('/onharu/');
 const capable=LIVE&&isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
 const initial=()=>({version:1,id:'',token:'',connected:false,pending:false,signature:'',lastSync:'',testRequested:'',testConfirmed:'',received:'',deletePending:false});
 let record=initial(),storageOK=true,ready=false,busy=false,reg=null,hasSubscription=false,installPrompt=null,statusMessage='',syncTimer=null,config=null,syncing=false;
 try{const value=localStorage.getItem(STORE);if(value){const v=JSON.parse(value);if(v.version===1&&/^[A-Za-z0-9_-]{22}$/.test(v.id)&&/^[A-Za-z0-9_-]{43}$/.test(v.token))record={...initial(),...v};}}catch{storageOK=false;}
 function persist(){try{localStorage.setItem(STORE,JSON.stringify(record));storageOK=true;return true;}catch{storageOK=false;statusMessage='알림 연결 정보를 이 기기에 저장하지 못했어요. 브라우저 저장공간을 확인해 주세요.';return false;}}
 function refresh(){if(typeof render==='function')render();}
 function bytesToBase64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
 function fromBase64(value){const str=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));return Uint8Array.from(str,c=>c.charCodeAt(0));}
 function times(){const values=[...new Set(activeMeds().map(m=>m.time))].sort();if(values.length>32||values.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new Error('invalid-times');return values;}
 function signature(){return JSON.stringify(times());}
 function connected(){return record.connected&&hasSubscription&&Notification.permission==='granted'&&!record.deletePending;}
 function safeError(error){if(error?.name==='NotAllowedError')return '알림 권한이 허용되지 않았어요. Chrome의 사이트 설정에서 온하루 알림을 허용해 주세요.';if(error?.message==='invalid-times')return '알림은 서로 다른 시각 32개까지 지원해요. 등록한 약 시간을 확인해 주세요.';if(error?.message==='storage')return '알림 연결 정보를 저장할 수 없어요. 시크릿 모드와 저장공간을 확인해 주세요.';if(error?.status===401)return '알림 연결을 다시 확인해야 해요. 연결을 해제한 뒤 다시 켜 주세요.';if(error?.status===409)return '이 기기의 기존 연결이 있거나 서버 연결 수가 가득 찼어요. 연결을 해제하고 다시 시도해 주세요.';if(error?.status===429)return '요청이 잠시 많아요. 1분 뒤에 다시 시도해 주세요.';return '알림 서버에 연결하지 못했어요. 인터넷을 확인한 뒤 다시 연결해 주세요.';}
 async function request(path,{method='GET',body,auth=false}={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(auth)headers.Authorization='Bearer '+record.token;
   const response=await fetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});
   let result={};try{result=await response.json();}catch{}
   if(!response.ok){const error=new Error('server');error.status=response.status;error.expired=result.expired===true;throw error;}return result;
  }finally{clearTimeout(timeout);}
 }
 function panel(){
  const permitted=capable&&Notification.permission==='granted';const isOn=capable&&connected();
  let label=!capable?'이 기기에서 연결 확인 필요':!ready?'알림 기능 준비 중':isOn?(record.pending?'시간 변경 반영 대기':'서버 알림 연결됨'):'서버 알림 꺼짐';
  if(record.deletePending)label='서버 연결 삭제 대기';
  const count=(()=>{try{return times().length;}catch{return 0;}})();
  const text=!LIVE?'화면을 닫은 뒤 알림은 배포된 온하루 주소에서 연결해 주세요.':!capable?'갤럭시의 Chrome에서 온하루를 열어주세요. 이 브라우저는 웹 푸시를 지원하지 않아요.':isOn?(record.pending?'변경한 약 시간을 아직 서버에 반영하지 못했어요. 예전 시각에 안내가 올 수 있으니 다시 반영해 주세요.':count?`한국 시간 기준, 매일 ${count}개 시각에 안내를 보냅니다.`:'연결은 됐지만 약 시간이 없어요. 약을 등록하면 알림 시간을 반영합니다.'):'처음 한 번 이 휴대폰에서 연결하고 알림을 허용해 주세요.';
  return `<section class="card text-block push-panel" aria-labelledby="pushTitle"><h2 class="label" id="pushTitle">${icon('clock')}화면을 닫아도 약 알림</h2><p><span class="status ${isOn&&!record.pending?'':'pending'}">${esc(label)}</span></p><p>${esc(text)}</p>${statusMessage?`<div class="notice" role="status">${esc(statusMessage)}</div>`:''}<div class="push-buttons" style="display:grid;gap:10px;margin:18px 0">${!isOn?`<button class="primary" data-action="enablePush" ${!capable||!ready||busy?'disabled':''}>이 휴대폰 알림 켜기</button>`:`<button class="secondary" data-action="syncPush" ${busy?'disabled':''}>${record.pending?'변경한 시간 다시 반영':'알림 시간 다시 확인'}</button><button class="primary" data-action="pushTest" ${busy?'disabled':''}>화면 닫고 시험 알림 받기</button>${record.testRequested?`<button class="secondary" data-action="confirmPushTest" ${busy?'disabled':''}>이 휴대폰에서 시험 알림을 받았어요</button>`:''}`}${record.id||hasSubscription?`<button class="link-btn" data-action="disablePush" ${busy?'disabled':''}>이 휴대폰 알림 연결 해제</button>`:''}<button class="secondary" data-action="installApp" ${busy?'disabled':''}>홈 화면에 온하루 추가</button><button class="link-btn" data-action="pushHelp">갤럭시 알림 설정 도움말</button></div>${record.testConfirmed?`<p class="note">직접 확인한 시험 수신: ${esc(new Date(record.testConfirmed).toLocaleString('ko-KR'))}</p>`:''}${record.received&&!record.testConfirmed?'<p class="note">브라우저가 시험 알림을 처리했어요. 휴대폰 알림창에도 표시되는지 확인해 주세요.</p>':''}<div class="notice"><strong>중요한 약은 휴대폰 기본 알람도 함께 설정해 주세요.</strong><br>인터넷·알림 허용이 필요합니다. 절전, 방해 금지, 브라우저 강제 종료, 서버 장애에 따라 늦거나 오지 않을 수 있어요. 소리와 진동은 휴대폰 설정을 따릅니다.</div><details><summary>서버에 저장하는 정보 보기</summary><p class="note">알림을 켜면 약의 시각(한국 시간)과 이 브라우저의 푸시 발송 정보를 Cloudflare 서버에 저장합니다. 약 이름·복용량·먹은 기록·연락처·사진은 보내지 않아요. 잠금화면에도 약 이름은 표시하지 않습니다. 연결 해제는 이 기기의 서버 정보를 삭제합니다. 이미 발송된 알림은 취소되지 않을 수 있어요. Cloudflare의 서비스 운영 정보는 해당 서비스의 개인정보 처리 정책을 따릅니다.</p></details><details><summary>화면이 켜져 있을 때만 안내</summary><p class="note">서버 알림과 별도인 보조 기능이에요. 중복 안내를 피하려면 한 가지만 사용해 주세요.</p><label class="check-field"><input type="checkbox" id="reminderToggle" ${state.reminders?'checked':''}>화면 안에서만 약 시간 안내</label><label class="check-field"><input type="checkbox" id="speakToggle" ${state.speakReminders?'checked':''}>화면 안 안내를 음성으로 듣기</label><button class="secondary" data-action="testReminder">화면 안 안내 시험</button></details></section>`;
 }
 function hint(){if(!capable)return '화면을 닫은 뒤 알림은 ‘약 관리’에서 연결해 주세요.';if(record.deletePending)return '서버 알림 삭제가 아직 반영되지 않았어요. 약 관리에서 확인해 주세요.';if(connected()){if(record.pending)return '알림 시간 변경을 반영하지 못했어요. 약 관리에서 다시 반영해 주세요.';return '서버 알림이 연결됐어요. 인터넷과 휴대폰 알림 허용이 필요해요.';}return '화면을 닫아도 알림을 받으려면 ‘약 관리’에서 알림을 켜 주세요.';}
 function onDataSave(){if(!record.id||!record.connected||record.deletePending)return;if(storageFailed){record.pending=true;statusMessage='약 정보를 기기에 저장하지 못해 서버 시간을 바꾸지 않았어요. 예전 시각에 알림이 올 수 있으니 저장공간을 확인해 주세요.';persist();return;}try{if(signature()===record.signature&&!record.pending)return;record.pending=true;record.testConfirmed='';persist();clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(()=>{}),700);}catch(error){statusMessage=safeError(error);record.pending=true;persist();}}
 async function sync(){if(!record.connected||record.deletePending)return false;if(storageFailed){statusMessage='먼저 약 정보를 기기에 정상적으로 저장해 주세요. 서버에는 예전 알림 시각이 남아 있을 수 있어요.';record.pending=true;persist();refresh();return false;}if(syncing||busy){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(()=>{}),800);return false;}syncing=true;record.pending=true;persist();let succeeded=false;
  try{const currentTimes=times();await request('/v1/devices/'+record.id,{method:'PUT',auth:true,body:{times:currentTimes,timeZone:ZONE}});record.signature=JSON.stringify(currentTimes);record.pending=false;record.lastSync=new Date().toISOString();statusMessage='현재 등록한 약 시간을 서버에 반영했어요.';succeeded=true;persist();return true;}
  catch(error){statusMessage=safeError(error);record.pending=true;persist();return false;}
  finally{syncing=false;if(succeeded){try{if(signature()!==record.signature){record.pending=true;persist();clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync().catch(()=>{}),150);}}catch{record.pending=true;persist();}}refresh();}
 }
 async function enable(){
  if(busy||!capable||!ready)return;
  if(storageFailed){notify('약 정보 저장 오류를 먼저 해결해 주세요. 서버 알림은 아직 켜지지 않았어요.');return;}
  if(record.deletePending){notify('먼저 연결 해제를 완료해 주세요.');return;}
  const permissionPromise=Notification.requestPermission(); // Must start inside the user's tap.
  busy=true;statusMessage='';refresh();
  try{const permission=await permissionPromise;if(permission!=='granted'){statusMessage='알림이 허용되지 않았어요. Chrome의 온하루 사이트 설정에서 알림을 허용해 주세요.';return;}
   const currentTimes=times();config=config||await request('/v1/config');let sub=await reg.pushManager.getSubscription();
   if(record.connected&&sub){hasSubscription=true;busy=false;await sync();return;}
   if(!record.id){record.id=bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));record.token=bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));record.pending=true;}
   if(!persist())throw new Error('storage');
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:fromBase64(config.publicKey)});
   hasSubscription=true;
   await request('/v1/devices',{method:'POST',body:{id:record.id,token:record.token,subscription:sub.toJSON(),times:currentTimes,timeZone:ZONE}});
   record.connected=true;record.pending=true;if(!persist())throw new Error('storage');
   // Idempotent registration deliberately cannot overwrite a newer schedule: PUT is authoritative.
   await request('/v1/devices/'+record.id,{method:'PUT',auth:true,body:{times:currentTimes,timeZone:ZONE}});
   record.signature=JSON.stringify(currentTimes);record.pending=false;record.lastSync=new Date().toISOString();record.testConfirmed='';persist();
   state.reminders=false;save();statusMessage='서버 알림을 연결했어요. 다음으로 화면을 닫고 시험 알림을 받아보세요.';
  }catch(error){statusMessage=safeError(error);if(record.id){record.pending=true;persist();}}
  finally{busy=false;refresh();}
 }
 async function disable(silent=false){
  if(busy)return false;busy=true;clearTimeout(syncTimer);statusMessage='';refresh();let deleted=!record.id,unsubscribed=false;
  try{if(record.id){try{await request('/v1/devices/'+record.id,{method:'DELETE',auth:true});deleted=true;}catch(error){statusMessage=safeError(error);}}
   try{const sub=reg?await reg.pushManager.getSubscription():null;unsubscribed=!sub||await sub.unsubscribe();hasSubscription=!!sub&&!unsubscribed;}catch{}
   if(deleted&&unsubscribed){record=initial();localStorage.removeItem(STORE);statusMessage='이 휴대폰의 서버 알림 연결을 해제했어요.';return true;}
   record.connected=false;record.deletePending=!deleted;persist();statusMessage=!deleted?'기기 알림 해제와 별도로 서버 정보 삭제를 확인하지 못했어요. 인터넷을 연결한 뒤 ‘연결 해제’를 다시 눌러주세요.':'서버 발송은 해제했지만 브라우저 연결이 남아 있어요. 휴대폰의 사이트 알림 설정도 확인해 주세요.';return false;
  }finally{busy=false;if(!silent)refresh();}
 }
 async function delayedTest(){if(busy||!connected())return;busy=true;statusMessage='';refresh();
  try{const result=await request('/v1/devices/'+record.id+'/test',{method:'POST',auth:true,body:{delaySeconds:60}});if(result.accepted!==true||!result.scheduledAt)throw new Error('not-queued');record.testRequested=new Date().toISOString();record.testConfirmed='';record.received='';persist();statusMessage='시험 알림을 예약했어요. 지금 화면을 닫아주세요. 약 1~2분 뒤 알림창에서 확인해 주세요.';showDialog('지금 온하루 화면을 닫아주세요',`<p>약 1~2분 뒤 시험 알림을 보냅니다.</p><ol class="bullet"><li>휴대폰 홈 버튼을 눌러 온하루를 나가거나 화면을 잠가 주세요.</li><li>알림창에 ‘온하루’ 시험 알림이 오는지 확인해 주세요.</li><li>알림을 눌러 돌아온 뒤 ‘시험 알림을 받았어요’를 눌러주세요.</li></ol><div class="notice">예약 접수는 수신 성공이 아닙니다. 알림이 안 오면 갤럭시 알림 설정 도움말을 확인해 주세요.</div><button class="primary wide" data-action="close" style="margin-top:18px">안내 확인</button>`);}
  catch(error){statusMessage=safeError(error);if(error.expired){record.connected=false;hasSubscription=false;persist();}}
  finally{busy=false;refresh();}
 }
 function install(){if(installPrompt){const p=installPrompt;installPrompt=null;p.prompt();p.userChoice.then(()=>refresh()).catch(()=>{});return;}showDialog('홈 화면에 온하루 추가',`<p>갤럭시의 Chrome에서 다음 순서로 추가해 주세요.</p><ol class="bullet"><li>Chrome 오른쪽 위의 점 세 개 메뉴를 누릅니다.</li><li>‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택합니다.</li><li>홈 화면의 온하루를 열고 ‘약 관리’에서 알림을 켭니다.</li></ol><p class="note">설치만으로 알림이 켜지지는 않아요. 알림 허용과 시험 수신까지 확인해 주세요.</p>`);}
 function help(){showDialog('갤럭시 알림 설정 도움말',`<ol class="bullet"><li>Chrome에서 온하루를 열고 ‘약’ → ‘이 휴대폰 알림 켜기’를 누릅니다.</li><li>알림을 묻는 창에서 ‘허용’을 누릅니다.</li><li>‘화면 닫고 시험 알림 받기’를 누르고 홈 화면으로 나가거나 화면을 잠급니다.</li><li>약 1~2분 뒤 알림창을 확인합니다.</li></ol><h3 style="margin-top:20px">알림이 오지 않는다면</h3><ul class="bullet"><li>휴대폰 설정 → 알림에서 Chrome 또는 설치한 온하루의 알림을 허용해 주세요.</li><li>Chrome의 온하루 사이트 설정에서도 알림을 허용해 주세요.</li><li>방해 금지, 절전 모드, 백그라운드 데이터 제한을 확인해 주세요. 메뉴 이름은 기종에 따라 달라요.</li><li>기본 Chrome 탭이나 설치한 온하루를 사용해 주세요. 카카오톡 안의 브라우저·시크릿 모드에서는 지원되지 않을 수 있어요.</li><li>브라우저를 강제 종료하거나 인터넷이 끊기면 알림이 오지 않을 수 있어요.</li></ul><div class="notice">이 기능은 보조 알림입니다. 정시·수신을 보장하지 않으니 중요한 약은 휴대폰 기본 알람도 설정해 주세요.</div>`);}
 window.onharuPush={panel,hint,onDataSave,forget:()=>disable(true)};
 Object.assign(handlers,{enablePush:enable,syncPush:sync,disablePush:()=>confirmAction('이 휴대폰 알림을 해제할까요?','서버에 저장한 이 기기의 발송 정보와 약 시각을 삭제합니다. 이미 발송된 알림은 취소되지 않을 수 있어요.',()=>disable(),'알림 연결 해제'),pushTest:delayedTest,confirmPushTest:()=>{record.testConfirmed=new Date().toISOString();persist();refresh();notify('직접 확인한 시험 수신을 기록했어요. 중요한 약은 기본 알람도 함께 사용해 주세요.');},installApp:install,pushHelp:help});
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
 window.addEventListener('online',()=>{if(record.pending&&record.connected&&!record.deletePending)sync().catch(()=>{});});
 if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='onharu-push-received'&&event.data.test===true){record.received=new Date().toISOString();persist();refresh();}});
 async function init(){
  if(!capable){ready=false;refresh();return;}
  try{reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('worker-timeout')),18000))]);config=await request('/v1/config');if(!/^[A-Za-z0-9_-]{87}$/.test(config.publicKey))throw new Error('config');hasSubscription=!!(await reg.pushManager.getSubscription());ready=true;
   if(record.connected&&hasSubscription&&Notification.permission==='granted'){if(storageFailed){record.pending=true;statusMessage='기기 저장 오류가 있어 서버 알림 시간을 변경하지 않았어요. 저장공간을 확인해 주세요.';persist();}else{if(record.signature!==signature()){record.pending=true;persist();}if(record.pending)setTimeout(()=>sync().catch(()=>{}),100);}}
  }catch(error){ready=false;statusMessage='알림 기능을 준비하지 못했어요. 인터넷을 확인하고 온하루를 새로 열어주세요.';}
  refresh();
 }
 init();
})();
