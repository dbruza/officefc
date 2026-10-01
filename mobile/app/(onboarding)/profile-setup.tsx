/** Step 3 of first run: name, handle, jersey and colour. */
import { FormScreen } from "@/components";
import { ProfileForm } from "@/screens/ProfileForm";
import { useAuth } from "@/lib/auth";

export default function ProfileSetup() {
  const { refresh } = useAuth();
  return (
    <FormScreen
      title="Set up your profile"
      subtitle="This is how you'll show up on the table. You can change it any time."
      documentTitle="Your profile"
      step={3}
    >
      {/* refresh() advances routing to the join step once the profile exists. ProfileForm
          brings its own <form>, so FormScreen gets no onSubmit (forms can't nest). */}
      <ProfileForm submitLabel="Continue" onSaved={refresh} />
    </FormScreen>
  );
}
