import { Stack } from 'expo-router';

/** No blanket auth gate here (unlike `apps/courier`) — browsing is public; individual screens (cart/addresses/order) redirect to login themselves when needed. */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
