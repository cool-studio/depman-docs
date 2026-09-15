---
title: DepMan documentation
description: Install a DepMan ingest client, configure it, and follow every release.
hide_table_of_contents: true
---

# DepMan

DepMan tells you when a published security advisory covers a dependency your project actually has
installed. A small client runs in each project after install, reports what is on disk, and DepMan
raises a Finding when an advisory matches.

Everything on this site except this page is published straight from the DepMan source repository.

## Install a client

- [npm client](/docs/clients/npm-client) — for JavaScript projects
- [Composer client](/docs/clients/composer-client) — for PHP projects
- [All clients](/docs/clients)

## Reference

- [`depman.json`](/docs/reference/depman-json) — the config file your project commits
- [Ingest API](/docs/reference/ingest-api) — the endpoint the clients report to

## Changelog

[Every release](/changelog) of the DepMan application and its clients, newest first. Subscribe
with [RSS](pathname:///changelog/rss.xml) or [Atom](pathname:///changelog/atom.xml).
