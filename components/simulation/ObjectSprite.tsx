import type { InternetObject } from "@/lib/simulation/personal-internet";
import styles from "./Conversation.module.css";

/** Original generated materials; labels and controls remain semantic HTML. */
export function ObjectSprite({
  kind,
  variant = 0,
}: {
  kind: InternetObject["kind"];
  variant?: number;
}) {
  const material =
    kind === "notebook"
      ? "disc"
      : kind === "document"
        ? "lime"
        : kind === "poster"
          ? "case"
          : variant === 4
            ? "disc"
            : variant === 5
              ? "case"
              : "cartridge";
  return (
    <span
      aria-hidden="true"
      className={styles.mediaArt}
      data-material={material}
    />
  );
}
