import { redirect } from 'next/navigation';

// The board is the default view — land on it straight away. (The chat view at
// ChatView is still available to wire to a route if needed.)
export default function HomePage() {
  redirect('/board');
}
