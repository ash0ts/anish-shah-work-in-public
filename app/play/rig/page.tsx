import type { Metadata } from "next";
import { RigScreen } from "@/components/play/rig/RigScreen";
import { publicGearManifest, publicRigPrograms } from "@/lib/gear";
import { selectRigView } from "@/lib/gear-model";
import { SITE_COPY } from "@/lib/copy";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: SITE_COPY.play["rig-seo-title"],
  description: SITE_COPY.play["rig-seo-description"],
  path: "/play/rig",
});

export default async function RigPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <RigScreen manifest={publicGearManifest()} programs={publicRigPrograms()} view={selectRigView(await searchParams)} />;
}
