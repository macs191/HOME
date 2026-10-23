import { useEffect, useState } from 'react'
import { getActiveAdminCallParticipants, getAdminAccounts, type BookingCallParticipant } from '../lib/supabase'
import { VoiceCall } from './VoiceCall'

export function VoiceCallInbox({ enabled, role }: { enabled: boolean; role: 'admin' | 'sub_admin' | 'customer' | 'provider' | 'company' }) {
  const [admins, setAdmins] = useState<BookingCallParticipant[]>([])
  const [accounts, setAccounts] = useState<Array<{ user_id: string; full_name: string; role: 'customer' | 'provider' }>>([])
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!enabled) return
    let active = true
    void (async () => {
      if (role === 'admin' || role === 'sub_admin') {
        const result = await getAdminAccounts('', 'all', 0, 200)
        if (active) setAccounts(result.rows.map((row) => ({ user_id: row.user_id, full_name: row.full_name, role: row.role })))
      } else {
        const result = await getActiveAdminCallParticipants()
        if (result.error) throw result.error
        if (active) setAdmins(result.data ?? [])
      }
    })().catch(() => { if (active) setMessage('تعذر تجهيز استقبال المكالمات. حدّث الصفحة أو سجّل الدخول من جديد.') })
    return () => { active = false }
  }, [enabled, role])
  if (!enabled) return null
  return <div className="voice-call-inbox" aria-live="assertive">{role === 'admin' || role === 'sub_admin' ? accounts.map((account) => <VoiceCall key={account.user_id} directTargetId={account.user_id} directTargetName={account.full_name} targetRole={account.role} incomingOnly floating />) : admins.map((admin) => <VoiceCall key={admin.user_id} directAdminId={admin.user_id} incomingOnly floating />)}{message && <small className="voice-call-message voice-call-inbox-message">{message}</small>}</div>
}
