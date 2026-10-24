import { cn } from '@taucad/ui/utils/cn';

type ToolPageProps = {
  /** The page title, 28/34 semibold as on the home. */
  readonly title: string;
  /** One muted sentence under the title. */
  readonly subtitle?: string;
  /** The page's one action, beside the title. */
  readonly action?: React.ReactNode;
  readonly className?: string;
  readonly children?: React.ReactNode;
};

/**
 * The frame of a tool page («Converti un file», «Importa un file»): the home's column, gutter and title
 * (UI-UX-SinopiaCAD §1.3–1.4), so moving between the home and a tool keeps the same width and type. The top inset
 * matches the home's title, which sits under its 48 px viewer bar.
 *
 * @returns The page.
 */
export function ToolPage({ title, subtitle, action, className, children }: ToolPageProps): React.JSX.Element {
  return (
    <div className={cn('mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 pt-18 pb-8 lg:px-8', className)}>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          {/* oxlint-disable-next-line tau-lint/no-raw-page-heading -- SinopiaCAD's pages take the home's title (UI-UX-SinopiaCAD §1.3: 28/34 semibold), which PageHeader's 36 px Tau title does not offer. */}
          <h1 className='text-3xl leading-tight font-semibold tracking-tight text-balance'>{title}</h1>
          {subtitle === undefined ? null : <p className='mt-2 max-w-prose text-sm text-muted-foreground'>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}
