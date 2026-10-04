export function Segmented({ label, value, options, onChange }) {
  return <div className="compare-segmented" role="group" aria-label={label}>
    {options.map(([id, text]) => <button key={id} type="button" className={value === id ? 'active' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
  </div>;
}
