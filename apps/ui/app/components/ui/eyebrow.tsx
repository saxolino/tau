import { cn } from '@taucad/ui/utils/cn';

/**
 * Sinopia's eyelet: a short label in mono capitals over a group («MISURE», «STRUMENTI»). It names a section; it never
 * carries the content itself, and it stays at the 10 px floor of the type scale.
 *
 * @param props - The label and an optional class.
 * @returns The eyelet.
 */
export function Eyebrow({
  children,
  className,
  as: Component = 'span',
  id,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
  as?: 'span' | 'h2' | 'h3' | 'p';
  id?: string;
}>): React.JSX.Element {
  return (
    <Component
      id={id}
      className={cn(
        'font-mono text-[10px] leading-4 font-medium tracking-[0.18em] text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </Component>
  );
}
