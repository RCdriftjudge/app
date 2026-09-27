const KEY='rcdj-pending-events-v09'
export function queueEvent(event){const q=JSON.parse(localStorage.getItem(KEY)||'[]');if(!event.idempotency_key)event.idempotency_key=crypto.randomUUID();q.push({...event,queuedAt:new Date().toISOString()});localStorage.setItem(KEY,JSON.stringify(q));return event}
export function pendingEvents(){return JSON.parse(localStorage.getItem(KEY)||'[]')}
export async function flush(send){for(const e of pendingEvents()){try{await send(e);localStorage.setItem(KEY,JSON.stringify(pendingEvents().filter(x=>x.idempotency_key!==e.idempotency_key)))}catch(_){break}}}
