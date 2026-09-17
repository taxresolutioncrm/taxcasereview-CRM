import { createClient } from "npm:@supabase/supabase-js@2";

const BOOK_MANAGE = "https://taxrescrm.app/book/manage/";
const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});

Deno.serve(async (req) => {
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token=req.headers.get("x-internal-cron-token")||"";
  const {data:authorized,error:authErr}=token?await supabase.rpc("verify_internal_cron_token",{provided:token}):{data:false,error:null};
  if(authErr||authorized!==true)return json({error:"Unauthorized"},401);

  const fmt = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
  const g: Record<string,string>={}; fmt.formatToParts(new Date()).forEach((p)=>{g[p.type]=p.value;});
  const nowMin=Date.UTC(+g.year,+g.month-1,+g.day,+g.hour%24,+g.minute);
  const {data:rows,error}=await supabase.from("calevents").select('id, "clientName", "eventType", date, time, contact_email, booking_token, reminder_24_sent, reminder_1_sent, status, source, tenant_id').eq("source","online").eq("status","scheduled").not("contact_email","is",null).gte("date",g.year+"-"+g.month+"-"+g.day);
  if(error)return json({error:"Reminder query failed"},500);

  let sent=0;
  for(const r of rows??[]){
    if(!r.time||!r.contact_email)continue;
    const[y,m,d]=String(r.date).split("-").map(Number),[hh,mm]=String(r.time).split(":").map(Number),evtMin=Date.UTC(y,m-1,d,hh,mm),minsAway=(evtMin-nowMin)/60000;
    let kind:"24h"|"1h"|null=null;
    if(!r.reminder_1_sent&&minsAway>0&&minsAway<=65)kind="1h";else if(!r.reminder_24_sent&&minsAway>65&&minsAway<=1440)kind="24h";if(!kind)continue;
    const whenLabel=new Date(y,m-1,d,hh,mm).toLocaleString("en-US",{weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit"})+" (Eastern)";
    const first=(String(r.clientName||"").trim().split(" ")[0])||"there",manage=r.booking_token?BOOK_MANAGE+r.booking_token:null;
    const mailFn=String(r.tenant_id||"")===DEMO_TENANT?"demo-send-email":"send-email";
    const resp=await fetch(Deno.env.get("SUPABASE_URL")+`/functions/v1/${mailFn}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`},body:JSON.stringify({to:r.contact_email,tenant_id:r.tenant_id||undefined,subject:kind==="1h"?`See you soon — ${r.eventType} at ${new Date(y,m-1,d,hh,mm).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})} ET`:`Reminder — ${r.eventType} tomorrow`,html:`<p>Hi <strong>${first}</strong>,</p><p>${kind==="1h"?"Your appointment is coming up within the hour:":"A quick reminder about your appointment:"}</p><p style="line-height:1.9"><strong>${r.eventType}</strong><br>${whenLabel}</p>${manage?`<p>Need to change it? <a href="${manage}">Reschedule</a> · <a href="${manage}?cancel=1">Cancel</a></p>`:`<p>Need to change it? Reply to this email or give us a call.</p>`}`})});
    if(resp.ok){await supabase.from("calevents").update(kind==="1h"?{reminder_1_sent:true}:{reminder_24_sent:true}).eq("id",r.id).eq("tenant_id",r.tenant_id);sent++;}else console.error("[booking-reminders] mail failed",mailFn,resp.status);
  }
  return json({ok:true,sent});
});
