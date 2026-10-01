/**
 * Another player's profile. The shared screen owns loading, layout, and the Rivals card
 * (it used to be injected from here; own profiles now get it too).
 */
import { useLocalSearchParams } from "expo-router";
import { PlayerProfileScreen } from "@/screens/PlayerProfileScreen";

export default function PlayerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // An empty id resolves to "Player not found" inside the screen rather than a blank page.
  return <PlayerProfileScreen uid={id ?? ""} />;
}
