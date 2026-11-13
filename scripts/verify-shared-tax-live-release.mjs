import { createHash } from 'node:crypto'

// Read-only public Cloudflare deployment checks. No login credentials, database writes, or deployments.
const targets = [
  { office: 'TCR / TaxRes shared login', url: 'https://taxrescrm.app/login' },
  { office: 'Centurion', url: 'https://centurionfirm.taxrescrm.app/login' },
  { office: 'TaxRes shared password', url: 'https://taxrescrm.app/family-password?office=centurion' },
]
const requiredVersion = '3.2.114'
const results = []
async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(22000),
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'TaxResCRM-Live-Release-Audit/1.0' },
  })
  return { res, text: await res.text() }
}
for (const target of targets) {
  try {
    const {res, text: html} = await fetchText(target.url)
    const jsSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)].map(x => new URL(x[1],res.url).href)
    const loaded = []
    const discovered = [...jsSources]
    const seen = new Set()
    let versionSeen = html.includes(requiredVersion)
    for (let i=0; i<discovered.length && seen.size<80 && !versionSeen; i++) {
      const url = discovered[i]
      if (seen.has(url)) continue
      seen.add(url)
      try {
        const asset = await fetchText(url)
        if (!asset.res.ok || !/javascript|text\/plain|octet-stream/.test(asset.res.headers.get('content-type')||'')) continue
        loaded.push({url, http: asset.res.status, bytes:asset.text.length})
        versionSeen ||= asset.text.includes(requiredVersion)
        const references = [...asset.text.matchAll(/(?:["'(])((?:\/assets\/|\.\/)[\w.-]+\.js)(?:["')])/g)]
        for (const m of references) {
          if (discovered.length>=100) break
          const next = new URL(m[1],url).href
          if (!seen.has(next)) discovered.push(next)
        }
      } catch (e) {
        loaded.push({url, error: String(e)})
      }
    }
    const response = {
      office:target.office,requested:target.url,finalUrl:res.url,status:res.status,
      bytes:html.length,htmlSha256:createHash('sha256').update(html).digest('hex').slice(0,16),
      appHtml:html.includes('id="root"') || html.includes("id='root'"),
      scriptsFound:jsSources.length,scriptsFetched:loaded.filter(x=>x.http===200).length,
      releaseMarkerFound:versionSeen,
      sha:process.env.GITHUB_SHA?.slice(0,12)||null,
    }
    response.pass = response.status===200 && response.appHtml && response.scriptsFetched>0 && versionSeen
    results.push(response)
    console.log('LIVE_SHARED_TAX_CRM_PROBE '+JSON.stringify(response))
  } catch(e) {
    const error={office:target.office,requested:target.url,pass:false,error:String(e)}
    results.push(error)
    console.log('LIVE_SHARED_TAX_CRM_PROBE '+JSON.stringify(error))
  }
}
const failed=results.filter(r=>!r.pass)
console.log('LIVE_SHARED_TAX_CRM_SUMMARY '+JSON.stringify({checked:results.length,passed:results.length-failed.length,failed:failed.length,requiredVersion}))
if(failed.length) process.exitCode=1
