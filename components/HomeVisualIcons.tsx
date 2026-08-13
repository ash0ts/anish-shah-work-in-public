import type {
  HomeRailIconId,
  HomeSignalIconId,
} from "@/lib/home-presentation";
import type { ThemeFacetId } from "@/lib/work-facets";

type IconProps = {
  className?: string;
};

const sharedProps = {
  "aria-hidden": true,
  fill: "none",
  focusable: false,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.7,
  viewBox: "0 0 32 32",
};

export function HomeSignalIcon({
  className,
  iconId,
}: IconProps & { iconId: HomeSignalIconId }) {
  if (iconId === "open-book") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="M4.5 7.5c4.7-.9 8.2.1 11.5 2.7v15c-3.3-2.6-6.8-3.6-11.5-2.7z" />
        <path d="M27.5 7.5c-4.7-.9-8.2.1-11.5 2.7v15c3.3-2.6 6.8-3.6 11.5-2.7z" />
        <path d="M8.2 12.1c1.5-.1 2.8.2 4 .8M19.8 12.9c1.2-.6 2.5-.9 4-.8" />
      </svg>
    );
  }
  if (iconId === "program-network") {
    return (
      <svg {...sharedProps} className={className}>
        <circle cx="16" cy="7" r="3" />
        <circle cx="7" cy="23.5" r="3" />
        <circle cx="25" cy="23.5" r="3" />
        <path d="m14.5 9.7-6 11M17.5 9.7l6 11M10 23.5h12" />
      </svg>
    );
  }
  return (
    <svg {...sharedProps} className={className}>
      <rect x="5" y="8" width="22" height="16" rx="2" />
      <path d="M10 13h12M10 18h7M21 18h1M16 5v3M16 24v3" />
      <circle cx="8" cy="13" r=".7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HomeRailIcon({
  className,
  iconId,
}: IconProps & { iconId: HomeRailIconId }) {
  if (iconId === "learning-loop") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="M7 9.5 16 5l9 4.5-9 4.5z" />
        <path d="M10 12v7c2.8 2.5 9.2 2.5 12 0v-7M25 10v8" />
        <path d="M7 25h18" />
      </svg>
    );
  }
  if (iconId === "research-trace") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="M6 25 13 7h6l7 18M10 17h12" />
        <circle cx="8" cy="25" r="2" />
        <circle cx="24" cy="25" r="2" />
        <circle cx="16" cy="7" r="2" />
      </svg>
    );
  }
  if (iconId === "program-broadcast") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="M11 24V8l12-3v16" />
        <circle cx="8" cy="24" r="3" />
        <circle cx="20" cy="21" r="3" />
        <path d="M25.5 10c2 1.4 2 3.6 0 5M28 7.5c4.2 3.2 4.2 7.8 0 11" />
      </svg>
    );
  }
  return (
    <svg {...sharedProps} className={className}>
      <circle cx="7" cy="16" r="3" />
      <circle cx="25" cy="8" r="3" />
      <circle cx="25" cy="24" r="3" />
      <path d="M10 15 22 9M10 17l12 6M7 7v6M7 19v6" />
    </svg>
  );
}

export function HomeTopicIcon({
  className,
  topicId,
}: IconProps & { topicId: ThemeFacetId }) {
  if (topicId === "agent-systems") {
    return (
      <svg {...sharedProps} className={className}>
        <circle cx="8" cy="16" r="3" />
        <circle cx="24" cy="8" r="3" />
        <circle cx="24" cy="24" r="3" />
        <path d="M11 15 21 9M11 17l10 6" />
      </svg>
    );
  }
  if (topicId === "evaluation-observability") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="M5 23V15M11 23V9M17 23v-5M23 23V6M4 26h23" />
        <path d="m5 11 6-5 6 8 8-10" />
      </svg>
    );
  }
  if (topicId === "open-source-ecosystems") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="M11 8 4 16l7 8M21 8l7 8-7 8M18 5l-4 22" />
      </svg>
    );
  }
  if (topicId === "foundation-models") {
    return (
      <svg {...sharedProps} className={className}>
        <path d="m16 4 10 6v12l-10 6-10-6V10z" />
        <path d="m6 10 10 6 10-6M16 16v12" />
      </svg>
    );
  }
  if (topicId === "ml-systems-infrastructure") {
    return (
      <svg {...sharedProps} className={className}>
        <rect x="5" y="5" width="22" height="7" rx="1" />
        <rect x="5" y="20" width="22" height="7" rx="1" />
        <path d="M8 8.5h1M8 23.5h1M20 8.5h4M20 23.5h4M16 12v8" />
      </svg>
    );
  }
  if (topicId === "retrieval-knowledge-systems") {
    return (
      <svg {...sharedProps} className={className}>
        <circle cx="13" cy="13" r="7" />
        <path d="m18.5 18.5 8 8M10 11h6M10 15h4" />
      </svg>
    );
  }
  if (topicId === "education-community") {
    return (
      <svg {...sharedProps} className={className}>
        <circle cx="11" cy="11" r="4" />
        <circle cx="23" cy="13" r="3" />
        <path d="M4 26c.8-5 3.1-8 7-8s6.2 3 7 8M19 20c4.2-.9 7.2 1.1 8 5" />
      </svg>
    );
  }
  return (
    <svg {...sharedProps} className={className}>
      <path d="M5 22c4-9 8-13 13-13 4 0 7 3 9 8" />
      <circle cx="6" cy="23" r="2" />
      <circle cx="18" cy="9" r="2" />
      <circle cx="27" cy="17" r="2" />
    </svg>
  );
}
