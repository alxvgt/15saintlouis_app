import { NextResponse } from 'next/server';
import { beds24Fetch } from '@/lib/beds24';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const propId = searchParams.get('propId');
    const roomId = searchParams.get('roomId');

    try {
        // CAS : Bookings — propId + roomId + type=bookings
        if (propId && roomId && searchParams.get('type') === 'bookings') {
            const startDate = new Date().toISOString().split('T')[0];
            const end = new Date();
            end.setDate(end.getDate() + 180);
            const endDate = end.toISOString().split('T')[0];

            const endpoint = `/bookings?propertyId=${propId}&roomId=${roomId}&arrivalFrom=${startDate}&departureTo=${endDate}&status=confirmed&status=request&status=new&status=black`;
            console.log("📡 [BOOKINGS] Appel endpoint:", endpoint);

            const result = await beds24Fetch(endpoint);
            console.log("📦 [BOOKINGS] Réponse brute:", JSON.stringify(result, null, 2));

            return NextResponse.json(result);
        }

        // CAS : Fixed prices (tarifs par période) — propId + roomId + type=fixedPrices
        if (propId && roomId && searchParams.get('type') === 'fixedPrices') {
            const endpoint = `/inventory/fixedPrices?propertyId=${propId}&roomId=${roomId}`;
            console.log("📡 [FIXED PRICES] Appel endpoint:", endpoint);
            const result = await beds24Fetch(endpoint);
            console.log("📦 [FIXED PRICES] Réponse brute:", JSON.stringify(result, null, 2));
            return NextResponse.json(result);
        }

        // CAS : Calendrier — propId + roomId fournis
        if (propId && roomId) {
            const startDate = new Date().toISOString().split('T')[0];
            const end = new Date();
            end.setDate(end.getDate() + 180);
            const endDate = end.toISOString().split('T')[0];

            // On inclut : disponibilité, minStay, maxStay, et override (pour détecter blackout vs réservé)
            const endpoint = `/inventory/rooms/calendar?propertyId=${propId}&roomId=${roomId}&startDate=${startDate}&endDate=${endDate}&includeNumAvail=true&includeMinStay=true&includeMaxStay=true&includeOverride=true&includeMultiplier=true`;
            console.log("📡 [CALENDRIER] Appel endpoint:", endpoint);

            const result = await beds24Fetch(endpoint);
            console.log("📦 [CALENDRIER] Réponse brute:", JSON.stringify(result, null, 2));

            return NextResponse.json(result);
        }

        // CAS : Liste des propriétés (includeAllRooms=true pour avoir roomTypes directement)
        const endpoint = propId
            ? `/properties?id=${propId}&includeAllRooms=true`
            : '/properties?includeAllRooms=true';

        console.log("📡 [PROPRIETES] Appel endpoint:", endpoint);

        const properties = await beds24Fetch(endpoint);
        console.log("📦 [PROPRIETES] Réponse brute:", JSON.stringify(properties, null, 2));

        return NextResponse.json(properties);

    } catch (error) {
        console.error("❌ Erreur Proxy Beds24:", error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    const body = await req.json();
    console.log("📥 [POST] Body reçu:", JSON.stringify(body));
    const { propId, roomId, dates, override, minStay, multiplier } = body;

    // Ajustement de prix (multiplicateur du calendrier Beds24) : 25 à 250 (%), 100 = prix normal
    if (multiplier !== undefined && (!Number.isInteger(Number(multiplier)) || Number(multiplier) < 25 || Number(multiplier) > 250)) {
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
                    ...(multiplier !== undefined ? { multiplier: Number(multiplier) / 100 } : {}),
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
        console.error("❌ Erreur POST Beds24:", error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}