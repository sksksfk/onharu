// Onharu web push. No dependencies. RFC 8291/8188/8292.
const ORIGIN = 'https://sksksfk.github.io';
const APP_URL = ORIGIN + '/onharu/';
const ZONE = 'Asia/Seoul';
const MAX_DEVICES = 12;
const GRACE_MS = 180000;
const encoder = new TextEncoder();
const bytes = s => encoder.encode(s);
const random = n => crypto.getRandomValues(new Uint8Array(n));
export function b64(a) { return btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
export function unb64(s, n) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s) || s.length > 128) throw new HttpError(400,'invalid_key');
  let a; try { a = Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-s.length%4)%4)), c=>c.charCodeAt(0)); } catch { throw new HttpError(400,'invalid_key'); }
  if (a.length !== n || b64(a) !== s) throw new HttpError(400,'invalid_key'); return a;
}
export function cat(...parts) { const a = new Uint8Array(parts.reduce((s,p)=>s+p.length,0)); let o=0; for(const p of parts){a.set(p,o);o+=p.length;}return a; }
export class HttpError extends Error { constructor(status,code){super(code);this.status=status;this.code=code;} }
function object(v){if(!v || typeof v!=='object' || Array.isArray(v))throw new HttpError(400,'invalid_body');}
function fields(v, allowed){object(v);if(Object.keys(v).some(k=>!allowed.includes(k)))throw new HttpError(400,'unknown_field');}
export function validateSchedule(v){
  if(v.timeZone!==ZONE || !Array.isArray(v.times) || v.times.length>32 || v.times.some(t=>typeof t!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)) || new Set(v.times).size!==v.times.length)throw new HttpError(400,'invalid_schedule');
  return [...v.times].sort();
}
export function validateEndpoint(s){
  if(typeof s!=='string'||s.length>2048||/[\s\\]/.test(s))throw new HttpError(400,'invalid_endpoint');
  // Inspect raw authority as URL normalizes explicit :443 away.
  const m=/^https:\/\/([^/]+)(\/[^#]*)$/.exec(s);
  if(!m || /[:@%]/.test(m[1]))throw new HttpError(400,'invalid_endpoint');
  const allowed = ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
  let u;try{u=new URL(s);}catch{throw new HttpError(400,'invalid_endpoint');}
  if(!allowed.includes(m[1]) || u.protocol!=='https:' || u.username || u.password || u.port || u.hash || u.search || u.pathname.length<2 || u.href!==s)throw new HttpError(400,'invalid_endpoint');
  return s;
}
export async function validateSubscription(v){
  fields(v,['endpoint','keys','expirationTime']); fields(v.keys,['p256dh','auth']);
  const endpoint=validateEndpoint(v.endpoint); const raw=unb64(v.keys.p256dh,65);unb64(v.keys.auth,16);
  if(raw[0]!==4)throw new HttpError(400,'invalid_key');
  try{await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw new HttpError(400,'invalid_key');}
  return {endpoint,keys:{p256dh:v.keys.p256dh,auth:v.keys.auth}};
}
export async function hmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data));}
export async function derive(shared,auth,ua,as,salt){
  const prkKey=await hmac(auth,shared);
  const ikm=await hmac(prkKey,cat(bytes('WebPush: info\0'),ua,as,new Uint8Array([1])));
  const prk=await hmac(salt,ikm);
  const cek=(await hmac(prk,bytes('Content-Encoding: aes128gcm\0\x01'))).slice(0,16);
  const nonce=(await hmac(prk,bytes('Content-Encoding: nonce\0\x01'))).slice(0,12);
  return {cek,nonce};
}
// Optional deterministic arguments are used by offline RFC-vector tests only.
export async function encrypt(subscription,plaintext, fixed){
  const ua=unb64(subscription.keys.p256dh,65),auth=unb64(subscription.keys.auth,16);
  const peer=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const pair=fixed?.pair || await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const as=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256));
  const salt=fixed?.salt || random(16), {cek,nonce}=await derive(shared,auth,ua,as,salt);
  const plain=bytes(plaintext); if(plain.length>3993)throw new Error('payload_too_large');
  const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},key,cat(plain,new Uint8Array([2]))));
  const header=new Uint8Array(21);header.set(salt);new DataView(header.buffer).setUint32(16,4096);header[20]=65;
  return cat(header,as,ciphertext);
}
async function hash(token){return b64(await crypto.subtle.digest('SHA-256',bytes(token)));}
function equal(a,b){if(typeof a!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function first(db,sql,...args){return db.prepare(sql).bind(...args).first();}
async function run(db,sql,...args){return db.prepare(sql).bind(...args).run();}
export async function getVapid(db){
  let row=await first(db,'SELECT public_key, private_jwk FROM vapid WHERE id=1');
  if(!row){
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const pub=b64(await crypto.subtle.exportKey('raw',pair.publicKey));
    const priv=JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey));
    await run(db,'INSERT OR IGNORE INTO vapid(id,public_key,private_jwk,created_at) VALUES(1,?,?,?)',pub,priv,Date.now());
    // Always read the atomically elected winner, never return the candidate.
    row=await first(db,'SELECT public_key, private_jwk FROM vapid WHERE id=1');
  }return row;
}
export async function authorization(endpoint,vapid,now=Date.now()){
  const head=b64(bytes(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const body=b64(bytes(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+3600,sub:APP_URL})));
  const signing= head+'.'+body;
  const key=await crypto.subtle.importKey('jwk',JSON.parse(vapid.private_jwk),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,bytes(signing)));
  if(signature.length!==64)throw new Error('unsupported_es256_encoding');
  return 'vapid t='+signing+'.'+b64(signature)+', k='+vapid.public_key;
}
function payload(slot,test=false){return JSON.stringify({title:'온하루',body:test?'알림 연결 확인입니다. 처방과 이미 복용했는지 확인해 주세요.':'예정된 약 확인 시간입니다. 처방과 이미 복용했는지 확인해 주세요.',tag:test?'onharu-test':'onharu-'+slot,data:{url:APP_URL,slot,expiresAt:slot*60000+GRACE_MS,test}});}
export async function sendPush(row,vapid,slot,test=false,transport=fetch){
  const sub=JSON.parse(row.subscription);validateEndpoint(sub.endpoint);
  const remaining=Math.floor((slot*60000+GRACE_MS-Date.now())/1000);
  if(remaining<=0)return {status:0,accepted:false,retryable:false,expired:false};
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const body=await encrypt(sub,payload(slot,test));
    const response=await transport(sub.endpoint,{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:await authorization(sub.endpoint,vapid),'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:String(Math.min(120,remaining)),Urgency:'normal',Topic:b64(bytes('onharu-'+slot))},body});
    const status=response.status;
    // Response bodies are never read or logged. Cancel immediately, no unbounded buffering.
    if(response.body)await response.body.cancel().catch(()=>{});
    let retryAfter=60000;const ra=response.headers.get('Retry-After');
    if(ra && /^\d{1,6}$/.test(ra))retryAfter=Math.max(60000,Math.min(180000,Number(ra)*1000));
    else if(ra){const at=Date.parse(ra);if(Number.isFinite(at))retryAfter=Math.max(60000,Math.min(180000,at-Date.now()));}
    return {status,accepted:status>=200&&status<300,expired:status===404||status===410,retryable:status===429||status>=500,retryAfter};
  }catch{return {status:0,accepted:false,expired:false,retryable:false};}finally{clearTimeout(timer);}
}
async function readBody(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw new HttpError(415,'json_required');
  if(request.headers.get('Content-Encoding'))throw new HttpError(415,'encoding_not_allowed');
  const declared=request.headers.get('Content-Length');if(declared && (!/^\d+$/.test(declared)||Number(declared)>8192))throw new HttpError(413,'body_too_large');
  if(!request.body)throw new HttpError(400,'invalid_body');
  const reader=request.body.getReader();const chunks=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();throw new HttpError(413,'body_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(cat(...chunks)));}catch{throw new HttpError(400,'invalid_json');}
}
async function throttle(db,now){
  const minute=Math.floor(now/60000);
  const row=await first(db,'INSERT INTO api_rate(id,minute,count) VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN minute=excluded.minute THEN count+1 ELSE 1 END, minute=excluded.minute RETURNING count',minute);
  if(row.count>120)throw new HttpError(429,'rate_limited');
}
function response(request,body,status=200){
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin'};
  if(request.headers.get('Origin')===ORIGIN)h['Access-Control-Allow-Origin']=ORIGIN;
  if(status===429)h['Retry-After']='60';
  return new Response(JSON.stringify(body),{status,headers:h});
}
export async function api(request,env){
  try{
    const u=new URL(request.url),method=request.method,origin=request.headers.get('Origin');
    if(origin && origin!==ORIGIN)throw new HttpError(403,'origin_forbidden');
    if(u.search)throw new HttpError(400,'query_not_allowed');
    const match=/^\/v1\/devices\/([A-Za-z0-9_-]{22})(\/test)?$/.exec(u.pathname);
    if(method==='OPTIONS'){
      if(origin!==ORIGIN || !(u.pathname==='/v1/config'||u.pathname==='/v1/devices'||match))throw new HttpError(403,'origin_forbidden');
      const asked=request.headers.get('Access-Control-Request-Method');
      if(!['GET','POST','PUT','DELETE'].includes(asked))throw new HttpError(405,'method_not_allowed');
      const askedHeaders=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
      if(askedHeaders.some(h=>!['authorization','content-type'].includes(h)))throw new HttpError(403,'headers_forbidden');
      return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600',Vary:'Origin'}});
    }
    if(method!=='GET'&&origin!==ORIGIN)throw new HttpError(403,'origin_required');
    const db=env.DB,now=Date.now();await throttle(db,now);
    if(method==='GET'&&u.pathname==='/v1/config'){const key=await getVapid(db);return response(request,{publicKey:key.public_key});}
    if(method==='POST'&&u.pathname==='/v1/devices'){
      const body=await readBody(request);fields(body,['id','token','subscription','times','timeZone']);
      unb64(body.id,16);unb64(body.token,32);
      const times=validateSchedule(body),sub=await validateSubscription(body.subscription),tokenHash=await hash(body.token);
      const serialized=JSON.stringify(sub);
      await run(db,'INSERT OR IGNORE INTO devices(id,endpoint,subscription,token_hash,times,time_zone,created_at,updated_at,schedule_since) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM devices) < ?',body.id,sub.endpoint,serialized,tokenHash,JSON.stringify(times),ZONE,now,now,now,MAX_DEVICES);
      const row=await first(db,'SELECT * FROM devices WHERE id=?',body.id);
      if(!row || !equal(row.token_hash,tokenHash) || row.subscription!==serialized)throw new HttpError(409,'registration_conflict_or_capacity');
      // Retried creation does not overwrite newer PUT changes.
      return response(request,{id:body.id,token:body.token},200);
    }
    if(match){
      const id=match[1];unb64(id,16);
      const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization')||'');
      if(!bearer)throw new HttpError(401,'unauthorized');unb64(bearer[1],32);
      const row=await first(db,'SELECT * FROM devices WHERE id=?',id);
      // Already absent is a successful deletion retry; existing identities still require the correct token.
      if(!row&&method==='DELETE'&&!match[2])return response(request,{ok:true});
      if(!row||!equal(row.token_hash,await hash(bearer[1])))throw new HttpError(401,'unauthorized');
      if(method==='DELETE'&&!match[2]){await run(db,'DELETE FROM devices WHERE id=? AND token_hash=?',id,row.token_hash);return response(request,{ok:true});}
      if(method==='PUT'&&!match[2]){
        const body=await readBody(request);fields(body,['times','timeZone']);const times=validateSchedule(body);
        await run(db,'UPDATE devices SET times=?,time_zone=?,updated_at=?,schedule_since=?,next_attempt_at=0 WHERE id=? AND token_hash=?',JSON.stringify(times),ZONE,now,now,id,row.token_hash);
        return response(request,{ok:true});
      }
      if(method==='POST'&&match[2]){
        let delaySeconds=0;
        if(request.body){const body=await readBody(request);fields(body,['delaySeconds']);if(body.delaySeconds!==undefined&&body.delaySeconds!==0&&body.delaySeconds!==60)throw new HttpError(400,'invalid_delay');delaySeconds=body.delaySeconds||0;}
        const due=delaySeconds?now+delaySeconds*1000:null;
        const claimed=await first(db,'UPDATE devices SET last_test_at=?,test_due_at=? WHERE id=? AND (last_test_at IS NULL OR last_test_at<=?) RETURNING id',now,due,id,now-60000);
        if(claimed&&due)return response(request,{accepted:true,scheduledAt:new Date(due).toISOString(),transportStatus:null,delivered:false},202);
        if(!claimed)throw new HttpError(429,'test_rate_limited');
        const out=await sendPush(row,await getVapid(db),Math.floor(now/60000),true);
        if(out.expired)await run(db,'DELETE FROM devices WHERE id=?',id);
        return response(request,{accepted:out.accepted,transportStatus:out.status||null,expired:out.expired,delivered:false},out.accepted?202:502);
      }
    }
    throw new HttpError(404,'not_found');
  }catch(error){return response(request,{error:error instanceof HttpError?error.code:'internal_error'},error instanceof HttpError?error.status:500);}
}
export function latestSlot(row,now){
  const times=new Set(JSON.parse(row.times)),minute=Math.floor(now/60000);
  for(let back=0;back<3;back++){
    const slot=minute-back,at=slot*60000;if(now-at>=GRACE_MS || at<row.schedule_since)continue;
    const korea=new Date(at+9*3600000).toISOString().slice(11,16);
    if(times.has(korea))return slot;
  }return null;
}
export async function tick(env){
  const db=env.DB,now=Date.now();
  const rows=(await db.prepare('SELECT * FROM devices ORDER BY id LIMIT 12').all()).results;
  if(!rows.length)return;
  let vapid;
  for(const row of rows){
    if(row.test_due_at && row.test_due_at<=now){
      const testClaim=await first(db,'UPDATE devices SET test_due_at=NULL WHERE id=? AND test_due_at=? RETURNING id',row.id,row.test_due_at);
      if(testClaim && now-row.test_due_at<GRACE_MS){
        vapid ||= await getVapid(db);
        const out=await sendPush(row,vapid,Math.floor(now/60000),true);
        if(out.expired)await run(db,'DELETE FROM devices WHERE id=?',row.id);
        else await run(db,'UPDATE devices SET last_transport_status=?,last_attempt_at=? WHERE id=?',out.status,Date.now(),row.id);
      }
      continue;
    }
    const slot=latestSlot(row,now);if(slot===null)continue;
    // Atomic lease and attempt increment. Lost/in-flight outcomes are never replayed automatically.
    const claimed=await first(db,
      'UPDATE devices SET last_slot=?,slot_attempts=CASE WHEN last_slot=? THEN slot_attempts+1 ELSE 1 END,next_attempt_at=0,claimed_at=? WHERE id=? AND updated_at=? AND (last_slot IS NULL OR last_slot<? OR (last_slot=? AND slot_attempts<2 AND next_attempt_at>0 AND next_attempt_at<=?)) RETURNING *',
      slot,slot,now,row.id,row.updated_at,slot,slot,now);
    if(!claimed)continue;
    vapid ||= await getVapid(db);
    const out=await sendPush(claimed,vapid,slot);
    if(out.expired){await run(db,'DELETE FROM devices WHERE id=?',row.id);continue;}
    const next=out.retryable&&claimed.slot_attempts<2&&Date.now()+out.retryAfter<slot*60000+GRACE_MS?Date.now()+out.retryAfter:0;
    await run(db,'UPDATE devices SET last_transport_status=?,last_attempt_at=?,next_attempt_at=? WHERE id=? AND last_slot=? AND slot_attempts=?',out.status,Date.now(),next,row.id,slot,claimed.slot_attempts);
  }
}
export default {fetch:api,scheduled(controller,env,ctx){ctx.waitUntil(tick(env));}};
