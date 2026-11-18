import {PDFDocument,StandardFonts,rgb} from 'pdf-lib'

// Source template for the existing RomyLabs Office Documents & E-Sign flow.
// Generates a reviewable PDF; the existing signature envelope sends the email.
export async function createRestoreRelayAgreementPdf({customer,monthlyPrice='399.99',months=6,additionalTerms=''}) {
  const name=String(customer||'').trim()
  if(!name)throw Error('Customer legal business name is required')
  const amount=Number(monthlyPrice)
  if(!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.00001||!Number.isInteger(Number(months))||Number(months)<1||Number(months)>36)throw Error('Invalid agreement price or term')
  const total=(Math.round(amount*100)*Number(months)/100).toFixed(2)
  const dollars=n=>'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
  const pdf=await PDFDocument.create()
  pdf.setTitle('Restore Relay SaaS Subscription Agreement — '+name)
  pdf.setAuthor('Romy Labs, LLC')
  const regular=await pdf.embedFont(StandardFonts.Helvetica)
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold)
  const W=612,H=792,M=52,line=14
  const purple=rgb(.16,.06,.36),gray=rgb(.24,.28,.34)
  let page=pdf.addPage([W,H]),y=H-M
  function nextPage(){page=pdf.addPage([W,H]);y=H-M}
  function write(txt,{size=10,strong=false,space=7,color=gray}={}){
    const font=strong?bold:regular
    const words=String(txt).split(/\s+/)
    let lines=[],current=''
    for(const word of words){
      const t=current?current+' '+word:word
      if(font.widthOfTextAtSize(t,size)>W-M*2&&current){lines.push(current);current=word}else current=t
    }
    if(current)lines.push(current)
    for(const s of lines){if(y<65)nextPage();page.drawText(s,{x:M,y,size,font,color});y-=line}
    y-=space
  }
  write('RESTORE RELAY',{size:19,strong:true,color:purple,space:2})
  write('SaaS Subscription & Services Agreement',{size:14,strong:true,color:purple,space:15})
  write('Provider: Romy Labs, LLC (the "Provider")')
  write('Customer: '+name+' (the "Customer")')
  write('Product: Restore Relay CRM — Professional Plan')
  write('Effective Date: Date the Customer signs this Agreement')
  write('1. SUBSCRIPTION AND SERVICES',{strong:true,color:purple})
  write('Provider grants Customer a limited, non-exclusive, non-transferable subscription to access Restore Relay, a hosted CRM for roofing operations, for Customer\'s internal business use. Included features are those shown in the subscribed plan and any written order agreed by both parties. The Professional Plan is represented as supporting up to 10 authorized users. Additional users, services, integrations, usage charges or third-party services require a separately disclosed and approved order.')
  write('2. TERM AND PRICE',{strong:true,color:purple})
  write('Initial fixed term: '+months+' consecutive monthly billing periods starting on the Effective Date or the mutually agreed service-activation date.')
  write('Monthly subscription: '+dollars(amount)+' per month. Number of installments: '+months+'. Total contracted subscription payments: '+dollars(total)+', excluding any applicable sales or similar taxes and separately agreed charges.')
  write('There is no automatic renewal beyond the initial term. Any renewal requires a new written agreement. Provider will not schedule recurring charges beyond the '+months+' agreed installments.')
  write('3. BILLING AND PAYMENT AUTHORIZATION',{strong:true,color:purple})
  write('The first monthly installment is due upon onboarding or service activation, as shown at secure checkout. Each remaining installment becomes due approximately one month after the preceding installment, for a total of '+months+' installments. Customer will enter its payment card or authorized bank-payment information directly into the secure payment provider checkout; Provider does not request payment credentials by email. Customer authorizes the disclosed recurring charge of '+dollars(amount)+' for no more than '+months+' installments. A failed charge does not authorize additional installments beyond the contracted term. Customer may request an invoice or payment receipt.')
  write('4. CUSTOMER RESPONSIBILITIES',{strong:true,color:purple})
  write('Customer will maintain accurate authorized user and billing contact information, safeguard credentials, comply with applicable laws, use the platform only for lawful business purposes, and obtain any notices or consents required for its data and communications. Customer is responsible for the accuracy of its business and job data.')
  write('5. HOSTING, SUPPORT AND SERVICE CHANGES',{strong:true,color:purple})
  write('Provider will make commercially reasonable efforts to provide platform access and standard support during the term, subject to scheduled maintenance, third-party services, and events outside Provider\'s reasonable control. Provider may apply security and maintenance updates without materially removing subscribed core features. Third-party SMS, calling, payment processing, and other usage-based services may have separate terms and costs disclosed before activation.')
  write('6. CUSTOMER DATA AND CONFIDENTIALITY',{strong:true,color:purple})
  write('Customer retains ownership of its business data. Provider may process Customer data to deliver, secure, support, and maintain the services under applicable privacy commitments. Each party will use reasonable safeguards for confidential information. Customer should export needed data before the end of service; post-termination retention and export follow the applicable written data-retention policy.')
  write('7. CANCELLATION, NONPAYMENT AND TERM END',{strong:true,color:purple})
  write('This Agreement is a fixed '+months+'-month commitment. Early termination or payment disputes should be handled in writing. Provider may suspend service for material nonpayment after reasonable notice and an opportunity to cure, or immediately for serious security or unlawful-use risks. At the end of the fixed term, the subscription does not automatically renew and future recurring billing must stop. Any refund or early-termination arrangement must be agreed in writing; nothing here overrides nonwaivable consumer or other applicable legal rights.')
  write('8. WARRANTIES AND LIABILITY',{strong:true,color:purple})
  write('Except as expressly stated, the platform is provided on an as-available basis to the fullest extent permitted by applicable law. Neither party excludes liability that cannot legally be excluded. Any specific service commitments or negotiated limits on liability require written agreement signed by both parties.')
  write('9. ENTIRE AGREEMENT AND ACCEPTANCE',{strong:true,color:purple})
  write('This Agreement and any expressly incorporated written order form are the agreement regarding this subscription. Changes must be agreed in writing. Florida law governs except where another mandatory law applies. Electronic signatures and electronic copies may be used to execute this Agreement.')
  if(String(additionalTerms||'').trim()){write('ADDITIONAL AGREED TERMS',{strong:true,color:purple});write(String(additionalTerms).trim())}
  if(y<190)nextPage()
  y-=12
  write('CUSTOMER AUTHORIZED REPRESENTATIVE',{size:11,strong:true,color:purple,space:12})
  write('Legal business: '+name)
  write('Printed name and title: _______________________________________________')
  const signatureTop=(H-y-15)/H
  write('Signature: __________________________________________________________')
  write('Date: __________________________')
  y-=6
  write('PROVIDER ACCEPTANCE',{size:11,strong:true,color:purple})
  write('Provider accepts this Agreement by activating the subscribed service after the Customer signs and completes the initial payment.')
  const out=await pdf.save()
  return {bytes:out,signaturePage:pdf.getPageCount(),signatureTop,fileName:'Restore-Relay-'+name.replace(/[^a-z0-9-]/gi,'-').replace(/-+/g,'-').slice(0,65)+'-Agreement.pdf'}
}
