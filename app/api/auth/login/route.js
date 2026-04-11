import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

function getConfs(url) {
    const RP_ID = process.env.RP_ID;
    const ORIGIN = url.origin;
    return { RP_ID, ORIGIN };
}

export async function GET(req) {
    try {
        const db = await getDb();
        const { RP_ID } = getConfs(new URL(req.url));

        const rawAuthenticators = await db.all('SELECT * FROM authenticators WHERE userId = ?', ["user_01"]);

        if (!rawAuthenticators || rawAuthenticators.length === 0) {
            return NextResponse.json({ error: "Aucun appareil enregistré" }, { status: 400 });
        }

        const options = await generateAuthenticationOptions({
            rpID: RP_ID,
            allowCredentials: rawAuthenticators.map(auth => ({
                id: isoBase64URL.toBuffer(auth.credentialID),
                type: 'public-key',
            })),
            userVerification: 'discouraged',
        });

        const safeOptions = {
            challenge: options.challenge,
            timeout: options.timeout,
            rpId: options.rpId,
            userVerification: options.userVerification,
            allowCredentials: rawAuthenticators.map(auth => ({
                id: auth.credentialID.replace(/=/g, ''),
                type: 'public-key',
                transports: JSON.parse(auth.transports || '[]')
            }))
        };

        await db.run('UPDATE users SET currentChallenge = ? WHERE id = ?', [options.challenge, "user_01"]);
        return NextResponse.json(safeOptions);
    } catch (error) {
        console.error("❌ LOGIN GET Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { RP_ID, ORIGIN } = getConfs(new URL(req.url));
        const db = await getDb();

        const user = await db.get('SELECT * FROM users WHERE id = ?', ["user_01"]);
        const cleanId = body.id.replace(/=/g, '');
        const authenticator = await db.get('SELECT * FROM authenticators WHERE credentialID = ?', [cleanId]);

        if (!authenticator) {
            return NextResponse.json({ error: "Clé non reconnue" }, { status: 401 });
        }

        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: user.currentChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            authenticator: {
                credentialID: isoBase64URL.toBuffer(authenticator.credentialID),
                credentialPublicKey: Buffer.from(authenticator.credentialPublicKey),
                counter: authenticator.counter,
            },
            requireUserVerification: false,
        });

        if (verification.verified) {
            await db.run('UPDATE authenticators SET counter = ? WHERE credentialID = ?',
                [verification.authenticationInfo.newCounter, cleanId]);

            // --- CRÉATION DE LA SESSION ---
            const response = NextResponse.json({ success: true });

            // On pose un cookie sécurisé qui expire dans 7 jours
            response.cookies.set('auth_session', 'true', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 60 * 60 * 24 * 7,
                path: '/',
            });

            return response;
        }

        return NextResponse.json({ success: false }, { status: 400 });
    } catch (error) {
        console.error("❌ LOGIN POST Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}