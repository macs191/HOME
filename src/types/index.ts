export type Role = 'customer' | 'provider' | 'company' | 'admin' | 'sub_admin'

export type ServiceCategory = {
  id: string
  name: string
  description: string
  icon: string
  color: string
  featured?: boolean
}

export type Service = {
  id: string
  categoryId: string
  name: string
  shortDescription: string
  description: string
  duration: string
  priceLabel: string
  featured?: boolean
}

export type BookingDraft = {
  serviceId?: string
  issue: string
  urgency: 'normal' | 'urgent'
  city: string
  district: string
  address: string
  accessNotes: string
  latitude?: number
  longitude?: number
  locationSource: 'none' | 'gps' | 'manual'
  scheduledDate: string
  scheduledSlot: string
  providerId?: string
}

export type Notice = {
  id: string
  title: string
  body: string
  time: string
  unread?: boolean
}
