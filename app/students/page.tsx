import { redirect } from 'next/navigation';
import { appPath } from '@/lib/deployment';

// Bookmarks from the earlier site open the corresponding shared learning view.
export default function LegacyPage() { redirect(appPath('/#/me')); }
