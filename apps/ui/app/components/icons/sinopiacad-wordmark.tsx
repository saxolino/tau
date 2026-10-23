import { cn } from '@taucad/ui/utils/cn';

/** Sinopia's mark, served from `public/brand/sinopia-mark.png` (Sinopia's own red logo, 201 px). */
export const sinopiaMarkUrl = '/brand/sinopia-mark.png';

/** The product name shown beside the mark and in the help menu. */
export const productName = 'SinopiaCAD';

const wordmarkSizes = {
  sm: { root: 'h-5 gap-1.5 text-sm', mark: 'size-5' },
  md: { root: 'h-6 gap-2 text-base', mark: 'size-6' },
  lg: { root: 'h-7 gap-2 text-lg', mark: 'size-7' },
} as const;

type SinopiaCadWordmarkProperties = React.ComponentProps<'span'> & {
  /** Row height the lockup fills: `sm` 20 px, `md` 24 px, `lg` 28 px. */
  readonly size?: keyof typeof wordmarkSizes;
};

/**
 * SinopiaCAD's lockup: Sinopia's mark beside the product name. Decorative by default, because every
 * placement sits inside a link or heading that names itself; pass `aria-hidden={false}` to expose the name.
 */
export function SinopiaCadWordmark({
  size = 'sm',
  className,
  ...properties
}: SinopiaCadWordmarkProperties): React.JSX.Element {
  const sizes = wordmarkSizes[size];

  return (
    <span
      aria-hidden
      data-slot='wordmark'
      className={cn('inline-flex shrink-0 items-center leading-none text-foreground', sizes.root, className)}
      {...properties}
    >
      <img src={sinopiaMarkUrl} alt='' draggable={false} className={cn('shrink-0 select-none', sizes.mark)} />
      <span className='font-semibold tracking-tight whitespace-nowrap'>
        Sinopia<span className='font-normal'>CAD</span>
      </span>
    </span>
  );
}

/** Sinopia's mark alone, square, for agent pickers and other icon slots. */
export function SinopiaMark({ className, ...properties }: React.ComponentProps<'img'>): React.JSX.Element {
  return (
    <img
      src={sinopiaMarkUrl}
      alt=''
      draggable={false}
      className={cn('shrink-0 select-none', className)}
      {...properties}
    />
  );
}
