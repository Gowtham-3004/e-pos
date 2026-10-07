import { Redirect } from 'expo-router';
import { useApp } from '../src/lib/app';

export default function Index() {
  const { session } = useApp();
  if (!session) return <Redirect href="/sign-in" />;
  return <Redirect href={session.mode === 'waiter' ? '/tables' : '/home'} />;
}
