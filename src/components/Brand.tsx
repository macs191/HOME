import { Home, KeyRound, type LucideIcon, Droplets, Zap, Wind, Sparkles, Refrigerator, Hammer, Paintbrush, Truck, Box, Bug, Wrench, MapPin, ShieldCheck, Clock3, Star, MessageCircle, WalletCards } from 'lucide-react'

const iconMap: Record<string, LucideIcon> = { droplets: Droplets, zap: Zap, wind: Wind, sparkles: Sparkles, refrigerator: Refrigerator, hammer: Hammer, paintbrush: Paintbrush, truck: Truck, box: Box, bug: Bug, 'key-round': KeyRound, wrench: Wrench }

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className="brand-lockup"><span className="brand-mark"><Home size={compact ? 18 : 21} strokeWidth={2.5} /><KeyRound size={compact ? 10 : 11} className="brand-key" /></span>{!compact && <span className="brand-name">هوم<span>سيرفس</span></span>}</div>
}

export function CategoryIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icon = iconMap[name] ?? Wrench
  return <Icon size={size} strokeWidth={1.9} />
}

export const featureIcons = { location: MapPin, verified: ShieldCheck, clock: Clock3, star: Star, chat: MessageCircle, wallet: WalletCards }
