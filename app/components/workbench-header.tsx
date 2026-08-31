import Link from 'next/link';
import { ArrowLeft, GraduationCap } from 'lucide-react';

export function WorkbenchHeader({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <header className="border-b border-border/80 bg-background/95">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
        <p className="font-heading text-base font-bold">双宝名校计划</p>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <GraduationCap className="size-4 text-primary" /> 家庭一对一学习台
        </span>
      </div>
    </header>
  );
}
