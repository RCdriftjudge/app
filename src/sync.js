// Offline queue for judge submissions. Each item is an RPC call whose args carry an idempotency key,
// so retrying after a timeout can never double-count. Items the server rejects move to a failed list
// the judge can see, instead of blocking the queue or disappearing.
const KEY='rcdj-pending-calls-v10'
const FAILED='rcdj-failed-calls-v10'

function read(k){try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return []}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}

export function queueCall(fn,args){const q=read(KEY);q.push({id:crypto.randomUUID(),fn,args,queuedAt:new Date().toISOString()});write(KEY,q)}
export function pendingCalls(){return read(KEY)}
export function failedCalls(){return read(FAILED)}
export function clearFailed(){write(FAILED,[])}

let flushing=null
export function flush(send,isNetworkError){
  flushing??=(async()=>{
    try{
      for(const item of read(KEY)){
        try{await send(item.fn,item.args)}
        catch(e){
          if(isNetworkError(e))return
          write(FAILED,[...read(FAILED),{...item,error:e.message}])
        }
        write(KEY,read(KEY).filter(x=>x.id!==item.id))
      }
    }finally{flushing=null}
  })()
  return flushing
}
