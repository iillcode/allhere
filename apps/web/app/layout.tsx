import type { Metadata } from "next";
import "@allhere/library-ui/styles.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "Allhere — Web resource library",
  description: "Collect and review the resources you find across the web.",
  icons: { icon: "/icons/allhere.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
