import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Sparkles, X } from 'lucide-react';
import type { GraphNodeCategory, GraphNodeKind, GraphValueType, NodeForgeNodeData } from '../types';

export interface NodeChoice {
  label: string;
  category: GraphNodeCategory;
  description?: string;
  nodeKind?: GraphNodeKind;
  valueType?: GraphValueType | 'exec' | 'any';
  nodeLabel?: string;
  data?: Partial<NodeForgeNodeData>;
  action?: 'create-variable';
}

const valueTypeLabels: Record<NonNullable<NodeChoice['valueType']>, string> = {
  exec: 'Exec',
  number: 'Number',
  boolean: 'Bool',
  string: 'String',
  vector3: 'Vec3',
  any: 'Value',
};

export function NodeSearchMenu({
  x,
  y,
  choices,
  onPick,
  onClose,
  filterHint,
  onAskAI,
}: {
  x: number;
  y: number;
  choices: NodeChoice[];
  onPick: (choice: NodeChoice) => void;
  onClose: () => void;
  /** When opened from a pin drag, explain which sockets are being filtered. */
  filterHint?: string | null;
  /** Hand the raw query to the AI assistant, which can author a whole wired graph from a plain
   *  description. Offered as the last row so typing something that isn't a node name and pressing
   *  Enter builds it, instead of dead-ending on "No matching nodes". */
  onAskAI?: (prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const onCloseRef = useRef(onClose);
  const reactId = useId().replace(/:/g, '');
  const titleId = `node-search-title-${reactId}`;
  const listId = `node-search-results-${reactId}`;
  const hintId = `node-search-hint-${reactId}`;
  const countId = `node-search-count-${reactId}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.cancelAnimationFrame(focusFrame);
      window.requestAnimationFrame(() => previousFocusRef.current?.focus());
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? choices.filter((choice) =>
          [choice.label, choice.nodeLabel, choice.category, choice.description, choice.nodeKind]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q)),
        )
      : choices;
  }, [choices, query]);

  const grouped = useMemo(() => {
    const groups: Array<{ category: GraphNodeCategory; choices: NodeChoice[] }> = [];
    for (const choice of filtered) {
      const group = groups.find((item) => item.category === choice.category);
      if (group) group.choices.push(choice);
      else groups.push({ category: choice.category, choices: [choice] });
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // The "ask AI" row lives at index `filtered.length`, i.e. one past the last node match. Keeping it
  // in the same index space as the node results means Enter needs no special case: with matches,
  // index 0 is the best node and Enter adds it (unchanged); with none, index 0 IS this row, so
  // "type a sentence, press Enter" just works.
  const trimmedQuery = query.trim();
  const showAsk = Boolean(onAskAI && trimmedQuery);
  const askIndex = filtered.length;
  const optionCount = filtered.length + (showAsk ? 1 : 0);
  const askActive = showAsk && active === askIndex;
  const askId = `node-search-option-${reactId}-${askIndex}`;
  const runAsk = () => {
    if (!onAskAI || !trimmedQuery) return;
    onAskAI(trimmedQuery);
    onClose();
  };

  const menuWidth = Math.min(378, Math.max(280, window.innerWidth - 24));
  const menuHeight = Math.min(458, Math.max(260, window.innerHeight - 24));
  const left = Math.max(12, Math.min(x, window.innerWidth - menuWidth - 12));
  const top = Math.max(12, Math.min(y, window.innerHeight - menuHeight - 12));
  return createPortal(
    <div
      ref={menuRef}
      className="node-search"
      style={{ left, top, width: menuWidth, maxHeight: menuHeight }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        if (document.activeElement === inputRef.current) closeRef.current?.focus();
        else inputRef.current?.focus();
      }}
    >
      <div className="node-search-heading">
        <strong id={titleId}>Add a node</strong>
        <button ref={closeRef} type="button" className="node-search-close" aria-label="Close node search" onClick={onClose}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <label className="node-search-field">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder={filterHint ? `Search ${filterHint}…` : 'Search actions, events, and values…'}
          role="combobox"
          aria-label="Search nodes"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-describedby={`${filterHint ? `${hintId} ` : ''}${countId}`}
          aria-activedescendant={filtered[active] ? `node-search-option-${reactId}-${active}` : askActive ? askId : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, optionCount - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              // A node match wins; otherwise the active row is the AI one (see askIndex above).
              if (filtered[active]) {
                event.preventDefault();
                onPick(filtered[active]);
              } else if (showAsk) {
                event.preventDefault();
                runAsk();
              }
            }
          }}
        />
      </label>
      {filterHint && <div className="node-search-filter-hint" id={hintId}>Showing {filterHint}</div>}
      <span className="sr-only" id={countId} role="status" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'node' : 'nodes'} available.
      </span>
      <div className="node-search-list" id={listId} role="listbox">
        {grouped.map((group, groupIndex) => (
          <section
            className="node-search-group"
            key={group.category}
            role="group"
            aria-labelledby={`node-search-group-${reactId}-${groupIndex}`}
          >
            <div className="node-search-group-title" id={`node-search-group-${reactId}-${groupIndex}`}>
              <span>{group.category}</span>
              <small>{group.choices.length}</small>
            </div>
            {group.choices.map((choice) => {
              const index = filtered.indexOf(choice);
              return (
                <button
                  key={`${choice.category}:${choice.label}`}
                  ref={index === active ? activeOptionRef : undefined}
                  id={`node-search-option-${reactId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === active}
                  className={index === active ? 'active' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(choice)}
                >
                  <span className="node-search-result-main">
                    <span className="node-search-result-title">{choice.label}</span>
                    {choice.description && <small>{choice.description}</small>}
                  </span>
                  <span className={`node-search-pill ${choice.valueType ? `value-${choice.valueType}` : ''}`}>
                    {valueTypeLabels[choice.valueType ?? 'exec']}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {showAsk && (
          <section className="node-search-group" role="group">
            <div className="node-search-group-title">
              <span>Describe it</span>
            </div>
            <button
              ref={askActive ? activeOptionRef : undefined}
              id={askId}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={askActive}
              className={askActive ? 'node-search-ask active' : 'node-search-ask'}
              onMouseEnter={() => setActive(askIndex)}
              onClick={runAsk}
            >
              <span className="node-search-result-main">
                <span className="node-search-result-title">
                  <Sparkles size={13} aria-hidden /> Build “{trimmedQuery}”
                </span>
                <small>Let the assistant wire this up for you</small>
              </span>
              <span className="node-search-pill node-search-ask-pill">↵</span>
            </button>
          </section>
        )}
        {filtered.length === 0 && !showAsk && (
          <div className="node-search-empty" role="status">No matching nodes</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
