'use client';
// Magasin des données par logement, partagé entre la vue d'ensemble et la vue "par logement" :
// passer de l'une à l'autre ne rappelle pas Beds24 tant que les données ont moins de FRESH_MS.
import {useCallback, useRef, useState} from 'react';
import {ALL_PARTS, buildRoomData, fetchRoomParts} from '@/lib/roomData';

const FRESH_MS = 2 * 60 * 1000;

export function useRoomStore() {
    const [store, setStore] = useState({});
    const mirror = useRef({});
    const inflight = useRef({});

    const commit = (key, entry) => {
        mirror.current = {...mirror.current, [key]: entry};
        setStore(mirror.current);
    };

    // room : { key, propId, roomId, basePriceId, hasPriceRules }
    // parts : ce qu'il faut (re)charger ; force : ignore la fraîcheur des données
    const load = useCallback(async (room, {force = false, parts = ALL_PARTS} = {}) => {
        const key = room.key;
        const cur = mirror.current[key];
        if (!force && cur && !cur.error && Date.now() - cur.loadedAt < FRESH_MS) return cur;
        if (!force && inflight.current[key]) return inflight.current[key];

        const p = (async () => {
            try {
                const partial = await fetchRoomParts(room, parts);
                const raw = {...(cur?.raw ?? {}), ...partial.raw};
                const entry = {
                    raw,
                    ...buildRoomData(raw, room.basePriceId),
                    notes: raw.notes ?? {},
                    debug: {...(cur?.debug ?? {}), ...partial.debug},
                    loadedAt: Date.now(),
                };
                commit(key, entry);
                return entry;
            } catch (err) {
                // on garde les données déjà affichées ; loadedAt = 0 force une nouvelle tentative au prochain chargement
                const entry = {
                    raw: cur?.raw ?? {}, days: cur?.days ?? [], notes: cur?.notes ?? {}, debug: cur?.debug ?? null,
                    error: err.message, loadedAt: 0,
                };
                commit(key, entry);
                return entry;
            } finally {
                delete inflight.current[key];
            }
        })();
        inflight.current[key] = p;
        return p;
    }, []);

    return {store, load};
}
