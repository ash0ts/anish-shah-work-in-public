import {
  hostedDeploymentTier,
  metadataTitlePrefix,
} from "../deployment-environment";
import { runtimeValue } from "./runtime-env";

export type HostedDeploymentPresentation = {
  tier: "preview" | "staging" | "production" | null;
  titlePrefix: string;
  nonProductionHosted: boolean;
  previewNotice: string | null;
};

export function runtimeHostedDeploymentPresentation(): HostedDeploymentPresentation {
  const tier = hostedDeploymentTier(runtimeValue("DEPLOYMENT_TIER"));
  const previewPrNumber = runtimeValue("PREVIEW_PR_NUMBER");
  return {
    tier,
    titlePrefix: metadataTitlePrefix(tier ?? undefined, previewPrNumber),
    nonProductionHosted: tier === "preview" || tier === "staging",
    previewNotice:
      tier === "preview"
        ? `Synthetic preview data · PR #${previewPrNumber ?? "preview"}`
        : null,
  };
}
