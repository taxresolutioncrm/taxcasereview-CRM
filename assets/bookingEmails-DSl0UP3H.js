import{F as e,t as m}from"./index-BCGrXRpo.js";const b="",x="Firm",y=e.address||"",w=e.phone||"",$="";function k({body:n,headerBg:t="linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%)",firmName:o,logoUrl:i,address:r,phone:p,email:l}){const s=o||e.name||x;let d=i||e.logoUrl||b;try{d&&typeof window<"u"&&(d=new URL(d,window.location.origin).href)}catch{}const g=r||e.address||y,h=p||e.phone||w,u=l||e.email||$;return`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:${t};padding:28px 40px;text-align:center">
    <img src="${d}" alt="${s}" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px" onerror="this.style.display='none'"/>
    <div style="font-size:13px;font-weight:800;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase">${s}</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    ${n}
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">
      ${s} &nbsp;·&nbsp; ${g}<br>
      📞 ${h} &nbsp;·&nbsp; ✉️ ${u}
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`}const a={};async function _(n){const t=n||"default";if(a[t])return a[t];try{if(!n)return a[t]=e.loaded&&e.name?{firmName:e.name,logoUrl:e.logoUrl||"",email:e.email||""}:{},a[t];const{data:o}=await m.rpc("booking_get_public_meta",{p_tenant:String(n)});a[t]=o&&o.firm_name?{firmName:o.firm_name,logoUrl:o.logo_url||"",email:o.email||""}:{}}catch{a[t]={}}return a[t]}const M=n=>{const[t,o]=String(n).split(":").map(Number),i=t>=12?"PM":"AM";return`${(t+11)%12+1}:${String(o).padStart(2,"0")} ${i}`},U=(n,t)=>`${new Date(n+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})} at ${M(t)} (Eastern)`,c=`${window.location.origin}/book`;function v(n=e.tenantId){return n?`${c}?t=${n}`:c}async function I({name:n,email:t,phone:o}){try{const i=(n||"").trim().split(" ")[0]||"there",r=new URLSearchParams;e.tenantId&&r.set("t",e.tenantId),(n||"").trim()&&r.set("name",n.trim()),(t||"").trim()&&r.set("email",t.trim()),(o||"").trim()&&r.set("phone",o.trim());const p=r.toString()?`${c}?${r.toString()}`:c,l=await _(e.tenantId),s=l.firmName||e.name||"TaxRes CRM",{error:f}=await m.functions.invoke("send-email",{body:{tenant_id:e.tenantId||void 0,to:t,subject:`Schedule Your Appointment — ${s}`,html:k({firmName:l.firmName,logoUrl:l.logoUrl,body:`<p>Hi <strong>${i}</strong>,</p><p>Pick whichever time works best for you — it takes less than a minute:</p><p style="text-align:center;margin:24px 0"><a href="${p}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p><p>You'll see our live availability and get an instant confirmation. If nothing there works, just reply to this email or give us a call.</p><p style="margin-top:20px">Talk soon,<br><strong>${s}</strong></p>`})}});return!f}catch(i){return console.error("sendBookingInvite error:",i),!1}}export{v as b,I as s,U as w};
