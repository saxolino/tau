import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@taucad/ui/components/card';
import { useLanguage } from '#i18n/language.js';
import { SinopiaCadWordmark } from '#components/icons/sinopiacad-wordmark.js';

/**
 * SinopiaCAD: the frame of every screen that stands in for the workspace before it opens (sign-in, second factor,
 * access to verify): the lockup above one card, in the language of the interface, with an optional line under the card.
 *
 * @param properties - The card's heading (and the id it carries, for a form to name itself by), its description and
 * its content, and what stands under the card.
 * @returns The screen.
 */
export function SinopiaAuthFrame({
  titleId,
  title,
  description,
  children,
  footer,
}: {
  readonly titleId: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): React.JSX.Element {
  const language = useLanguage();
  return (
    <main
      lang={language}
      className='flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-6 text-foreground'
    >
      <SinopiaCadWordmark size='lg' />
      <Card className='w-full max-w-sm'>
        <CardHeader>
          <CardTitle className='text-xl font-semibold'>
            <h1 id={titleId}>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer}
    </main>
  );
}
