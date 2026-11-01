'use client';
import {useEffect, useState} from 'react';

import { priceForDate } from '@/lib/fixedPrices';

function expandCalendarRanges(ranges) {
    const days = [];
    for (const range of ranges) {
        const [fy, fm, fd] = range.from.split('-').map(Number);
        const [ty, tm, td] = range.to.split('-').map(Number);
        const current = new Date(fy, fm - 1, fd);
        const end = new Date(ty, tm - 1, td);
        while (current <= end) {
            days.push({
                date: [
                    current.getFullYear(),
                    String(current.getMonth() + 1).padStart(2, '0'),
                    String(current.getDate()).padStart(2, '0')
                ].join('-'),
                numAvail: range.numAvail ?? null,
                minStay: range.minStay ?? null,
                maxStay: range.maxStay ?? null,
                override: range.override ?? null,
                price: null,
                multiplier: range.multiplier ?? null,
            });
            current.setDate(current.getDate() + 1);
        }
    }
    return days;
}

function getDayStatus(day) {
    if (day.override === 'blackout') return 'blocked';
    if (day.bookingStatus === 'black') return 'blocked';
    if (day.numAvail === 0 && !day.bookingStatus) return 'blocked'; // inventory = 0 sans réservation connue
    if (day.bookingStatus === 'confirmed' || day.bookingStatus === 'new' || day.bookingStatus === 'request') return 'booked';
    return 'available';
}

const STATUS_COLORS = {
    available: {bg: '#4ade80', text: '#043528'},
    booked: {bg: '#ef4444', text: '#ffffff'},
    blocked: {bg: '#374151', text: '#ffffff'},
};

// Beds24 renvoie le multiplicateur en coefficient (1 = prix normal, 1.06 = +6 %) ;
// l'app l'affiche et le saisit en pourcentage (100 = prix normal, 106 = +6 %).
function adjustmentPct(day) {
    const m = Number(day.multiplier);
    return Number.isFinite(m) && m > 0 ? Math.round(m * 100) : 100;
}

// Prix affiché = prix de base Beds24 × ajustement du jour
function effectivePrice(day) {
    if (day.price == null) return null;
    const pct = adjustmentPct(day);
    return pct === 100 ? day.price : Math.round(day.price * pct) / 100;
}

// Prix dans les cases du calendrier : arrondi à l'unité, précédé de « ~ » quand il y a eu arrondi
function formatCellPrice(p) {
    if (p === null || p === undefined) return '';
    return (Number.isInteger(p) ? '' : '~') + Math.round(p) + '€';
}

function formatPrice(p) {
    if (p === null || p === undefined) return '';
    return (Number.isInteger(p) ? String(p) : p.toFixed(2).replace('.', ',')) + '€';
}

const STATUS_LABELS = {
    available: 'Libre',
    booked: 'Réservé',
    blocked: 'Bloqué',
};

export default function Dashboard() {
    const [properties, setProperties] = useState([]);
    const [selectedProp, setSelectedProp] = useState(null);
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [calendarDays, setCalendarDays] = useState([]);
    const [rawCalendarDebug, setRawCalendarDebug] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

    const [selectedDates, setSelectedDates] = useState([]);
    const [actionMode, setActionMode] = useState(null);
    const [minStayInput, setMinStayInput] = useState(2);
    const [multiplierInput, setMultiplierInput] = useState('');
    const [notesOpen, setNotesOpen] = useState(false); // bloc « * Notes » (accordéon)
    const [noteInput, setNoteInput] = useState('');
    const [notes, setNotes] = useState({}); // { 'YYYY-MM-DD': 'texte' }

    useEffect(() => {
        async function loadProperties() {
            try {
                const res = await fetch('/api/beds24');
                const json = await res.json();
                if (json.success && json.data) {
                    setProperties(json.data);
                } else {
                    setError("Erreur chargement propriétés : " + JSON.stringify(json));
                }
            } catch (err) {
                setError("Erreur réseau : " + err.message);
            } finally {
                setLoading(false);
            }
        }

        loadProperties();
    }, []);

    const handleSelectProp = async (prop) => {
        setLoading(true);
        setSelectedProp(prop);
        setCalendarDays([]);
        setSelectedDates([]);
        setActionMode(null);
        setRawCalendarDebug(null);
        setError(null);
        setSuccessMsg(null);

        try {
            let roomId = prop.roomTypes?.[0]?.id;
            if (!roomId) {
                const resDeep = await fetch(`/api/beds24?propId=${prop.id}`);
                const jsonDeep = await resDeep.json();
                roomId = jsonDeep.data?.[0]?.roomTypes?.[0]?.id;
            }
            if (!roomId) {
                setError(`Aucun roomId trouvé pour "${prop.name}".`);
                setLoading(false);
                return;
            }
            setSelectedRoomId(roomId);
            await Promise.all([fetchCalendar(prop.id, roomId), fetchNotes(roomId)]);
        } catch (err) {
            setError("Erreur : " + err.message);
            setLoading(false);
        }
    };

    const fetchNotes = async (rId) => {
        try {
            const res = await fetch(`/api/notes?roomId=${rId}`);
            const json = await res.json();
            setNotes(json.success ? json.notes : {});
        } catch (err) {
            console.error('Erreur chargement notes', err);
            setNotes({});
        }
    };

    const fetchCalendar = async (pId, rId) => {
        try {
            const [calRes, bookRes, fixedRes] = await Promise.all([
                fetch(`/api/beds24?propId=${pId}&roomId=${rId}`),
                fetch(`/api/beds24?propId=${pId}&roomId=${rId}&type=bookings`),
                fetch(`/api/beds24?propId=${pId}&roomId=${rId}&type=fixedPrices`)
            ]);
            const calJson = await calRes.json();
            const bookJson = await bookRes.json();
            const fixedJson = await fixedRes.json().catch(() => null);
            const fixedRules = fixedJson?.success && Array.isArray(fixedJson.data) ? fixedJson.data : [];

            console.log("📅 [DEBUG] Calendrier:", calJson);
            console.log("📅 [DEBUG] Bookings:", bookJson);
            setRawCalendarDebug({calendar: calJson, bookings: bookJson, fixedPrices: fixedJson});

            const ranges = calJson.data?.[0]?.calendar;
            if (!ranges?.length) {
                setError("Calendrier vide.");
                return;
            }

            // Construire un map date -> statut booking
            const bookingMap = {}; // { '2026-04-10': 'confirmed' | 'black' | ... }
            for (const booking of (bookJson.data ?? [])) {
                const [ay, am, ad] = booking.arrival.split('-').map(Number);
                const [dy, dm, dd] = booking.departure.split('-').map(Number);
                const cur = new Date(ay, am - 1, ad);
                const dep = new Date(dy, dm - 1, dd);
                while (cur < dep) {
                    const key = [cur.getFullYear(), String(cur.getMonth() + 1).padStart(2, '0'), String(cur.getDate()).padStart(2, '0')].join('-');
                    bookingMap[key] = booking.status;
                    cur.setDate(cur.getDate() + 1);
                }
            }

            const expanded = expandCalendarRanges(ranges);
            // Enrichir chaque jour avec le statut booking
            const enriched = expanded.map(day => ({
                ...day,
                bookingStatus: bookingMap[day.date] ?? null,
                price: priceForDate(fixedRules, day.date)
            }));

            setCalendarDays(enriched);
        } catch (err) {
            setError("Erreur API : " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleDate = (date) => {
        setSelectedDates(prev =>
            prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
        );
    };

    // Ouvre le mode prix / note en pré-remplissant avec la valeur existante si elle est commune aux jours sélectionnés
    const chooseMode = (mode) => {
        const days = calendarDays.filter(d => selectedDates.includes(d.date));
        if (mode === 'setMultiplier') {
            const ms = new Set(days.map(d => adjustmentPct(d)));
            setMultiplierInput(ms.size === 1 ? String([...ms][0]) : '');
        } else if (mode === 'note') {
            const texts = new Set(selectedDates.map(d => notes[d] ?? ''));
            setNoteInput(texts.size === 1 ? [...texts][0] : '');
        }
        setActionMode(mode);
    };

    // Résultat de l'ajustement saisi, affiché à côté du champ (une fourchette si la sélection mélange plusieurs prix de base)
    const adjustmentResult = (() => {
        if (actionMode !== 'setMultiplier') return null;
        const m = Number(String(multiplierInput).replace(',', '.').replace('%', '').trim());
        if (multiplierInput === '' || !Number.isInteger(m) || m < 25 || m > 250) return null;
        const bases = calendarDays.filter(d => selectedDates.includes(d.date) && d.price != null).map(d => d.price);
        if (bases.length === 0) return null;
        const lo = Math.round(Math.min(...bases) * m) / 100;
        const hi = Math.round(Math.max(...bases) * m) / 100;
        return lo === hi ? formatPrice(lo) : `${formatPrice(lo)} – ${formatPrice(hi)}`;
    })();

    const btnStyle = (active, color, activeText = '#fff') => ({
        padding: '6px 12px',
        borderRadius: '6px',
        border: 'none',
        cursor: selectedDates.length === 0 ? 'not-allowed' : 'pointer',
        backgroundColor: active ? color : '#e2e8f0',
        color: active ? activeText : '#1a202c',
        fontSize: '0.85rem',
        opacity: selectedDates.length === 0 ? 0.5 : 1
    });

    // Enregistre la note sur les jours sélectionnés ; un texte vide supprime la note
    const saveNote = async (text) => {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: String(selectedRoomId), dates: selectedDates, text }),
        });
        const json = await res.json();
        if (json.success) {
            setSuccessMsg(text.trim()
                ? `✓ Note enregistrée sur ${selectedDates.length} jour(s)`
                : `✓ Note supprimée sur ${selectedDates.length} jour(s)`);
            setSelectedDates([]);
            setActionMode(null);
            await fetchNotes(selectedRoomId);
        } else {
            setError("Erreur note : " + (json.error || 'Réponse invalide'));
        }
    };

    // Suppression directe de la note des jours sélectionnés (sans passer par « vider le champ + appliquer »)
    const deleteNotes = async () => {
        if (selectedDates.length === 0) return;
        setSaving(true);
        setError(null);
        try {
            await saveNote('');
        } catch (err) {
            setError("Erreur réseau : " + err.message);
        } finally {
            setSaving(false);
        }
    };

    // Réinitialise une valeur du calendrier sur les jours sélectionnés (ajustement de prix ou séjour minimum)
    const resetValue = async (extra, okMsg) => {
        if (selectedDates.length === 0) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/beds24', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ propId: selectedProp.id, roomId: selectedRoomId, dates: selectedDates, ...extra }),
            });
            const json = await res.json();
            if (json.success) {
                if (json.warnings?.length) {
                    setError("Beds24 a répondu avec des avertissements : " + JSON.stringify(json.warnings));
                }
                setSuccessMsg(`✓ ${okMsg} sur ${selectedDates.length} jour(s)`);
                setSelectedDates([]);
                setActionMode(null);
                await fetchCalendar(selectedProp.id, selectedRoomId);
            } else {
                setError("Erreur API : " + (json.error || json.message || 'Réponse invalide') + (json.detail ? ' — ' + JSON.stringify(json.detail) : ''));
            }
        } catch (err) {
            setError("Erreur réseau : " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const removeAdjustment = () => resetValue({ multiplier: null }, 'Ajustement supprimé');
    const removeMinStay = () => resetValue({ minStay: 1 }, 'Séjour minimum remis à 1');

    const applyAction = async () => {
        if (selectedDates.length === 0 || !actionMode) return;
        const sorted = [...selectedDates].sort();
        const fromDate = sorted[0];
        const toDate = sorted[sorted.length - 1];

        setSaving(true);
        setError(null);

        try {
            if (actionMode === 'note') {
                await saveNote(noteInput);
                return;
            }

            let payload = {};
            if (actionMode === 'block') {
                payload = { dates: selectedDates, override: 'blackout' };
            } else if (actionMode === 'unblock') {
                payload = { dates: selectedDates, override: 'none' };
            } else if (actionMode === 'noCheckIn') {
                payload = { dates: selectedDates, override: 'noCheckIn' };
            } else if (actionMode === 'setMinStay') {
                payload = { dates: selectedDates, minStay: minStayInput };
            } else if (actionMode === 'setMultiplier') {
                const m = Number(String(multiplierInput).replace(',', '.').replace('%', '').trim());
                if (multiplierInput === '' || !Number.isInteger(m) || m < 25 || m > 250) {
                    setError("Ajustement invalide : entier entre 25 et 250 (100 = prix normal, 106 = +6 %)");
                    return;
                }
                payload = { dates: selectedDates, multiplier: m === 100 ? null : m }; // 100 % = pas d'ajustement : on supprime la valeur
            }


            const res = await fetch('/api/beds24', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propId: selectedProp.id,
                    roomId: selectedRoomId,
                    ...payload,
                }),
            });

            const json = await res.json();
            if (json.success) {
                if (json.warnings?.length) {
                    setError("Beds24 a répondu avec des avertissements : " + JSON.stringify(json.warnings));
                }
                setSuccessMsg(`✓ ${selectedDates.length} jour(s) modifié(s)`);
                setSelectedDates([]);
                setActionMode(null);
                await fetchCalendar(selectedProp.id, selectedRoomId);
            } else {
                setError("Erreur API : " + (json.error || json.message || 'Réponse invalide') + (json.detail ? ' — ' + JSON.stringify(json.detail) : ''));
            }
        } catch (err) {
            setError("Erreur réseau : " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleGoBack = () => {
        setSelectedProp(null);
        setCalendarDays([]);
        setSelectedDates([]);
        setActionMode(null);
        setRawCalendarDebug(null);
        setNotes({});
        setError(null);
        setSuccessMsg(null);
    };

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    };

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const upcomingNotes = Object.entries(notes)
        .filter(([date]) => date >= todayStr)
        .sort(([a], [b]) => a.localeCompare(b));

    const daysByMonth = calendarDays.reduce((acc, day) => {
        const [y, m] = day.date.split('-');
        const key = `${y}-${m}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(day);
        return acc;
    }, {});

    const monthLabel = (key) => {
        const [y, m] = key.split('-');
        return new Intl.DateTimeFormat('fr-FR', {month: 'long', year: 'numeric'}).format(new Date(y, m - 1));
    };

    const firstDayOffset = (days) => {
        if (days.length === 0) return 0;
        const [y, m, d] = days[0].date.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        return dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
    };

    return (
        <main style={{padding: '2rem'}}>
            {!selectedProp ? (
                <div>
                    <h1 style={{marginBottom: '2rem', fontSize: '2rem', color: '#ffffff'}}>Le 15 Saint-Louis</h1>

                    {error && <p style={{color: '#ef4444', marginBottom: '1rem'}}>{error}</p>}
                    {successMsg && <p style={{color: '#4ade80', marginBottom: '1rem'}}>{successMsg}</p>}

                    {loading ? (
                        <p>Chargement...</p>
                    ) : properties.length === 0 ? (
                        <p>Aucun gîte trouvé.</p>
                    ) : (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                            gap: '1.5rem'
                        }}>
                            {properties.map((prop, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => handleSelectProp(prop)}
                                    style={{
                                        backgroundColor: '#ffffff',
                                        borderRadius: '12px',
                                        padding: '1.5rem',
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                                        transition: 'transform 0.2s, box-shadow 0.2s',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                        e.currentTarget.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
                                    }}
                                >
                                    <h2 style={{margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: '#1a202c'}}>
                                        {prop.name}
                                    </h2>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelectProp(prop);
                                        }}
                                        style={{
                                            marginTop: '1rem',
                                            padding: '0.5rem 1rem',
                                            backgroundColor: '#4ade80',
                                            color: '#043528',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontWeight: 'bold',
                                            fontSize: '0.9rem',
                                        }}
                                    >
                                        Voir le calendrier
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            ) : (
                <div>
                    <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', alignItems: 'center' }}>
                        <h1 style={{ cursor: 'pointer', fontSize: '1.5rem', margin: 0 }}
                            onClick={handleGoBack}>
                            ‹ Retour
                        </h1>
                        <button onClick={handleLogout} style={{ background: '#f1f5f9', border: '1px solid #cbd5e0', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                            Déconnexion
                        </button>
                    </header>



                    <h2 style={{marginBottom: '1rem', color: '#ffffff'}}>{selectedProp.name}</h2>

                    {loading ? <p>Chargement du calendrier...</p> : (
                        <>
                            {calendarDays.length > 0 && (
                                <div style={{
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 100,
                                    backgroundColor: '#f8fafc',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    padding: '2vw',
                                    marginBottom: '1vh',

                                }}>
                                    <p style={{margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#475569'}}>
                                        {selectedDates.length === 0
                                            ? '👆 Clique sur des jours pour les sélectionner, puis choisis une action'
                                            : `${selectedDates.length} jour(s) sélectionné(s)`}
                                    </p>
                                    {/* Zone 1 : boutons d'actions */}
                                    <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center'}}>
                                        {[
                                            {mode: 'block', label: '⚫ Bloquer', color: '#1a202c'},
                                            {mode: 'unblock', label: '🟢 Débloquer', color: '#4ade80', text: '#043528'},
                                            {mode: 'noCheckIn', label: '❌ No Check-in', color: '#f97316'},
                                            {mode: 'setMinStay', label: '📅 Min Stay', color: '#3b82f6'},
                                            {mode: 'setMultiplier', label: '± Ajustement prix', color: '#b45309'},
                                            {mode: 'note', label: 'ⓘ Note', color: '#7c3aed'},
                                        ].map(a => (
                                            <button key={a.mode} onClick={() => chooseMode(a.mode)}
                                                    disabled={selectedDates.length === 0}
                                                    style={btnStyle(actionMode === a.mode, a.color, a.text)}>
                                                {a.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Zone 2 : saisie / validation (apparaît dès qu'une action est choisie) */}
                                    {actionMode && (
                                        <div style={{
                                            marginTop: '0.75rem',
                                            padding: '0.75rem',
                                            backgroundColor: '#e0e7ff',
                                            border: '1px solid #c7d2fe',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px',
                                            color: '#1e293b',
                                            fontSize: '0.85rem'
                                        }}>
                                            {actionMode === 'block' && <span>Bloquer {selectedDates.length} jour(s)</span>}
                                            {actionMode === 'unblock' && <span>Débloquer {selectedDates.length} jour(s)</span>}
                                            {actionMode === 'noCheckIn' && <span>Interdire l'arrivée sur {selectedDates.length} jour(s)</span>}

                                            {actionMode === 'setMinStay' && (
                                                <label style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                                    Séjour minimum
                                                    <input type="number" min={1} max={365} value={minStayInput}
                                                           onChange={e => setMinStayInput(parseInt(e.target.value))}
                                                           style={{
                                                               width: '60px',
                                                               padding: '5px 8px',
                                                               border: '1px solid #cbd5e0',
                                                               borderRadius: '6px',
                                                               fontSize: '0.85rem'
                                                           }}/>
                                                    nuit(s)
                                                </label>
                                            )}

                                            {actionMode === 'setMultiplier' && (
                                                <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                                                    <span>Ajustement</span>
                                                    <input type="number" min={25} max={250} step={1} value={multiplierInput}
                                                           placeholder="100"
                                                           onChange={e => setMultiplierInput(e.target.value)}
                                                           style={{
                                                               width: '60px',
                                                               padding: '5px 8px',
                                                               border: '1px solid #cbd5e0',
                                                               borderRadius: '6px',
                                                               fontSize: '0.85rem',
                                                               textAlign: 'center'
                                                           }}/>
                                                    <span>%</span>
                                                    {adjustmentResult && <strong>→ {adjustmentResult}</strong>}
                                                </div>
                                            )}

                                            {actionMode === 'note' && (
                                                <textarea value={noteInput} rows={2} maxLength={500}
                                                          placeholder="Note interne"
                                                          onChange={e => setNoteInput(e.target.value)}
                                                          style={{
                                                              width: '100%',
                                                              boxSizing: 'border-box',
                                                              padding: '6px 8px',
                                                              border: '1px solid #cbd5e0',
                                                              borderRadius: '6px',
                                                              fontSize: '0.85rem',
                                                              fontFamily: 'inherit'
                                                          }}/>
                                            )}

                                            <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center'}}>
                                                <button onClick={applyAction} disabled={saving}
                                                        style={{
                                                            padding: '6px 16px',
                                                            borderRadius: '6px',
                                                            border: 'none',
                                                            cursor: saving ? 'not-allowed' : 'pointer',
                                                            backgroundColor: '#3b82f6',
                                                            color: '#fff',
                                                            fontSize: '0.85rem',
                                                            fontWeight: 'bold'
                                                        }}>
                                                    {saving ? '⏳ En cours...' : '✓ Appliquer'}
                                                </button>
                                                {actionMode === 'setMinStay' && selectedDates.some(d => calendarDays.find(c => c.date === d && c.minStay > 1)) && (
                                                    <button onClick={removeMinStay} disabled={saving}
                                                            style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                border: 'none',
                                                                cursor: saving ? 'wait' : 'pointer',
                                                                backgroundColor: '#dc2626',
                                                                color: '#fff',
                                                                fontSize: '0.85rem'
                                                            }}>
                                                        Supprimer
                                                    </button>
                                                )}
                                                {actionMode === 'setMultiplier' && selectedDates.some(d => calendarDays.find(c => c.date === d && adjustmentPct(c) !== 100)) && (
                                                    <button onClick={removeAdjustment} disabled={saving}
                                                            style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                border: 'none',
                                                                cursor: saving ? 'wait' : 'pointer',
                                                                backgroundColor: '#dc2626',
                                                                color: '#fff',
                                                                fontSize: '0.85rem'
                                                            }}>
                                                        Supprimer
                                                    </button>
                                                )}
                                                {actionMode === 'note' && selectedDates.some(d => notes[d]) && (
                                                    <button onClick={deleteNotes} disabled={saving}
                                                            style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                border: 'none',
                                                                cursor: saving ? 'wait' : 'pointer',
                                                                backgroundColor: '#dc2626',
                                                                color: '#fff',
                                                                fontSize: '0.85rem'
                                                            }}>
                                                        Supprimer
                                                    </button>
                                                )}
                                                <button onClick={() => {
                                                    setActionMode(null);
                                                    setSelectedDates([]);
                                                }}
                                                        style={{
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            border: '1px solid #cbd5e0',
                                                            cursor: 'pointer',
                                                            backgroundColor: '#fff',
                                                            fontSize: '0.85rem'
                                                        }}>
                                                    Annuler
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {upcomingNotes.length > 0 && (
                                <div style={{
                                    marginBottom: '1.5rem',
                                    backgroundColor: '#f8fafc',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    padding: '0.75rem 1rem',
                                    color: '#1e293b',
                                    fontSize: '0.85rem'
                                }}>
                                    <button
                                        onClick={() => setNotesOpen(o => !o)}
                                        aria-expanded={notesOpen}
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
                                        <strong>ⓘ Notes ({upcomingNotes.length})</strong>
                                        <span aria-hidden="true">{notesOpen ? '▲' : '▼'}</span>
                                    </button>
                                    {notesOpen && (
                                        <ul style={{margin: '0.5rem 0 0 0', paddingLeft: '1.2rem'}}>
                                            {upcomingNotes.map(([date, text]) => {
                                                const [y, m, d] = date.split('-').map(Number);
                                                const label = new Intl.DateTimeFormat('fr-FR', {weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(y, m - 1, d));
                                                return <li key={date} style={{marginBottom: '4px'}}><strong>{label}</strong> — {text}</li>;
                                            })}
                                        </ul>
                                    )}
                                </div>
                            )}

                            {Object.entries(daysByMonth).map(([monthKey, days]) => (
                                <div key={monthKey} style={{marginBottom: '2rem'}}>
                                    <h3 style={{
                                        textTransform: 'capitalize',
                                        marginBottom: '0.75rem',
                                        fontSize: '1rem',
                                        color: '#ffffff'
                                    }}>
                                        {monthLabel(monthKey)}
                                    </h3>

                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(7, 1fr)',
                                        gap: '2px',
                                        marginBottom: '4px'
                                    }}>
                                        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
                                            <div key={i} style={{
                                                textAlign: 'center',
                                                fontSize: '0.65rem',
                                                color: '#94a3b8',
                                                fontWeight: 'bold'
                                            }}>{d}</div>
                                        ))}
                                    </div>

                                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px'}}>
                                        {/* ✅ FIX : offset basé sur le 1er jour réel du mois dans les données */}
                                        {Array.from({length: firstDayOffset(days)}).map((_, i) => (
                                            <div key={`empty-${i}`}/>
                                        ))}

                                        {days.map((day) => {
                                            const status = getDayStatus(day);
                                            const colors = STATUS_COLORS[status];
                                            const isSelected = selectedDates.includes(day.date);
                                            const [y, m, d] = day.date.split('-').map(Number);
                                            const dateObj = new Date(y, m - 1, d);

                                            return (
                                                <div
                                                    key={day.date}
                                                    onClick={() => toggleDate(day.date)}
                                                    title={`${day.date} — ${STATUS_LABELS[status]}${day.minStay ? ` — min: ${day.minStay}j` : ''}${day.override ? ` — override: ${day.override}` : ''}${day.price != null ? ` — ${formatPrice(effectivePrice(day))}${adjustmentPct(day) !== 100 ? ` (prix de base ${formatPrice(day.price)}, ajustement ${adjustmentPct(day)}%)` : ''}` : ''}${notes[day.date] ? ` — * ${notes[day.date]}` : ''}`}
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
                                                        userSelect: 'none',
                                                        position: 'relative',
                                                    }}
                                                >
                                                    <span style={{
                                                        fontSize: '5vw',
                                                        fontWeight: 'bold',
                                                        marginTop: '27%'
                                                    }}>{dateObj.getDate()}</span>
                                                    {notes[day.date] && (
                                                        <span style={{
                                                            position: 'absolute',
                                                            top: '0.3vh',
                                                            right: '0.2vw',
                                                            fontSize: '2.5vw',
                                                            fontWeight: 'bold',
                                                            lineHeight: 1
                                                        }}>ⓘ</span>
                                                    )}
                                                    {day.price != null && (
                                                        <span style={{
                                                            fontSize: '2vw',
                                                            opacity: 0.9,
                                                            position: 'absolute',
                                                            top: '0px',
                                                            left: '0px',
                                                            backgroundColor: 'rgb(255 255 255 / 0.3)',
                                                            padding: '1px 3px',
                                                            borderRadius: '3px',
                                                            fontWeight: 'bold',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {formatCellPrice(effectivePrice(day))}{adjustmentPct(day) > 100 ? '↑' : adjustmentPct(day) < 100 ? '↓' : ''}
                                                        </span>
                                                    )}
                                                    <span style={{
                                                        fontSize: '2.25vw',
                                                        opacity: 0.9,
                                                        position: 'absolute',
                                                        bottom: '0px',
                                                        left: '0px',
                                                        backgroundColor: 'rgb(255 255 255 / 0.3)',
                                                        padding: '1px 3px',
                                                        borderRadius: '3px',
                                                        fontWeight: 'bold'
                                                    }}>
                                                    {day.minStay && (
                                                        <span>{day.minStay}n</span>
                                                    )}
                                                        {day.override === 'noCheckIn' && (
                                                            <span style={{fontSize: '1.8vw', marginLeft: '0.3vw'}}>❌</span>
                                                        )}
                                                    </span>

                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {calendarDays.length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    gap: '15px',
                                    fontSize: '0.8rem',
                                    flexWrap: 'wrap'
                                }}>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                        <div style={{
                                            width: '12px',
                                            height: '12px',
                                            backgroundColor: '#4ade80',
                                            borderRadius: '3px'
                                        }}></div>
                                        Libre
                                    </div>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                        <div style={{
                                            width: '12px',
                                            height: '12px',
                                            backgroundColor: '#ef4444',
                                            borderRadius: '3px'
                                        }}></div>
                                        Réservé
                                    </div>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                        <div style={{
                                            width: '12px',
                                            height: '12px',
                                            backgroundColor: '#1a202c',
                                            borderRadius: '3px'
                                        }}></div>
                                        Bloqué
                                    </div>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                                        <div style={{
                                            width: '12px',
                                            height: '12px',
                                            backgroundColor: '#f59e0b',
                                            borderRadius: '3px'
                                        }}></div>
                                        Sélectionné
                                    </div>
                                </div>
                            )}

                            {rawCalendarDebug && (
                                <details style={{
                                    marginTop: '2rem',
                                    border: '1px dashed #94a3b8',
                                    borderRadius: '8px',
                                    padding: '1rem'
                                }}>
                                    <summary style={{cursor: 'pointer', fontWeight: 'bold', color: '#ffffff'}}>
                                        🔍 Debug — Réponse brute API calendrier
                                    </summary>
                                    <pre style={{
                                        fontSize: '0.65rem',
                                        overflowX: 'auto',
                                        marginTop: '1rem',
                                        whiteSpace: 'pre-wrap',
                                        color: '#1e293b'
                                    }}>
                                        {JSON.stringify(rawCalendarDebug, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </>
                    )}
                </div>
            )}
        </main>
    );
}