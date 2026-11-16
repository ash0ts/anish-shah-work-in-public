import type { Metadata } from "next";
import { RigScreen } from "@/components/play/rig/RigScreen";
import { publicGearManifest } from "@/lib/gear";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: SITE_COPY.play["rig-seo-title"],
  description: SITE_COPY.play["rig-seo-description"],
  path: "/play/rig",
});

export default function RigPage() {
  return <RigScreen manifest={publicGearManifest()} />;
}
