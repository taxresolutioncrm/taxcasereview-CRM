import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { supabase } from '../../lib/supabase'

let stripePromise = null
function getStripe(pk) {
  if (!stripePromise) stripePromise = loadStripe(pk)
  return stripePromise
}

function PayForm({ caseId, paymentIntentId, amount, onPaid, onClose }) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying,setPaying]=useState(false)
  const [err,setErr]=useState('')

  async function pay() {
    if (!stripe || !elements || paying) return
    setPaying(true); setErr('')
    const { error } = await stripe.confirmPayment({elements,redirect:'if_required'})
    if (error) { setErr(error.message || 'Payment failed'); setPaying(false); return }
    const { data, error:confirmErr } = await supabase.functions.invoke('stripe-formacorp-fee-confirm',{
      body:{caseId,paymentIntentId}
    })
    setPaying(false)
    if (confirmErr || data?.error) { setErr(data?.error || confirmErr?.message || 'Payment confirmation failed'); return }
    onPaid?.(data)
  }

  return <div>
    <PaymentElement/>
    {err && <div style={{color:'#f87171',fontSize:12,marginTop:10}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:16}}>
      <button className="btn" onClick={onClose} disabled={paying}>Cancel</button>
      <button className="btn pri" onClick={pay} disabled={paying || !stripe}>
        {paying?'Processing…':`Pay $${Number(amount||0).toFixed(2)}`}
      </button>
    </div>
  </div>
}

export default function FormaCorpFeePaymentModal({ caseRecord, onClose, onPaid }) {
  const [clientSecret,setClientSecret]=useState(null)
  const [paymentIntentId,setPaymentIntentId]=useState(null)
  const [amount,setAmount]=useState(0)
  const [publishableKey,setPublishableKey]=useState(null)
  const [err,setErr]=useState('')

  useEffect(()=>{
    let cancelled=false
    async function init(){
      const { data:s } = await supabase.from('settings').select('stripe_publishable_key,payment_provider').limit(1).maybeSingle()
      if(cancelled) return
      if(s?.payment_provider && s.payment_provider!=='stripe'){
        setErr('This office does not have Stripe selected as its payment processor.')
        return
      }
      if(!s?.stripe_publishable_key){
        setErr('Online card/bank payments are not configured for this office.')
        return
      }
      setPublishableKey(s.stripe_publishable_key)
      const { data,error } = await supabase.functions.invoke('stripe-formacorp-fee-intent',{body:{caseId:caseRecord.id}})
      if(cancelled) return
      if(error || data?.error){
        setErr(data?.error || error?.message || 'Could not initialize payment')
        return
      }
      setClientSecret(data.client_secret)
      setPaymentIntentId(data.payment_intent_id)
      setAmount(Number(data.amount||0))
    }
    init()
    return ()=>{cancelled=true}
  },[caseRecord.id])

  return <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal" style={{maxWidth:480}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontWeight:800,fontSize:15}}>Pay State Filing Funds</div>
        <button className="btn sm" onClick={onClose}>✕</button>
      </div>
      <div style={{fontSize:11,color:'var(--t3)',lineHeight:1.5,marginBottom:12}}>
        Payment is collected securely inside FormaCorp. This records filing funds received; the case is not marked paid to the state until the state filing channel actually deducts or charges the government fee.
      </div>
      {err && <div style={{fontSize:12,color:'var(--err)',marginBottom:10}}>{err}</div>}
      {clientSecret && publishableKey ? <Elements stripe={getStripe(publishableKey)} options={{clientSecret}}>
        <PayForm caseId={caseRecord.id} paymentIntentId={paymentIntentId} amount={amount} onClose={onClose}
          onPaid={d=>{onPaid?.(d); onClose()}}/>
      </Elements> : !err ? <div style={{padding:18,textAlign:'center',color:'var(--t3)'}}>Loading secure payment form…</div> : null}
    </div>
  </div>
}
