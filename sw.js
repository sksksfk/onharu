'use strict';
// Static assets only. Never cache notification credentials or API responses.
const CACHE='onharu-static-20261101-push-1';
const APP=new URL('./',self.location.href).href;
const ASSETS=['./','./index.html','./push-client.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(ASSETS);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('onharu-static-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(APP).pathname))return;
 const isDocument=req.mode==='navigate';
 const isAsset=ASSETS.some(p=>new URL(p,APP).href===url.href);
 if(!isDocument&&!isAsset)return;
 event.respondWith((async()=>{
  try{const response=await fetch(req);if(response.ok&&response.type==='basic'){const cache=await caches.open(CACHE);await cache.put(req,response.clone());}return response;}
  catch{const cache=await caches.open(CACHE);return(await cache.match(req))||(isDocument?await cache.match(APP):null)||new Response('인터넷 연결을 확인해 주세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
 })());
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let message={};try{message=event.data?.json()||{};}catch{message={};}
 const data=message.data&&typeof message.data==='object'?message.data:{};
 // Medication reminders should not appear long after their scheduled slot.
 const expiry=typeof data.expiresAt==='number'?data.expiresAt:Date.parse(data.expiresAt||'');
 if(Number.isFinite(expiry)&&Date.now()>expiry)return;
 const test=data.test===true;
 const title='온하루';
 const body=test?'화면을 닫은 뒤에도 알림을 받을 수 있는지 확인하는 시험 알림입니다.':'예정된 약 확인 시간입니다. 처방과 이미 복용했는지 확인해 주세요.';
 const tag=typeof message.tag==='string'&&message.tag.length<=120?message.tag:(test?'onharu-test':'onharu-reminder');
 await self.registration.showNotification(title,{body,tag,icon:new URL('icon-192.png',APP).href,badge:new URL('icon-192.png',APP).href,renotify:false,vibrate:[200,100,200],data:{url:APP,test},timestamp:Date.now()});
 const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const client of windows)if(client.url.startsWith(APP))client.postMessage({type:'onharu-push-received',test,at:new Date().toISOString()});
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){if(client.url.startsWith(APP)){await client.focus();return;}}
  await self.clients.openWindow(APP);
 })());
});
