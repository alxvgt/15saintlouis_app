// lib/beds24.js
import { NextResponse } from 'next/server';

const BEDS24_API_URL = 'https://api.beds24.com/v2';

// État partagé à l'échelle du process (globalThis : survit au découpage des routes en bundles séparés)
const g = globalThis;
g.__beds24 ||= { token: null, expiresAt: 0, pending: null, cache: new Map() };
const state = g.__beds24;

export class Beds24Error extends Error {
    constructor(message, { status, resetsIn } = {}) {
        super(message);
        this.status = status;
        this.resetsIn = resetsIn;
    }
}

async function requestToken() {
    const refreshToken = process.env.BEDS24_REFRESH_TOKEN;

    if (!refreshToken) {
        throw new Error("BEDS24_REFRESH_TOKEN manquant dans le .env");
    }

    // On appelle /authentication/token avec le Refresh Token dans le header
    const response = await fetch(`${BEDS24_API_URL}/authentication/token`, {
        method: 'GET',
        headers: {
            'accept': 'application/json',
            'refreshToken': refreshToken
        },
        cache: 'no-store'
    });

    const data = await response.json();

    if (!response.ok || !data.token) {
        console.error("Détails Erreur Auth (Refresh -> Access):", data);
        throw new Error('Impossible de générer un Access Token valide');
    }

    // Le token est réutilisé jusqu'à ~5 min avant son expiration (au lieu d'un échange à chaque appel)
    const ttl = Math.max(60, (Number(data.expiresIn) || 3600) - 300);
    state.token = data.token;
    state.expiresAt = Date.now() + ttl * 1000;
    return data.token;
}

export async function getAccessToken() {
    if (state.token && Date.now() < state.expiresAt) return state.token;
    if (!state.pending) state.pending = requestToken().finally(() => { state.pending = null; });
    return state.pending;
}

export async function beds24Fetch(endpoint, options = {}, retried = false) {
    const accessToken = await getAccessToken();

    const res = await fetch(`${BEDS24_API_URL}${endpoint}`, {
        ...options,
        cache: 'no-store',
        headers: {
            ...options.headers,
            'accept': 'application/json',
            'token': accessToken,
            'Content-Type': 'application/json'
        }
    });

    // Suivi des crédits API (limite Beds24 : 100 crédits / 5 min par défaut)
    const cost = res.headers.get('x-request-cost');
    const remaining = res.headers.get('x-five-min-limit-remaining');
    const resetsIn = res.headers.get('x-five-min-limit-resets-in');
    console.log(`💳 [BEDS24] ${options.method ?? 'GET'} ${endpoint.split('?')[0]} → HTTP ${res.status} | coût=${cost ?? '?'} | restants=${remaining ?? '?'} | reset dans ${resetsIn ?? '?'}s`);

    if (res.status === 401 && !retried) {
        state.token = null; // token refusé : on en redemande un une seule fois
        return beds24Fetch(endpoint, options, true);
    }

    const json = await res.json();
    if (res.status === 429 || json?.code === 429) {
        throw new Beds24Error('Credit limit exceeded', { status: 429, resetsIn: resetsIn ? Number(resetsIn) : undefined });
    }
    return json;
}

// Cache mémoire à durée limitée, réservé aux données qui bougent peu (liste des propriétés, fixed prices).
// Une réponse en erreur n'est jamais conservée.
export async function cached(key, ttlMs, fn) {
    const hit = state.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = fn().then(v => {
        if (v?.success === false) state.cache.delete(key);
        return v;
    }, e => {
        state.cache.delete(key);
        throw e;
    });
    state.cache.set(key, { expires: Date.now() + ttlMs, value });
    return value;
}

// Beds24 pagine ses réponses (pages.nextPageExists) : on suit les pages et on fusionne les données.
// Les entrées de calendrier d'une même chambre (roomId + calendar) sont fusionnées, les autres concaténées.
function mergeData(existing, incoming) {
    const out = [...existing];
    for (const item of incoming) {
        const same = item?.roomId != null && Array.isArray(item.calendar)
            ? out.find(e => e?.roomId === item.roomId && Array.isArray(e.calendar))
            : null;
        if (same) same.calendar = [...same.calendar, ...item.calendar];
        else out.push(item);
    }
    return out;
}

export async function beds24FetchAll(endpoint, options = {}) {
    let merged = null;
    for (let page = 1; page <= 20; page++) {
        const url = page === 1 ? endpoint : `${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}`;
        const res = await beds24Fetch(url, options);
        if (!merged) merged = res;
        else if (Array.isArray(res?.data)) merged.data = mergeData(merged.data ?? [], res.data);
        if (!res?.pages?.nextPageExists) break;
    }
    return merged;
}

// Réponse d'erreur commune aux routes : 429 explicite (avec délai avant reset), sinon 500
export function errorResponse(error, logLabel = 'Beds24') {
    if (error?.status === 429) {
        const wait = error.resetsIn != null ? ` Réessaie dans ${error.resetsIn} s.` : ' Réessaie dans quelques minutes.';
        console.error(`⏳ ${logLabel} : limite de crédits atteinte`);
        return NextResponse.json({
            success: false,
            code: 429,
            error: `Limite d'appels Beds24 atteinte.${wait}`,
            resetsIn: error.resetsIn ?? null,
        }, { status: 429 });
    }
    console.error(`❌ ${logLabel} :`, error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
}
