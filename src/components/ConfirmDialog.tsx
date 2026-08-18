import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useConfirmStore } from '../store/confirmStore';

/**
 * Renders the pending confirmation request (see confirmStore). Escape cancels; Enter is left to
 * the currently focused button so keyboard users can never confirm while focused on Cancel.
 * Mounted once in App, portalled to <body>.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const respond = useConfirmStore((s) => s.respond);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!request) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      (request.danger ? cancelRef.current : confirmRef.current)?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        respond(false);
        return;
      }
      if (e.key === 'Tab') {
        const cancel = cancelRef.current;
        const confirm = confirmRef.current;
        if (!cancel || !confirm) return;
        if (e.shiftKey && (document.activeElement === cancel || !document.activeElement)) {
          e.preventDefault();
          confirm.focus();
        } else if (!e.shiftKey && document.activeElement === confirm) {
          e.preventDefault();
          cancel.focus();
        } else if (document.activeElement !== cancel && document.activeElement !== confirm) {
          e.preventDefault();
          (request.danger ? cancel : confirm).focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey, true);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [request, respond]);

  const titleId = request?.title ? 'confirm-dialog-title' : undefined;
  const messageId = request ? 'confirm-dialog-message' : undefined;

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div
          className="confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => respond(false)}
        >
          <motion.div
            role={request.danger ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-label={request.title ? undefined : 'Confirm action'}
            aria-labelledby={titleId}
            aria-describedby={messageId}
            className={`confirm-dialog ${request.danger ? 'is-danger' : ''}`}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {request.danger && (
              <div className="confirm-dialog__icon" aria-hidden>
                <AlertTriangle size={20} />
              </div>
            )}
            <div className="confirm-dialog__body">
              {request.title && (
                <h3 id={titleId} className="confirm-dialog__title">
                  {request.title}
                </h3>
              )}
              <p id={messageId} className="confirm-dialog__message">
                {request.message}
              </p>
            </div>
            <div className="confirm-dialog__actions">
              <button
                ref={cancelRef}
                type="button"
                className="confirm-dialog__cancel"
                onClick={() => respond(false)}
              >
                {request.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmRef}
                type="button"
                className={`confirm-dialog__confirm ${request.danger ? 'is-danger' : ''}`}
                onClick={() => respond(true)}
              >
                {request.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
