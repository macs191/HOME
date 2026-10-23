import { useEffect, useRef, useState } from 'react'
import AgoraRTC from 'agora-rtc-sdk-ng'
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Volume2, X } from 'lucide-react'
import { getAgoraRtcToken, getAuthState, getBookingCallParticipants, supabase, type BookingCallParticipant } from '../lib/supabase'

type CallState = 'idle' | 'calling' | 'incoming' | 'connected'
type Signal = { callId: string; from: string; to: string; name?: string }

function numericUid(userId: string) {
  let value = 2166136261
  for (let index = 0; index < userId.length; index += 1) value = Math.imul(value ^ userId.charCodeAt(index), 16777619)
  return (value >>> 0) % 2147483646 + 1
}

export function VoiceCall({ bookingId, targetRole, directTargetId, directTargetName, directAdminId, fixedTargetLabel, floating = false, incomingOnly = false }: { bookingId?: string; targetRole?: 'admin' | 'provider' | 'customer'; directTargetId?: string; directTargetName?: string; directAdminId?: string; fixedTargetLabel?: string; floating?: boolean; incomingOnly?: boolean }) {
  const [userId, setUserId] = useState('')
  const [participants, setParticipants] = useState<BookingCallParticipant[]>([])
  const [targetId, setTargetId] = useState('')
  const [state, setState] = useState<CallState>('idle')
  const [incoming, setIncoming] = useState<Signal | null>(null)
  const [muted, setMuted] = useState(false)
  const [message, setMessage] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [channelReady, setChannelReady] = useState(false)
  const signalChannelRef = useRef<any>(null)
  const agoraClientRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)
  const callIdRef = useRef('')
  const currentTargetRef = useRef('')
  const stateRef = useRef<CallState>('idle')

  const send = async (event: string, payload: Record<string, unknown>) => {
    const channel = signalChannelRef.current
    if (channel) await channel.send({ type: 'broadcast', event, payload })
  }
  const leaveAgora = async () => {
    try { localTrackRef.current?.close(); localTrackRef.current = null; if (agoraClientRef.current) await agoraClientRef.current.leave() } catch { /* cleanup must remain best effort */ }
    agoraClientRef.current = null
  }
  const reset = () => { void leaveAgora(); callIdRef.current = ''; currentTargetRef.current = ''; setIncoming(null); setState('idle'); stateRef.current = 'idle'; setMuted(false); setSeconds(0) }

  const joinAgora = async (callId: string) => {
    const uid = numericUid(userId)
    const channelName = `homefix-${callId}`
    const result = await getAgoraRtcToken(channelName, uid)
    if (result.error || !result.data) throw new Error(result.error?.message || 'agora_token_failed')
    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
    agoraClientRef.current = client
    client.on('user-published', async (user: any, mediaType: 'audio' | 'video') => {
      if (mediaType !== 'audio') return
      await client.subscribe(user, 'audio')
      user.audioTrack?.play()
      setState('connected'); stateRef.current = 'connected'; setMessage('')
    })
    client.on('user-unpublished', () => { setMessage('توقف صوت الطرف الآخر مؤقتًا.') })
    client.on('user-left', () => { setMessage('غادر الطرف الآخر المكالمة.'); reset() })
    await client.join(result.data.appId, result.data.channelName, result.data.token, result.data.uid)
    const track = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_low_quality' })
    localTrackRef.current = track
    await client.publish([track])
    setMessage('بانتظار اتصال الطرف الآخر…')
  }

  useEffect(() => {
    let active = true
    let channel: any
    void (async () => {
      const auth = await getAuthState(); if (!active || !auth.user) return
      if (!supabase) throw new Error('الاتصال غير متاح في وضع المعاينة.')
      setUserId(auth.user.id)
      let rows: BookingCallParticipant[] = []
      let topic = ''
      if (directTargetId) { rows = [{ user_id: directTargetId, display_name: directTargetName ?? 'الحساب', participant_role: targetRole ?? 'customer' }]; topic = `voice-direct:${directTargetId}:${auth.user.id}` }
      else if (directAdminId) { rows = [{ user_id: directAdminId, display_name: 'الإدارة', participant_role: 'admin' }]; topic = `voice-direct:${auth.user.id}:${directAdminId}` }
      else if (bookingId) {
        const result = await getBookingCallParticipants(bookingId)
        if (!active) return
        if (result.error) { setMessage('تعذر تجهيز أطراف الاتصال الصوتي.'); return }
        rows = (result.data ?? []).filter((item) => item.user_id !== auth.user!.id && (!targetRole || item.participant_role === targetRole))
        topic = `voice-call:${bookingId}`
      }
      if (!topic) { setMessage('لا تتوفر قناة اتصال لهذا الحساب.'); return }
      setParticipants(rows); setTargetId(rows[0]?.user_id ?? '')
      channel = supabase.channel(topic, { config: { broadcast: { self: false }, private: true } })
      channel.on('broadcast', { event: 'voice-invite' }, ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || stateRef.current !== 'idle') return; callIdRef.current = payload.callId; currentTargetRef.current = payload.from; setIncoming(payload); setState('incoming'); stateRef.current = 'incoming' })
      channel.on('broadcast', { event: 'voice-accepted' }, async ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || payload.callId !== callIdRef.current) return; setState('calling'); stateRef.current = 'calling'; try { await joinAgora(payload.callId) } catch (error) { const code = error instanceof Error ? error.message : ''; setMessage(code === 'agora_not_configured' ? 'Agora غير مهيأة في Supabase. أضف AGORA_APP_ID وAGORA_APP_CERTIFICATE إلى Edge Function Secrets.' : code === 'authentication_required' ? 'انتهت جلسة الدخول. سجّل الدخول من جديد.' : 'تعذر بدء Agora. تحقق من أسرار Agora وصلاحية الميكروفون واتصال الإنترنت.'); reset() } })
      channel.on('broadcast', { event: 'voice-rejected' }, ({ payload }: { payload: Signal }) => { if (payload.to === auth.user!.id && payload.callId === callIdRef.current) { setMessage('لم يتم قبول المكالمة.'); reset() } })
      channel.on('broadcast', { event: 'voice-ended' }, ({ payload }: { payload: Signal }) => { if (payload.to === auth.user!.id && payload.callId === callIdRef.current) { setMessage('أنهى الطرف الآخر المكالمة.'); reset() } })
      channel.subscribe((status: string) => { if (status === 'SUBSCRIBED') { signalChannelRef.current = channel; setChannelReady(true); setMessage('') } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { setChannelReady(false); setMessage('تعذر فتح قناة الاتصال. تحقق من تسجيل الدخول واتصال الإنترنت.') } })
    })().catch(() => setMessage('تعذر تهيئة الاتصال الصوتي.'))
    return () => { active = false; setChannelReady(false); signalChannelRef.current = null; void channel?.unsubscribe(); reset() }
  }, [bookingId, targetRole, directTargetId, directTargetName, directAdminId])

  useEffect(() => { if (state !== 'connected') return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [state])

  const call = async () => {
    if (!targetId || !signalChannelRef.current || !channelReady || state !== 'idle') { if (!channelReady) setMessage('انتظر لحظة حتى يتم تجهيز الاتصال…'); return }
    setMessage('جارٍ إرسال طلب الاتصال…'); callIdRef.current = crypto.randomUUID(); currentTargetRef.current = targetId; setState('calling'); stateRef.current = 'calling'
    const target = participants.find((item) => item.user_id === targetId)
    try { await send('voice-invite', { callId: callIdRef.current, from: userId, to: targetId, name: target?.display_name ?? 'مستخدم' }) } catch { setMessage('تعذر إرسال طلب الاتصال. تحقق من اتصال Supabase ثم حاول مرة أخرى.'); reset() }
  }
  const accept = async () => {
    if (!incoming) return
    const callInfo = incoming; setMessage('جارٍ تشغيل Agora والميكروفون…'); setIncoming(null); setState('calling'); stateRef.current = 'calling'
    try { await send('voice-accepted', { callId: callInfo.callId, from: userId, to: callInfo.from }); await joinAgora(callInfo.callId) } catch { setMessage('تعذر تشغيل المكالمة. تحقق من إعداد Agora وصلاحية الميكروفون.'); reset() }
  }
  const reject = async () => { if (incoming) await send('voice-rejected', { callId: incoming.callId, from: userId, to: incoming.from }); reset() }
  const hangup = async () => { if (callIdRef.current && currentTargetRef.current) await send('voice-ended', { callId: callIdRef.current, from: userId, to: currentTargetRef.current }); reset() }
  const toggleMute = () => { const next = !muted; localTrackRef.current?.setEnabled(!next); setMuted(next) }
  const target = participants.find((item) => item.user_id === targetId)
  const formatTime = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  if (incomingOnly && state === 'idle') return null
  const showFloating = floating && state !== 'idle'
  return <div className={`voice-call${showFloating ? ' voice-call-floating' : ''}`} role={showFloating ? 'dialog' : undefined} aria-label={showFloating ? 'مكالمة صوتية' : undefined}>
    {showFloating && <div className="voice-call-floating-head"><strong>مكالمة صوتية</strong><span>{state === 'connected' ? formatTime : state === 'incoming' ? 'مكالمة واردة' : 'Agora'}</span><button type="button" className="icon-button" onClick={() => void hangup()} aria-label="إغلاق شاشة المكالمة"><X size={16} /></button></div>}
    <div className="voice-call-actions">
      {state === 'idle' && !incomingOnly ? <>{!fixedTargetLabel && <select value={targetId} onChange={(event) => setTargetId(event.target.value)} aria-label="اختر طرف الاتصال"><option value="">اختر طرف الاتصال</option>{participants.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name} · {item.participant_role === 'admin' ? 'الإدارة' : item.participant_role === 'provider' ? 'فني' : 'عميل'}</option>)}</select>}<button type="button" className="button button-secondary button-small" onClick={() => void call()} disabled={!targetId || !channelReady}><Phone size={15} /> {fixedTargetLabel ?? 'اتصال صوتي'}</button></>
      : state === 'incoming' ? <div className="voice-incoming"><PhoneCall size={17} /><strong>{incoming?.name ?? 'مكالمة واردة'}</strong><button type="button" className="button button-primary button-small" onClick={() => void accept()}>قبول</button><button type="button" className="button button-danger button-small" onClick={() => void reject()}><PhoneOff size={14} /> رفض</button></div>
      : <div className="voice-active"><span><Volume2 size={15} /> {state === 'connected' ? `متصل ${formatTime}` : `جارٍ الاتصال بـ ${target?.display_name ?? 'الطرف الآخر'}…`}</span>{state === 'connected' && <button type="button" className="icon-button" onClick={toggleMute} aria-label={muted ? 'تشغيل الميكروفون' : 'كتم الميكروفون'}>{muted ? <MicOff size={16} /> : <Mic size={16} />}</button>}<button type="button" className="button button-danger button-small" onClick={() => void hangup()}><PhoneOff size={14} /> إنهاء</button></div>}
    </div>{message && <small className="voice-call-message">{message}</small>}
  </div>
}
