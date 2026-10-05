/** Privacy policy at /privacy — linked from sign-up, sign-in and the App Store listing. */
import { LegalDocument } from "@/components";
import { PRIVACY_POLICY } from "@/lib/legal";

export default function PrivacyRoute() {
  return <LegalDocument doc={PRIVACY_POLICY} />;
}
