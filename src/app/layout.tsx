import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "buildinator",
  description: "Web frontend for Grok Build sessions",
  icons: { icon: "/favicon.svg" },
};

const themeBoot = `(function(){try{var t=localStorage.getItem("buildinator-theme");if(t==="default")t="web";if(t==="tui"||t==="web")document.documentElement.setAttribute("data-theme",t);else document.documentElement.setAttribute("data-theme","tui");}catch(e){document.documentElement.setAttribute("data-theme","tui");}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="tui" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
