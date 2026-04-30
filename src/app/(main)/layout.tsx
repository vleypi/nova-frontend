import { LandingHeader, LandingFooter } from "@/features/landing";

// Layout публичной части приложения с landing-шапкой и подвалом.
export default function LandingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <LandingHeader />
      {children}
      <LandingFooter />
    </>
  );
}
