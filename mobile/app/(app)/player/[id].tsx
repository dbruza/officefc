import { useLocalSearchParams } from "expo-router";
import { PlayerProfileScreen } from "@/screens/PlayerProfileScreen";

export default function PlayerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlayerProfileScreen uid={id} />;
}
