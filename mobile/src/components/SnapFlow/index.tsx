/**
 * Log a match from a photo of the full-time stats screen: AI consent (until allowed) →
 * upload → AI extraction → side → opponent → teams → verify & submit. See useSnapFlow for
 * the state machine.
 */
import { useSnapFlow } from "./useSnapFlow";
import {
  CaptureStep,
  ConsentStep,
  DoneStep,
  OpponentStep,
  ProcessingStep,
  SideStep,
  TeamsStep,
  VerifyStep,
} from "./steps";
import type { SnapFlowProps } from "./types";

export function SnapFlow(props: SnapFlowProps) {
  const flow = useSnapFlow(props);

  switch (flow.step) {
    case "consent":
      return <ConsentStep flow={flow} modeSwitch={props.modeSwitch} />;
    case "capture":
      return <CaptureStep flow={flow} modeSwitch={props.modeSwitch} />;
    case "processing":
      return <ProcessingStep flow={flow} />;
    case "side":
      return <SideStep flow={flow} />;
    case "opponent":
      return <OpponentStep flow={flow} />;
    case "teams":
      return <TeamsStep flow={flow} />;
    case "verify":
      return <VerifyStep flow={flow} />;
    case "done":
      return <DoneStep flow={flow} />;
  }
}
