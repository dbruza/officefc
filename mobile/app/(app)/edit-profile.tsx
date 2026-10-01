/** In-app profile editing: the shared ProfileForm in a narrow page; saving toasts and returns. */
import { KeyboardAvoidingView, Platform } from "react-native";
import { Card, Page, Reveal, ScreenHeader, useSafeBack } from "@/components";
import { useBreakpoint } from "@/lib/responsive";
import { ProfileForm } from "@/screens/ProfileForm";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

const flat = { padding: 0, borderWidth: 0, backgroundColor: "transparent" } as const;

export default function EditProfile() {
  const goBack = useSafeBack();
  const { profile, refresh } = useAuth();
  const { isTablet } = useBreakpoint();

  const form = (
    <ProfileForm
      initial={profile}
      submitLabel="Save changes"
      onSaved={async () => {
        await refresh();
        toast.success("Profile updated");
        goBack();
      }}
    />
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Page
        width="narrow"
        header={
          <ScreenHeader title="Edit profile" subtitle="Changes show up across the whole league." />
        }
      >
        {/* Phones use the full width; bigger screens frame the form in a card. Same tree
            either way, so resizing across the breakpoint never resets what was typed. */}
        <Reveal>
          <Card style={isTablet ? { padding: 24 } : flat}>{form}</Card>
        </Reveal>
      </Page>
    </KeyboardAvoidingView>
  );
}
