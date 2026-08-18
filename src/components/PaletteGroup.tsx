import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

/**
 * A collapsible group used by the node palettes (Scripting + Material editors). Collapse state is
 * persisted per-title in localStorage. Pass `forceOpen` (e.g. while a search is active) to expand
 * regardless of the saved state, and an optional `count` badge.
 */
export function PaletteGroup({
  title,
  icon: Icon,
  count,
  forceOpen = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const storageKey = `nf.palette.group.${title}`;
  const reactId = useId();
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? defaultOpen : saved !== '0';
  });
  const expanded = forceOpen || open;
  const toggle = () => {
    setOpen((value) => {
      localStorage.setItem(storageKey, value ? '0' : '1');
      return !value;
    });
  };
  const contentId = `palette-group-${reactId.replace(/:/g, '')}`;
  return (
    <section className={expanded ? 'palette-group' : 'palette-group collapsed'}>
      <h3 className="palette-group-heading">
        <button
          type="button"
          className="palette-group-head"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-disabled={forceOpen || undefined}
          disabled={forceOpen}
          title={forceOpen ? 'Groups stay open while filtering' : undefined}
          onClick={toggle}
        >
          <Icon size={14} aria-hidden />
          <span>{title}</span>
          {count !== undefined && <small>{count}</small>}
          <ChevronRight size={12} className="palette-group-caret" aria-hidden />
        </button>
      </h3>
      <div id={contentId} hidden={!expanded}>{expanded ? children : null}</div>
    </section>
  );
}
