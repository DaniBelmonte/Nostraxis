import { MagnifyingGlass, SlidersHorizontal, X } from '@phosphor-icons/react';
import { DateRange } from './Observability';

function FilterSelect({ label, value, options, onChange, labelledOptions }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map((option) => <option key={option} value={option}>{labelledOptions ? (option === 'All' ? `All ${label.toLowerCase()}s` : option) : option}</option>)}
  </select></label>;
}

export function FilterBar({ query, onQuery, searchPlaceholder = 'Search…', dates, onDates, primary = [], more = [], moreOpen, onToggleMore }) {
  return <>
    <div className="filter-toolbar">
      {onQuery && <label className="search-field filter-search-field">
        <MagnifyingGlass />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={searchPlaceholder} />
        {query && <button type="button" onClick={() => onQuery('')} aria-label="Clear search"><X /></button>}
      </label>}
      {dates && <DateRange {...dates} onChange={onDates} />}
    </div>
    <div className="filter-row">
      {primary.map(({ key, ...filter }) => <FilterSelect key={key} labelledOptions {...filter} />)}
      {!!more.length && <button type="button" className={`toolbar-button ${moreOpen ? 'active' : ''}`} onClick={onToggleMore} aria-expanded={moreOpen}><SlidersHorizontal /> More filters</button>}
    </div>
    {moreOpen && !!more.length && <div className="filter-row filter-row-more">
      {more.map(({ key, ...filter }) => <FilterSelect key={key} {...filter} />)}
    </div>}
  </>;
}
