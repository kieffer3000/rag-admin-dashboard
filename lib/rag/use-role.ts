'use client';

import { useOrganization } from '@clerk/nextjs';

/**
 * Admin = personal workspace (you own everything) or org role org:admin.
 * Members can query shared projects but cannot upload, delete, or
 * administer the index.
 */
export function useIsAdmin(): boolean {
  const { organization, membership, isLoaded } = useOrganization();
  if (!isLoaded) return true; // optimistic during load to avoid UI flash
  if (!organization) return true; // personal workspace
  return membership?.role === 'org:admin';
}
