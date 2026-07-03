import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Apple,
  ClipboardCheck,
  Cloud,
  Globe,
  Monitor,
  OctagonX,
  Scissors,
  Smartphone,
  X,
} from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import type { ExportPlatformInfo, ExportTarget } from '../platform/types';

/** Single asset above this size gets flagged in the breakdown — it dominates load time. */
const LARGE_ASSET_BYTES = 8 * 1024 * 1024;

/** Remembers the "Strip unused assets" choice across sessions. */
const STRIP_PREF_KEY = 'nodeforge.export.stripUnused';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function platformIcon(info: ExportPlatformInfo) {
  if (info.id === 'web') return <Globe size={14} aria-hidden />;
  if (info.id === 'ios') return <Apple size={14} aria-hidden />;
  if (info.kind === 'mobile') return <Smartphone size={14} aria-hidden />;
  return <Monitor size={14} aria-hidden />;
}

/** The buildProduction target a doctor platform maps to ('desktop' = installer for the host OS). */
function platformTarget(info: ExportPlatformInfo): ExportTarget | null {
  if (info.id === 'web') return 'web';
  if (info.id === 'android') return 'android';
  if (info.id === 'ios') return 'ios';
  return info.status === 'ready' || info.status === 'missing' ? 'desktop' : null;
}

/**
 * Per-platform rows for a Production export: what this machine can build right now (checkbox),
 * what belongs on CI (cloud hint), and exactly what's missing otherwise (first unmet requirement).
 */
function PlatformPicker({
  selected,
  onToggle,
}: {
  selected: Set<ExportTarget>;
  onToggle: (target: ExportTarget) => void;
}) {
  const platforms = useProjectStore((state) => state.exportPlatforms);
  if (!platforms) return null;

  return (
    <section className="report-section">
      <h3>Platforms</h3>
      <ul className="report-platforms">
        {platforms.platforms.map((info) => {
          const target = platformTarget(info);
          const buildable = target !== null && (info.status === 'ready' || info.id === 'web');
          const checked = info.id === 'web' || (target !== null && selected.has(target));
          const firstMissing = info.requirements.find((req) => !req.ok);
          return (
            <li key={info.id} className={`report-platform ${info.status}`}>
              <label className="report-platform-main">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!buildable || info.id === 'web'}
                  onChange={() => target && onToggle(target)}
                />
                {platformIcon(info)}
                <span className="report-platform-label">{info.label}</span>
                {info.id === 'web' && <span className="report-flag ok">always included</span>}
                {info.status === 'ready' && info.id !== 'web' && <span className="report-flag ok">ready</span>}
                {info.status === 'ci' && (
                  <span className="report-flag" title={info.notes}>
                    <Cloud size={11} aria-hidden /> build on CI
                  </span>
                )}
                {info.status === 'missing' && (
                  <span className="report-flag warn" title={info.notes}>
                    setup needed
                  </span>
                )}
                {info.status === 'unsupported' && <span className="report-flag error">needs a Mac</span>}
              </label>
              {info.status === 'missing' && firstMissing && (
                <div className="report-platform-hint">
                  {firstMissing.label}
                  {firstMissing.fix ? ` — ${firstMissing.fix}` : ''}
                  {' · run `npm run doctor` for the full checklist'}
                </div>
              )}
              {info.status === 'ci' && (
                <div className="report-platform-hint">
                  One click away on GitHub: Actions → “Export Desktop Installers”.
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Pre-export "Build Report": what's in the bundle, how big each asset is, what's broken and
 * what will be stripped — shown before any file dialog so the user can trust what ships.
 * Opens whenever `pendingExport` is set (both the Export and Production buttons).
 */
export function BuildReportDialog() {
  const pending = useProjectStore((state) => state.pendingExport);
  const cancel = useProjectStore((state) => state.cancelPendingExport);
  const confirm = useProjectStore((state) => state.confirmPendingExport);
  const loadExportPlatforms = useProjectStore((state) => state.loadExportPlatforms);
  const [stripUnused, setStripUnused] = useState(() => localStorage.getItem(STRIP_PREF_KEY) !== '0');
  // Native build targets for Production mode; the desktop installer for this OS starts selected.
  const [targets, setTargets] = useState<Set<ExportTarget>>(() => new Set<ExportTarget>(['desktop']));

  const isProduction = pending?.mode === 'production';

  useEffect(() => {
    if (!pending) return;
    if (isProduction) void loadExportPlatforms();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, isProduction, cancel, loadExportPlatforms]);

  const toggleTarget = (target: ExportTarget) => {
    setTargets((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  };

  const report = pending?.report ?? null;
  const stripped = useMemo(
    () => (report && !report.scanFailed ? report.assets.filter((asset) => !asset.referenced) : []),
    [report],
  );
  const strippedBytes = stripped.reduce((total, asset) => total + asset.bytes, 0);
  const willStrip = stripUnused && !(report?.scanFailed ?? false) && stripped.length > 0;

  const setStrip = (value: boolean) => {
    setStripUnused(value);
    localStorage.setItem(STRIP_PREF_KEY, value ? '1' : '0');
  };

  const hasErrors = (report?.errors.length ?? 0) > 0;
  const hasWarnings = (report?.warnings.length ?? 0) > 0;

  // Portal to <body> so the modal escapes the toolbar's `backdrop-filter` containing block
  // (otherwise `position: fixed` resolves against the 58px toolbar and gets clipped).
  return createPortal(
    <AnimatePresence>
      {pending && report && (
        <motion.div
          className="prefs-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancel();
          }}
        >
          <motion.div
            className="prefs-card report-card"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label="Build report"
          >
            <header className="prefs-header">
              <ClipboardCheck size={16} aria-hidden />
              <strong>Build Report — {pending.mode === 'production' ? 'Production' : 'Export'}</strong>
              <div className="prefs-spacer" />
              <button className="prefs-close" onClick={cancel} title="Close (Esc)">
                <X size={14} aria-hidden />
              </button>
            </header>

            <div className="report-body">
              <div className="report-total">
                <strong>{humanSize(report.totalBytes)}</strong>
                <span>
                  total bundle{willStrip ? ` · ≈${humanSize(Math.max(0, report.totalBytes - strippedBytes))} after stripping` : ''}
                </span>
              </div>

              <section className="report-section">
                <h3>Contents</h3>
                <ul className="report-summary">
                  {report.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>

              {hasErrors && (
                <section className="report-section">
                  <h3 className="report-h-error">
                    <OctagonX size={14} aria-hidden /> Errors — export blocked
                  </h3>
                  <ul className="report-issues error">
                    {report.errors.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}

              {hasWarnings && (
                <section className="report-section">
                  <h3 className="report-h-warn">
                    <AlertTriangle size={14} aria-hidden /> Warnings
                  </h3>
                  <ul className="report-issues warn">
                    {report.warnings.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}

              {report.assets.length > 0 && (
                <section className="report-section">
                  <h3>Assets ({report.assets.length})</h3>
                  <table className="report-assets">
                    <tbody>
                      {report.assets.map((asset) => {
                        const isStripped = willStrip && !asset.referenced;
                        const isLarge = asset.bytes > LARGE_ASSET_BYTES;
                        return (
                          <tr key={asset.id} className={isStripped ? 'stripped' : isLarge ? 'large' : undefined}>
                            <td className="report-asset-name" title={asset.id}>
                              {asset.name}
                            </td>
                            <td className="report-asset-type">{asset.type}</td>
                            <td className="report-asset-flags">
                              {isLarge && !isStripped && (
                                <span className="report-flag warn" title="Over 8 MB — consider compressing">
                                  <AlertTriangle size={11} aria-hidden /> large
                                </span>
                              )}
                              {!asset.embedded && <span className="report-flag error">no data</span>}
                              {isStripped && <span className="report-flag">stripped</span>}
                            </td>
                            <td className="report-asset-size">{humanSize(asset.bytes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}

              {isProduction && <PlatformPicker selected={targets} onToggle={toggleTarget} />}

              <section className="report-section">
                <label className="report-strip-toggle">
                  <input
                    type="checkbox"
                    checked={stripUnused}
                    disabled={report.scanFailed}
                    onChange={(e) => setStrip(e.target.checked)}
                  />
                  <Scissors size={14} aria-hidden />
                  <span>
                    Strip unused assets
                    {report.scanFailed
                      ? ' — unavailable: the reference scan failed, so everything ships.'
                      : stripped.length
                        ? ` — ${stripped.length} unreferenced asset${stripped.length === 1 ? '' : 's'}, saves ${humanSize(strippedBytes)}.`
                        : ' — every asset is referenced; nothing to strip.'}
                  </span>
                </label>
              </section>
            </div>

            <footer className="report-footer">
              <button className="prefs-link-button" onClick={cancel}>
                Cancel
              </button>
              <button
                className="prefs-primary-button"
                disabled={hasErrors}
                title={hasErrors ? 'Fix the errors above first — a used resource is missing.' : undefined}
                onClick={() => void confirm(stripUnused, isProduction ? [...targets] : undefined)}
              >
                {hasErrors ? 'Export' : hasWarnings ? 'Export anyway' : 'Export'}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
