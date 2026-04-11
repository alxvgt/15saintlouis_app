import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

function getConfs(url) {
    const RP_ID = process.env.RP_ID;
    const ORIGIN = url.origin;
    return { RP_ID, ORIGIN };
}

export async function GET(req) {
    if (process.env.ALLOW_REGISTER !== 'true') {
        return NextResponse.json({ error: 'Registration disabled' }, { status: 403 });
    }

    try {
        const db = await getDb();
        const { RP_ID } = getConfs(new URL(req.url));

        const username = "admin1";
        const userId = "user_01";

        const options = await generateRegistrationOptions({
            rpName: 'Le 15 Saint-Louis',
            rpID: RP_ID,
            userID: userId,
            userName: username,
            attestationType: 'none',
            // ASSOUPLISSEMENT ICI :
            // On ne force pas la vérification utilisateur (PIN/Empreinte) pour l'enregistrement
            // et on laisse l'authentificateur choisir la méthode la plus compatible.
            authenticatorSelection: {
                userVerification: 'discouraged',
                residentKey: 'preferred',
            },
        });

        await db.run(
            'INSERT OR REPLACE INTO users (id, username, currentChallenge) VALUES (?, ?, ?)',
            [userId, username, options.challenge]
        );

        return NextResponse.json(options);
    } catch (error) {
        console.error("❌ REGISTER GET Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    if (process.env.ALLOW_REGISTER !== 'true') {
        return NextResponse.json({ error: 'Registration disabled' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { RP_ID, ORIGIN } = getConfs(new URL(req.url));
        const db = await getDb();

        const user = await db.get('SELECT * FROM users WHERE id = ?', ["user_01"]);
        if (!user || !user.currentChallenge) {
            return NextResponse.json({ error: "Challenge introuvable" }, { status: 400 });
        }

        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: user.currentChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            requireUserVerification: false, // Assouplissement
        });

        if (verification.verified) {
            const { registrationInfo } = verification;
            const credentialID = Buffer.from(registrationInfo.credentialID).toString('base64url').replace(/=/g, '');

            console.log("✅ Register Success. ID:", credentialID);

            await db.run(
                'INSERT INTO authenticators (credentialID, credentialPublicKey, counter, userId, transports) VALUES (?, ?, ?, ?, ?)',
                [
                    credentialID,
                    Buffer.from(registrationInfo.credentialPublicKey),
                    registrationInfo.counter,
                    user.id,
                    JSON.stringify(body.response.transports || [])
                ]
            );

            await db.run('UPDATE users SET currentChallenge = NULL WHERE id = ?', [user.id]);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ success: false }, { status: 400 });
    } catch (error) {
        console.error("❌ REGISTER POST Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}