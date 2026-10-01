/** The "You" tab: your own profile, rendered by the shared player screen in root mode. */
import { useAuth } from "@/lib/auth";
import { PlayerProfileScreen } from "@/screens/PlayerProfileScreen";

export default function MyProfileRoute() {
  const { user } = useAuth();
  return user ? <PlayerProfileScreen uid={user.uid} root /> : null;
}
