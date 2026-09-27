// Keeps the app shell available when venue wifi drops. Supabase requests are cross-origin and never cached.
const CACHE='rcdj-shell-v2'
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./manifest.webmanifest'])));self.skipWaiting()})
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()})
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url)
  if(req.method!=='GET'||url.origin!==location.origin)return
  // Pages: network first so deploys show up, cached copy when offline.
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put('./',copy));return r}).catch(()=>caches.match('./')))
    return
  }
  // Hashed assets never change, so cache first.
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r})))
})
