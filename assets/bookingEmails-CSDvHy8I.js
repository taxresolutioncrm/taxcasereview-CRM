import{F as t,s as g}from"./index-CG71_oGn.js";const b="",x="Firm",y=t.address||"",w=t.phone||"",$="";function k({body:e,headerBg:n="linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%)",firmName:r,logoUrl:o,address:a,phone:p,email:s}){const i=r||t.name||x,l=o||t.logoUrl||b;let f=l;try{l&&typeof window<"u"&&(f=new URL(l,window.location.origin).href)}catch{}const m=a||t.address||y,h=p||t.phone||w,u=s||t.email||$;return`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:${n};padding:28px 40px;text-align:center">
    <img src="${f}" alt="${i}" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px" onerror="this.style.display='none'"/>
    <div style="font-size:13px;font-weight:800;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase">${i}</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    ${e}
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">
      ${i} &nbsp;·&nbsp; ${m}<br>
      📞 ${h} &nbsp;·&nbsp; ✉️ ${u}
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`}const d={};async function _(e){const n=e||"default";if(d[n])return d[n];try{if(!e&&t.loaded&&t.name)return{firmName:t.name,logoUrl:t.logoUrl||""};const r=e?{p_tenant:String(e)}:{},{data:o}=await g.rpc("booking_get_public_meta",r);d[n]=o&&o.firm_name?{firmName:o.firm_name,logoUrl:o.logo_url}:{}}catch{d[n]={}}return d[n]}const I=e=>{const[n,r]=String(e).split(":").map(Number),o=n>=12?"PM":"AM";return`${(n+11)%12+1}:${String(r).padStart(2,"0")} ${o}`},S=(e,n)=>`${new Date(e+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})} at ${I(n)} (Eastern)`,c=`${window.location.origin}/book`;function U(){return t.tenantId?`${c}?t=${t.tenantId}`:c}async function v({name:e,email:n,phone:r}){try{const o=(e||"").trim().split(" ")[0]||"there",a=new URLSearchParams;t.tenantId&&a.set("t",t.tenantId),(e||"").trim()&&a.set("name",e.trim()),(n||"").trim()&&a.set("email",n.trim()),(r||"").trim()&&a.set("phone",r.trim());const p=a.toString()?`${c}?${a.toString()}`:c,s=await _(t.tenantId),i=s.firmName||t.name||"TaxRes CRM",{error:l}=await g.functions.invoke("send-email",{body:{tenant_id:t.tenantId||void 0,to:n,subject:`Schedule Your Appointment — ${i}`,html:k({firmName:s.firmName,logoUrl:s.logoUrl,body:`<p>Hi <strong>${o}</strong>,</p><p>Pick whichever time works best for you — it takes less than a minute:</p><p style="text-align:center;margin:24px 0"><a href="${p}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p><p>You'll see our live availability and get an instant confirmation. If nothing there works, just reply to this email or give us a call.</p><p style="margin-top:20px">Talk soon,<br><strong>${i}</strong></p>`})}});return!l}catch(o){return console.error("sendBookingInvite error:",o),!1}}export{U as b,v as s,S as w};
