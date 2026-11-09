import{F as n,u as h}from"./index-WXHrpfdS.js";import{P as x}from"./productBookingConfig-D_LUdory.js";const y="",w="Firm",k=n.address||"",$=n.phone||"",_="";function b({body:e,headerBg:t="linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%)",firmName:o,logoUrl:a,address:s,phone:r,email:m}){const l=o||n.name||w;let c=a||n.logoUrl||y;try{c&&typeof window<"u"&&(c=new URL(c,window.location.origin).href)}catch{}const i=s||n.address||k,g=r||n.phone||$,u=m||n.email||_;return`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:${t};padding:28px 40px;text-align:center">
    <img src="${c}" alt="${l}" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px" onerror="this.style.display='none'"/>
    <div style="font-size:13px;font-weight:800;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase">${l}</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    ${e}
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">
      ${l} &nbsp;·&nbsp; ${i}<br>
      📞 ${g} &nbsp;·&nbsp; ✉️ ${u}
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`}const d={};async function v(e){const t=e||"default";if(d[t])return d[t];try{if(!e)return d[t]=n.loaded&&n.name?{firmName:n.name,logoUrl:n.logoUrl||"",email:n.email||""}:{},d[t];const{data:o}=await h.rpc("booking_get_public_meta",{p_tenant:String(e)});d[t]=o&&o.firm_name?{firmName:o.firm_name,logoUrl:o.logo_url||"",email:o.email||""}:{}}catch{d[t]={}}return d[t]}const S=e=>{const[t,o]=String(e).split(":").map(Number),a=t>=12?"PM":"AM";return`${(t+11)%12+1}:${String(o).padStart(2,"0")} ${a}`},I=(e,t)=>`${new Date(e+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})} at ${S(t)} (Eastern)`,f=`${window.location.origin}/book`;function L(e=n.tenantId){return e?`${f}?t=${e}`:f}function U(e,{name:t="",email:o="",phone:a=""}={}){const s=x[e];if(!s||s.inactive)throw new Error("Booking is not configured for this CRM");const r=new URLSearchParams({product:s.key});return t.trim()&&r.set("name",t.trim()),o.trim()&&r.set("email",o.trim()),a.trim()&&r.set("phone",a.trim()),`${f}?${r.toString()}`}async function O({name:e,email:t,phone:o,productId:a}){try{const s=(e||"").trim().split(" ")[0]||"there";if(a){const i=x[a];if(!i||i.inactive)return!1;const g=U(a,{name:e||"",email:t||"",phone:o||""}),{error:u}=await h.functions.invoke("send-email",{body:{tenant_id:n.tenantId||void 0,to:t,from_name:i.fromName||i.name,subject:`Schedule Your Appointment — ${i.name}`,html:b({firmName:i.name,logoUrl:i.logo||"",body:`<p>Hi <strong>${s}</strong>,</p>
          <p>Choose a date and time for your <strong>${i.name}</strong> appointment:</p>
          <p style="text-align:center;margin:24px 0"><a href="${g}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p>
          <p>You'll see available times and receive a booking confirmation.</p>
          <p style="margin-top:20px">Talk soon,<br><strong>${i.name}</strong></p>`})}});return!u}const r=new URLSearchParams;n.tenantId&&r.set("t",n.tenantId),(e||"").trim()&&r.set("name",e.trim()),(t||"").trim()&&r.set("email",t.trim()),(o||"").trim()&&r.set("phone",o.trim());const m=r.toString()?`${f}?${r.toString()}`:f,l=await v(n.tenantId),p=l.firmName||n.name||"TaxRes CRM",{error:c}=await h.functions.invoke("send-email",{body:{tenant_id:n.tenantId||void 0,to:t,subject:`Schedule Your Appointment — ${p}`,html:b({firmName:l.firmName,logoUrl:l.logoUrl,body:`<p>Hi <strong>${s}</strong>,</p><p>Pick whichever time works best for you — it takes less than a minute:</p><p style="text-align:center;margin:24px 0"><a href="${m}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p><p>You'll see our live availability and get an instant confirmation. If nothing there works, just reply to this email or give us a call.</p><p style="margin-top:20px">Talk soon,<br><strong>${p}</strong></p>`})}});return!c}catch(s){return console.error("sendBookingInvite error:",s),!1}}export{L as b,U as p,O as s,I as w};
