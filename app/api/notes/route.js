import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROOM_RE = /^\d+$/;
const MAX_DATES = 400;
const MAX_TEXT = 500;

// GET /api/notes?roomId=123  ->  { success, notes: { '2026-11-03': 'texte', ... } }
export async function GET(req) {
    const roomId = new URL(req.url).searchParams.get('roomId');
    if (!roomId || !ROOM_RE.test(roomId)) {
        return NextResponse.json({ success: false, error: 'roomId invalide' }, { status: 400 });
    }
    try {
        const db = await getDb();
        const rows = await db.all('SELECT date, text FROM day_notes WHERE roomId = ?', [roomId]);
        const notes = Object.fromEntries(rows.map(r => [r.date, r.text]));
        return NextResponse.json({ success: true, notes });
    } catch (error) {
        console.error('❌ Erreur GET notes:', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

// POST /api/notes  { roomId, dates: ['2026-11-03', ...], text }
// text vide => suppression de la note sur ces dates
export async function POST(req) {
    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'JSON invalide' }, { status: 400 });
    }
    const roomId = String(body.roomId ?? '');
    const { dates } = body;
    const text = String(body.text ?? '').trim();

    if (!ROOM_RE.test(roomId) || !Array.isArray(dates) || dates.length === 0
        || dates.length > MAX_DATES || !dates.every(d => typeof d === 'string' && DATE_RE.test(d))) {
        return NextResponse.json({ success: false, error: 'Paramètres invalides' }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
        return NextResponse.json({ success: false, error: `Note trop longue (max ${MAX_TEXT} caractères)` }, { status: 400 });
    }

    try {
        const db = await getDb();
        await db.exec('BEGIN');
        try {
            for (const date of dates) {
                if (text === '') {
                    await db.run('DELETE FROM day_notes WHERE roomId = ? AND date = ?', [roomId, date]);
                } else {
                    await db.run(
                        `INSERT INTO day_notes (roomId, date, text, updatedAt) VALUES (?, ?, ?, ?)
                         ON CONFLICT(roomId, date) DO UPDATE SET text = excluded.text, updatedAt = excluded.updatedAt`,
                        [roomId, date, text, new Date().toISOString()]
                    );
                }
            }
            await db.exec('COMMIT');
        } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('❌ Erreur POST notes:', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
