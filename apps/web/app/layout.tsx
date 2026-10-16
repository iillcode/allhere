import type { Metadata } from "next";
import "@stashwell/library-ui/styles.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "Stashwell — Web resource library",
  description: "Collect and review the resources you find across the web.",
  icons: { icon: "/icons/stashwell.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
