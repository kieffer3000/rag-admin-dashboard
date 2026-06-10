'use client';

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs';

export function User() {
  return (
    <div className="flex items-center gap-2">
      <OrganizationSwitcher
        afterCreateOrganizationUrl="/members"
        afterSelectOrganizationUrl="/"
        afterSelectPersonalUrl="/"
        appearance={{
          elements: {
            rootBox: 'flex items-center',
            organizationSwitcherTrigger:
              'rounded-xl px-2.5 py-1.5 text-[13px] font-medium hover:bg-[rgb(var(--hairline)/0.06)]'
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
