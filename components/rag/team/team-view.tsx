'use client';

import { useOrganization, OrganizationProfile, CreateOrganization } from '@clerk/nextjs';
import { Users } from 'lucide-react';

export function TeamView() {
  const { organization, isLoaded } = useOrganization();

  return (
    <div className="h-full p-2.5">
      <div className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
        <div className="px-6 pt-6 lg:px-8">
          <h1 className="text-[22px] font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {organization
              ? `${organization.name} — invite teammates and manage roles. Admins manage the knowledge base; members can query it.`
              : 'Create a workspace to share your knowledge base with teammates.'}
          </p>
        </div>

        <div className="scroll-clean flex flex-1 items-start justify-center overflow-y-auto px-6 py-6">
          {!isLoaded ? null : organization ? (
            <OrganizationProfile
              routing="hash"
              appearance={{
                elements: {
                  rootBox: 'w-full max-w-3xl',
                  cardBox: 'w-full max-w-3xl shadow-none border-none'
                }
              }}
            />
          ) : (
            <div className="flex flex-col items-center pt-10 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(240_16%_96.5%)] text-muted-foreground dark:bg-[rgb(255_255_255_/_0.05)]">
                <Users className="h-6 w-6" />
              </div>
              <p className="mb-6 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                You&apos;re in your personal workspace. Create a team workspace to
                invite members — they&apos;ll get their own login and can query your
                shared projects.
              </p>
              <CreateOrganization afterCreateOrganizationUrl="/members" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
