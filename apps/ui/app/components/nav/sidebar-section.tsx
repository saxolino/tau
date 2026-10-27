import type { ReactNode } from 'react';
import { SidebarGroup, SidebarMenu } from '#components/ui/sidebar.js';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { cn } from '@taucad/ui/utils/cn';

/**
 * One section of SinopiaCAD's sidebar, in Sinopia's grammar: a mono eyelet in capitals over a list of rows, on the
 * same 8 px gutter as the rows (the eyelet starts where the rows' icons start). A section without a label is a bare
 * list, for the first group whose rows name themselves (Inizio, Progetti).
 *
 * @param props - The label, an optional control at the label's end, and the rows.
 * @returns The section.
 */
export function SidebarSection({
  label,
  action,
  className,
  children,
  ...properties
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  readonly label?: string;
  /** A small control at the end of the label's row. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <SidebarGroup data-slot='sidebar-section' className={cn('gap-0.5 px-2 py-0', className)} {...properties}>
      {label === undefined ? null : (
        <div data-slot='sidebar-group-label' className='flex h-7 items-center justify-between gap-2 px-1.5'>
          <Eyebrow as='h2'>{label}</Eyebrow>
          {action}
        </div>
      )}
      <SidebarMenu className='gap-0.5'>{children}</SidebarMenu>
    </SidebarGroup>
  );
}
