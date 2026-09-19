import { X } from '@phosphor-icons/react';

export function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button onClick={onClose} aria-label="Close"><X /></button></header>
      {children}
    </section>
  </div>;
}
