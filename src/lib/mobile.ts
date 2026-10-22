import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPushDevice, unregisterPushDevice } from './supabase'

let pushListenersReady = false

export const isAndroidApp = () => Capacitor.getPlatform() === 'android'

function openAppUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'com.home.service:') {
      const callbackPath = parsed.host === 'auth' ? '/auth/callback' : (parsed.pathname || '/')
      window.history.replaceState({}, '', `${callbackPath}${parsed.search}${parsed.hash}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  } catch { /* تجاهل الروابط غير الصالحة */ }
}

function safeTargetPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/customer/notifications'
  return value
}

export async function initialiseAndroidApp() {
  if (!Capacitor.isNativePlatform()) return () => undefined
  const urlListener = await CapacitorApp.addListener('appUrlOpen', ({ url }) => openAppUrl(url))
  const stateListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event('home-service-resume'))
  })

  if (!pushListenersReady) {
    pushListenersReady = true
    await PushNotifications.addListener('registration', ({ value }) => { void registerPushDevice(value, 'android') })
    await PushNotifications.addListener('registrationError', (error) => {
      window.dispatchEvent(new CustomEvent('homefix:push-error', { detail: error }))
    })
    await PushNotifications.addListener('pushNotificationReceived', ({ notification }) => {
      window.dispatchEvent(new CustomEvent('homefix:push-received', { detail: notification }))
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const target = safeTargetPath(notification.data?.target_path)
      window.history.pushState({}, '', target)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  }

  return () => { void urlListener.remove(); void stateListener.remove() }
}

export async function requestAndroidNotifications() {
  if (!isAndroidApp()) return
  await PushNotifications.createChannel({
    id: 'home-service-incoming-v2',
    name: 'إشعارات HOME SERVICE',
    description: 'تحديثات الطلبات ووصول الفني والرسائل المهمة',
    importance: 5,
    visibility: 1,
    sound: 'home_ring',
    vibration: true,
  }).catch(() => undefined)
  const permission = await PushNotifications.checkPermissions()
  if (permission.receive !== 'granted') {
    const requested = await PushNotifications.requestPermissions()
    if (requested.receive !== 'granted') return
  }
  await PushNotifications.register()
}

export async function removeAndroidPushToken(token: string) {
  await unregisterPushDevice(token)
}
