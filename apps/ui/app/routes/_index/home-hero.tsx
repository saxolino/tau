import { useId } from 'react';
import type { ReactNode } from 'react';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useTranslation } from '#i18n/translate.js';

/**
 * The home's opening (UI-UX-SinopiaCAD §2): what the CAD does in one line — from a picture to a piece in 3D, in
 * named pieces with measures in millimetres — the three ways in on the left, and on the right what comes out.
 *
 * @param props - The intake and the example beside it.
 * @returns The opening.
 */
export function HomeHero({ intake, example }: Readonly<{ intake: ReactNode; example: ReactNode }>): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const facts = ['pieces', 'measures', 'delivery'] as const;
  return (
    <section aria-labelledby={headingId} data-slot='home-hero' className='w-full pt-8'>
      <div className='max-w-2xl'>
        <h1 id={headingId} className='text-3xl leading-tight font-semibold tracking-tight text-balance'>
          {t('home.title')}
        </h1>
        <p className='mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground'>{t('home.subtitle')}</p>
        {/* What every project ends as: three facts in the eyelet's voice, the CAD's own delivery. */}
        <ul aria-label={t('home.hero.eyebrow')} className='mt-3 flex flex-wrap items-center gap-x-2 gap-y-1'>
          {facts.map((fact, index) => (
            <li key={fact} className='flex items-center gap-2'>
              {index === 0 ? null : <span aria-hidden className='size-0.5 rounded-full bg-muted-foreground/60' />}
              <Eyebrow>{t(`home.hero.facts.${fact}`)}</Eyebrow>
            </li>
          ))}
        </ul>
      </div>
      <div className='mt-6 grid gap-4 @3xl/viewer:grid-cols-2'>
        {intake}
        {example}
      </div>
    </section>
  );
}
