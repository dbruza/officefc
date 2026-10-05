/** Support at /support: common questions and how to reach us (the App Store support URL). */
import { LegalDocument } from "@/components";
import { SUPPORT } from "@/lib/legal";

export default function SupportRoute() {
  return <LegalDocument doc={SUPPORT} />;
}
