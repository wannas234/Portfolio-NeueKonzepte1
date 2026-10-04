import type { Metadata } from "next";
import BillingSuccess from "@/components/billing/BillingSuccess";

export const metadata: Metadata = {
  title: "Zahlung bestätigt · UniVerse",
  description: "Bestätigung deines UniVerse-Pro-Abos",
};

// Zugriff nur mit Anmeldung (Proxy). Der Status kommt aus der Datenbank, nicht aus dieser URL.
export default function Page() {
  return <BillingSuccess />;
}
