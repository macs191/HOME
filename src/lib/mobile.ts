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
      window.history.replaceState({}, '', `${parsed.pathname}${parsed.search}${parsed.hash}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  } catch { /* تجاهل الروابط غير الصالحة */ }
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
    await PushNotifications.addListener('registrationError', () => undefined)
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const target = typeof notification.data?.target_path === 'string' ? notification.data.target_path : '/customer/notifications'
      window.history.pushState({}, '', target)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  }

  return () => { void urlListener.remove(); void stateListener.remove() }
}

export async function requestAndroidNotifications() {
  if (!isAndroidApp()) return
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
