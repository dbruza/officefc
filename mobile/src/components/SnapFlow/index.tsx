import { useSnapFlow } from "./useSnapFlow";
import {
  CaptureStep,
  DoneStep,
  OpponentStep,
  PrefillStep,
  ProcessingStep,
  ReviewStep,
  SideStep,
  TeamsStep,
} from "./steps";
import type { SnapFlowProps } from "./types";

export function SnapFlow(props: SnapFlowProps) {
  const flow = useSnapFlow(props);

  if (flow.step === "capture") return <CaptureStep flow={flow} />;
  if (flow.step === "processing") return <ProcessingStep flow={flow} />;
  if (flow.step === "side") return <SideStep flow={flow} />;
  if (flow.step === "opponent") return <OpponentStep flow={flow} />;
  if (flow.step === "teams") return <TeamsStep flow={flow} />;
  if (flow.step === "prefill") return <PrefillStep flow={flow} />;
  if (flow.step === "review") return <ReviewStep flow={flow} />;
  if (flow.step === "done") return <DoneStep flow={flow} />;

  return null;
}
