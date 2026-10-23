import type { CSSProperties, ReactNode } from 'react';
import { Check, FileText, Landmark, Mic, QrCode, Send } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Hero picture for the marketing homepage: the product's story in three
 * short slides (dictate → send → paid) instead of a full invoice, which read
 * as a wall of numbers on first sight. Pure CSS animation (`.hero-slide` in
 * globals.css), so it stays a server component; with reduced motion only
 * the invoice slide shows. All slides share one grid cell, so the box takes
 * the tallest slide's height and nothing jumps while they change.
 *
 * Names and amounts are a fixed Czech example in every locale, like a
 * product screenshot; only the short labels are translated.
 */
export async function MarketingHeroSlides() {
  const t = await getTranslations('marketing.heroSlides');

  return (
    <div aria-hidden="true">
      <div className="grid rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <Slide index={0} step={t('voice.step')} icon={Mic}>
          <div className="flex items-center gap-3 self-end rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
            <Mic className="h-4 w-4 shrink-0" />
            <span className="flex h-6 items-center gap-[3px]">
              {[0.6, 1, 0.45, 0.85, 0.5, 1, 0.7, 0.4, 0.9, 0.55, 0.8, 0.45].map((h, i) => (
                <span
                  key={i}
                  className="hero-wave w-[3px] rounded-full bg-primary-foreground/80"
                  style={{ height: `${h * 100}%`, animationDelay: `${i * 70}ms` }}
                />
              ))}
            </span>
            <span className="text-xs tabular-nums opacity-80">0:07</span>
          </div>
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3 text-sm font-medium">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            {t('voice.reply')}
          </div>
        </Slide>

        <Slide index={1} step={t('send.step')} icon={Send} still>
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-background p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Dvořák &amp; Partners s.r.o.</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">14 520 Kč</p>
            </div>
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted">
              <QrCode className="h-10 w-10 text-foreground" />
            </span>
          </div>
          <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Check className="h-3.5 w-3.5" />
            {t('send.sent')}
          </p>
        </Slide>

        <Slide index={2} step={t('paid.step')} icon={Landmark}>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
              <Landmark className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t('paid.title')}</p>
              <p className="text-xl font-extrabold tabular-nums text-success">+14 520 Kč</p>
            </div>
          </div>
          <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
            <Check className="h-3.5 w-3.5" />
            {t('paid.matched')}
          </p>
        </Slide>

        <div className="mt-6 flex gap-1.5 [grid-area:2/1] motion-reduce:hidden">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="hero-dot block h-full rounded-full bg-primary" style={delay(i)} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const delay = (index: number): CSSProperties => ({ animationDelay: `${index * 4}s` });

function Slide({
  index,
  step,
  icon: Icon,
  still,
  children
}: {
  index: number;
  step: string;
  icon: typeof Mic;
  still?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="hero-slide flex flex-col gap-4 [grid-area:1/1]" style={delay(index)} data-still={still || undefined}>
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {index + 1} · {step}
      </p>
      {children}
    </div>
  );
}
