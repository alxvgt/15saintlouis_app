'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import ActionPanel from './ActionPanel';
import Legend, {HolidayStripe} from './Legend';
import Loader from './Loader';
import NotesAccordion from './NotesAccordion';
import {
    STATUS_COLORS, adjustmentPct, dayTooltip, effectivePrice, formatCellPrice, getDayStatus, parseDate, shortName,
} from '@/lib/calendar';
import {holidayInfo, holidayText} from '@/lib/frenchHolidays';
import {themeFor} from '@/lib/theme';
import {useTouchRangeSelect} from '@/lib/useTouchRangeSelect';

// Taille d'une case (carrée) : 15 % de la largeur de l'écran, bornée pour rester raisonnable sur tablette / PC.
// Tout le contenu de la case (chiffres, prix, liseré…) est calculé à partir de cette variable CSS.
const CELL_SIZE = 'clamp(46px, 15vw, 80px)';
const TITLE_H = 22;     // bandeau de titre de chaque logement
const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

// Vue d'ensemble : un bloc par logement (bandeau de titre coloré + ligne de cases), toutes les dates futures
// en colonnes avec défilement horizontal.
// `rooms` : [{ key, name, propId, roomId, basePriceId, hasPriceRules }]
// `store` / `load` : magasin de données partagé avec la vue "par logement" (voir lib/useRoomStore.js)
export default function OverviewCalendar({rooms, store, load}) {
    const [selection, setSelection] = useState({}); // { [key]: ['YYYY-MM-DD', ...] }
    const [refreshing, setRefreshing] = useState(false);
    const [dragging, setDragging] = useState(false); // sélection tactile en cours
    const lastClicked = useRef({});
    const gridRef = useRef(null);

    // Chargement initial : ne rappelle Beds24 que si les données du magasin ne sont pas fraîches
    const roomsSig = rooms.map(r => r.key).join('|');
    useEffect(() => {
        rooms.forEach(r => load(r));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomsSig, load]);

    const loading = rooms.some(r => !store[r.key]);

    // Colonnes = union triée des dates de tous les logements
    const dates = useMemo(() => {
        const set = new Set();
        for (const r of rooms) for (const d of store[r.key]?.days ?? []) set.add(d.date);
        return [...set].sort();
    }, [rooms, store]);

    const dayMaps = useMemo(
        () => Object.fromEntries(rooms.map(r => [r.key, new Map((store[r.key]?.days ?? []).map(d => [d.date, d]))])),
        [rooms, store]);

    // Bandeaux de mois
    const months = useMemo(() => {
        const segs = [];
        for (const date of dates) {
            const key = date.slice(0, 7);
            const last = segs[segs.length - 1];
            if (last && last.key === key) last.count++;
            else segs.push({key, count: 1});
        }
        return segs;
    }, [dates]);

    // Sélection par plage : Maj+clic (PC) ; appui long + glisse (mobile, voir ci-dessous)
    const toggle = (roomKey, date, shift) => {
        const current = new Set(selection[roomKey] ?? []);
        const anchor = lastClicked.current[roomKey];
        if (shift && anchor) {
            const [a, b] = anchor < date ? [anchor, date] : [date, anchor];
            dates.filter(d => d >= a && d <= b).forEach(d => current.add(d));
        } else if (current.has(date)) current.delete(date);
        else current.add(date);
        lastClicked.current[roomKey] = date;
        setSelection({...selection, [roomKey]: [...current]});
    };

    // Valeurs courantes lues par les écouteurs tactiles (qui ne sont attachés qu'une fois)
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const datesRef = useRef(dates);
    datesRef.current = dates;

    const touch = useTouchRangeSelect(gridRef, {
        isSelected: (cell) => (selectionRef.current[cell.room] ?? []).includes(cell.date),
        onCell: (cell, mode, prev) => {
            // doigt rapide : on comble les cases sautées entre la précédente et la courante (même ligne)
            const list = datesRef.current;
            let range = [cell.date];
            if (prev) {
                const a = list.indexOf(prev.date);
                const b = list.indexOf(cell.date);
                if (a >= 0 && b >= 0) range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
            }
            lastClicked.current[cell.room] = cell.date;
            setSelection(p => {
                const s = new Set(p[cell.room] ?? []);
                range.forEach(d => (mode === 'add' ? s.add(d) : s.delete(d)));
                return {...p, [cell.room]: [...s]};
            });
        },
        onActiveChange: setDragging,
    }, !loading && dates.length > 0);

    const targets = rooms.map(r => ({
        key: r.key,
        label: shortName(r.name),
        propId: r.propId,
        roomId: r.roomId,
        dates: selection[r.key] ?? [],
        days: store[r.key]?.days ?? [],
        notes: store[r.key]?.notes ?? {},
    }));

    // Après une action : on ne recharge que ce qui a changé, et seulement pour les logements concernés
    const onApplied = async (keys, {parts}) => {
        await Promise.all(rooms.filter(r => keys.includes(r.key)).map(r => load(r, {force: true, parts})));
        setSelection(prev => {
            const next = {...prev};
            keys.forEach(k => { next[k] = []; });
            return next;
        });
    };

    const refresh = async () => {
        setRefreshing(true);
        await Promise.all(rooms.map(r => load(r, {force: true, parts: ['calendar', 'bookings', 'notes']})));
        setRefreshing(false);
    };

    // Notes à venir de tous les logements (même bloc repliable que sur chaque page logement)
    const noteItems = rooms.flatMap(r => {
        const theme = themeFor(r);
        return Object.entries(store[r.key]?.notes ?? {}).map(([date, text]) => ({
            date, text, label: shortName(r.name), badgeBg: theme.nameBg, badgeText: theme.buttonText,
        }));
    });

    const errors = [...new Set(rooms.filter(r => store[r.key]?.error).map(r => `${shortName(r.name)} : ${store[r.key].error}`))];

    return (
        <section style={{marginTop: '2rem'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 6px 0.75rem'}}>
                <h2 style={{margin: 0, fontSize: '1.25rem', color: '#ffffff'}}>Vue d'ensemble</h2>
                {!loading && (
                    <button onClick={refresh} disabled={refreshing}
                            style={{
                                padding: '4px 10px', borderRadius: '6px', border: '1px solid #475569', background: 'transparent',
                                color: '#e2e8f0', fontSize: '0.8rem', cursor: refreshing ? 'wait' : 'pointer',
                            }}>
                        {refreshing ? '⏳' : '↻'} Actualiser
                    </button>
                )}
            </div>

            {loading ? <Loader/> : (
                <>
                    <ActionPanel targets={targets} onApplied={onApplied} onCancel={() => setSelection({})}/>

                    {errors.length > 0 && <p style={{color: '#fca5a5', fontSize: '0.85rem', margin: '0.5rem 6px'}}>{errors.join(' — ')}</p>}

                    <NotesAccordion items={noteItems}/>

                    {dates.length > 0 && (
                        <>
                            <div ref={gridRef}
                                 style={{
                                     overflowX: 'auto', WebkitOverflowScrolling: 'touch',
                                     userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                                     WebkitTapHighlightColor: 'transparent',
                                     outline: dragging ? '2px solid #f59e0b' : 'none', borderRadius: '6px',
                                     '--cell': CELL_SIZE,
                                 }}>
                                <div style={{width: `calc(var(--cell) * ${dates.length})`, position: 'relative'}}>
                                    {/* Ligne des mois */}
                                    <div style={{display: 'flex', height: 24}}>
                                        {months.map(m => {
                                            const [y, mo] = m.key.split('-');
                                            const label = new Intl.DateTimeFormat('fr-FR', m.count < 5 ? {month: 'short'} : {month: 'long', year: 'numeric'}).format(new Date(y, mo - 1));
                                            return (
                                                <div key={m.key} style={{
                                                    width: `calc(var(--cell) * ${m.count})`, boxSizing: 'border-box', borderLeft: '1px solid #475569',
                                                    fontSize: '0.8rem', fontWeight: 'bold', color: '#ffffff', textTransform: 'capitalize',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    <span style={{position: 'sticky', left: 0, display: 'inline-block',  fontSize: '1.2rem', paddingLeft: '1vw', paddingRight: '10vw', backgroundImage: 'linear-gradient(to right, rgba(245, 158, 11, 0.5), rgba(255,255,255,0))'}}>{label}</span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Ligne des jours de la semaine */}
                                    <div style={{display: 'flex', marginBottom: 2}}>
                                        {dates.map(date => {
                                            const dow = parseDate(date).getDay();
                                            const isWeekend = dow === 0 || dow === 6;
                                            return (
                                                <div key={date} style={{
                                                    width: 'var(--cell)', textAlign: 'center', fontSize: isWeekend ? '0.9rem' : '0.6rem', fontWeight: 'bold',
                                                    boxSizing: 'border-box', padding: isWeekend ? '1px 0' : '3px 0', borderRadius: 4,
                                                    // Semaine : fond discret ; week-end : fond ambré plus marqué
                                                    backgroundColor: isWeekend ? 'rgba(245, 158, 11, 0.35)' : 'rgba(148, 163, 184, 0.12)',
                                                    color: isWeekend ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.4)',
                                                }}>{WEEKDAYS[dow]}</div>
                                            );
                                        })}
                                    </div>

                                    {rooms.map(room => {
                                        const theme = themeFor(room);
                                        const selected = new Set(selection[room.key] ?? []);
                                        const notes = store[room.key]?.notes ?? {};
                                        return (
                                            <div key={room.key} style={{marginBottom: 8}}>
                                                {/* Bandeau de titre : la couleur du logement court sur toute la largeur,
                                                    le nom reste visible pendant le défilement horizontal */}
                                                <div style={{
                                                    height: TITLE_H, backgroundColor: theme.nameBg, color: theme.buttonText,
                                                    borderRadius: '8px 8px 0 0', fontSize: '0.8rem', fontWeight: 'bold', lineHeight: `${TITLE_H}px`,
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    <span style={{position: 'sticky', left: 8, display: 'inline-block'}}>{shortName(room.name)}</span>
                                                </div>
                                                <div style={{
                                                    display: 'flex', backgroundColor: theme.rowBg, borderRadius: '0 0 8px 8px',
                                                    borderBottom: `3px solid ${theme.nameBg}`,
                                                }}>
                                                    {dates.map(date => {
                                                        const day = dayMaps[room.key]?.get(date);
                                                        if (!day) return <div key={date} style={{width: 'var(--cell)', height: 'var(--cell)', flex: '0 0 auto'}}/>;
                                                        const status = getDayStatus(day);
                                                        const colors = STATUS_COLORS[status];
                                                        const isSelected = selected.has(date);
                                                        const pct = adjustmentPct(day);
                                                        const hol = holidayInfo(date);
                                                        const dow = parseDate(date).getDay();
                                                        const isWeekend = dow === 0 || dow === 6;
                                                        return (
                                                            <div key={date}
                                                                 data-cell="1" data-room={room.key} data-date={date}
                                                                 onClick={(e) => { if (!touch.justEnded()) toggle(room.key, date, e.shiftKey); }}
                                                                 title={dayTooltip(day, notes[date], holidayText(hol))}
                                                                 style={{width: 'var(--cell)', height: 'var(--cell)', flex: '0 0 auto', boxSizing: 'border-box', padding: 1}}>
                                                                <div style={{
                                                                    height: '100%', borderRadius: 'calc(var(--cell) * 0.125)', position: 'relative', pointerEvents: 'none',
                                                                    backgroundColor: isSelected ? '#f59e0b' : colors.bg,
                                                                    color: isSelected ? '#fff' : colors.text,
                                                                    border: isSelected ? '2px solid #d97706' : '2px solid transparent',
                                                                    boxSizing: 'border-box',
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    fontWeight: 'bold', fontSize: 'calc(var(--cell) * 0.36)',
                                                                }}>
                                                                    {isWeekend && (
                                                                        <span style={{position: 'absolute', inset: 0, borderRadius: 'inherit', backgroundColor: 'rgba(0,0,255,0)', pointerEvents: 'none', margin: '-2px'}}/>
                                                                    )}
                                                                    {Number(date.slice(8))}
                                                                    {notes[date] && <span style={{position: 'absolute', top: 1, right: 3, fontSize: 'calc(var(--cell) * 0.21)', backgroundColor: 'rgba(255,255,255,0.3)', padding: '0 2px', borderRadius: '3px'}}>ⓘ</span>}
                                                                    {day.price != null && (
                                                                        <span style={{position: 'absolute', top: 1, left: 3, fontSize: 'calc(var(--cell) * 0.2)', whiteSpace: 'nowrap', backgroundColor: 'rgba(255,255,255,0.6)', padding: '0 3px', borderRadius: '3px'}}>
                                                                            {formatCellPrice(effectivePrice(day))}{pct > 100 ? '↑' : pct < 100 ? '↓' : ''}
                                                                        </span>
                                                                    )}
                                                                    <HolidayStripe info={hol} height="calc(var(--cell) * 0.09)" radius="calc(var(--cell) * 0.1)"/>
                                                                    <span style={{position: 'absolute', bottom: 'calc(var(--cell) * 0)', left: 3, fontSize: 'calc(var(--cell) * 0.2)', backgroundColor: 'rgba(255,255,255,0.6)', padding: '0 3px', borderRadius: '3px'}}>
                                                                        {day.minStay ? `${day.minStay}n` : ''}{day.override === 'noCheckIn' ? '❌' : ''}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <p style={{fontSize: '0.75rem', color: dragging ? '#fbbf24' : '#94a3b8', margin: '8px 6px 0'}}>
                                ↔ Glisse pour naviguer · appui long puis glisse pour sélectionner une plage (Maj+clic sur PC)
                            </p>
                            <div style={{marginTop: '0.75rem'}}><Legend/></div>
                        </>
                    )}
                </>
            )}
        </section>
    );
}