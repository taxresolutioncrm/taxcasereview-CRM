import{b as s,j as e}from"./react-vendor-cHbyIcbo.js";import{u as Y,s as x,F as i}from"./index-TVnYKQHZ.js";import{I as U}from"./IRSFormFiller-Cu7Y5hDY.js";import"./supabase-C8W5_S3P.js";import"./signalwire-UjILrmut.js";import"./react-router-CmHBznGq.js";import"./irsFormUtils-4QaKWf0Q.js";import"./pdf-lib-D2rjcfyf.js";import"./financialIntakeSchema-CAxfr5YH.js";const z={formNumber:"2848",status:"Not Filed",client:"",caseNum:"",filedDate:"",notes:""},G=[{num:"1128",label:"Adopt, Change or Retain Tax Year",url:"https://www.irs.gov/pub/irs-pdf/f1128.pdf",formType:"1128"},{num:"12153",label:"CDP Hearing Request",url:"https://www.irs.gov/pub/irs-pdf/f12153.pdf",formType:"12153"},{num:"12661",label:"Disputed Issue Verification",url:"https://www.irs.gov/pub/irs-pdf/f12661.pdf",formType:"12661"},{num:"2553",label:"S-Corp Election",url:"https://www.irs.gov/pub/irs-pdf/f2553.pdf",formType:"2553"},{num:"2848",label:"Power of Attorney",url:"https://www.irs.gov/pub/irs-pdf/f2848.pdf",formType:"2848"},{num:"433-A",label:"Collection Info (Individual)",url:"https://www.irs.gov/pub/irs-pdf/f433a.pdf",formType:"433a"},{num:"433-B",label:"Collection Info (Business)",url:"https://www.irs.gov/pub/irs-pdf/f433b.pdf",formType:"433b"},{num:"433-D",label:"Installment Agreement",url:"https://www.irs.gov/pub/irs-pdf/f433d.pdf",formType:"433d"},{num:"433-F",label:"Collection Info (General)",url:"https://www.irs.gov/pub/irs-pdf/f433f.pdf",formType:"433f"},{num:"433-H",label:"Installment Agreement Request & CIS",url:"https://www.irs.gov/pub/irs-pdf/f433h.pdf",formType:"433h"},{num:"4506-T",label:"Request for Transcript",url:"https://www.irs.gov/pub/irs-pdf/f4506t.pdf",formType:"4506t"},{num:"4549",label:"Exam Changes (Audit)",url:"https://www.irs.gov/pub/irs-pdf/f4549.pdf",formType:"4549"},{num:"656",label:"Offer in Compromise",url:"https://www.irs.gov/pub/irs-pdf/f656.pdf",formType:"656"},{num:"656-L",label:"OIC — Doubt as to Liability",url:"https://www.irs.gov/pub/irs-pdf/f656l.pdf",formType:"656l"},{num:"843",label:"Penalty Abatement",url:"https://www.irs.gov/pub/irs-pdf/f843.pdf",formType:"843"},{num:"8821",label:"Tax Info Authorization",url:"https://www.irs.gov/pub/irs-pdf/f8821.pdf",formType:"8821"},{num:"8822",label:"Change of Address (Individual)",url:"https://www.irs.gov/pub/irs-pdf/f8822.pdf",formType:"8822"},{num:"8822-B",label:"Change of Address (Business)",url:"https://www.irs.gov/pub/irs-pdf/f8822b.pdf",formType:"8822b"},{num:"8832",label:"Entity Classification",url:"https://www.irs.gov/pub/irs-pdf/f8832.pdf",formType:"8832"},{num:"911",label:"Taxpayer Advocate",url:"https://www.irs.gov/pub/irs-pdf/f911.pdf",formType:"911"},{num:"9465",label:"Installment Agreement",url:"https://www.irs.gov/pub/irs-pdf/f9465.pdf",formType:"9465"},{num:"SS-4",label:"Apply for EIN",url:"https://www.irs.gov/pub/irs-pdf/fss4.pdf",formType:"ss4"}];function K(r){return`
    <div style="text-align:center;margin-bottom:24px;border-bottom:2px solid #1A7FD4;padding-bottom:16px">
      <img src="${i.logoUrl}" style="height:48px;margin-bottom:8px" onerror="this.style.display='none'"/>
      <div style="font-size:20px;font-weight:700;color:#1A7FD4">${i.name}</div>
      <div style="font-size:11px;color:#666">${i.address} · ${i.email}</div>
      <div style="font-size:16px;font-weight:700;margin-top:10px;color:#111">${r}</div>
    </div>`}function v(r="Client Signature",l="Authorized Representative"){return`
    <div style="display:flex;gap:40px;margin-top:32px">
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555">
        ${r}<br/>Date: ___________________
      </div>
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555">
        ${l} — ${i.name}<br/>Date: ___________________
      </div>
    </div>`}function b(r,l){const p=window.open("","_blank","width=860,height=1000");p.document.write(`<!DOCTYPE html><html><head>
    <title>${r}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:40px 48px;max-width:800px;margin:0 auto}
      h3{color:#1A7FD4;margin:18px 0 6px}
      p{margin:6px 0;line-height:1.6}
      ul{margin:6px 0;padding-left:20px;line-height:1.7}
      .fee-box{border:2px solid #1A7FD4;border-radius:6px;padding:12px 16px;margin:16px 0;background:#f0f7ff}
      .fee-box b{font-size:14px}
      @media print{body{padding:24px}}
    </style>
  </head><body>
    ${K(r)}
    ${l}
  </body></html>`),p.document.close(),setTimeout(()=>p.print(),400)}function V(){b("Tax Investigation Service Agreement",`
    <p>This Tax Investigation Service Agreement ("Agreement") is entered into between <b>${i.name}</b> ("Company") and the undersigned client ("Client") as of the date signed below.</p>

    <h3>1. Scope of Services</h3>
    <p>The Company agrees to perform an initial tax investigation, which includes review of tax transcripts, identification of IRS or state tax liabilities, evaluation of available resolution programs, and preparation of a written summary of findings and recommended resolution strategy.</p>

    <h3>2. Company Obligations</h3>
    <ul>
      <li>Obtain IRS transcripts via Form 2848 or 8821</li>
      <li>Analyze outstanding tax liabilities and compliance history</li>
      <li>Identify applicable IRS resolution programs (OIC, CNC, IA, Abatement, etc.)</li>
      <li>Deliver a written resolution recommendation within 21 business days of full access being granted</li>
      <li>Assign a dedicated case representative to the Client</li>
    </ul>

    <h3>3. Client Obligations</h3>
    <ul>
      <li>Provide accurate and complete personal, financial, and tax information</li>
      <li>Execute IRS authorization forms (2848 / 8821) promptly</li>
      <li>Respond to company requests for documents within 5 business days</li>
      <li>Pay the investigation fee in full prior to commencement of services</li>
    </ul>

    <h3>4. Tax Investigation Fee</h3>
    <div class="fee-box">
      <b>Investigation Fee: $___________</b><br/>
      <span style="font-size:11px;color:#555">(Standard fee: $499 – $699. Manager-approved rates may vary.)</span><br/>
      <span style="font-size:11px">This fee is non-refundable once transcript review has commenced.</span>
    </div>

    <h3>5. Not a Law Firm</h3>
    <p>${i.name} is a tax resolution consulting firm and is <b>not a law firm</b>. No attorney-client relationship is created by this agreement. The Company does not provide legal advice. Enrolled Agents and/or licensed tax professionals perform all representation services.</p>

    <h3>6. No Guarantee of Outcome</h3>
    <p>The Company makes no guarantee as to the specific outcome of any IRS or state tax resolution matter. Acceptance into any IRS program (including Offer in Compromise) is solely at the discretion of the IRS.</p>

    <h3>7. Termination</h3>
    <p>Either party may terminate this Agreement with 5 business days written notice. Investigation fees already paid are non-refundable once services have commenced. The Company may terminate immediately for non-cooperation or material misrepresentation by the Client.</p>

    <h3>8. Dispute Resolution / Arbitration</h3>
    <p>Any dispute arising from this Agreement shall be resolved by binding arbitration under the rules of the American Arbitration Association in Palm Beach County, Florida. Both parties waive their right to a jury trial.</p>

    <h3>9. Governing Law</h3>
    <p>This Agreement is governed by the laws of the State of Florida.</p>

    ${v("Client Signature","Authorized Representative — ${FIRM.name}")}
    <p style="font-size:10px;color:#888;margin-top:20px;text-align:center">
      ${i.name} · ${i.address} · ${i.email} · Not a law firm
    </p>
  `)}function J(){b("Service Addendum — Additional Services Agreement",`
    <p>This Addendum ("Addendum") supplements the Tax Investigation Service Agreement previously executed between <b>${i.name}</b> ("Company") and the undersigned client ("Client") and is incorporated therein by reference.</p>

    <h3>1. Additional Services Authorized</h3>
    <p>Client authorizes the Company to proceed with the following additional resolution services beyond the initial tax investigation:</p>
    <ul>
      <li>Full IRS / State representation and negotiation</li>
      <li>Preparation and submission of resolution application (as applicable)</li>
      <li>Power of Attorney representation before the IRS and/or state tax authorities</li>
      <li>Filing of any delinquent returns required for resolution eligibility</li>
      <li>Ongoing case management through resolution acceptance or closure</li>
    </ul>

    <h3>2. Additional Service Fee</h3>
    <div class="fee-box">
      <b>Additional Service Fee: $___________</b><br/>
      <span style="font-size:11px;color:#555">Payment plan: $___________ /month · Starting: ___________</span><br/>
      <span style="font-size:11px">Fees for additional services are separate from and in addition to the investigation fee.</span>
    </div>

    <h3>3. Conditions</h3>
    <p>Services under this Addendum are contingent upon: (a) Client remaining current on any required tax filings; (b) Client maintaining compliance with any IRS or state payment agreements during representation; (c) Timely payment of fees as agreed.</p>

    <h3>4. Incorporation</h3>
    <p>All terms of the original Tax Investigation Service Agreement remain in full force and effect and are incorporated herein. In the event of conflict, this Addendum controls.</p>

    ${v("Client Signature","Authorized Representative — ${FIRM.name}")}
    <p style="font-size:10px;color:#888;margin-top:20px;text-align:center">
      ${i.name} · ${i.address} · ${i.email} · Not a law firm
    </p>
  `)}function Q(){b("Engagement Letter",`
    <p>Dear Client,</p>
    <p>Thank you for choosing <b>${i.name}</b>. We are pleased to confirm our engagement to assist you with your federal and/or state tax resolution matter. This letter outlines the terms of our engagement.</p>

    <h3>Services to Be Performed</h3>
    <ul>
      <li>Review your tax transcripts and compliance history with the IRS and/or applicable state taxing authority</li>
      <li>Identify all outstanding liabilities and unfiled returns</li>
      <li>Evaluate eligibility for IRS resolution programs including Installment Agreement, Currently Not Collectible status, Offer in Compromise, Penalty Abatement, and/or Innocent Spouse relief</li>
      <li>Represent you before the IRS and/or state tax authority through resolution</li>
    </ul>

    <h3>Your Responsibilities</h3>
    <ul>
      <li>Provide complete and accurate financial and tax information</li>
      <li>Execute all necessary authorization forms promptly</li>
      <li>Notify us immediately of any IRS or state contacts, notices, or levies received</li>
      <li>Fulfill all payment obligations under this engagement</li>
    </ul>

    <h3>Important Disclosures</h3>
    <p>${i.name} is a tax resolution firm staffed by Enrolled Agents and licensed tax professionals. We are <b>not a law firm</b> and do not provide legal advice. Results in tax resolution matters cannot be guaranteed, as final decisions rest with the IRS or applicable state agency.</p>

    <p>We are committed to providing you with diligent, professional representation. Please do not hesitate to contact our office with any questions.</p>

    <p style="margin-top:16px">Sincerely,</p>
    <p><b>${i.name}</b><br/>${i.address}<br/>${i.email}</p>

    ${v("Client Acknowledgment","Authorized Representative — ${FIRM.name}")}
    <p style="font-size:10px;color:#888;margin-top:20px;text-align:center">
      ${i.name} · ${i.address} · ${i.email} · Not a law firm
    </p>
  `)}function X(){b("Power of Attorney Cover Letter",`
    <p style="text-align:right;color:#555;font-size:11px">Date: ___________________</p>

    <p><b>Internal Revenue Service</b><br/>
    [IRS Address / Compliance Center]</p>

    <p><b>Re: Power of Attorney — Form 2848<br/>
    Taxpayer: _____________________________ · SSN/EIN: _____________________________<br/>
    Tax Year(s): _____________________________________________________________</b></p>

    <p>Dear IRS Representative,</p>

    <p>Please find enclosed a completed and executed Form 2848, Power of Attorney and Declaration of Representative, authorizing <b>${i.name}</b> to represent the above-named taxpayer before the Internal Revenue Service.</p>

    <p>Effective immediately, please direct all correspondence, notices, and communications regarding the above-referenced taxpayer and tax period(s) to our office:</p>

    <div style="border-left:3px solid #1A7FD4;padding-left:16px;margin:16px 0">
      <b>${i.name}</b><br/>
      631 US Highway One Ste 304<br/>
      North Palm Beach, FL 33408<br/>
      Phone: (561) ___-____<br/>
      Fax: (561) ___-____<br/>
      Email: ${i.email}
    </div>

    <p>Our authorized representative(s) are Enrolled Agents licensed to practice before the IRS. We respectfully request that all future contact regarding this matter be made through our office so that we may best serve our client's interests.</p>

    <p>If there are any questions regarding this authorization, please contact our office directly. We appreciate your cooperation.</p>

    <p style="margin-top:16px">Respectfully submitted,</p>

    <div style="margin-top:40px;border-top:1px solid #333;width:280px;padding-top:6px;font-size:11px;color:#555">
      Authorized Representative — ${i.name}<br/>
      Enrolled Agent / Licensed Professional<br/>
      Date: ___________________
    </div>

    <p style="font-size:10px;color:#888;margin-top:24px;text-align:center">
      ${i.name} · ${i.address} · ${i.email} · Not a law firm
    </p>
  `)}function le(){const{user:r}=Y(),[l,p]=s.useState([]),[D,f]=s.useState(!1),[o,y]=s.useState(z),[w,S]=s.useState(!1),[j,C]=s.useState(""),[A,k]=s.useState([]),[I,T]=s.useState(null),[u,$]=s.useState(""),[h,R]=s.useState(""),[P,g]=s.useState(!1);s.useEffect(()=>{r&&(_(),E())},[r==null?void 0:r.id]);async function _(){const{data:t}=await x.from("irsforms").select("*").order("created_at",{ascending:!1});t&&p(t)}async function E(){const{data:t,error:n}=await x.from("clients").select("id, name, business_name, street, city, state, zip, phone, email, ssn, ein").order("name");if(n){console.error("loadClients error:",n.message);return}t&&k(t)}function c(t){C(t),setTimeout(()=>C(""),3e3)}function d(t,n){y(a=>({...a,[t]:n}))}async function O(){if(!o.formNumber){c("Form number required");return}S(!0);const{error:t}=await x.from("irsforms").insert([{...o,created_at:new Date().toISOString()}]);if(S(!1),t){c("Error: "+t.message);return}c("IRS Form logged!"),f(!1),y(z),_()}async function B(t){const{error:n}=await x.from("irsforms").delete().eq("id",t);if(n){c("Error: "+n.message);return}c("Deleted"),_()}function L(t,n){const a=t.business_name||t.name||"",m=[t.street,t.city,t.state,t.zip].filter(Boolean).join(", "),q=t.ssn?`SSN: ${t.ssn}`:"",M=t.ein?`EIN: ${t.ein}`:"",H=[q,M].filter(Boolean).join("  |  "),N=new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}),F=window.open("","_blank","width=900,height=700");F.document.write(`<!DOCTYPE html><html><head>
      <title>Form ${n.num} — ${a}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:36px 48px;max-width:800px;margin:0 auto}
        .header{text-align:center;border-bottom:2px solid #1A7FD4;padding-bottom:16px;margin-bottom:24px}
        .firm{font-size:18px;font-weight:700;color:#1A7FD4}
        .meta{font-size:11px;color:#666;margin-top:4px}
        .box{border:1px solid #ddd;border-radius:6px;padding:14px 18px;margin-bottom:16px;background:#f8faff}
        .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:3px}
        .val{font-size:13px;font-weight:600;color:#111}
        .form-link{display:inline-block;margin-top:20px;padding:10px 24px;background:#1A7FD4;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px}
        .notice{margin-top:24px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:12px}
        @media print{.form-link{display:none}}
      </style>
    </head><body>
      <div class="header">
        <img src="${i.logoUrl}" style="height:44px;margin-bottom:8px" onerror="this.style.display='none'"/>
        <div class="firm">${i.name}</div>
        <div class="meta">${i.address||""} · ${i.phone||""} · ${i.email||""}</div>
      </div>

      <h2 style="font-size:15px;margin-bottom:16px">IRS Form ${n.num} — ${n.label}</h2>
      <p style="margin-bottom:16px;color:#444">Prepared for:</p>

      <div class="box">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><div class="label">Taxpayer Name</div><div class="val">${a}</div></div>
          <div><div class="label">Taxpayer ID</div><div class="val">${H||"—"}</div></div>
          <div><div class="label">Address</div><div class="val">${m||"—"}</div></div>
          <div><div class="label">Date Prepared</div><div class="val">${N}</div></div>
          ${t.phone?`<div><div class="label">Phone</div><div class="val">${t.phone}</div></div>`:""}
          ${t.email?`<div><div class="label">Email</div><div class="val">${t.email}</div></div>`:""}
        </div>
      </div>

      <a href="${n.url}" target="_blank" class="form-link">📄 Open Form ${n.num} (Official IRS PDF)</a>

      <div class="notice">
        This cover sheet was generated by ${i.name} on ${N}. Complete and sign the attached IRS form. 
        Contact us at ${i.phone||i.email||""} with any questions.
      </div>
    </body></html>`),F.document.close(),setTimeout(()=>{window.open(n.url,"_blank")},300)}const W={"Not Filed":"bn",Draft:"ba",Sent:"bb",Filed:"bg","Pending IRS":"ba","In Review":"ba",Approved:"bg",Missing:"br"};return e.jsxs("div",{style:{padding:"20px 24px",maxWidth:1100,margin:"0 auto"},children:[j&&e.jsx("div",{className:"toast show",children:j}),e.jsxs("div",{style:{marginBottom:20},children:[e.jsx("h2",{style:{fontSize:17,fontWeight:700,margin:0},children:"📋 IRS Forms & Documents"}),e.jsx("p",{style:{fontSize:12,color:"var(--t3)",margin:"4px 0 0"},children:"Download official IRS forms, pre-fill with client data, and manage POA."})]}),e.jsxs("div",{className:"card",style:{marginBottom:20},children:[e.jsxs("div",{className:"ch",children:[e.jsx("span",{className:"ct",children:"📋 IRS Forms & Documents"}),e.jsx("span",{style:{fontSize:12,color:"var(--t2)"},children:"Select a client to pre-fill any form, or open blank"})]}),e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:12,padding:"4px 0",flexWrap:"wrap"},children:[e.jsxs("div",{style:{position:"relative",flex:1,maxWidth:340},children:[e.jsx("input",{value:h,onChange:t=>{R(t.target.value),$(""),g(!0)},onFocus:()=>g(!0),onBlur:()=>setTimeout(()=>g(!1),150),placeholder:"Search client name to pre-fill…",style:{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:13,background:"var(--s2)",color:"var(--tx)",boxSizing:"border-box"}}),P&&h&&(()=>{const t=h.toLowerCase(),n=A.filter(a=>(a.name||"").toLowerCase().includes(t)||(a.business_name||"").toLowerCase().includes(t)).slice(0,10);return n.length>0?e.jsx("div",{style:{position:"absolute",top:"100%",left:0,right:0,background:"var(--sf)",border:"1px solid var(--br)",borderRadius:8,zIndex:50,maxHeight:220,overflowY:"auto",boxShadow:"0 4px 16px rgba(0,0,0,.25)"},children:n.map(a=>e.jsx("div",{onMouseDown:()=>{$(a.id),R(a.business_name||a.name),g(!1)},style:{padding:"9px 14px",cursor:"pointer",fontSize:13,color:"var(--tx)",borderBottom:"1px solid var(--br)"},onMouseEnter:m=>m.currentTarget.style.background="var(--s2)",onMouseLeave:m=>m.currentTarget.style.background="",children:a.business_name||a.name},a.id))}):e.jsx("div",{style:{position:"absolute",top:"100%",left:0,right:0,background:"var(--sf)",border:"1px solid var(--br)",borderRadius:8,zIndex:50,padding:"10px 14px",fontSize:13,color:"var(--t3)"},children:"No clients found"})})()]}),u&&e.jsxs("span",{style:{fontSize:12,color:"var(--ok)",fontWeight:700},children:["✅ ",h," selected — click ✏️ Pre-fill on any form below"]})]}),e.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(240px, 1fr))",gap:10,padding:"16px 0 4px"},children:G.map(t=>e.jsxs("div",{style:{background:"var(--s2)",border:"1px solid var(--br)",borderRadius:10,padding:"10px 14px"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:8},children:[e.jsx("span",{style:{background:"var(--blue)",color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,flexShrink:0},children:t.num}),e.jsx("span",{style:{fontSize:12,fontWeight:600,color:"var(--tx)",lineHeight:1.3},children:t.label})]}),e.jsxs("div",{style:{display:"flex",gap:6},children:[e.jsx("a",{href:t.url,target:"_blank",rel:"noreferrer",style:{flex:1,textDecoration:"none"},children:e.jsx("button",{className:"btn sec",style:{width:"100%",fontSize:11,padding:"5px 8px",justifyContent:"center"},children:"📄 Blank"})}),e.jsx("button",{className:"btn pri",style:{flex:1,fontSize:11,padding:"5px 8px",justifyContent:"center",opacity:u?1:.45},disabled:!u,onClick:()=>{const n=A.find(a=>a.id===u);n&&(t.formType?T({...n,address:n.street,business_name:n.business_name,_formType:t.formType}):L(n,t))},children:"✏️ Pre-fill"})]})]},t.num))})]}),e.jsxs("div",{className:"card",style:{marginBottom:20},children:[e.jsxs("div",{className:"ch",children:[e.jsx("span",{className:"ct",children:"Document Templates"}),e.jsx("span",{style:{fontSize:12,color:"var(--t2)"},children:"Opens print-ready PDF window"})]}),e.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:10,padding:"4px 0"},children:[{icon:"📄",label:`Tax Investigation
Service Agreement`,desc:"Full TCR agreement w/ fees & signatures",action:V,color:"var(--blue)"},{icon:"📋",label:`Service
Addendum`,desc:"Supplemental agreement for additional services",action:J,color:"#25A25A"},{icon:"✉️",label:`Engagement
Letter`,desc:"Client engagement confirmation letter",action:Q,color:"#7B5EA7"},{icon:"🔐",label:`POA Cover
Letter`,desc:"Form 2848 cover letter to IRS",action:X,color:"#D4930A"}].map(t=>e.jsxs("button",{className:"btn sec",onClick:t.action,style:{display:"flex",flexDirection:"column",alignItems:"flex-start",padding:"12px 14px",gap:4,height:"auto",borderLeft:`3px solid ${t.color}`},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,width:"100%"},children:[e.jsx("span",{style:{fontSize:18},children:t.icon}),e.jsx("span",{style:{fontWeight:700,fontSize:12,lineHeight:1.3,whiteSpace:"pre-line",textAlign:"left"},children:t.label})]}),e.jsx("span",{style:{fontSize:11,color:"var(--t2)",textAlign:"left",lineHeight:1.4},children:t.desc})]},t.label))})]}),e.jsxs("div",{className:"card",children:[e.jsxs("div",{className:"ch",children:[e.jsxs("span",{className:"ct",children:["IRS Form Tracker (",l.length,")"]}),e.jsx("button",{className:"btn pri",onClick:()=>f(!0),children:"+ Log IRS Form"})]}),e.jsx("div",{className:"ovx",children:e.jsxs("table",{children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{children:"Form"}),e.jsx("th",{children:"Client"}),e.jsx("th",{children:"Case #"}),e.jsx("th",{children:"Filed Date"}),e.jsx("th",{children:"Status"}),e.jsx("th",{children:"Notes"}),e.jsx("th",{})]})}),e.jsx("tbody",{children:l.length===0?e.jsx("tr",{children:e.jsx("td",{colSpan:7,style:{textAlign:"center",color:"var(--t3)",padding:20},children:"No IRS forms logged yet"})}):l.map(t=>e.jsxs("tr",{children:[e.jsx("td",{children:e.jsxs("span",{className:"bdg bb",style:{fontWeight:700},children:["Form ",t.formNumber]})}),e.jsx("td",{style:{fontWeight:600},children:t.client||"—"}),e.jsx("td",{style:{color:"var(--t2)"},children:t.caseNum||"—"}),e.jsx("td",{style:{color:"var(--t2)"},children:t.filedDate||"—"}),e.jsx("td",{children:e.jsx("span",{className:`bdg ${W[t.status]||"bn"}`,children:t.status})}),e.jsx("td",{style:{color:"var(--t2)",fontSize:12},children:t.notes||"—"}),e.jsx("td",{children:e.jsx("button",{className:"btn del",onClick:()=>B(t.id),children:"Del"})})]},t.id))})]})})]}),D&&e.jsx("div",{className:"modal-bg open",onClick:t=>t.target===t.currentTarget&&f(!1),children:e.jsxs("div",{className:"modal",children:[e.jsxs("div",{className:"mh",children:[e.jsx("span",{className:"mt",children:"Log IRS Form"}),e.jsx("button",{className:"xbtn",onClick:()=>f(!1),children:"×"})]}),e.jsxs("div",{className:"fg2",children:[e.jsxs("div",{className:"field",children:[e.jsx("label",{children:"Form Number"}),e.jsx("select",{value:o.formNumber,onChange:t=>d("formNumber",t.target.value),children:["2848","8821","433-A","433-B","433-F","656","9465","843","911","4506-T"].map(t=>e.jsx("option",{children:t},t))})]}),e.jsxs("div",{className:"field",children:[e.jsx("label",{children:"Status"}),e.jsx("select",{value:o.status,onChange:t=>d("status",t.target.value),children:["Not Filed","Draft","Sent","Filed","Pending IRS","In Review","Approved","Missing"].map(t=>e.jsx("option",{children:t},t))})]})]}),e.jsxs("div",{className:"fg2",children:[e.jsxs("div",{className:"field",children:[e.jsx("label",{children:"Client"}),e.jsx("input",{value:o.client,onChange:t=>d("client",t.target.value),placeholder:"Client name"})]}),e.jsxs("div",{className:"field",children:[e.jsx("label",{children:"Case #"}),e.jsx("input",{value:o.caseNum,onChange:t=>d("caseNum",t.target.value),placeholder:"Case number"})]})]}),e.jsxs("div",{className:"fg2",children:[e.jsxs("div",{className:"field",children:[e.jsx("label",{children:"Filed Date"}),e.jsx("input",{type:"date",value:o.filedDate,onChange:t=>d("filedDate",t.target.value)})]}),e.jsxs("div",{className:"field",children:[e.jsx("label",{children:"Notes"}),e.jsx("input",{value:o.notes,onChange:t=>d("notes",t.target.value),placeholder:"Optional notes"})]})]}),e.jsx("button",{className:"btn pri",style:{width:"100%",justifyContent:"center",padding:10},onClick:O,disabled:w,children:w?"Saving...":"Log IRS Form"})]})}),I&&e.jsx(U,{client:I,onClose:()=>T(null)})]})}export{le as default};
