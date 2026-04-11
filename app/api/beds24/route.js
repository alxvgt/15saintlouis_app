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
            end.setDate(end.getDate() + 90);
            const endDate = end.toISOString().split('T')[0];

            const endpoint = `/bookings?propertyId=${propId}&roomId=${roomId}&arrivalFrom=${startDate}&departureTo=${endDate}&status=confirmed&status=request&status=new&status=black`;
            console.log("📡 [BOOKINGS] Appel endpoint:", endpoint);

            const result = await beds24Fetch(endpoint);
            console.log("📦 [BOOKINGS] Réponse brute:", JSON.stringify(result, null, 2));

            return NextResponse.json(result);
        }

        // CAS : Calendrier — propId + roomId fournis
        if (propId && roomId) {
            const startDate = new Date().toISOString().split('T')[0];
            const end = new Date();
            end.setDate(end.getDate() + 90);
            const endDate = end.toISOString().split('T')[0];

            // On inclut : disponibilité, minStay, maxStay, et override (pour détecter blackout vs réservé)
            const endpoint = `/inventory/rooms/calendar?propertyId=${propId}&roomId=${roomId}&startDate=${startDate}&endDate=${endDate}&includeNumAvail=true&includeMinStay=true&includeMaxStay=true&includeOverride=true`;
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
    const { action } = body;

    try {
        // ACTION : Bloquer des jours (override: blackout + numAvail: 0)
        if (action === 'block') {
            const { roomId, fromDate, toDate } = body;
            console.log(`🚫 [BLOCK] roomId=${roomId} du ${fromDate} au ${toDate}`);

            const payload = [
                {
                    roomId: parseInt(roomId),
                    calendar: [
                        {
                            from: fromDate,
                            to: toDate,
                            override: "blackout",
                            numAvail: 0
                        }
                    ]
                }
            ];

            const result = await beds24Fetch('/inventory/rooms/calendar', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            console.log("📦 [BLOCK] Réponse:", JSON.stringify(result, null, 2));
            return NextResponse.json(result);
        }

        // ACTION : Débloquer des jours (override: none, numAvail revient au max auto)
        if (action === 'unblock') {
            const { roomId, fromDate, toDate } = body;
            console.log(`✅ [UNBLOCK] roomId=${roomId} du ${fromDate} au ${toDate}`);

            const payload = [
                {
                    roomId: parseInt(roomId),
                    calendar: [
                        {
                            from: fromDate,
                            to: toDate,
                            override: "none"
                            // numAvail sera remis au max automatiquement par Beds24
                        }
                    ]
                }
            ];

            const result = await beds24Fetch('/inventory/rooms/calendar', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            console.log("📦 [UNBLOCK] Réponse:", JSON.stringify(result, null, 2));
            return NextResponse.json(result);
        }

        // ACTION : Modifier le minStay
        if (action === 'setMinStay') {
            const { roomId, fromDate, toDate, minStay } = body;
            console.log(`📅 [MINSTAY] roomId=${roomId} du ${fromDate} au ${toDate} → ${minStay}j`);

            const payload = [
                {
                    roomId: parseInt(roomId),
                    calendar: [
                        {
                            from: fromDate,
                            to: toDate,
                            minStay: parseInt(minStay)
                        }
                    ]
                }
            ];

            const result = await beds24Fetch('/inventory/rooms/calendar', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            console.log("📦 [MINSTAY] Réponse:", JSON.stringify(result, null, 2));
            return NextResponse.json(result);
        }

        return NextResponse.json({ success: false, error: 'Action inconnue' }, { status: 400 });

    } catch (error) {
        console.error("❌ Erreur POST Beds24:", error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}