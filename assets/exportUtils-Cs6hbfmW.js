import{F as e}from"./index-CG71_oGn.js";function c(r,o){const a=r.map(n=>n.map(d=>`"${String(d??"").replace(/"/g,'""')}"`).join(",")).join(`
`),i=new Blob([a],{type:"text/csv"}),t=document.createElement("a");t.href=URL.createObjectURL(i),t.download=o.endsWith(".csv")?o:o+".csv",t.click()}function s(r,o){const a=window.open("","_blank"),i=new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});a.document.write(`<!DOCTYPE html><html><head><title>${r}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 32px; color: #1e293b; }
    h1 { font-size: 20px; font-weight: 800; color: #1e3a8a; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 24px; }
    h2 { font-size: 14px; font-weight: 700; margin: 24px 0 8px; color: #1e3a8a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
    th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border: 1px solid #e2e8f0; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 32px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    @media print { body { padding: 16px; } }
  </style></head><body>
  ${e.logoUrl?`<img src="${e.logoUrl}" alt="${e.name||"Firm"}" style="max-height:52px;max-width:190px;object-fit:contain;margin-bottom:10px" onerror="this.style.display='none'"/>`:""}
  <h1>${r}</h1>
  <div class="meta">${e.name||"Firm"} · Generated ${i}</div>
  ${o.map(t=>`
    <h2>${t.heading}</h2>
    <table>
      ${t.headers?`<thead><tr>${t.headers.map(n=>`<th>${n}</th>`).join("")}</tr></thead>`:""}
      <tbody>${t.rows.map(n=>`<tr>${n.map(d=>`<td>${d??"—"}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `).join("")}
  <div class="footer">${[e.name,e.address,e.phone,e.email].filter(Boolean).join(" · ")}</div>
  </body></html>`),a.document.close(),setTimeout(()=>a.print(),400)}function m(r,o){const a=`<table>${r.map((n,d)=>`<tr>${n.map(p=>d===0?`<th><b>${p}</b></th>`:`<td>${p??""}</td>`).join("")}</tr>`).join("")}</table>`,i=new Blob([`<html><head><meta charset="UTF-8"></head><body>${a}</body></html>`],{type:"application/vnd.ms-excel"}),t=document.createElement("a");t.href=URL.createObjectURL(i),t.download=o.endsWith(".xls")?o:o+".xls",t.click()}export{m as a,s as b,c as e};
