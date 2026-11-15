'use client';
import {useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {adjustmentPct, addDays, contiguousGroups, formatPrice, getDayStatus} from '@/lib/calendar';
import {isCancellable} from '@/lib/bookingRules';

// Panneau d'actions partagé (vue par logement ET vue d'ensemble).
// `targets` : [{ key, label, propId, roomId, dates: [...], days: [...], notes: {...} }]
// Chaque action est appliquée à chaque cible (= un logement) avec ses propres dates.
// `onApplied(keys, {parts, partial})` : `parts` = ce qui a changé côté données (calendar, bookings, notes).
export default function ActionPanel({targets, onApplied, onCancel, accent}) {
    const [actionMode, setActionMode] = useState(null);
    const [minStayInput, setMinStayInput] = useState(2);
    const [multiplierInput, setMultiplierInput] = useState('');
    const [noteInput, setNoteInput] = useState('');
    const [firstNameInput, setFirstNameInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [confirmCancel, setConfirmCancel] = useState(null); // réservations concernées par « Débloquer », en attente de confirmation

    const minStayRef = useRef(null);
    const multiplierRef = useRef(null);
    const noteRef = useRef(null);
    const firstNameRef = useRef(null);

    const active = targets.filter(t => t.dates.length > 0);
    const total = active.reduce((n, t) => n + t.dates.length, 0);
    const noSelection = total === 0;

    const selectedDays = active.flatMap(t => {
        const set = new Set(t.dates);
        return t.days.filter(d => set.has(d.date));
    });
    const selectedNotes = active.flatMap(t => t.dates.map(d => t.notes[d] ?? ''));
    const hasNotes = selectedNotes.some(Boolean);

    const chooseMode = (mode) => {
        setError(null);
        setSuccessMsg(null);
        // flushSync : le champ est rendu immédiatement, ce qui permet de le focaliser dans le même geste
        // utilisateur (sinon le clavier ne s'ouvre pas sur mobile)
        flushSync(() => {
            if (mode === 'setMultiplier') {
                const ms = new Set(selectedDays.map(d => adjustmentPct(d)));
                setMultiplierInput(ms.size === 1 ? String([...ms][0]) : '');
            } else if (mode === 'note') {
                const texts = new Set(selectedNotes);
                setNoteInput(texts.size === 1 ? [...texts][0] : '');
            }
            setActionMode(mode);
        });

        const el = mode === 'note' ? noteRef.current
            : mode === 'setMinStay' ? minStayRef.current
            : mode === 'setMultiplier' ? multiplierRef.current
            : mode === 'booking' ? firstNameRef.current
            : null;
        if (el) {
            el.focus();
            if (mode === 'note') el.setSelectionRange(el.value.length, el.value.length);
            else if (el.select) el.select();
        }
    };

    // Résultat de l'ajustement saisi, affiché à côté du champ (une fourchette si plusieurs prix de base)
    const adjustmentResult = (() => {
        if (actionMode !== 'setMultiplier') return null;
        const m = Number(String(multiplierInput).replace(',', '.').replace('%', '').trim());
        if (multiplierInput === '' || !Number.isInteger(m) || m < 25 || m > 250) return null;
        const bases = selectedDays.filter(d => d.price != null).map(d => d.price);
        if (bases.length === 0) return null;
        const lo = Math.round(Math.min(...bases) * m) / 100;
        const hi = Math.round(Math.max(...bases) * m) / 100;
        return lo === hi ? formatPrice(lo) : `${formatPrice(lo)} – ${formatPrice(hi)}`;
    })();

    const postJson = async (url, body, method = 'POST', bodyOverride = null) => {
        const res = await fetch(url, {
            method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(bodyOverride ?? body),
        });
        return res.json();
    };

    // Exécute `fn(target)` sur chaque logement concerné, un par un ; recharge les données si au moins un a réussi.
    const runOnTargets = async (fn, okMsg, parts = ['calendar']) => {
        if (noSelection) return;
        setSaving(true);
        setError(null);
        setSuccessMsg(null);
        const errors = [];
        const warnings = [];
        let okCount = 0;
        for (const t of active) {
            try {
                const json = await fn(t);
                if (json.success) {
                    okCount++;
                    if (json.warnings?.length) warnings.push(`${t.label} : ${JSON.stringify(json.warnings)}`);
                } else {
                    errors.push(`${t.label} : ${json.error || json.message || 'Réponse invalide'}${json.detail ? ' — ' + JSON.stringify(json.detail) : ''}`);
                }
            } catch (err) {
                errors.push(`${t.label} : erreur réseau (${err.message})`);
            }
        }
        const problems = [...errors, ...warnings.map(w => 'Avertissement Beds24 — ' + w)];
        if (problems.length) setError(problems.join('\n'));
        if (okCount > 0) {
            setSuccessMsg(`✓ ${okMsg} sur ${total} jour(s)`);
            setActionMode(null);
            await onApplied(active.map(t => t.key), {parts, partial: errors.length > 0});
        }
        setSaving(false);
    };

    const beds24 = (extra) => (t) => postJson('/api/beds24', {propId: t.propId, roomId: t.roomId, dates: t.dates, ...extra});
    const notesCall = (text) => (t) => postJson('/api/notes', {roomId: String(t.roomId), dates: t.dates, text});

    const createBookings = async () => {
        // Une réservation ne peut être créée que sur des nuits libres
        const notFree = active.flatMap(t => {
            const byDate = new Map(t.days.map(d => [d.date, d]));
            return t.dates.filter(date => {
                const d = byDate.get(date);
                return !d || getDayStatus(d) !== 'available';
            }).map(date => `${t.label} ${date}`);
        });
        if (notFree.length > 0) {
            setError(`Réservation impossible : ces nuits ne sont pas libres → ${notFree.slice(0, 6).join(', ')}${notFree.length > 6 ? '…' : ''}`);
            return;
        }
        await runOnTargets(async (t) => {
            // une réservation par plage de nuits consécutives ; le départ = dernière nuit + 1 jour
            const results = [];
            for (const group of contiguousGroups(t.dates)) {
                const json = await postJson('/api/bookings', {
                    roomId: String(t.roomId),
                    arrival: group[0],
                    departure: addDays(group[group.length - 1], 1),
                    firstName: firstNameInput,
                });
                results.push(json);
                if (!json.success) return json;
            }
            return {success: true, count: results.length};
        }, 'Réservation créée', ['calendar', 'bookings']);
    };

    const applyAction = async () => {
        if (noSelection || !actionMode) return;
        if (actionMode === 'note') return runOnTargets(notesCall(noteInput), noteInput.trim() ? 'Note enregistrée' : 'Note supprimée', ['notes']);
        if (actionMode === 'booking') return createBookings();
        if (actionMode === 'block') return runOnTargets(beds24({override: 'blackout'}), 'Jours modifiés');
        if (actionMode === 'unblock') return requestUnblock();
        if (actionMode === 'noCheckIn') return runOnTargets(beds24({override: 'noCheckIn'}), 'Jours modifiés');
        if (actionMode === 'setMinStay') return runOnTargets(beds24({minStay: minStayInput}), 'Jours modifiés');
        if (actionMode === 'setMultiplier') {
            const m = Number(String(multiplierInput).replace(',', '.').replace('%', '').trim());
            if (multiplierInput === '' || !Number.isInteger(m) || m < 25 || m > 250) {
                setError("Ajustement invalide : entier entre 25 et 250 (100 = prix normal, 106 = +6 %)");
                return;
            }
            // 100 % = pas d'ajustement : on supprime la valeur
            return runOnTargets(beds24({multiplier: m === 100 ? null : m}), 'Jours modifiés');
        }
    };

    // Réservations (une seule fois chacune) couvrant les jours sélectionnés d'un logement
    const bookingsOf = (t) => {
        const set = new Set(t.dates);
        const byId = new Map();
        for (const d of t.days) if (set.has(d.date) && d.booking) byId.set(d.booking.id, d.booking);
        return [...byId.values()].sort((a, b) => a.arrival.localeCompare(b.arrival));
    };
    const bookedSelection = active.map(t => ({t, bookings: bookingsOf(t)})).filter(x => x.bookings.length > 0);
    const bookingCount = bookedSelection.reduce((n, x) => n + x.bookings.length, 0);

    // Jours à débloquer pour un logement : ceux de la sélection, sauf ceux couverts par une réservation
    // qu'on ne peut pas annuler ici (Airbnb, Booking, saisie manuelle dans Beds24…)
    const unblockDatesOf = (t) => {
        const locked = new Set(t.days.filter(d => d.booking && !isCancellable(d.booking)).map(d => d.date));
        return t.dates.filter(date => !locked.has(date));
    };

    // Débloquer : si des réservations sont concernées, on demande confirmation avant de les annuler
    const requestUnblock = () => {
        if (bookedSelection.length > 0) {
            setError(null);
            setSuccessMsg(null);
            setConfirmCancel(bookedSelection);
            return;
        }
        return runOnTargets(beds24({override: 'none'}), 'Jours modifiés');
    };

    // Détail pour la fenêtre de confirmation
    const dialog = confirmCancel && (() => {
        const rows = confirmCancel.flatMap(({t, bookings}) => bookings.map(b => ({t, b})));
        const dayBooked = (t) => new Set(t.days.filter(d => d.booking).map(d => d.date));
        return {
            cancellable: rows.filter(r => isCancellable(r.b)),
            locked: rows.filter(r => !isCancellable(r.b)),
            freeCount: active.reduce((n, t) => { const booked = dayBooked(t); return n + t.dates.filter(d => !booked.has(d)).length; }, 0),
        };
    })();

    const confirmUnblock = async () => {
        const items = confirmCancel;
        const cancelCount = dialog.cancellable.length;
        setConfirmCancel(null);
        await runOnTargets(async (t) => {
            const found = items.find(x => x.t.key === t.key);
            const ids = (found?.bookings ?? []).filter(isCancellable).map(b => b.id);
            if (ids.length > 0) {
                // Beds24 refuse de supprimer une réservation active : on la passe au statut « cancelled »
                const json = await postJson('/api/bookings', {ids}, 'PATCH');
                if (!json.success) return json;
            }
            const dates = unblockDatesOf(t);
            if (dates.length === 0) return {success: true};
            return postJson('/api/beds24', {propId: t.propId, roomId: t.roomId, dates, override: 'none'});
        }, cancelCount > 0 ? 'Réservation annulée et jours débloqués' : 'Jours débloqués', ['calendar', 'bookings']);
    };

    const removeAdjustment = () => runOnTargets(beds24({multiplier: null}), 'Ajustement supprimé');
    const removeMinStay = () => runOnTargets(beds24({minStay: 1}), 'Séjour minimum remis à 1');
    const deleteNotes = () => runOnTargets(notesCall(''), 'Note supprimée', ['notes']);

    // Hauteur fixe (30 px) : les emojis (🛏, ⓘ…) ont des métriques de police différentes et gonflaient certains boutons.
    const btnStyle = (isActive, color, activeText = '#fff') => ({
        height: '30px',
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 10px',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        borderRadius: '6px',
        border: 'none',
        cursor: noSelection ? 'not-allowed' : 'pointer',
        backgroundColor: isActive ? color : '#e2e8f0',
        color: isActive ? activeText : '#1a202c',
        fontSize: '0.85rem',
        opacity: noSelection ? 0.5 : 1,
    });
    const dangerBtn = {
        padding: '5px 10px', borderRadius: '6px', border: 'none', cursor: saving ? 'wait' : 'pointer',
        backgroundColor: '#dc2626', color: '#fff', fontSize: '0.85rem',
    };
    const inputStyle = {padding: '3px 8px', border: '1px solid #cbd5e0', borderRadius: '6px', fontSize: '0.85rem'};

    // Texte court sur une seule ligne : sa hauteur ne change jamais, donc la page ne « saute » pas pendant la sélection
    const label = total === 0
        ? '👆 Sélectionne des jours'
        : active.length > 1
            ? `${total} jour(s) · ${active.length} logements`
            : `${total} jour(s) sélectionné(s)`;

    return (
        <div style={{
            position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0', borderRadius: '10px', padding: '6px 8px', marginBottom: '4px',
            ...(accent ? {borderLeft: `8px solid ${accent}`} : {}),
        }}>
            <p style={{margin: '0 0 5px 0', fontSize: '0.8rem', lineHeight: '1.2', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{label}</p>

            <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center'}}>
                {[
                    {mode: 'block', label: '⚫ Bloquer', color: '#1a202c'},
                    {mode: 'unblock', label: '🟢 Débloquer', color: '#4ade80', text: '#043528'},
                    {mode: 'noCheckIn', label: '❌ No Check-in', color: '#f97316'},
                    {mode: 'setMinStay', label: '📅 Min Stay', color: '#3b82f6'},
                    {mode: 'setMultiplier', label: '± Ajustement prix', color: '#b45309'},
                    {mode: 'booking', label: '🛏 Réservation', color: '#0e7490'},
                    {mode: 'note', label: 'ⓘ Note', color: '#7c3aed'},
                ].map(a => (
                    <button key={a.mode} onClick={() => chooseMode(a.mode)} disabled={noSelection}
                            style={btnStyle(actionMode === a.mode, a.color, a.text)}>
                        {a.label}
                    </button>
                ))}
            </div>

            {(error || successMsg) && (
                <div style={{marginTop: '5px', fontSize: '0.8rem', whiteSpace: 'pre-wrap'}}>
                    {error && <div style={{color: '#b91c1c'}}>{error}</div>}
                    {successMsg && <div style={{color: '#15803d'}}>{successMsg}</div>}
                </div>
            )}

            {actionMode && (
                <div style={{
                    marginTop: '5px', padding: '5px 8px', backgroundColor: '#e0e7ff', border: '1px solid #c7d2fe',
                    borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '5px', color: '#1e293b', fontSize: '0.85rem',
                }}>
                    {actionMode === 'block' && <span>Bloquer {total} jour(s)</span>}
                    {actionMode === 'unblock' && (
                        <span>
                            Débloquer {total} jour(s)
                            {bookingCount > 0 && <strong style={{color: '#b91c1c'}}> — ⚠ {bookingCount} réservation(s) : confirmation demandée</strong>}
                        </span>
                    )}
                    {actionMode === 'noCheckIn' && <span>Interdire l'arrivée sur {total} jour(s)</span>}

                    {actionMode === 'setMinStay' && (
                        <label style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                            Séjour minimum
                            <input ref={minStayRef} type="number" min={1} max={365} value={minStayInput}
                                   onChange={e => setMinStayInput(parseInt(e.target.value))}
                                   style={{...inputStyle, width: '60px'}}/>
                            nuit(s)
                        </label>
                    )}

                    {actionMode === 'setMultiplier' && (
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                            <span>Ajustement</span>
                            <input ref={multiplierRef} type="number" min={25} max={250} step={1} value={multiplierInput}
                                   placeholder="100" onChange={e => setMultiplierInput(e.target.value)}
                                   style={{...inputStyle, width: '60px', textAlign: 'center'}}/>
                            <span>%</span>
                            {adjustmentResult && <strong>→ {adjustmentResult}</strong>}
                        </div>
                    )}

                    {actionMode === 'booking' && (
                        <label style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                            <span>
                                Réservation ({active.reduce((n, t) => n + contiguousGroups(t.dates).length, 0)} séjour(s)) — prénom
                            </span>
                            <input ref={firstNameRef} type="text" maxLength={100} value={firstNameInput}
                                   placeholder="optionnel" onChange={e => setFirstNameInput(e.target.value)}
                                   style={{...inputStyle, width: '160px'}}/>
                        </label>
                    )}

                    {actionMode === 'note' && (
                        <textarea ref={noteRef} value={noteInput} rows={2} maxLength={500} placeholder="Note interne"
                                  onChange={e => setNoteInput(e.target.value)}
                                  style={{...inputStyle, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit'}}/>
                    )}

                    <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center'}}>
                        <button onClick={applyAction} disabled={saving}
                                style={{
                                    padding: '5px 14px', borderRadius: '6px', border: 'none',
                                    cursor: saving ? 'not-allowed' : 'pointer', backgroundColor: '#3b82f6',
                                    color: '#fff', fontSize: '0.85rem', fontWeight: 'bold',
                                }}>
                            {saving ? '⏳ En cours...' : '✓ Appliquer'}
                        </button>
                        {actionMode === 'setMinStay' && selectedDays.some(d => d.minStay > 1) && (
                            <button onClick={removeMinStay} disabled={saving} style={dangerBtn}>Supprimer</button>
                        )}
                        {actionMode === 'setMultiplier' && selectedDays.some(d => adjustmentPct(d) !== 100) && (
                            <button onClick={removeAdjustment} disabled={saving} style={dangerBtn}>Supprimer</button>
                        )}
                        {actionMode === 'note' && hasNotes && (
                            <button onClick={deleteNotes} disabled={saving} style={dangerBtn}>Supprimer</button>
                        )}
                        <button onClick={() => { setActionMode(null); setError(null); setSuccessMsg(null); onCancel(); }}
                                style={{
                                    padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e0',
                                    cursor: 'pointer', backgroundColor: '#fff', fontSize: '0.85rem',
                                }}>
                            Annuler
                        </button>
                    </div>
                </div>
            )}
            {confirmCancel && dialog && (
                <div role="dialog" aria-modal="true" aria-labelledby="confirm-cancel-title"
                     onClick={() => setConfirmCancel(null)}
                     style={{
                         position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.6)',
                         display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
                     }}>
                    <div onClick={(e) => e.stopPropagation()}
                         style={{
                             backgroundColor: '#fff', color: '#1e293b', borderRadius: '12px', padding: '1.25rem',
                             width: '100%', maxWidth: '440px', maxHeight: '85vh', overflowY: 'auto',
                             boxShadow: '0 20px 40px rgba(0,0,0,0.4)', border: `2px solid ${dialog.cancellable.length > 0 ? '#dc2626' : '#94a3b8'}`,
                         }}>
                        <h3 id="confirm-cancel-title" style={{margin: '0 0 0.75rem', color: dialog.cancellable.length > 0 ? '#b91c1c' : '#334155', fontSize: '1.1rem'}}>
                            {dialog.cancellable.length > 0
                                ? `⚠ Annuler ${dialog.cancellable.length > 1 ? `${dialog.cancellable.length} réservations` : 'la réservation'} ?`
                                : 'Réservation non modifiable ici'}
                        </h3>

                        {dialog.cancellable.length > 0 && (
                            <>
                                <p style={{margin: '0 0 0.5rem', fontSize: '0.9rem'}}>
                                    Pour débloquer ces jours, {dialog.cancellable.length > 1 ? 'ces réservations passeront' : 'cette réservation passera'} au
                                    statut « annulée » dans Beds24 et les dates seront libérées. Le séjour est annulé en entier,
                                    même si seules certaines nuits sont sélectionnées.
                                </p>
                                <ul style={{margin: '0 0 0.75rem', paddingLeft: '1.1rem', fontSize: '0.9rem'}}>
                                    {dialog.cancellable.map(({t, b}) => (
                                        <li key={`${t.key}-${b.id}`} style={{marginBottom: '6px'}}>
                                            <strong>{t.label}</strong> — du {b.arrival} au {b.departure}
                                            {b.guest ? ` — ${b.guest}` : ''}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}

                        {dialog.locked.length > 0 && (
                            <div style={{
                                margin: '0 0 0.75rem', padding: '8px 10px', borderRadius: '8px', fontSize: '0.85rem',
                                backgroundColor: '#fef3c7', border: '1px solid #f59e0b', color: '#78350f',
                            }}>
                                <div style={{marginBottom: '4px'}}>
                                    <strong>{dialog.locked.length > 1 ? 'Ces réservations ne peuvent' : 'Cette réservation ne peut'} pas être annulée{dialog.locked.length > 1 ? 's' : ''} ici</strong> :
                                    seules celles créées par l'app le peuvent. Annule-la depuis sa plateforme d'origine (Airbnb, Booking…) ou dans Beds24.
                                </div>
                                <ul style={{margin: 0, paddingLeft: '1.1rem'}}>
                                    {dialog.locked.map(({t, b}) => (
                                        <li key={`${t.key}-${b.id}`}>
                                            {t.label} — du {b.arrival} au {b.departure}
                                            {b.guest ? ` — ${b.guest}` : ''}
                                            {` (origine : ${b.referer || b.channel || 'inconnue'})`}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div style={{display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap'}}>
                            <button onClick={() => setConfirmCancel(null)}
                                    style={{padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e0', background: '#fff', cursor: 'pointer', color: '#1e293b'}}>
                                Retour
                            </button>
                            {dialog.cancellable.length > 0 ? (
                                <button onClick={confirmUnblock}
                                        style={{padding: '8px 14px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 'bold', cursor: 'pointer'}}>
                                    Annuler {dialog.cancellable.length > 1 ? 'les réservations' : 'la réservation'}
                                </button>
                            ) : dialog.freeCount > 0 && (
                                <button onClick={confirmUnblock}
                                        style={{padding: '8px 14px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 'bold', cursor: 'pointer'}}>
                                    Débloquer les autres jours ({dialog.freeCount})
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
