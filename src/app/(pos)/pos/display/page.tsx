import type { Metadata } from "next";
import { DisplayView } from "./display-view";

export const metadata: Metadata = { title: "Layar pelanggan" };

export default function CustomerDisplayPage() {
  return <DisplayView />;
}
