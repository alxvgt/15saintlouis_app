import { NextResponse } from 'next/server';
import { beds24Fetch, beds24FetchAll, cached, errorResponse } from '@/lib/beds24';
import { findBasePriceId, hasPriceRules } from '@/lib/dailyPrices';

export const dynamic = 'force-dynamic';

// Données qui bougent peu : mises en cache côté serveur pour économiser les crédits Beds24
const PROPERTIES_TTL_MS = 30 * 60 * 1000;
const FIXED_PRICES_TTL_MS = 60 * 60 * 1000;

// Fenêtre affichée : 12 mois à partir d'aujourd'hui
const WINDOW_DAYS = 365;

function windowDates() {
    const startDate = new Date().toISOString().split('T')[0];
    const end = new Date();
    end.setDate(end.getDate() + WINDOW_DAYS);
    return { startDate, endDate: end.toISOString().split('T')[0] };
}

// La liste des propriétés avec règles de prix est très volumineuse : on n'en garde que le nécessaire,
// dont le numéro de la daily price "de base" de chaque chambre (celle qui n'est liée à aucune autre).
function slimProperties(result) {
    if (!result || !Array.isArray(result.data)) return result;
    return {
        ...result,
        data: result.data.map(p => ({
            id: p.id,
            name: p.name,
            roomTypes: (p.roomTypes ?? []).map(r => ({
                id: r.id,
                name: r.name,
                basePriceId: findBasePriceId(r.priceRules),
                hasPriceRules: hasPriceRules(r.priceRules),
            })),
        })),
    };
}

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const propId = searchParams.get('propId');
    const roomId = searchParams.get('roomId');

    try {
        // CAS : Bookings — propId + roomId + type=bookings
        if (propId && roomId && searchParams.get('type') === 'bookings') {
            const { startDate, endDate } = windowDates();

            const endpoint = `/bookings?propertyId=${propId}&roomId=${roomId}&arrivalFrom=${startDate}&departureTo=${endDate}&status=confirmed&status=request&status=new&status=black`;
            console.log("📡 [BOOKINGS] Appel endpoint:", endpoint);

            const result = await beds24FetchAll(endpoint);
            console.log("📦 [BOOKINGS] Réservations reçues:", result?.data?.length ?? 0);

            return NextResponse.json(result);
        }

        // CAS : Fixed prices (tarifs par période) — propId + roomId + type=fixedPrices
        if (propId && roomId && searchParams.get('type') === 'fixedPrices') {
            const endpoint = `/inventory/fixedPrices?propertyId=${propId}&roomId=${roomId}`;
            console.log("📡 [FIXED PRICES] Appel endpoint:", endpoint);
            const result = await cached(`fixed:${roomId}`, FIXED_PRICES_TTL_MS, () => beds24FetchAll(endpoint));
            console.log("📦 [FIXED PRICES] Règles reçues:", result?.data?.length ?? 0);
            return NextResponse.json(result);
        }

        // CAS : Calendrier — propId + roomId fournis
        if (propId && roomId) {
            const { startDate, endDate } = windowDates();

            // On inclut : disponibilité, minStay, override (blackout vs réservé), multiplicateur
            // et, seulement si la chambre a des daily price rules (?prices=1), les prix journaliers price1..price16
            const endpoint = `/inventory/rooms/calendar?propertyId=${propId}&roomId=${roomId}&startDate=${startDate}&endDate=${endDate}&includeNumAvail=true&includeMinStay=true&includeOverride=true&includeMultiplier=true${searchParams.get('prices') === '1' ? '&includePrices=true' : ''}`;
            console.log("📡 [CALENDRIER] Appel endpoint:", endpoint);

            const result = await beds24FetchAll(endpoint);
            console.log("📦 [CALENDRIER] Plages reçues:", result?.data?.[0]?.calendar?.length ?? 0);

            return NextResponse.json(result);
        }

        // CAS : Liste des propriétés (includeAllRooms=true pour avoir roomTypes directement)
        const endpoint = propId
            ? `/properties?id=${propId}&includeAllRooms=true&includePriceRules=true`
            : '/properties?includeAllRooms=true&includePriceRules=true';

        console.log("📡 [PROPRIETES] Appel endpoint:", endpoint);

        const properties = slimProperties(await cached(`properties:${propId ?? 'all'}`, PROPERTIES_TTL_MS, () => beds24FetchAll(endpoint)));
        console.log("📦 [PROPRIETES] Propriétés reçues:", properties?.data?.length ?? 0);

        return NextResponse.json(properties);

    } catch (error) {
        return errorResponse(error, 'Erreur Proxy Beds24');
    }
}

export async function POST(req) {
    const body = await req.json();
    console.log("📥 [POST] Body reçu:", JSON.stringify(body));
    const { propId, roomId, dates, override, minStay, multiplier } = body;

    // Ajustement de prix (multiplicateur du calendrier Beds24) : 25 à 250 (%), 100 = prix normal
    // multiplier: null = suppression de l'ajustement (retour au prix normal)
    if (multiplier !== undefined && multiplier !== null && (!Number.isInteger(Number(multiplier)) || Number(multiplier) < 25 || Number(multiplier) > 250)) {
        return NextResponse.json({ success: false, error: 'Ajustement de prix invalide (entier entre 25 et 250)' }, { status: 400 });
    }

    try {
        const payload = [
            {
                roomId: parseInt(roomId),
                calendar: dates.map(date => ({
                    from: date,
                    to: date,
                    ...(override !== undefined ? { override, ...(override === 'blackout' ? { numAvail: 0 } : {}) } : {}),
                    ...(minStay !== undefined ? { minStay: parseInt(minStay) } : {}),
                    // L'API Beds24 exprime le multiplicateur en coefficient (1 = prix normal, 1.06 = +6 %), pas en pourcentage
                    // Suppression (null) : Beds24 ignore null, "" et 1 ; seul 1.0001 remet l'ajustement à 100 % (affiché 100 % dans Beds24)
                    ...(multiplier !== undefined ? { multiplier: multiplier === null ? 1.0001 : Number(multiplier) / 100 } : {}),
                }))
            }
        ];

        console.log("📤 [POST] Payload Beds24:", JSON.stringify(payload));

        const result = await beds24Fetch('/inventory/rooms/calendar', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        console.log("📥 [POST] Réponse Beds24:", JSON.stringify(result));

        // Beds24 répond un tableau d'éléments { success } : on ne déclare pas "succès" si l'un d'eux échoue
        const failed = Array.isArray(result) ? result.filter(r => r && r.success === false) : [];
        if (failed.length > 0 || (!Array.isArray(result) && result?.success === false)) {
            return NextResponse.json({
                success: false,
                error: 'Beds24 a refusé la modification',
                detail: failed.length > 0 ? failed : result,
            }, { status: 502 });
        }
        const warnings = Array.isArray(result)
            ? result.flatMap(r => [...(r?.warnings ?? []), ...(r?.errors ?? [])])
            : [];
        return NextResponse.json({ success: true, result, warnings });

    } catch (error) {
        return errorResponse(error, 'Erreur POST Beds24');
    }
}