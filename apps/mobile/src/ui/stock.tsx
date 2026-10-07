import { View } from 'react-native';
import { stockHealth } from '@elixir/domain';
import { qty as fmtQty } from '@elixir/format';
import { Badge } from './primitives';
import { T } from './Text';

export function HealthBadge({ value, reorder, unit }: { value: number; reorder: number; unit: string }) {
  const h = stockHealth(value, reorder);
  return (
    <View style={{ alignItems: 'flex-end', gap: 3 }}>
      <T v="bodyStrong" num>{`${fmtQty(value)} ${unit}`}</T>
      <Badge size="sm" tone={h === 'out' ? 'danger' : h === 'low' ? 'warning' : 'success'} icon={h === 'out' ? 'CircleX' : h === 'low' ? 'TriangleAlert' : 'CircleCheck'} label={h === 'out' ? 'Out of stock' : h === 'low' ? 'Low' : 'In stock'} />
    </View>
  );
}

