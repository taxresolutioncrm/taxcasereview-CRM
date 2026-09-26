import fs from 'node:fs'
import vm from 'node:vm'
import { TextEncoder } from 'node:util'

const fail = (m) => { throw new Error(m) }
const waitFor = (promise, ms=1500) => Promise.race([
  promise,
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),ms)),
])

function btoaNode(value){ return Buffer.from(value, 'binary').toString('base64') }

// 1) IRS/SOR page capture: binary PDF must survive intact into chrome.storage.
{
  const src=fs.readFileSync('tools/irs-sor-bridge/irs-sor.js','utf8')
  let stored=null
  let setResolve
  const setDone=new Promise(r=>{ setResolve=r })

  const subjectCell={ textContent:'Subject' }
  const valueCell={ textContent:'TDS Transaction ID - TX123 TIN - 123-45-6789 Tax Period - 202212' }
  const row={ querySelectorAll:(sel)=>sel==='td'?[subjectCell,valueCell]:[] }
  const link={
    getAttribute:(name)=>name==='onclick' ? "openWin('/semail/views/view_file.jsp?action=download&id=1')" : '',
    closest:()=>({ textContent:'transcript.pdf -- 123 bytes' }),
  }
  const document={
    querySelectorAll:(sel)=>sel==='tr'?[row]:sel==='a[onclick]'?[link]:[],
    body:{ textContent:'' },
  }
  const location={ pathname:'/semail/views/message_detail.jsp', origin:'https://la.www4.irs.gov' }
  const expected=Buffer.from('%PDF-1.7\n'+('A'.repeat(96)))
  const fetch=async()=>({
    ok:true,
    status:200,
    headers:{ get:(name)=>String(name).toLowerCase()==='content-type'?'application/pdf':null },
    arrayBuffer:async()=>expected.buffer.slice(expected.byteOffset,expected.byteOffset+expected.byteLength),
    text:async()=>fail('PDF path called response.text()'),
  })
  const chrome={ storage:{ local:{
    get:async()=>({taxresSorDeliveries:[]}),
    set:async(obj)=>{ stored=obj; setResolve() },
  }}}
  const crypto={ subtle:{ digest:async()=>new Uint8Array(32).buffer } }
  const context={
    document, location, fetch, chrome, crypto,
    TextEncoder, Uint8Array, URL, Date,
    btoa:btoaNode,
    console:{warn:(...args)=>fail('capture warning: '+args.join(' '))},
  }
  vm.runInNewContext(src,context,{filename:'irs-sor.js'})
  await waitFor(setDone)

  const delivery=stored?.taxresSorDeliveries?.[0]
  if(!delivery) fail('capture did not persist a delivery')
  if(delivery.contentEncoding!=='base64') fail('PDF delivery was not base64 encoded')
  if(delivery.contentType!=='application/pdf') fail('PDF content type was not preserved')
  if(delivery.tinLast4!=='6789') fail('TIN last4 metadata mismatch')
  if(delivery.taxYear!=='2022') fail('tax year metadata mismatch')
  const decoded=Buffer.from(delivery.content,'base64')
  if(!decoded.equals(expected)) fail('PDF bytes changed during SOR capture')
}

// 2) CRM bridge: publish READY + DELIVERY, then delete only after CRM ACK.
{
  const src=fs.readFileSync('tools/irs-sor-bridge/crm-bridge.js','utf8')
  const delivery={bridgeId:'bridge-123',content:'payload'}
  const posted=[]
  const listeners={}
  let storage=[delivery]
  const origin='https://nashville.taxrescrm.app'
  const window={
    location:{origin},
    postMessage:(msg,target)=>{ posted.push({msg,target}) },
    addEventListener:(name,fn)=>{ listeners[name]=fn },
  }
  const chrome={ storage:{ local:{
    get:async()=>({taxresSorDeliveries:storage}),
    set:async(obj)=>{ storage=obj.taxresSorDeliveries },
  }}}
  const context={
    window, chrome,
    setInterval:()=>0,
    console,
  }
  vm.runInNewContext(src,context,{filename:'crm-bridge.js'})
  await new Promise(r=>setTimeout(r,0))

  if(!posted.some(x=>x.msg?.type==='TAXRES_SOR_BRIDGE_READY')) fail('bridge did not publish READY')
  if(!posted.some(x=>x.msg?.type==='TAXRES_SOR_DELIVERY' && x.msg?.delivery?.bridgeId==='bridge-123')) fail('bridge did not publish DELIVERY')
  if(storage.length!==1) fail('bridge removed delivery before ACK')

  const onMessage=listeners.message
  if(typeof onMessage!=='function') fail('bridge ACK listener missing')
  await onMessage({
    source:window,
    origin,
    data:{source:'taxres-crm',type:'TAXRES_SOR_ACK',bridgeId:'bridge-123'},
  })
  if(storage.length!==0) fail('bridge did not clear delivery after valid ACK')
}

console.log('PASS: IRS SOR bridge runtime capture/publish/ACK contract')
