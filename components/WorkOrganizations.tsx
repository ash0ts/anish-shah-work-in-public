import Link from "next/link";
import Image from "next/image";
import styles from "./WorkOrganizations.module.css";

export type WorkOrganizationRelationship =
  | "built-at"
  | "contributed-to"
  | "presented-with-or-at";

export type WorkOrganizationLogoView = {
  src: `/assets/organizations/${string}`;
  width?: number;
  height?: number;
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

export type WorkOrganizationsProps = {
  eyebrow: string;
  title: string;
  summary: string;
  sections: WorkOrganizationSectionView[];
  selectedOrganizationId?: string | null;
};

export function WorkOrganizations({
  eyebrow,
  title,
  summary,
  sections,
  selectedOrganizationId = null,
}: WorkOrganizationsProps) {
  const visibleSections = sections.filter(({ marks }) => marks.length > 0);

  if (!visibleSections.length) return null;
  const relationshipLabels = Object.fromEntries(
    sections.map(({ id, label }) => [id, label]),
  ) as Record<WorkOrganizationRelationship, string>;

  return (
    <section
      aria-labelledby="work-organizations-title"
      className={styles.section}
      id="work-organizations"
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <div className={styles.introduction}>
          <h2 id="work-organizations-title">{title}</h2>
          <p>{summary}</p>
        </div>
      </header>

      <div className={styles.relationships}>
        {visibleSections.map((section) => {
          const headingId = `work-organizations-${section.id}`;
          return (
            <section
              aria-labelledby={headingId}
              className={styles.relationship}
              data-relationship={section.id}
              key={section.id}
            >
              <header className={styles.relationshipHeader}>
                <h3 id={headingId}>{section.label}</h3>
                <span aria-hidden="true">
                  {String(section.marks.length).padStart(2, "0")}
                </span>
              </header>

              <ol className={styles.marks}>
                {section.marks.map((mark) => (
                  <li key={mark.id}>
                    <OrganizationMark
                      mark={mark}
                      relationshipLabels={relationshipLabels}
                      selected={selectedOrganizationId === mark.id}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function OrganizationMark({
  mark,
  relationshipLabels,
  selected,
}: {
  mark: WorkOrganizationMarkView;
  relationshipLabels: Record<WorkOrganizationRelationship, string>;
  selected: boolean;
}) {
  const primaryRelationship = relationshipLabels[mark.relationship];
  const secondaryRelationships = uniqueRelationships(
    mark.secondaryRelationships,
    mark.relationship,
  );
  const projectLabel = `${mark.projectCount} ${
    mark.projectCount === 1 ? "project" : "projects"
  }`;
  const accessibleRelationship = [
    primaryRelationship,
    ...secondaryRelationships.map(
      (relationship) => `also ${relationshipLabels[relationship].toLowerCase()}`,
    ),
  ].join(", ");

  return (
    <Link
      aria-current={selected ? "page" : undefined}
      aria-label={`${mark.name}: ${accessibleRelationship}; ${projectLabel}`}
      className={styles.mark}
      data-selected={selected || undefined}
      href={`/work?organization=${encodeURIComponent(mark.id)}#work-index`}
      prefetch={false}
    >
      <span aria-hidden="true" className={styles.logo}>
        {mark.logo ? (
          <Image
            alt=""
            height={mark.logo.height ?? 96}
            sizes="160px"
            src={mark.logo.src}
            unoptimized
            width={mark.logo.width ?? 240}
          />
        ) : (
          <strong className={styles.wordmark}>{mark.name}</strong>
        )}
      </span>

      <span className={styles.markBody}>
        {mark.logo ? <strong>{mark.name}</strong> : null}
        <span className={styles.relationshipLabel}>
          {primaryRelationship}
          {secondaryRelationships.map((relationship) => (
            <small key={relationship}>
              Also {relationshipLabels[relationship].toLowerCase()}
            </small>
          ))}
        </span>
      </span>

      <span className={styles.projectCount}>
        {projectLabel}
        <i aria-hidden="true">↗</i>
      </span>
    </Link>
  );
}

function uniqueRelationships(
  relationships: WorkOrganizationRelationship[],
  primary: WorkOrganizationRelationship,
) {
  return [...new Set(relationships)].filter(
    (relationship) => relationship !== primary,
  );
}
