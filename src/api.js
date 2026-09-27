import {createClient} from '@supabase/supabase-js'

const url=import.meta.env.VITE_SUPABASE_URL||''
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||''
export const REQUEST_TIMEOUT_MS=12000
function fetchWithTimeout(input,init={}){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),REQUEST_TIMEOUT_MS)
  init.signal?.addEventListener('abort',()=>ctrl.abort())
  return fetch(input,{...init,signal:ctrl.signal}).finally(()=>clearTimeout(timer))
}
export const sb=url&&key?createClient(url,key,{global:{fetch:fetchWithTimeout}}):null

// Thrown when the request never reached the server, so the caller can queue it and retry.
export class NetworkError extends Error{}

function toError(error,status){
  const message=error?.message||'Something went wrong'
  if(status===0||/failed to fetch|networkerror|network request failed|load failed|fetch failed|abort/i.test(message))return new NetworkError('No connection to the server')
  return new Error(message)
}

export async function ensureAuth(){
  if(!sb)throw new Error('Backend is not configured.')
  const {data}=await sb.auth.getSession()
  if(data.session)return data.session.user
  const r=await sb.auth.signInAnonymously()
  if(r.error)throw toError(r.error,r.error.status)
  return r.data.user
}

export async function rpc(fn,args={}){
  await ensureAuth()
  const {data,error,status}=await sb.rpc(fn,args)
  if(error)throw toError(error,status)
  return data
}

// Competition name behind a QR code; callable before the device has signed in.
export async function inviteInfo(code){
  if(!sb||!code)return null
  const {data,error}=await sb.rpc('invite_info',{p_code:code})
  return error?null:data
}

export function watchCompetition(id,onChange){
  if(!sb)return ()=>{}
  const channel=sb.channel(`competition:${id}`)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'competitions',filter:`id=eq.${id}`},onChange)
    .subscribe()
  return ()=>sb.removeChannel(channel)
}
