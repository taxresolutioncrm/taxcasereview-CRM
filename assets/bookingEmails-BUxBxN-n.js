import{F as t,s as f}from"./index-VnsWnq2G.js";const u="",h="Tax Case Review",x=t.address||"",y=t.phone||"",w="info@taxcasereview.org";function $({body:n,headerBg:e="linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%)",firmName:r,logoUrl:o,address:a,phone:c,email:s}){const i=r||t.name||h,p=o||t.logoUrl||u,g=a||t.address||x,m=c||t.phone||y,b=s||t.email||w;return`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:${e};padding:28px 40px;text-align:center">
    <img src="${p}" alt="${i}" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px" onerror="this.style.display='none'"/>
    <div style="font-size:13px;font-weight:800;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase">${i}</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    ${n}
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">
      ${i} &nbsp;·&nbsp; ${g}<br>
      📞 ${m} &nbsp;·&nbsp; ✉️ ${b}
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`}const l={};async function k(n){const e=n||"default";if(l[e])return l[e];try{if(!n&&t.loaded&&t.name)return{firmName:t.name,logoUrl:t.logoUrl||""};const r=n?{p_tenant:String(n)}:{},{data:o}=await f.rpc("booking_get_public_meta",r);l[e]=o&&o.firm_name?{firmName:o.firm_name,logoUrl:o.logo_url}:{}}catch{l[e]={}}return l[e]}const _=n=>{const[e,r]=String(n).split(":").map(Number),o=e>=12?"PM":"AM";return`${(e+11)%12+1}:${String(r).padStart(2,"0")} ${o}`},I=(n,e)=>`${new Date(n+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})} at ${_(e)} (Eastern)`,d=`${window.location.origin}/book`;function M(){return t.tenantId?`${d}?t=${t.tenantId}`:d}async function R({name:n,email:e,phone:r}){try{const o=(n||"").trim().split(" ")[0]||"there",a=new URLSearchParams;t.tenantId&&a.set("t",t.tenantId),(n||"").trim()&&a.set("name",n.trim()),(e||"").trim()&&a.set("email",e.trim()),(r||"").trim()&&a.set("phone",r.trim());const c=a.toString()?`${d}?${a.toString()}`:d,s=await k(t.tenantId),i=s.firmName||t.name||"TaxRes CRM",{error:p}=await f.functions.invoke("send-email",{body:{tenant_id:t.tenantId||void 0,to:e,subject:`Schedule Your Appointment — ${i}`,html:$({firmName:s.firmName,logoUrl:s.logoUrl,body:`<p>Hi <strong>${o}</strong>,</p><p>Pick whichever time works best for you — it takes less than a minute:</p><p style="text-align:center;margin:24px 0"><a href="${c}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p><p>You'll see our live availability and get an instant confirmation. If nothing there works, just reply to this email or give us a call.</p><p style="margin-top:20px">Talk soon,<br><strong>${i}</strong></p>`})}});return!p}catch(o){return console.error("sendBookingInvite error:",o),!1}}export{M as b,R as s,I as w};
