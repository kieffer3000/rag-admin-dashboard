'use client';

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs';
import { cn } from '@/lib/utils';

/** Org switcher + account. `rail` (3.30) stacks them vertically on the dark
 *  olive rail — the org name is hidden there via .rail-org CSS (globals.css)
 *  so the trigger collapses to just the org avatar. */
export function User({ rail = false }: { rail?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        rail && 'rail-org flex-col gap-1.5'
      )}
    >
      <OrganizationSwitcher
        afterCreateOrganizationUrl="/members"
        afterSelectOrganizationUrl="/"
        afterSelectPersonalUrl="/"
        appearance={{
          elements: {
            rootBox: 'flex items-center',
            organizationSwitcherTrigger: rail
              ? 'rounded-xl p-1.5 text-white/85 hover:bg-white/10'
              : 'rounded-xl px-2.5 py-1.5 text-[13px] font-medium hover:bg-[rgb(var(--hairline)/0.06)]'
          }
        }}
      />
      <UserButton
        appearance={{
          elements: {
            avatarBox: 'h-8 w-8'
          }
        }}
      />
    </div>
  );
}
