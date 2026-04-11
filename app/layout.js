import "./globals.css";

export const metadata = {
    title: "Beds24 Manager",
    description: "Gestion rapide des gîtes",
};

export default function RootLayout({ children }) {
    return (
        <html lang="fr">
        <body className="bg-green-950 text-slate-50 antialiased">
        {children}
        </body>
        </html>
    );
}