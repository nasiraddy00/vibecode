import type { ReactNode } from 'react';
import { ProvenanceBadge } from './ProvenanceBadge';
import type { Provenance } from '@/lib/types';

interface PanelProps {
  title: string;
  children: ReactNode;
  /** Right-hand side of the header: counts, badges, controls. */
  actions?: ReactNode;
  provenance?: Provenance;
  source?: string;
  accent?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Small caption under the title bar. */
  subtitle?: string;
}

export function Panel({
  title, children, actions, provenance, source,
  accent = false, className = '', bodyClassName = '', subtitle,
}: PanelProps) {
  return (
    <section className={`panel ${accent ? 'panel-accent' : ''} flex flex-col min-h-0 ${className}`}>
      <header className="panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="panel-title">{title}</h2>
          {subtitle && (
            <span className="label-xs truncate hidden sm:inline">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          {provenance && <ProvenanceBadge provenance={provenance} source={source} />}
        </div>
      </header>
      <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
