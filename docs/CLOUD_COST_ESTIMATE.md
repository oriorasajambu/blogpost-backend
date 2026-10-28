# Two-project cloud cost estimate

Planning observation: 27 October 2026. This worksheet covers the backend **and web** resources in Jakarta for `blogpost-staging` and `blogpost-512905`. It implements the backend/variant plans' requirement to estimate both environments before provisioning. It is a usage model, not a provider quote, approved spend, bill cap or capacity proof. No resource, budget, recipient or API was changed while preparing it.

Owner decision, 28 October 2026: **keep this as an estimate only**. The proposed amounts remain illustrative. Do not enable the Budget API, create/update budgets or configure alert recipients under this proposal. No such settings were changed. Paid cloud provisioning remains pending the plan's budget/setup prerequisites; local development can continue independently.

Read-only Cloud SDK observations confirm billing enabled and billing currency **IDR** for both selected projects. Cloud Run, SQL Admin, Cloud Billing and Cloud Billing Budget APIs were absent from each project's enabled-service inventory. Budget listing was unavailable; that does **not** prove budgets are absent. Inspect existing project-scoped budgets before creating or changing one. Keep billing-account identifiers and recipient details in the private worksheet.

## Configuration and usage assumptions

Use Enterprise PostgreSQL 17, single-zone `db-f1-micro`, continuously running in each project, 10 GiB SSD initially and the plan's bounded 20 GiB growth policy. Daily backups retain three successful copies in Staging and seven in Production. Pre-migration backups additionally retain at least seven days/last three attempts in Staging and 30 days/last five releases in Production. Do not stop Staging SQL or reduce recovery retention to meet this estimate.

API and web each use request billing, 1 vCPU/1 GiB, minimum zero, maximum one instance per service in Staging and two in Production. Service time below is the **sum across both services and all instances**, including startup/shutdown; overlapping API/web work is counted twice. Jobs use the plan's 1 vCPU/512 MiB. The production traffic allowance starts from 100 visits/day, roughly 3,000 visits/month, plus staff use. These are unmeasured planning quantities; replace them with actual billable-time, storage and transfer metrics after the first week.

| Monthly quantity                                                        |        Staging |       Production |
| ----------------------------------------------------------------------- | -------------: | ---------------: |
| SQL running time                                                        |      730 hours |        730 hours |
| Provisioned SSD                                                         |         10 GiB |           10 GiB |
| Billable SQL backup storage, including daily/pre-migration              |   30 GiB-month |     60 GiB-month |
| Combined API/web billable time, 1 vCPU/1 GiB                            | 30,000 seconds |   80,000 seconds |
| Combined API/web requests                                               |         50,000 |          150,000 |
| Operations task time, 1 vCPU/0.5 GiB                                    |  6,000 seconds |    6,000 seconds |
| Private media, including variants, retained revisions and soft deletion |    5 GiB-month |     15 GiB-month |
| Storage Class A / B operations                                          | 5,000 / 50,000 | 10,000 / 150,000 |
| Registry stored layers/artifacts                                        |   10 GiB-month |     20 GiB-month |
| Manual recovery Cloud Build, default-pool `e2-standard-2`               |    200 minutes |      100 minutes |
| Secret versions / version accesses                                      |     8 / 30,000 |       8 / 30,000 |
| Scheduled maintenance triggers                                          |              1 |                1 |
| Internet delivery/downloads, primarily Indonesian clients               |          5 GiB |           25 GiB |

Backup quantities are assumptions about **used retained bytes**, not provisioned SSD multiplied by a backup count. They allow roughly six/twelve 5 GiB equivalents. Incremental storage may be smaller; frequent deployments, failed attempts, growth or retained recovery references can be larger. The minimum-day and last-attempt rules both apply. Measure actual billed backup bytes and revise the estimate before exceeding these allowances. Media allowance also includes seven-day soft-deleted bytes; SQL backups do not protect image objects.

## Published rates and monthly calculation

The official pages contain region selectors. The Jakarta tables were read from their embedded public page data, rather than using the default Iowa table. USD rates below were observed on the date above. No commitments, trial credits or billing-account free-tier discounts are deducted from the variable-price calculation. Shared free allowances must not be counted once for each project.

| Component and calculation                                                           | Staging USD | Production USD | Source                                                                                                                     |
| ----------------------------------------------------------------------------------- | ----------: | -------------: | -------------------------------------------------------------------------------------------------------------------------- |
| SQL: 730 × $0.0137/hour                                                             |      10.001 |         10.001 | [SQL pricing, Jakarta shared core](https://cloud.google.com/sql/pricing#mysql-and-postgresql-pricing-1)                    |
| SSD: 10 × $0.221/GiB-month                                                          |       2.210 |          2.210 | [SQL storage](https://cloud.google.com/sql/pricing)                                                                        |
| Backups: 30/60 × $0.104/GiB-month                                                   |       3.120 |          6.240 | [SQL used backup storage](https://cloud.google.com/sql/pricing)                                                            |
| Services: seconds × ($0.0000336 CPU + $0.0000035 memory) + requests × $0.40/million |       1.133 |          3.028 | [Cloud Run request billing, Jakarta](https://cloud.google.com/run/pricing)                                                 |
| Jobs: 6,000 × ($0.0000216 CPU + 0.5 × $0.0000024 memory)                            |       0.137 |          0.137 | [Cloud Run job billing, Jakarta](https://cloud.google.com/run/pricing)                                                     |
| Media: 5/15 × $0.023/GiB-month                                                      |       0.115 |          0.345 | [Storage, Jakarta Standard](https://cloud.google.com/storage/pricing)                                                      |
| Object operations: A × $0.005/1,000 + B × $0.0004/1,000                             |       0.045 |          0.110 | [Regional flat-namespace operations](https://cloud.google.com/storage/pricing#operations-pricing)                          |
| Registry: 10/20 × $0.10/GiB-month                                                   |       1.000 |          2.000 | [Artifact Registry storage](https://cloud.google.com/artifact-registry/pricing)                                            |
| Recovery builds: 200/100 × $0.006/minute                                            |       1.200 |          0.600 | [Cloud Build default pool](https://cloud.google.com/build/pricing)                                                         |
| Secrets: 8 × $0.06/month + 30,000 × $0.03/10,000                                    |       0.570 |          0.570 | [Secret Manager](https://cloud.google.com/secret-manager/pricing)                                                          |
| Scheduler: 1 × $0.10/month                                                          |       0.100 |          0.100 | [Scheduler](https://cloud.google.com/scheduler/pricing)                                                                    |
| Internet: 5/25 × $0.19/GiB                                                          |       0.950 |          4.750 | [Jakarta Premium Tier, first tier to Indonesia](https://cloud.google.com/vpc/network-pricing#internet_data_transfer_rates) |
| Observability planning reserve                                                      |       2.000 |          2.000 | [Logging/Monitoring](https://cloud.google.com/products/observability/pricing)                                              |
| Google sign-in planning reserve, about ten staff                                    |       0.060 |          0.060 | [Identity Platform](https://cloud.google.com/identity-platform/pricing)                                                    |
| **Monthly planning subtotal, unrounded calculation**                                | **22.6408** |    **32.1508** | **Combined: $54.7916**                                                                                                     |

The last two rows are reserves, not fixed provider fees. At the intended use, Google social sign-in and project logging can be within their applicable free limits, and standard Google metrics are non-chargeable. Paid custom metrics/extra retention/monitoring traffic consume the reserve. Monitoring's published alert-policy charges start no sooner than September 2027; they are not charged as a present fixed fee in this October 2026 estimate. Secret versions remain billable when disabled; deleting a root job or disabling a secret does not remove version storage charges. Job time has a one-minute minimum per started task. Network transfer is charged once when the bytes leave Cloud Run for a client; private same-region Storage-to-API and API-to-web traffic is not added again as internet transfer.

Image vulnerability scanning remains a required release gate. It can use reviewed tooling in CI; enabling Google's paid automatic scanning is a separate cost choice. At the published $0.26 per new image digest, an example 30 Staging/12 Production new API/operations/web digests adds **$7.80/$3.12** monthly. Tags on the same digest do not add scans. This optional provider feature was not enabled. [Artifact Analysis pricing](https://cloud.google.com/artifact-analysis/pricing).

With that optional scanning and a **$5 first-month setup/restore/load-test reserve per environment**, the planning envelopes are **$35.4408 Staging**, **$40.2708 Production**, **$75.7116 combined** before taxes. This reserve includes a short-lived recovery instance and extra execution/build/storage use; it is not permission to retain another permanent database. GitHub Actions/storage, domains, devices, internet access, paid support, taxes and a separately purchased observability/scanning product are outside these GCP subtotals. Revisit after measuring actual bills and before a service/retention change.

## Proposed IDR budgets and controls

The proposal is **Rp750,000/month for Staging** and **Rp1,000,000/month for Production**, **Rp1,750,000 combined**. These are alert amounts for owner review, not a new agreed spending target. A deliberately rounded **Rp20,000 per USD planning allocation** makes the first-month envelopes about Rp709,000/Rp805,000; this is a reserve conversion, **not today's exchange rate or Google's billing conversion**. Actual native IDR SKU prices, account terms, currency surcharge and taxes must be checked in Billing/SQL's creation estimate before paid provisioning. Google's [SKU pricing API](https://docs.cloud.google.com/billing/docs/reference/rest/v1/services.skus/list) documents its own currency conversion, including any surcharge.

Prepare alerts-only calendar-month budgets with these exact project scopes:

| Environment | Budget project filter   | Proposed amount | Actual thresholds | Forecast threshold |
| ----------- | ----------------------- | --------------: | ----------------- | ------------------ |
| Staging     | `projects/393487571647` |    `IDR 750000` | 50%, 80%, 100%    | 100%               |
| Production  | `projects/520873230275` |   `IDR 1000000` | 50%, 80%, 100%    | 100%               |

Include all services and exclude credits in the planning alert view so trial/promotional credits do not conceal the underlying usage. Keep a combined billing-account/report view without changing unrelated projects' budgets. Review existing matching budgets before adding any; retain unrelated scopes. Use only owner-approved recipients/notification channels. No recipient, threshold or budget is configured by this document. [Budget API](https://docs.cloud.google.com/billing/docs/how-to/budget-api), [budget creation and notifications](https://docs.cloud.google.com/billing/docs/how-to/budgets).

Alerts can lag and do not stop charges. The proposal adds no automated billing disable, SQL stop/delete or content purge. At 50%, inspect spend by service; at 80%, investigate growth/new digests, failed jobs and unexpected transfer and decide whether to revise capacity/spend; at 100% actual/forecast, require a prompt owner decision. Preserve recovery data and diagnose rather than deleting retained backups or volumes to suppress an alert.

SQL is the main fixed cost. If micro capacity is inadequate, Jakarta `db-g1-small` compute is $0.0455/hour, about $33.215/month: **+$23.214 per environment** before storage, and the budgets need a fresh review. Growing SSD from 10 to 20 GiB adds $2.21/month per environment. At this network tier, every extra 100 GiB delivered adds about $19. Continuous active traffic, longer jobs, increased backup retention or paid scanning can exceed the modeled envelope. Minimum-zero/service maxima are capacity controls, not a bill guarantee. Do not silently provision a larger tier when the selected one is unavailable.

Before creating paid resources: obtain the owner's budget/recipient decision; verify or establish both scoped budgets and actual notification delivery settings; verify native IDR creation prices and tier availability; then proceed through the reviewed source/IAM/backup setup gates. The deployment writer, real provider tests, client journeys, rollback/restore drill and owner acceptance remain required. See [cloud worksheet](CLOUD_ENVIRONMENTS.md) and [implementation status](IMPLEMENTATION_STATUS.md).
