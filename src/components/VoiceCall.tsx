import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Volume2 } from 'lucide-react'
import { getAuthState, getBookingCallParticipants, supabase, type BookingCallParticipant } from '../lib/supabase'

type CallState = 'idle' | 'calling' | 'incoming' | 'connected'
type Signal = { callId: string; from: string; to: string; offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; name?: string }
const rtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }

export function VoiceCall({ bookingId, targetRole, directTargetId, directTargetName, directAdminId, fixedTargetLabel, incomingOnly = false }: { bookingId?: string; targetRole?: 'admin' | 'provider' | 'customer'; directTargetId?: string; directTargetName?: string; directAdminId?: string; fixedTargetLabel?: string; incomingOnly?: boolean }) {
  const [userId, setUserId] = useState('')
  const [participants, setParticipants] = useState<BookingCallParticipant[]>([])
  const [targetId, setTargetId] = useState('')
  const [state, setState] = useState<CallState>('idle')
  const [incoming, setIncoming] = useState<Signal | null>(null)
  const [muted, setMuted] = useState(false)
  const [message, setMessage] = useState('')
  const [channelReady, setChannelReady] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const channelRef = useRef<any>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const callIdRef = useRef('')
  const currentTargetRef = useRef('')
  const stateRef = useRef<CallState>('idle')

  const send = async (event: string, payload: Record<string, unknown>) => { const channel = channelRef.current; if (channel) await channel.send({ type: 'broadcast', event, payload }) }
  const closeMedia = () => { pcRef.current?.close(); pcRef.current = null; localStreamRef.current?.getTracks().forEach((track) => track.stop()); localStreamRef.current = null; if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null }
  const reset = () => { closeMedia(); callIdRef.current = ''; currentTargetRef.current = ''; setIncoming(null); setState('idle'); stateRef.current = 'idle'; setMuted(false); setSeconds(0) }

  const createPeer = async (signal: Signal, caller: boolean) => {
    const pc = new RTCPeerConnection(rtcConfig)
    pcRef.current = pc
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }) } catch { setMessage('اسمح بالوصول إلى الميكروفون من إعدادات المتصفح أو التطبيق ثم حاول مرة أخرى.'); reset(); throw new Error('microphone_permission_denied') }
    localStreamRef.current = stream
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))
    pc.ontrack = (event) => { if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = event.streams[0]; void remoteAudioRef.current.play().catch(() => undefined) } }
    pc.onicecandidate = (event) => { if (event.candidate) void send('voice-ice', { callId: signal.callId, from: userId, to: signal.from === userId ? signal.to : signal.from, candidate: event.candidate.toJSON() }) }
    pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) { setMessage('انقطع الاتصال الصوتي.'); reset() } }
    if (caller) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true }); await pc.setLocalDescription(offer); await send('voice-offer', { callId: signal.callId, from: userId, to: signal.to, offer })
    } else if (signal.offer) {
      await pc.setRemoteDescription(signal.offer); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await send('voice-answer', { callId: signal.callId, from: userId, to: signal.from, answer })
    }
  }

  useEffect(() => {
    let active = true
    let channel: any
    void (async () => {
      const auth = await getAuthState(); if (!active || !auth.user) return
      if (!supabase) throw new Error('الاتصال المباشر غير متاح في وضع المعاينة.')
      setUserId(auth.user.id)
      let rows: BookingCallParticipant[] = []
      let topic = ''
      if (directTargetId) {
        rows = [{ user_id: directTargetId, display_name: directTargetName ?? 'الحساب', participant_role: targetRole ?? 'customer' }]
        topic = `voice-direct:${directTargetId}:${auth.user.id}`
      } else if (directAdminId) {
        rows = [{ user_id: directAdminId, display_name: 'الإدارة', participant_role: 'admin' }]
        topic = `voice-direct:${auth.user.id}:${directAdminId}`
      } else if (bookingId) {
        const result = await getBookingCallParticipants(bookingId)
        if (!active) return
        if (result.error) { setMessage('تعذر تجهيز أطراف الاتصال الصوتي.'); return }
        rows = (result.data ?? []).filter((item) => item.user_id !== auth.user!.id && (!targetRole || item.participant_role === targetRole))
        topic = `voice-call:${bookingId}`
      }
      if (!topic) { setMessage('لا تتوفر قناة اتصال آمنة لهذا الحساب.'); return }
      setParticipants(rows); setTargetId(rows[0]?.user_id ?? '')
      channel = supabase.channel(topic, { config: { broadcast: { self: false }, private: true } })
      channel.on('broadcast', { event: 'voice-invite' }, ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || stateRef.current !== 'idle') return; callIdRef.current = payload.callId; currentTargetRef.current = payload.from; setIncoming(payload); setState('incoming'); stateRef.current = 'incoming' })
      channel.on('broadcast', { event: 'voice-accepted' }, async ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || payload.callId !== callIdRef.current) return; setState('calling'); stateRef.current = 'calling'; await createPeer(payload, true) })
      channel.on('broadcast', { event: 'voice-rejected' }, ({ payload }: { payload: Signal }) => { if (payload.to === auth.user!.id && payload.callId === callIdRef.current) { setMessage('لم يتم قبول المكالمة.'); reset() } })
      channel.on('broadcast', { event: 'voice-offer' }, async ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || payload.callId !== callIdRef.current || !pcRef.current) return; await pcRef.current.setRemoteDescription(payload.offer!); const answer = await pcRef.current.createAnswer(); await pcRef.current.setLocalDescription(answer); await send('voice-answer', { callId: payload.callId, from: auth.user!.id, to: payload.from, answer }) })
      channel.on('broadcast', { event: 'voice-answer' }, async ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || payload.callId !== callIdRef.current || !pcRef.current) return; await pcRef.current.setRemoteDescription(payload.answer!); setState('connected'); stateRef.current = 'connected' })
      channel.on('broadcast', { event: 'voice-ice' }, async ({ payload }: { payload: Signal }) => { if (payload.to !== auth.user!.id || payload.callId !== callIdRef.current || !pcRef.current || !payload.candidate) return; try { await pcRef.current.addIceCandidate(payload.candidate) } catch { /* candidate قد يصل قبل الوصف */ } })
      channel.on('broadcast', { event: 'voice-ended' }, ({ payload }: { payload: Signal }) => { if (payload.to === auth.user!.id && payload.callId === callIdRef.current) { setMessage('أنهى الطرف الآخر المكالمة.'); reset() } })
      channel.subscribe((status: string) => { if (status === 'SUBSCRIBED') { channelRef.current = channel; setChannelReady(true); setMessage('') } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { setChannelReady(false); setMessage('تعذر فتح قناة الاتصال. تحقق من تسجيل الدخول واتصال الإنترنت.') } })
    })().catch(() => setMessage('تعذر تهيئة الاتصال الصوتي.'))
    return () => { active = false; setChannelReady(false); channelRef.current = null; void channel?.unsubscribe(); reset() }
  }, [bookingId, targetRole, directTargetId, directTargetName, directAdminId, fixedTargetLabel, incomingOnly])

  useEffect(() => { if (state !== 'connected') return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [state])

  const call = async () => {
    if (!targetId || !channelRef.current || !channelReady || state !== 'idle') { if (!channelReady) setMessage('انتظر لحظة حتى يتم تجهيز الاتصال…'); return }
    setMessage('جارٍ إرسال طلب الاتصال…'); callIdRef.current = crypto.randomUUID(); currentTargetRef.current = targetId; setState('calling'); stateRef.current = 'calling'
    const target = participants.find((item) => item.user_id === targetId)
    await send('voice-invite', { callId: callIdRef.current, from: userId, to: targetId, name: target?.display_name ?? 'مستخدم' })
  }
  const accept = async () => { if (!incoming) return; setMessage('جارٍ تشغيل الميكروفون…'); setIncoming(null); setState('calling'); stateRef.current = 'calling'; try { await send('voice-accepted', { callId: incoming.callId, from: userId, to: incoming.from }); await createPeer(incoming, false) } catch { setMessage('تعذر تشغيل المكالمة. تحقق من صلاحية الميكروفون.') } }
  const reject = async () => { if (incoming) await send('voice-rejected', { callId: incoming.callId, from: userId, to: incoming.from }); reset() }
  const hangup = async () => { if (callIdRef.current && currentTargetRef.current) await send('voice-ended', { callId: callIdRef.current, from: userId, to: currentTargetRef.current }); reset() }
  const toggleMute = () => { const next = !muted; localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next }); setMuted(next) }
  const target = participants.find((item) => item.user_id === targetId)
  const formatTime = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  if (incomingOnly && state === 'idle') return null
  return <div className="voice-call"><audio ref={remoteAudioRef} autoPlay /><div className="voice-call-actions">{state === 'idle' && !incomingOnly ? <>{!fixedTargetLabel && <select value={targetId} onChange={(event) => setTargetId(event.target.value)} aria-label="اختر طرف الاتصال"><option value="">اختر طرف الاتصال</option>{participants.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name} · {item.participant_role === 'admin' ? 'الإدارة' : item.participant_role === 'provider' ? 'فني' : 'عميل'}</option>)}</select>}<button type="button" className="button button-secondary button-small" onClick={() => void call()} disabled={!targetId || !channelReady}><Phone size={15} /> {fixedTargetLabel ?? 'اتصال صوتي'}</button></> : state === 'incoming' ? <div className="voice-incoming"><PhoneCall size={17} /><strong>{incoming?.name ?? 'مكالمة واردة'}</strong><button type="button" className="button button-primary button-small" onClick={() => void accept()}>قبول</button><button type="button" className="button button-danger button-small" onClick={() => void reject()}><PhoneOff size={14} /> رفض</button></div> : <div className="voice-active"><span><Volume2 size={15} /> {state === 'connected' ? `متصل ${formatTime}` : `جارٍ الاتصال بـ ${target?.display_name ?? 'الطرف الآخر'}…`}</span>{state === 'connected' && <button type="button" className="icon-button" onClick={toggleMute} aria-label={muted ? 'تشغيل الميكروفون' : 'كتم الميكروفون'}>{muted ? <MicOff size={16} /> : <Mic size={16} />}</button>}<button type="button" className="button button-danger button-small" onClick={() => void hangup()}><PhoneOff size={14} /> إنهاء</button></div>}</div>{message && <small className="voice-call-message">{message}</small>}</div>
}
