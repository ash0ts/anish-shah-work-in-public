import { createElement } from "react";
import { runtimeHostedDeploymentPresentation } from "../lib/server/deployment-presentation";

export function PreviewEnvironmentNotice() {
  const { previewNotice } = runtimeHostedDeploymentPresentation();
  return previewNotice
    ? createElement(
        "aside",
        {
          "aria-label": previewNotice,
          className: "preview-environment-notice",
          role: "status",
        },
        createElement(
          "span",
          { className: "preview-environment-notice__full" },
          previewNotice,
        ),
        createElement(
          "span",
          {
            "aria-hidden": true,
            className: "preview-environment-notice__compact",
          },
          previewNotice.replace(" preview data", ""),
        ),
      )
    : null;
}
