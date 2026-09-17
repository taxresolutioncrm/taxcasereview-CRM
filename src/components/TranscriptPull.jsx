import TDSSessionPresence from './TDSSessionPresence'
import TranscriptPullCore from './TranscriptPullCore'

export default function TranscriptPull(props) {
  return (
    <>
      <TDSSessionPresence />
      <TranscriptPullCore {...props} />
    </>
  )
}
