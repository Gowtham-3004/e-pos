import type { ComponentProps } from 'react';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];
type McName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Glyph = FeatherName | { mc: McName };

/**
 * Icon names follow the lucide vocabulary used by `@elixir/domain` status metas, so a
 * `StatusMeta.icon` can be rendered directly. Outline (Feather) is the default set.
 */
const MAP: Record<string, Glyph> = {
  // status metas (domain/status.ts)
  FilePen: 'edit-3', CircleDot: 'disc', FileCheck2: 'file-text', CircleDashed: 'loader', CircleCheck: 'check-circle', CircleX: 'x-circle', Undo2: 'corner-up-left',
  HardDrive: 'hard-drive', CloudUpload: 'upload-cloud', RefreshCw: 'refresh-cw', CloudCheck: 'cloud', GitMerge: 'git-merge', CloudAlert: 'cloud-off',
  Clock: 'clock', RotateCw: 'rotate-cw', TriangleAlert: 'alert-triangle', Wifi: 'wifi', WifiOff: 'wifi-off', Ban: 'slash', Hourglass: 'clock',
  Sparkle: 'star', Check: 'check', Flame: { mc: 'fire' }, BellRing: 'bell', HandPlatter: { mc: 'room-service-outline' }, PackageCheck: 'package',
  Circle: 'circle', Users: 'users', ClipboardList: 'clipboard', Receipt: 'file-text', Wallet: 'credit-card', CalendarCheck: 'calendar', Sparkles: { mc: 'broom' },
  FlaskConical: 'droplet',
  // app vocabulary
  Home: 'home', Inbox: 'inbox', Package: 'package', Monitor: 'monitor', More: 'more-horizontal', Grid: 'grid', List: 'list', Bell: 'bell', User: 'user',
  Search: 'search', ChevronRight: 'chevron-right', ChevronLeft: 'chevron-left', ChevronDown: 'chevron-down', Plus: 'plus', Minus: 'minus', X: 'x',
  Trash: 'trash-2', Edit: 'edit-2', Send: 'send', Droplet: 'droplet', Smartphone: 'smartphone', Server: 'server', Tablet: 'tablet', Settings: 'settings',
  LogOut: 'log-out', Moon: 'moon', Sun: 'sun', Info: 'info', TrendingUp: 'trending-up', TrendingDown: 'trending-down', ShoppingBag: 'shopping-bag',
  Lock: 'lock', Shield: 'shield', Backspace: 'delete', Zap: 'zap', Activity: 'activity', Layers: 'layers', MapPin: 'map-pin', Tag: 'tag', Star: 'star',
  Store: 'shopping-bag', Calendar: 'calendar', Percent: 'percent', Rupee: 'dollar-sign', Database: 'database', Power: 'power', Phone: 'phone-call',
  ArrowUpRight: 'arrow-up-right', ArrowDownRight: 'arrow-down-right', Minus2: 'minus', Cpu: 'cpu', Box: 'box', Truck: 'truck', MessageSquare: 'message-square',
  Fingerprint: { mc: 'fingerprint' }, ChefHat: { mc: 'chef-hat' }, Water: { mc: 'cup-water' }, Utensils: { mc: 'silverware-fork-knife' }, Kds: 'tv',
  CloudOff: 'cloud-off', Cloud: 'cloud', Eye: 'eye', FileText: 'file-text', Printer: 'printer', AlertCircle: 'alert-circle', Coffee: 'coffee',
};

export function Icon({ name, size = 18, color, strokeColor }: { name: string; size?: number; color?: string; strokeColor?: string }) {
  const t = useTheme();
  const g = MAP[name] ?? (name as FeatherName);
  const c = color ?? strokeColor ?? t.c.text.secondary;
  if (typeof g === 'object') return <MaterialCommunityIcons name={g.mc} size={size} color={c} />;
  return <Feather name={g} size={size} color={c} />;
}
