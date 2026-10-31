import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db = null;

export async function getDb() {
    if (!db) {
        db = await open({
            filename: './data/auth.db',
            driver: sqlite3.Database
        });

        // Création des tables si elles n'existent pas
        await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        currentChallenge TEXT
      );
        CREATE TABLE IF NOT EXISTS authenticators (
            credentialID TEXT PRIMARY KEY, -- On s'assure que c'est bien TEXT
            credentialPublicKey BLOB,
            counter INTEGER,
            userId TEXT,
            transports TEXT,
            FOREIGN KEY (userId) REFERENCES users(id)
      );
        CREATE TABLE IF NOT EXISTS day_notes (
            roomId TEXT NOT NULL,
            date TEXT NOT NULL,          -- YYYY-MM-DD
            text TEXT NOT NULL,
            updatedAt TEXT,
            PRIMARY KEY (roomId, date)
      );
    `);
    }
    return db;
}