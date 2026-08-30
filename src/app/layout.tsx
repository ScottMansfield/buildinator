import type { Metadata } from "next";
import "./globals.css";
import "./users.css";
import "./activity.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "buildinator",
  description: "Web frontend for Grok Build sessions",
  icons: { icon: "/favicon.svg" },
};

const themeBoot = `(function(){try{var t=localStorage.getItem("buildinator-theme");if(t==="default")t="web";if(t==="tui"||t==="grokday"||t==="web"||t==="light")document.documentElement.setAttribute("data-theme",t);else document.documentElement.setAttribute("data-theme","tui");var f=localStorage.getItem("buildinator-font-size");if(f==="12"||f==="13"||f==="14"||f==="16")document.documentElement.style.setProperty("--ui-font-size",f+"px");}catch(e){document.documentElement.setAttribute("data-theme","tui");}})();`;

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
