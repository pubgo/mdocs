# SVG Bob Complex Demo

This file is for testing `svgbob` / `bob` code block rendering in `mo`.

## 1) Distributed Architecture (svgbob)

```svgbob
                               +------------------------------+
                               |        Global DNS / CDN      |
                               +------------------------------+
                                             |
                                             v
+-------------------+     +--------------------------+     +--------------------+
|   Mobile / Web    | --> |   API Gateway / WAF      | --> |   Auth Service     |
|   Clients         |     |   (rate-limit, routing)  |     |   JWT / OIDC       |
+-------------------+     +--------------------------+     +--------------------+
           |                              |
           |                              v
           |                  +---------------------------+
           |                  |  Service Mesh / LB        |
           |                  +---------------------------+
           |                       |            |
           |                       |            |
           |                       v            v
           |             +----------------+   +----------------+
           |             |  User Service  |   | Order Service  |
           |             +----------------+   +----------------+
           |                      |                    |
           |                      |                    |
           |                      v                    v
           |             +----------------+   +----------------+
           |             | PostgreSQL     |   | Kafka          |
           |             | (users, ACL)   |   | event bus      |
           |             +----------------+   +----------------+
           |                                          |
           |                                          v
           |                                 +----------------+
           |                                 | Analytics      |
           |                                 | ETL + BI       |
           |                                 +----------------+
           |
           +--> +--------------------------+
                | Object Storage (assets) |
                +--------------------------+
```

## 2) CI/CD Pipeline (bob alias)

```bob
+---------+     +-----------+     +----------------+     +-------------+
|  Commit | --> |  Linting  | --> | Unit / E2E Test| --> | Build Image |
+---------+     +-----------+     +----------------+     +-------------+
                      |                    |                     |
                      | fail               | fail                | push
                      v                    v                     v
                +-------------+      +-------------+      +----------------+
                | PR Comment  |      | Block Merge |      | Registry       |
                +-------------+      +-------------+      +----------------+
                                                                |
                                                                v
                                                         +--------------+
                                                         | Deploy Staging|
                                                         +--------------+
                                                                |
                                                      +---------+---------+
                                                      | Canary / Full Roll |
                                                      +--------------------+
                                                                |
                                                                v
                                                          +-----------+
                                                          | Production|
                                                          +-----------+
```

## 3) Network Zones with long labels

```svgbob
+----------------------------------------------------------------------------------------------------+
|                                     Private VPC / Zero Trust Network                               |
|                                                                                                    |
|   +--------------------+        +---------------------+         +------------------------------+   |
|   | Bastion / SSO Jump | -----> | Internal API Layer  | ----->  | Stateful Core Domain Engine |   |
|   +--------------------+        +---------------------+         +------------------------------+   |
|              |                              |                                   |                  |
|              v                              v                                   v                  |
|   +--------------------+        +---------------------+         +------------------------------+   |
|   | Observability      | <----- | Metrics + Tracing   | ----->  | Alert Rules / On-call       |   |
|   | Logs / Profiles    |        | OpenTelemetry stack |         | Paging + SLO Burn Alerts    |   |
|   +--------------------+        +---------------------+         +------------------------------+   |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

## 4) Fallback check

If `svgbob` rendering fails, this code block should still be shown as plain text by fallback behavior.

```svgbob
this is intentionally not a valid shape but should still keep visible
---- ??? ----
```
