---
name: modern-web-guidance
description: Look up browser support and implementation guidance when choosing native controls, keyboard focus, browser APIs, or browser-sensitive layout in the benchmark reports dashboard.
---

From the project root, use the CLI pinned in the lockfile. Search for the browser behavior, then retrieve the matching guide by its returned ID.

```sh
DISABLE_TELEMETRY=1 npm exec --no -- modern-web-guidance search "accordion collapse keyboard"
DISABLE_TELEMETRY=1 npm exec --no -- modern-web-guidance retrieve accordion
```

Apply the relevant guidance in `reports-ui/index.html`. Verify the affected behavior in the browser with a report fixture.
