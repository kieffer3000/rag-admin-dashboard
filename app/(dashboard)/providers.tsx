'use client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { RagProvider } from '@/lib/rag/store';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <RagProvider>{children}</RagProvider>
    </TooltipProvider>
  );
}
