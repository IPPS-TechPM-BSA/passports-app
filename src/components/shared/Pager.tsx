import { Fragment } from 'react'

interface PagerProps {
  page: number
  pageCount: number
  onPage: (page: number) => void
  /** e.g. "Showing 1–25 of 132" */
  summary: string
  prevLabel: string
  nextLabel: string
}

export default function Pager({ page, pageCount, onPage, summary, prevLabel, nextLabel }: PagerProps) {
  // First, last, and the pages around the current one.
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1)
    .filter(n => n === 1 || n === pageCount || Math.abs(n - page) <= 2)

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.85rem', color: '#6B7C96' }}>{summary}</span>
      {pageCount > 1 && (
        <ul className="pagination pagination-sm" style={{ margin: 0 }}>
          <li className={page === 1 ? 'disabled' : ''}>
            <a href="#" aria-label={prevLabel}
              onClick={e => { e.preventDefault(); if (page > 1) onPage(page - 1) }}>
              &laquo;
            </a>
          </li>
          {pageNumbers.map((n, i) => (
            <Fragment key={n}>
              {i > 0 && n - pageNumbers[i - 1] > 1 && (
                <li className="disabled"><span>&hellip;</span></li>
              )}
              <li className={n === page ? 'active' : ''}>
                <a href="#" aria-current={n === page ? 'page' : undefined}
                  onClick={e => { e.preventDefault(); onPage(n) }}>
                  {n}
                </a>
              </li>
            </Fragment>
          ))}
          <li className={page === pageCount ? 'disabled' : ''}>
            <a href="#" aria-label={nextLabel}
              onClick={e => { e.preventDefault(); if (page < pageCount) onPage(page + 1) }}>
              &raquo;
            </a>
          </li>
        </ul>
      )}
    </div>
  )
}
