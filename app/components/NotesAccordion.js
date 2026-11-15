'use client';
import {useState} from 'react';

const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Bloc repliable « ⓘ Notes (N) » : notes à venir, triées par date.
// items : [{ date: 'YYYY-MM-DD', text, label?, badgeBg?, badgeText? }]  (label = nom du logement, vue d'ensemble)
export default function NotesAccordion({items}) {
    const [open, setOpen] = useState(false);
    const today = todayKey();
    const upcoming = items
        .filter(i => i.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.label).localeCompare(String(b.label)));
    if (upcoming.length === 0) return null;

    return (
        <div style={{
            marginBottom: '1rem',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '0.6rem 1rem',
            color: '#1e293b',
            fontSize: '0.85rem'
        }}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'inherit',
                    fontSize: 'inherit',
                    fontFamily: 'inherit'
                }}>
                <strong>ⓘ Notes ({upcoming.length})</strong>
                <span aria-hidden="true">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <ul style={{margin: '0.5rem 0 0 0', paddingLeft: '1.2rem'}}>
                    {upcoming.map(({date, text, label, badgeBg, badgeText}) => {
                        const [y, m, d] = date.split('-').map(Number);
                        const dateLabel = new Intl.DateTimeFormat('fr-FR', {weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(y, m - 1, d));
                        return (
                            <li key={`${label ?? ''}-${date}`} style={{marginBottom: '4px'}}>
                                {label && (
                                    <span style={{
                                        display: 'inline-block', marginRight: '6px', padding: '0 6px', borderRadius: '4px',
                                        fontSize: '0.75rem', fontWeight: 'bold', backgroundColor: badgeBg ?? '#e2e8f0', color: badgeText ?? '#1e293b',
                                    }}>{label}</span>
                                )}
                                <strong>{dateLabel}</strong> — {text}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
