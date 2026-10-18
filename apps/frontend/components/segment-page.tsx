import type { ComponentType } from 'react';
import { CONTACT_EMAIL } from '@/lib/site';

type Icon = ComponentType<{ className?: string }>;

/**
 * Building blocks shared by the segment pages (/for-schools, /for-creators,
 * /events), which are otherwise plain copy: a grid of icon cards and an FAQ
 * whose entries the page also emits as FAQPage data.
 */
export function IconCards({ items }: { items: { icon: Icon; title: string; body: string }[] }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ icon: Icon, title, body }) => (
        <div key={title} className="rounded-xl border border-border bg-card p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <h3 className="mt-3 font-bold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </div>
      ))}
    </div>
  );
}

export function FaqList({ title, faq }: { title: string; faq: { q: string; a: string }[] }) {
  return (
    <>
      <h2 className="mt-12 text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
        {faq.map(({ q, a }) => (
          <details key={q} className="group p-4">
            <summary className="cursor-pointer list-none font-semibold marker:hidden">{q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </>
  );
}

export function faqLd(faq: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  };
}

/** A mailto with the subject filled in, or null when no contact address is configured. */
export function contactMailto(subject: string): string | null {
  return CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` : null;
}
