import { Archive, ArrowLeftRight, CalendarDays, ChartNoAxesCombined, ClipboardList, Handshake,
  LayoutDashboard, ListFilter, Megaphone, MessageSquare, Package, PackageCheck, PlusCircle,
  Settings, ShieldCheck, Store, Tags, Truck, Users, Wallet, type LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = { today: LayoutDashboard, orders: ClipboardList,
  add: PlusCircle, list: ListFilter, handover: Handshake, truck: Truck, return: ArrowLeftRight,
  batch: Package, products: Package, calendar: CalendarDays, stock: PackageCheck, category: Tags,
  customers: Users, reports: ChartNoAxesCombined, money: Wallet, archive: Archive, store: Store,
  ads: Megaphone, settings: Settings, account: ShieldCheck, sms: MessageSquare };
export function WorkspaceIcon({ name, className = "h-[18px] w-[18px]" }: { name: string; className?: string }) {
  const Icon = icons[name] ?? Package;
  return <Icon className={className} strokeWidth={1.7} aria-hidden="true" />;
}
