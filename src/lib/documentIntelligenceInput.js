export async function prepareFileForDocumentAI(file, options={}) {
  if (!file) return { extractedText:'', pageImages:[] }
  const maxText = Number(options.maxText || 180000)
  const maxPages = Number(options.maxPages || 12)
  const name = String(file.name || '').toLowerCase()
  const type = String(file.type || '').toLowerCase()

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const buf = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: buf }).promise
    const textPages = []
    for (let p=1; p<=pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const text = (content.items || []).map(it=>String(it?.str || '')).filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
      if (text) textPages.push('[Page '+p+']\n'+text)
      if (textPages.join('\n\n').length >= maxText) break
    }
    const extractedText = textPages.join('\n\n').slice(0,maxText)
    if (extractedText.replace(/\s/g,'').length >= 120) {
      try { pdf.destroy() } catch {}
      return { extractedText, pageImages:[] }
    }

    const pageImages = []
    let encodedBytes = 0
    const pages = Math.min(pdf.numPages, maxPages)
    for (let p=1; p<=pages; p++) {
      const page = await pdf.getPage(p)
      const viewport0 = page.getViewport({ scale:1 })
      const targetWidth = Math.min(1400, Math.max(900, viewport0.width * 1.4))
      const scale = targetWidth / viewport0.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d', { alpha:false })
      if (!ctx) continue
      await page.render({ canvasContext:ctx, viewport }).promise
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78)
      const data = dataUrl.split(',')[1] || ''
      encodedBytes += data.length
      if (encodedBytes > 9_000_000) break
      pageImages.push({ mediaType:'image/jpeg', data, page:p })
    }
    try { pdf.destroy() } catch {}
    return { extractedText:'', pageImages }
  }

  if (type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name)) {
    const dataUrl = await new Promise((resolve,reject)=>{
      const reader = new FileReader()
      reader.onerror=()=>reject(reader.error || new Error('Could not read image'))
      reader.onload=()=>resolve(String(reader.result || ''))
      reader.readAsDataURL(file)
    })
    return {
      extractedText:'',
      pageImages:[{ mediaType:(type || 'image/jpeg').replace('image/jpg','image/jpeg'), data:String(dataUrl).split(',')[1] || '', page:1 }],
    }
  }

  if (type.startsWith('text/') || /\.(csv|txt|json|xml|rtf)$/i.test(name)) {
    return { extractedText:(await file.text()).slice(0,maxText), pageImages:[] }
  }

  return { extractedText:'', pageImages:[] }
}

export async function prepareStoredDocumentForAI(doc, supabase, options={}) {
  let url = String(doc?.file_url || '')
  if (doc?.storage_path) {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 900)
    if (error) throw error
    url = data?.signedUrl || ''
  } else if (url.startsWith('storage://documents/')) {
    const path = url.replace('storage://documents/','')
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 900)
    if (error) throw error
    url = data?.signedUrl || ''
  }
  if (!url) return { extractedText:'', pageImages:[] }
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not read source document for AI')
  const blob = await response.blob()
  const name = String(doc?.file_name || doc?.name || 'document')
  const file = new File([blob], name, { type: blob.type || '' })
  return prepareFileForDocumentAI(file, options)
}
