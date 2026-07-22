import { FormScreen } from "@/components";
import { ProfileForm } from "@/screens/ProfileForm";
import { useAuth } from "@/lib/auth";

export default function ProfileSetup() {
  const { refresh } = useAuth();
  return (
    <FormScreen title="Set up your profile" subtitle="This is how you'll show up on the table.">
      {/* refresh() advances routing to the join step once the profile exists */}
      <ProfileForm submitLabel="Continue" onSaved={refresh} />
    </FormScreen>
  );
}
