'use client';
import {useRef, useState} from 'react';
import {HolidayStripe} from './Legend';
import {STATUS_COLORS, adjustmentPct, dayTooltip, effectivePrice, formatCellPrice, getDayStatus, parseDate} from '@/lib/calendar';
import {holidayInfo, holidayText} from '@/lib/frenchHolidays';
import {useTouchRangeSelect} from '@/lib/useTouchRangeSelect';

const monthLabel = (key) => {
    const [y, m] = key.split('-');
    return new Intl.DateTimeFormat('fr-FR', {month: 'long', year: 'numeric'}).format(new Date(y, m - 1));
};

const firstDayOffset = (days) => {
    if (days.length === 0) return 0;
    const dow = parseDate(days[0].date).getDay();
    return dow === 0 ? 6 : dow - 1;
};

// Vue "par logement" : un mois par grille de 7 colonnes.
// onToggle(date) : tap simple ; onRange(dates, 'add' | 'remove') : appui long puis glisse (mobile).
export default function MonthGrid({days, selectedDates, onToggle, onRange, notes}) {
    const gridRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const selected = new Set(selectedDates);

    // Valeurs courantes lues par les écouteurs tactiles (attachés une seule fois)
    const latest = useRef({});
    latest.current = {selected, days, onRange};

    const touch = useTouchRangeSelect(gridRef, {
        isSelected: (cell) => latest.current.selected.has(cell.date),
        onCell: (cell, mode, prev) => {
            // doigt rapide : on comble les jours sautés
            const list = latest.current.days.map(d => d.date);
            let range = [cell.date];
            if (prev) {
                const a = list.indexOf(prev.date);
                const b = list.indexOf(cell.date);
                if (a >= 0 && b >= 0) range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
            }
            latest.current.onRange?.(range, mode);
        },
        onActiveChange: setDragging,
    }, days.length > 0, {autoScroll: 'y'});

    const daysByMonth = days.reduce((acc, day) => {
        const key = day.date.slice(0, 7);
        (acc[key] ||= []).push(day);
        return acc;
    }, {});

    return (
        <div ref={gridRef}
             style={{
                 userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent',
                 outline: dragging ? '2px solid #f59e0b' : 'none', borderRadius: '6px',
                 // Les tailles de texte des cases sont en `cqw` (% de la largeur de CETTE grille) : elles suivent la taille
                 // des cases quel que soit l'écran ; la largeur est bornée pour rester lisible sur tablette / PC.
                 containerType: 'inline-size', maxWidth: '720px', margin: '0 auto',
             }}>
            {days.length > 0 && (
                <p style={{fontSize: '0.75rem', color: dragging ? '#fbbf24' : '#94a3b8', margin: '0 0 1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    Appui long puis glisse pour sélectionner plusieurs jours
                </p>
            )}
            {Object.entries(daysByMonth).map(([monthKey, monthDays]) => (
                <div key={monthKey} style={{marginBottom: '2rem'}}>
                    <h3 style={{textTransform: 'capitalize', marginBottom: '0.75rem', fontSize: '1rem', color: '#ffffff'}}>
                        {monthLabel(monthKey)}
                    </h3>

                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px'}}>
                        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
                            <div key={i} style={{textAlign: 'center', fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold'}}>{d}</div>
                        ))}
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px'}}>
                        {Array.from({length: firstDayOffset(monthDays)}).map((_, i) => <div key={`empty-${i}`}/>)}

                        {monthDays.map((day) => {
                            const status = getDayStatus(day);
                            const colors = STATUS_COLORS[status];
                            const isSelected = selected.has(day.date);
                            const dayNum = Number(day.date.slice(8));
                            const pct = adjustmentPct(day);
                            const hol = holidayInfo(day.date);

                            return (
                                <div
                                    key={day.date}
                                    data-cell="1" data-room="r" data-date={day.date}
                                    onClick={() => { if (!touch.justEnded()) onToggle(day.date); }}
                                    title={dayTooltip(day, notes[day.date], holidayText(hol))}
                                    style={{
                                        aspectRatio: '1/1',
                                        backgroundColor: isSelected ? '#f59e0b' : colors.bg,
                                        borderRadius: '6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'flex-start',
                                        color: isSelected ? '#fff' : colors.text,
                                        fontSize: '1.1rem',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        border: isSelected ? '2px solid #d97706' : '2px solid transparent',
                                        boxSizing: 'border-box',
                                        userSelect: 'none',
                                        position: 'relative',
                                    }}
                                >
                                    <span style={{fontSize: '5.2cqw', fontWeight: 'bold', marginTop: '27.5%', pointerEvents: 'none'}}>{dayNum}</span>
                                    {notes[day.date] && (
                                        <span style={{position: 'absolute', top: '2px', right: '2px', fontSize: 'max(9px, 2.6cqw)', fontWeight: 'bold', lineHeight: 1, pointerEvents: 'none'}}>ⓘ</span>
                                    )}
                                    {day.price != null && (
                                        <span style={{
                                            fontSize: 'max(8px, 2.1cqw)', opacity: 0.9, position: 'absolute', top: '0px', left: '0px',
                                            backgroundColor: 'rgb(255 255 255 / 0.6)', padding: '1px 3px', borderRadius: '3px',
                                            fontWeight: 'bold', whiteSpace: 'nowrap', pointerEvents: 'none',
                                        }}>
                                            {formatCellPrice(effectivePrice(day))}{pct > 100 ? '↑' : pct < 100 ? '↓' : ''}
                                        </span>
                                    )}
                                    <HolidayStripe info={hol} radius={4}/>
                                    <span style={{
                                        fontSize: 'max(8px, 2.35cqw)', opacity: 0.9, position: 'absolute', bottom: '0px', left: '0px',
                                        backgroundColor: 'rgb(255 255 255 / 0.6)', padding: '1px 3px', borderRadius: '3px', fontWeight: 'bold',
                                        pointerEvents: 'none',
                                    }}>
                                        {day.minStay && <span>{day.minStay}n</span>}
                                        {day.override === 'noCheckIn' && <span style={{fontSize: 'max(7px, 1.9cqw)', marginLeft: '2px'}}>❌</span>}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
