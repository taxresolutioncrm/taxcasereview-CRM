const {test,expect}=require('@playwright/test')
const fs=require('fs'),path=require('path')
const clients=fs.readFileSync(path.resolve(__dirname,'../../src/pages/Clients.jsx'),'utf8')
const fax=fs.readFileSync(path.resolve(__dirname,'../../src/pages/Fax.jsx'),'utf8')
test('both client viewer actions open inline fax while keeping client page mounted',()=>{
 expect((clients.match(/setFaxIntent\(\{documentId:selectedDoc.id,clientId,clientName\}\)/g)||[]).length).toBe(2)
 expect(clients).toContain('<Fax embeddedDocument={faxIntent}')
 expect(clients).not.toContain("navigate('/fax',{state:{faxClientDocument:")
})
test('fax validates selected document in active tenant and reuses SignalWire',()=>{
 for(const text of [".eq('tenant_id',myTenantId)","select('id,name,canopy_id,tenant_id')","doc.canopy_client_id","!doc.client_id && !doc.canopy_client_id","createSignedUrl(path,3600)","functions.invoke('send-fax'","disabled={sending || linkedLoading}"])
 expect(fax).toContain(text)
 expect(fax).toContain("style={embeddedDocument?{zIndex:20000}:undefined}")
 expect(fax).toContain("if(!embeddedDocument) load()")
 expect(fax).toContain("from '../lib/docFolders'")
 expect(clients).toContain("from '../lib/docFolders'")
})

test('inline fax presents submission receipt without navigation and checks callback status',()=>{
  for(const fragment of ['faxReceipt && !modal','refreshFaxReceipt','printFaxReceipt','Retry fax','Return to client','Delivery status','signalwire_fax_id','faxReceipt.status===\'Pending\''])
    expect(fax).toContain(fragment)
  expect(fax).toContain("setFaxReceipt({sid:sw_id")
  expect(fax).not.toContain("setModal(false); onClose?.(); setForm(BLANK)")
})
