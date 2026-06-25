import { PricingTable } from '@clerk/nextjs';

// Subscribe page — shown to signed-in users without an active plan once the app
// is opened to customers (BILLING_OPEN=on). Clerk's <PricingTable/> renders the
// plans (individual + organization) and handles checkout.
export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <div className="text-[15px] font-semibold tracking-wide text-accent">answersDoc</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            Choose your plan
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Upload anything, ask anything — answers with citations. Bring your own
            OpenRouter key and pay only for the AI you use.
          </p>
        </div>
        <PricingTable />
      </div>
    </div>
  );
}
