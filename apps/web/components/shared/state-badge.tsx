import type { GenerationDetailResponseDto } from "@vi/contracts";
import { Badge } from "../ui/badge";
import { getRunStateUi } from "../../lib/ui-state";

export function RunStateBadge(props: {
  state: GenerationDetailResponseDto["active_run_state"];
}): React.JSX.Element {
  const ui = getRunStateUi(props.state);

  const variant =
    ui.tone === "success"
      ? "success"
      : ui.tone === "warning"
        ? "warning"
        : ui.tone === "danger"
          ? "danger"
          : ui.tone === "muted"
            ? "muted"
            : "default";

  return <Badge variant={variant}>{ui.label}</Badge>;
}
