# Canonical content migration quality report

Generated from four immutable source files plus reviewed canonical and presentation curation. Content version: `c08c2fc612b67f74`.

## Source accounting

| Source | Plan baseline | Current parsed | Accounted |
|---|---:|---:|---:|
| Public footprint CSV | 184 | 184 | 184 |
| Impact metrics CSV | 61 | 85 | 85 |
| Public footprint Markdown | — | 13 level-two sections | 13 owner narrative blocks |
| Impact report Markdown | — | 10 level-two sections | 10 owner narrative blocks |

The impact CSV has **24 more rows** than the plan baseline. The importer keeps all current rows and treats the file as the authority.

The canonical bundle also contains **2 reviewed public artifacts** sourced from explicit links in the supplied Markdown, without changing or replacing any footprint observation.

## Footprint inventory

| Category | Rows |
|---|---:|
| event | 49 |
| external_reference | 24 |
| recording | 23 |
| open_source_pr | 21 |
| article | 15 |
| mirror | 12 |
| translation | 11 |
| technical_report | 9 |
| open_source_repo | 7 |
| profile | 6 |
| producer_credit | 4 |
| course | 3 |

- Confidence distribution: high 171, medium-high 8, medium 3, low 2.
- Repeated normalized titles: 23; repeated canonical URLs: 44.
- Recording duration represented: 69194 seconds (19h 13m 14s).
- Known MLOps Community URL corrections applied: 1.

## Relations

| Predicate | Generated |
|---|---:|
| derivative_of | 1 |
| implements | 4 |
| mirror_of | 12 |
| part_of | 9 |
| recording_of | 20 |
| references | 6 |
| translation_of | 12 |

Recording relations require a unique best typed match across URL role, date, exact title, and organization. Reviewed curation supplies explicit corrections and relationships; title-only ties never write a relation.

## Canonical entities

- Entity groups: 137 (artifact 40, occurrence 52, program 8, work 37).
- Source observations keep stable opaque IDs and retain their legacy IDs and route aliases.
- Work, occurrence, artifact, and program groupings preserve every source item; representations and context records remain inspectable without inflating unique-work views.

## Public WorkGroups

- Public WorkGroups: 82 (courses-learning 3, products-open-source 14, talks-programs 43, writing-research 22).
- Every public `unique_work` entity belongs to exactly one WorkGroup, including the reviewed EvalForge supplemental work.
- Explicit curation groups related courses, workshop editions, regional broadcasts, repeated talk deliveries, pull-request families, and production credits without changing canonical entity IDs or legacy routes.
- Remaining eligible entities receive deterministic standalone groups; context entities never become standalone WorkGroups.
- Owner-only grouping ledger decisions: program_sibling 2, reference_only 30, same_occurrence_representation 31, same_story 11, standalone 71.
- Duplicate titles and URLs alone never create a grouping; the ledger requires explicit curation, typed relations, or deterministic standalone classification.

## Publication projection

- Owner bundle: 186 items (184 footprint observations + 2 reviewed Markdown artifacts), 85 exact metric observations plus 13 reviewed public projections, 215 evidence records, and 23 source narrative blocks.
- Public bundle: 186 public items, 137 canonical entities, 82 WorkGroups, 13 rounded or derived public measures in 4 presentation groups, 198 public evidence records, and 9 collections.
- Exact metric observations remain only in the ignored owner bundle.
- The July MCP usage checkpoint and the cross-year tracked-program total replace their older public headline checkpoints; exact source values remain owner-only.
- Public metrics contain display strings and qualifiers, never raw numeric value fields.
- Internal evidence URLs, source excerpts, local paths, and source hashes are excluded from public output.

Public measure records:

- `metric:courses:enrollments:2026-07-30`
- `metric:courses:same-day-account-share:2026-07-30`
- `metric:course:llm-apps-evaluation:launch-signups:2025-01-10`
- `metric:project:wandb-mcp-server:tool-calls:2026-07-29`
- `metric:project:wandb-mcp-server:audience:2026-06-11`
- `metric:project:wandb-mcp-server:returning-share:2026-06-11`
- `metric:project:wandb-mcp-server:weekly-reengaged:2026-07-28`
- `metric:events:pipeline-supported:2024-2025`
- `metric:events:ic-associated-pipeline:2024`
- `metric:event:nvidia-gtc:leads:2024`
- `metric:event:fully-connected-sf:reach:2024`
- `metric:archive:event-references:2026-07`
- `metric:archive:recording-hours:2026-07`

## Private or excluded metric families

The following source metric families remain exact only in the owner bundle unless represented by a separately reviewed rounded public claim:

- `all_time_tool_calls`
- `analyst_interactions`
- `attendees`
- `attributed_qo_pipeline_arr`
- `avg_calls_per_user`
- `campaign_leads_all_courses`
- `completions_tracked`
- `course_sourced_wandb_signups`
- `enrollees_now_on_paid_org`
- `enrollments_existing_wandb_users`
- `enrollments_total`
- `enterprise_adopters`
- `events_as_core_ic`
- `first_run_on_or_after_enrollment`
- `first_runs_on_or_after_enrollment`
- `first_weave_call_on_or_after_enrollment`
- `first_weave_calls_on_or_after_enrollment`
- `free_user_email_first_line_coverage`
- `internal_alpha_shipped`
- `invited_sessions`
- `join_date`
- `launch_signups_first_36_hours`
- `leads`
- `named_accounts_supported`
- `official_nvidia_blueprint`
- `open_source_release`
- `pipeline_supported_usd`
- `pod_ownership`
- `production_tool_call_events_30d`
- `registered_tools`
- `registrants`
- `returning_user_share_of_wau`
- `sellout_status`
- `session_delivered`
- `shipped_in_wandb_sdk`
- `team_commitment`
- `top_tool_calls_gql`
- `total_users_at_launch`
- `unique_orgs`
- `unique_orgs_current`
- `unique_users`
- `unique_users_current`
- `weekly_active_users`
- `weekly_active_users_last_complete_week`
- `weekly_reengaged_users`

Completion floors, paid-organization associations, aggregate course-campaign leads, failure or support telemetry, private projects, customer names, team allocations, and warehouse-only attribution views are not copied into public data.

## Verification checks

- Stable opaque source-observation IDs are unique across all 186 items; legacy IDs and old route slugs remain aliases.
- Every organization, entity, evidence, relation, collection, and metric subject reference resolves.
- Every WorkGroup member, context entity, item, organization, and metric presentation reference resolves.
- All 184 footprint rows and 85 impact rows retain source-row fingerprints in the owner bundle.
- Tool-call display values are validated against currency prefixes.
- Item-detail metrics require an explicit item or canonical-entity subject; collection metrics are never inherited implicitly.
- The public projection contains only `public` publication states and `public_web` evidence.
- Public URLs pass protocol and blocked-domain checks.
- Re-running the importer with unchanged inputs produces byte-identical generated outputs.
