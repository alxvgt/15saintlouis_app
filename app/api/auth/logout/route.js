import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
    console.log("🚀 Logout: Destruction de la session");

    const response = NextResponse.json({ success: true });

    // On vide le cookie
    response.cookies.set('auth_session', '', {
        httpOnly: true,
        path: '/',
        expires: new Date(0),
    });

    return response;
}