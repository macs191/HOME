import { useEffect, useState } from 'react'
import { getActiveAdminCallParticipants, type BookingCallParticipant } from '../lib/supabase'
import { VoiceCall } from './VoiceCall'

export function VoiceCallInbox({ enabled }: { enabled: boolean }) {
  const [admins, setAdmins] = useState<BookingCallParticipant[]>([])
  useEffect(() => {
    if (!enabled) return
    let active = true
    void getActiveAdminCallParticipants().then(({ data }) => { if (active) setAdmins(data ?? []) }).catch(() => undefined)
    return () => { active = false }
  }, [enabled])
  if (!enabled) return null
  return <div className="voice-call-inbox" aria-live="assertive">{admins.map((admin) => <VoiceCall key={admin.user_id} directAdminId={admin.user_id} incomingOnly floating />)}</div>
}
