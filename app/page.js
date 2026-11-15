'use client';
import {useEffect, useMemo, useState} from 'react';

import ActionPanel from './components/ActionPanel';
import Legend from './components/Legend';
import Loader from './components/Loader';
import MonthGrid from './components/MonthGrid';
import NotesAccordion from './components/NotesAccordion';
import OverviewCalendar from './components/OverviewCalendar';
import {shortName} from '@/lib/calendar';
import {resolveRoom} from '@/lib/roomData';
import {themeFor} from '@/lib/theme';
import {useRoomStore} from '@/lib/useRoomStore';

export default function Dashboard() {
    const {store, load} = useRoomStore();
    const [properties, setProperties] = useState([]);
    const [rooms, setRooms] = useState([]); // un logement par propriété : { key, name, propId, roomId, basePriceId, hasPriceRules }
    const [selectedRoom, setSelectedRoom] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [selectedDates, setSelectedDates] = useState([]);

    useEffect(() => {
        async function loadProperties() {
            try {
                const res = await fetch('/api/beds24');
                const json = await res.json();
                if (json.success && json.data) {
                    setProperties(json.data);
                    const resolved = (await Promise.all(json.data.map(async (prop) => {
                        const room = await resolveRoom(prop);
                        return room ? {key: `${prop.id}-${room.roomId}`, name: prop.name, propId: prop.id, ...room} : null;
                    }))).filter(Boolean);
                    setRooms(resolved);
                } else {
                    setError(json.error ? json.error : "Erreur chargement propriétés : " + JSON.stringify(json));
                }
            } catch (err) {
                setError("Erreur réseau : " + err.message);
            } finally {
                setLoading(false);
            }
        }

        loadProperties();
    }, []);

    const handleSelectProp = (prop) => {
        const room = rooms.find(r => r.propId === prop.id);
        if (!room) {
            setError(`Aucun roomId trouvé pour "${prop.name}".`);
            return;
        }
        setError(null);
        setSelectedDates([]);
        setSelectedRoom(room);
        load(room); // ne rappelle Beds24 que si les données du magasin ne sont plus fraîches
    };

    const toggleDate = (date) => {
        setSelectedDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]);
    };

    const handleGoBack = () => {
        setSelectedRoom(null);
        setSelectedDates([]);
        setError(null);
    };

    const handleLogout = async () => {
        await fetch('/api/auth/logout', {method: 'POST'});
        window.location.href = '/login';
    };

    const entry = selectedRoom ? store[selectedRoom.key] : null;
    const calendarDays = entry?.days ?? [];
    const notes = entry?.notes ?? {};
    const theme = themeFor(selectedRoom ?? {});

    const targets = useMemo(() => selectedRoom ? [{
        key: selectedRoom.key,
        label: shortName(selectedRoom.name),
        propId: selectedRoom.propId,
        roomId: selectedRoom.roomId,
        dates: selectedDates,
        days: calendarDays,
        notes,
    }] : [], [selectedRoom, selectedDates, calendarDays, notes]);

    // ───────────── Accueil ─────────────
    if (!selectedRoom) {
        return (
            <div>
                <div style={{padding: '0.5rem 1rem 0'}}>
                    <h1 style={{margin: '0 0 0.75rem', fontSize: 'clamp(1.6rem, 6vw, 2.25rem)', lineHeight: 1.15, color: '#ffffff'}}>Le 15 Saint-Louis</h1>

                    {error && <p style={{color: '#fca5a5', marginBottom: '1rem'}}>{error}</p>}

                    {loading ? (
                        <Loader/>
                    ) : properties.length === 0 ? (
                        <p>Aucun gîte trouvé.</p>
                    ) : (
                        <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap'}}>
                            {properties.map((prop) => {
                                const t = themeFor(prop);
                                return (
                                    <button
                                        key={prop.id}
                                        onClick={() => handleSelectProp(prop)}
                                        style={{
                                            flex: '1 1 150px',
                                            height: 'clamp(52px, 8vh, 72px)', // proportionnel à la hauteur de l'écran
                                            backgroundColor: t.button,
                                            color: t.buttonText,
                                            border: 'none',
                                            borderRadius: '12px',
                                            cursor: 'pointer',
                                            fontSize: '1.1rem',
                                            fontWeight: 'bold',
                                            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.15)',
                                            transition: 'transform 0.2s, box-shadow 0.2s',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-3px)';
                                            e.currentTarget.style.boxShadow = '0 10px 20px rgba(0, 0, 0, 0.2)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.15)';
                                        }}
                                    >
                                        {shortName(prop.name)}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Vue d'ensemble en pleine largeur : marge très légère */}
                {!loading && rooms.length > 0 && (
                    <div style={{padding: '0 4px 2rem'}}>
                        <OverviewCalendar rooms={rooms} store={store} load={load}/>
                    </div>
                )}
            </div>
        );
    }

    // ───────────── Détail d'un logement ─────────────
    return (
        <main style={{padding: '2rem'}}>
            <header style={{display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', alignItems: 'center'}}>
                <h1 style={{cursor: 'pointer', fontSize: '1.5rem', margin: 0}} onClick={handleGoBack}>
                    ‹ Retour
                </h1>
                <button onClick={handleLogout}
                        style={{background: '#f1f5f9', border: '1px solid #cbd5e0', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', color: '#1a202c'}}>
                    Déconnexion
                </button>
            </header>

            <h2 style={{
                marginBottom: '1rem', padding: '10px 14px', borderRadius: '10px', fontSize: '1.15rem',
                backgroundColor: theme.button, color: theme.buttonText, borderLeft: `8px solid ${theme.accent}`,
            }}>
                {selectedRoom.name}
            </h2>

            {(error || entry?.error) && (
                <p style={{color: '#fca5a5', marginBottom: '1rem'}}>
                    {error || entry.error}{' '}
                    <button onClick={() => load(selectedRoom, {force: true})}
                            style={{marginLeft: 8, padding: '2px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: 'transparent', color: '#fca5a5', cursor: 'pointer'}}>
                        Réessayer
                    </button>
                </p>
            )}

            {!entry ? <Loader color={theme.accent}/> : (
                <>
                    {calendarDays.length > 0 && (
                        <ActionPanel
                            targets={targets}
                            accent={theme.accent}
                            onCancel={() => setSelectedDates([])}
                            onApplied={async (keys, {parts}) => {
                                setSelectedDates([]);
                                await load(selectedRoom, {force: true, parts});
                            }}
                        />
                    )}

                    <NotesAccordion items={Object.entries(notes).map(([date, text]) => ({date, text}))}/>

                    <MonthGrid days={calendarDays} selectedDates={selectedDates} onToggle={toggleDate} notes={notes}
                               onRange={(dates, mode) => setSelectedDates(prev => {
                                   const s = new Set(prev);
                                   dates.forEach(d => (mode === 'add' ? s.add(d) : s.delete(d)));
                                   return [...s];
                               })}/>

                    {calendarDays.length > 0 && <Legend/>}

                    {entry.debug && (
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
                                color: '#e2e8f0'
                            }}>
                                {JSON.stringify(entry.debug, null, 2)}
                            </pre>
                        </details>
                    )}
                </>
            )}
        </main>
    );
}
