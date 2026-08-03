import { createElement } from "react";
import { runtimeHostedDeploymentPresentation } from "../lib/server/deployment-presentation";

export function PreviewEnvironmentNotice() {
  const { previewNotice } = runtimeHostedDeploymentPresentation();
  return previewNotice
    ? createElement(
        "aside",
        { className: "preview-environment-notice", role: "status" },
        previewNotice,
      )
    : null;
}
