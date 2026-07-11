import React from 'react';
import { cn } from '../../utils/cn';

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  density?: 'compact' | 'normal';
}

const DensityContext = React.createContext<'compact' | 'normal'>('normal');

export const Table: React.FC<TableProps> = ({ density = 'normal', className, children, ...rest }) => (
  <DensityContext.Provider value={density}>
    <div className="w-full overflow-x-auto rounded-xl border border-border bg-surface">
      <table className={cn('w-full text-sm text-left border-collapse', className)} {...rest}>
        {children}
      </table>
    </div>
  </DensityContext.Provider>
);

export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, children, ...rest }) => (
  <thead className={cn('bg-surface-sunken/60', className)} {...rest}>
    {children}
  </thead>
);

export const TBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, children, ...rest }) => (
  <tbody className={cn('divide-y divide-border', className)} {...rest}>
    {children}
  </tbody>
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement> & { clickable?: boolean }> = ({
  clickable,
  className,
  children,
  ...rest
}) => (
  <tr
    className={cn(clickable && 'cursor-pointer transition-colors hover:bg-surface-sunken/50', className)}
    {...rest}
  >
    {children}
  </tr>
);

export const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...rest }) => {
  const density = React.useContext(DensityContext);
  return (
    <th
      className={cn(
        'font-semibold text-xs uppercase tracking-wider text-ink-muted',
        density === 'compact' ? 'px-3 py-2' : 'px-4 py-3',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
};

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...rest }) => {
  const density = React.useContext(DensityContext);
  return (
    <td className={cn('text-ink', density === 'compact' ? 'px-3 py-2' : 'px-4 py-3', className)} {...rest}>
      {children}
    </td>
  );
};
