/**
 * Theme entrypoint: re-exports tokens and a font-loading hook used by the root layout.
 */
import { useFonts } from "expo-font";
import { Archivo_400Regular, Archivo_500Medium, Archivo_700Bold } from "@expo-google-fonts/archivo";
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";

export * from "./tokens";

/**
 * Loads the Archivo + JetBrains Mono families under the names used by `fonts`
 * in tokens.ts. Returns `[loaded, error]`.
 */
export function useAppFonts() {
  return useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });
}
