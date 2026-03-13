# Command Execution Reminders

## Vercel Commands
If running `vercel` directly produces the Windows version header or hangs, use **Direct Execution via npx**:

```bash
npx vercel [command]
```

### Examples
- `npx vercel --version`
- `npx vercel login`
- `npx vercel link`
- `npx vercel` (for deployment)

## Why this works
- **Environment Isolation**: `npx` ensures you are using the version specified in the project or downloads the latest stable version.
- **Shell Alias Bypass**: Some shell environments on Windows create aliases or wrappers that don't pipe correctly to AI tool-calling agents. `npx` bypasses these wrappers.
- **HTTPS Requirement**: Since we are using DeviceMotion APIs, the site *must* be served over HTTPS. Deploying to Vercel via `npx vercel` provides an automatic HTTPS endpoint.
