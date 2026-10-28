# Isolated OpenAPI proxy toolchain

The single mock startup task installs this lockfile on demand, outside the API's production dependency graph. It uses Prism 5.16.0 with Node 24.22.1. Dependency scripts and analytics are disabled.

Prism's parser eagerly imports the Postman SDK even when loading an OpenAPI document. Its SDK depends on an obsolete Faker interface; replacing that dependency with maintained Faker breaks module loading. This OpenAPI-only toolchain replaces the unused `postman-collection` package with a local adapter whose `Collection` constructor always throws. No Postman parsing or dynamic generation is offered. The adapter does not replace Prism's OpenAPI transformer, response validator or HTTP proxy. Startup accepts only the checked-in OpenAPI document.

Faker, Lodash and UUID are pinned to patched versions. Run `npm audit --prefix tools/mock --audit-level=moderate` after dependency changes and run `npm run mock:smoke` with the pinned runtime to verify real JSON, negative-case envelopes, editorial mutations and binary responses through Prism.
