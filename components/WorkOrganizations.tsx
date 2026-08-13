import Image from "next/image";
import Link from "next/link";
import { SITE_COPY } from "@/lib/copy";
import styles from "./WorkOrganizations.module.css";

export type WorkOrganizationRelationship =
  | "built-at"
  | "contributed-to"
  | "presented-with-or-at";

export type WorkOrganizationLogoView = {
  src: `/assets/organizations/${string}`;
  width: number;
  height: number;
};

export type WorkOrganizationMarkView = {
  id: string;
  name: string;
  relationship: WorkOrganizationRelationship;
  secondaryRelationships: WorkOrganizationRelationship[];
  projectCount: number;
  logo: WorkOrganizationLogoView | null;
};

export type WorkOrganizationSectionView = {
  id: WorkOrganizationRelationship;
  label: string;
  marks: WorkOrganizationMarkView[];
};

type OrganizationHref = (organizationId: string) => string;

export type WorkOrganizationLensProps = {
  open: boolean;
  sections: WorkOrganizationSectionView[];
  selectedOrganizationId?: string | null;
  organizationHref: OrganizationHref;
};

export function WorkOrganizationLens({
  open,
  sections,
  selectedOrganizationId = null,
  organizationHref,
}: WorkOrganizationLensProps) {
  const visibleSections = sections.filter(({ marks }) => marks.length > 0);
  const markCount = visibleSections.reduce(
    (count, section) => count + section.marks.length,
    0,
  );
  if (!markCount) return null;

  const relationshipLabels = relationshipLabelsFrom(sections);
  const marks = visibleSections.flatMap((section) => section.marks);

  return (
    <section
      aria-label={SITE_COPY.work["organizations-browse-label"]}
      className={styles.lensSection}
    >
      <details className={styles.lens} id="work-organizations" open={open}>
        <summary>
          <span>{SITE_COPY.work["organizations-control-label"]}</span>
          <strong>{markCount}</strong>
          <i aria-hidden="true">+</i>
        </summary>

        <div className={styles.directory}>
          <header className={styles.directoryHeader}>
            <p>
              {SITE_COPY.work["organizations-browse-all-prefix"]}{" "}
              {SITE_COPY.work["organizations-noun-plural"]}
            </p>
            <RelationshipLegend sections={visibleSections} />
          </header>

          <ol className={styles.directoryMarks}>
            {marks.map((mark) => (
              <li key={mark.id}>
                <OrganizationMark
                  href={organizationHref(mark.id)}
                  mark={mark}
                  relationshipLabels={relationshipLabels}
                  selected={selectedOrganizationId === mark.id}
                  variant="directory"
                />
              </li>
            ))}
          </ol>
        </div>
      </details>
    </section>
  );
}

export type WorkOrganizationContextProps = {
  allOrganizationCount: number;
  browseAllHref: string;
  clearOrganizationHref: string | null;
  marks: WorkOrganizationMarkView[];
  matchingMarkCount: number;
  organizationHref: OrganizationHref;
  relationshipLabels: Record<WorkOrganizationRelationship, string>;
  selectedOrganizationId?: string | null;
  selectedOrganizationName?: string | null;
};

export function WorkOrganizationContext({
  allOrganizationCount,
  browseAllHref,
  clearOrganizationHref,
  marks,
  matchingMarkCount,
  organizationHref,
  relationshipLabels,
  selectedOrganizationId = null,
  selectedOrganizationName = null,
}: WorkOrganizationContextProps) {
  const remaining = Math.max(0, matchingMarkCount - marks.length);

  return (
    <section
      aria-labelledby="work-context-organizations-title"
      className={styles.context}
    >
      <header className={styles.contextHeader}>
        <div>
          <p>{SITE_COPY.work["organizations-context-eyebrow"]}</p>
          <h2 id="work-context-organizations-title">
            {SITE_COPY.work["organizations-context-title"]}
          </h2>
        </div>
        {selectedOrganizationName && clearOrganizationHref ? (
          <Link
            aria-label={`${SITE_COPY.work["organizations-remove-filter-prefix"]} ${selectedOrganizationName} ${SITE_COPY.work["organizations-remove-filter-suffix"]}`}
            className={styles.activeFilter}
            href={clearOrganizationHref}
            prefetch={false}
          >
            <span>{selectedOrganizationName}</span>
            <i aria-hidden="true">×</i>
          </Link>
        ) : null}
      </header>

      {marks.length ? (
        <ol className={styles.contextMarks}>
          {marks.map((mark) => (
            <li key={mark.id}>
              <OrganizationMark
                href={organizationHref(mark.id)}
                mark={mark}
                relationshipLabels={relationshipLabels}
                selected={selectedOrganizationId === mark.id}
                variant="context"
              />
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.contextFooter}>
        {remaining > 0 ? (
          <span>
            +{remaining} more{" "}
            {remaining === 1
              ? SITE_COPY.work["organizations-more-singular"]
              : SITE_COPY.work["organizations-more-plural"]}
          </span>
        ) : null}
        <Link className={styles.more} href={browseAllHref} prefetch={false}>
          {SITE_COPY.work["organizations-browse-all-prefix"]}{" "}
          {allOrganizationCount}{" "}
          {SITE_COPY.work["organizations-noun-plural"]}
        </Link>
      </div>
    </section>
  );
}

function RelationshipLegend({
  sections,
}: {
  sections: WorkOrganizationSectionView[];
}) {
  return (
    <ul
      aria-label={SITE_COPY.work["organizations-legend-label"]}
      className={styles.legend}
    >
      {sections.map((section) => (
        <li key={section.id}>
          <RelationshipIcon relationship={section.id} />
          <span>{section.label}</span>
        </li>
      ))}
    </ul>
  );
}

function RelationshipIcon({
  relationship,
}: {
  relationship: WorkOrganizationRelationship;
}) {
  return (
    <span
      aria-hidden="true"
      className={styles.relationshipIcon}
      data-relationship={relationship}
    />
  );
}

function OrganizationMark({
  href,
  mark,
  relationshipLabels,
  selected,
  variant,
}: {
  href: string;
  mark: WorkOrganizationMarkView;
  relationshipLabels?: Record<WorkOrganizationRelationship, string>;
  selected: boolean;
  variant: "context" | "directory";
}) {
  const primaryRelationship = relationshipLabels?.[mark.relationship];
  const secondaryRelationships = uniqueRelationships(
    mark.secondaryRelationships,
    mark.relationship,
  );
  const projectLabel = `${mark.projectCount} ${
    mark.projectCount === 1
      ? SITE_COPY.work["organizations-project-singular"]
      : SITE_COPY.work["organizations-project-plural"]
  }`;
  const accessibleRelationship = primaryRelationship
    ? [
        primaryRelationship,
        ...secondaryRelationships.map(
          (relationship) =>
            `${SITE_COPY.work["organizations-secondary-prefix"]} ${relationshipLabels?.[relationship].toLowerCase()}`,
        ),
      ].join(", ")
    : null;

  return (
    <Link
      aria-current={selected ? "page" : undefined}
      aria-label={`${mark.name}${
        accessibleRelationship ? `: ${accessibleRelationship};` : ":"
      } ${projectLabel}`}
      className={styles.mark}
      data-organization-id={mark.id}
      data-selected={selected || undefined}
      data-variant={variant}
      href={href}
      prefetch={false}
    >
      <span aria-hidden="true" className={styles.logo}>
        {mark.logo ? (
          <Image
            alt=""
            height={mark.logo.height}
            loading="lazy"
            sizes={variant === "context" ? "112px" : "144px"}
            src={mark.logo.src}
            unoptimized
            width={mark.logo.width}
          />
        ) : (
          <strong className={styles.wordmark}>{mark.name}</strong>
        )}
      </span>

      <span className={styles.markBody}>
        {mark.logo ? <strong>{mark.name}</strong> : null}
        {primaryRelationship && variant === "directory" ? (
          <span className={styles.markRelationshipIcon}>
            <RelationshipIcon relationship={mark.relationship} />
          </span>
        ) : null}
      </span>

      <span className={styles.projectCount}>{projectLabel}</span>
    </Link>
  );
}

function relationshipLabelsFrom(sections: WorkOrganizationSectionView[]) {
  return Object.fromEntries(
    sections.map(({ id, label }) => [id, label]),
  ) as Record<WorkOrganizationRelationship, string>;
}

function uniqueRelationships(
  relationships: WorkOrganizationRelationship[],
  primary: WorkOrganizationRelationship,
) {
  return [...new Set(relationships)].filter(
    (relationship) => relationship !== primary,
  );
}
