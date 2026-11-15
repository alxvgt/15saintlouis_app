import { NextResponse } from 'next/server';
import { beds24Fetch, errorResponse } from '@/lib/beds24';
import { isCancellable } from '@/lib/bookingRules';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d+$/;
const MAX_NAME = 100;

// POST /api/bookings  { roomId, arrival: 'YYYY-MM-DD', departure: 'YYYY-MM-DD', firstName? }
// Crée une réservation "confirmed" (le prénom est optionnel). departure = jour du départ (dernière nuit + 1).
export async function POST(req) {
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'JSON invalide' }, { status: 400 });
    }
    const roomId = String(body.roomId ?? '');
    const { arrival, departure } = body;
    const firstName = String(body.firstName ?? '').trim();

    if (!ID_RE.test(roomId) || !DATE_RE.test(String(arrival)) || !DATE_RE.test(String(departure)) || departure <= arrival) {
        return NextResponse.json({ success: false, error: 'Paramètres invalides' }, { status: 400 });
    }
    if (firstName.length > MAX_NAME) {
        return NextResponse.json({ success: false, error: 'Prénom trop long' }, { status: 400 });
    }

    try {
        const payload = [{
            roomId: parseInt(roomId),
            status: 'confirmed',
            arrival,
            departure,
            ...(firstName ? { firstName } : {}),
        }];
        console.log('📤 [BOOKING] Payload Beds24:', JSON.stringify(payload));

        const result = await beds24Fetch('/bookings', { method: 'POST', body: JSON.stringify(payload) });
        console.log('📥 [BOOKING] Réponse Beds24:', JSON.stringify(result));

        // 401 "Token not valid" = le token n'a pas le droit d'écrire des réservations (scopes fixés à la création du code d'invitation)
        if (!Array.isArray(result) && result?.code === 401) {
            return NextResponse.json({
                success: false,
                error: "Le token Beds24 n'a pas les droits d'écriture sur les réservations (scopes write:bookings et write:bookings-personal). Génère un nouveau code d'invitation avec ces scopes et mets à jour BEDS24_REFRESH_TOKEN.",
            }, { status: 403 });
        }

        const failed = Array.isArray(result) ? result.filter(r => r && r.success === false) : [];
        if (failed.length > 0 || (!Array.isArray(result) && result?.success === false)) {
            return NextResponse.json({
                success: false,
                error: 'Beds24 a refusé la réservation',
                detail: failed.length > 0 ? failed : result,
            }, { status: 502 });
        }
        return NextResponse.json({ success: true, result });
    } catch (error) {
        return errorResponse(error, 'Erreur POST booking');
    }
}

// PATCH /api/bookings  { ids: [123, 456] }
// Annule des réservations (statut « cancelled », réversible) : Beds24 refuse de SUPPRIMER une réservation active.
// Garde-fou côté serveur : seules les réservations créées par l'app (Original Referrer = API / avingtier) sont acceptées.
export async function PATCH(req) {
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'JSON invalide' }, { status: 400 });
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (ids.length === 0 || ids.length > 20 || !ids.every(id => ID_RE.test(id))) {
        return NextResponse.json({ success: false, error: 'Paramètres invalides' }, { status: 400 });
    }

    const scopeError = () => NextResponse.json({
        success: false,
        error: "Le token Beds24 n'a pas le droit de modifier les réservations (scope write:bookings). Génère un nouveau code d'invitation avec ce scope et mets à jour BEDS24_REFRESH_TOKEN.",
    }, { status: 403 });
    const isRefused = (r) => !Array.isArray(r) && (r?.code === 401 || r?.code === 403);

    try {
        // 1. On relit les réservations pour vérifier leur origine
        const found = await beds24Fetch(`/bookings?${ids.map(id => `id=${id}`).join('&')}`);
        if (isRefused(found)) return scopeError();
        const byId = new Map((Array.isArray(found?.data) ? found.data : []).map(b => [String(b.id), b]));
        console.log('🔎 [BOOKING] Origine des réservations à annuler:', ids.map(id => `${id}=${byId.get(id)?.referer ?? '?'}`).join(', '));
        const refused = ids.filter(id => !isCancellable(byId.get(id)));
        if (refused.length > 0) {
            return NextResponse.json({
                success: false,
                error: `Annulation refusée : seules les réservations créées par l'app (origine API ou avingtier) peuvent être annulées ici. Réservation(s) : ${refused.map(id => `${id} (origine : ${byId.get(id)?.referer || 'inconnue'})`).join(', ')}`,
            }, { status: 403 });
        }

        // 2. Annulation = statut « cancelled »
        const payload = ids.map(id => ({ id: parseInt(id), status: 'cancelled' }));
        console.log('📤 [BOOKING] Annulation:', JSON.stringify(payload));
        const result = await beds24Fetch('/bookings', { method: 'POST', body: JSON.stringify(payload) });
        console.log('📥 [BOOKING] Réponse annulation:', JSON.stringify(result));
        if (isRefused(result)) return scopeError();

        // Succès seulement si Beds24 répond une entrée réussie par réservation (un tableau vide n'est PAS un succès)
        const ok = Array.isArray(result) && result.length === ids.length && result.every(r => r?.success !== false);
        if (!ok) {
            return NextResponse.json({ success: false, error: "Beds24 n'a pas confirmé l'annulation", detail: result }, { status: 502 });
        }
        return NextResponse.json({ success: true, result });
    } catch (error) {
        return errorResponse(error, 'Erreur annulation booking');
    }
}
