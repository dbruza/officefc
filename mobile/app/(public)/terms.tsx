/** Terms of use at /terms — agreed to at sign-up; includes the zero-tolerance content rules. */
import { LegalDocument } from "@/components";
import { TERMS_OF_USE } from "@/lib/legal";

export default function TermsRoute() {
  return <LegalDocument doc={TERMS_OF_USE} />;
}
