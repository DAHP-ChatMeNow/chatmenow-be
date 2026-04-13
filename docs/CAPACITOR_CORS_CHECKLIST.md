# Capacitor WebView CORS Checklist

## Scope
- Backend: Express in `src/index.js`
- Reverse proxy: `nginx/livekit.conf` (LiveKit only)
- FE client: Axios in `chatmenow-fe/lib/axios.ts`

## Checklist Result

1. CORS middleware enabled globally: PASS
- `app.use(cors(corsOptions))` is applied before API routes.

2. Allowed origins include Capacitor/WebView defaults: PASS
- `defaultMobileOrigins` includes:
  - `http://localhost`
  - `https://localhost`
  - `capacitor://localhost`

3. Environment-based allowlist supported: PASS
- `ALLOWED_ORIGINS` is merged into allowed set.

4. Credentials mode handling: PASS
- `credentials: true` is enabled and origin is validated explicitly.

5. Preflight OPTIONS support: PASS
- CORS config has `methods`, `allowedHeaders`, and `preflightContinue: false`.

6. Required headers for current FE: PASS
- FE sends `Authorization` and `x-api-key`.
- Backend allows: `Content-Type`, `Authorization`, `x-api-key`.

7. nginx overriding CORS headers: PASS (current files)
- `nginx/livekit.conf` is only for LiveKit route and does not inject conflicting CORS headers for API.

8. Production domain coverage in allowlist: WARN
- Ensure production API `.env` has all needed origins:
  - web domain(s)
  - admin domain(s) if used
  - `capacitor://localhost`
  - `https://localhost`

## Recommended Production ALLOWED_ORIGINS Template

```env
ALLOWED_ORIGINS=http://localhost,http://localhost:3000,https://localhost,capacitor://localhost,https://chatmenow.cloud,https://admin.chatmenow.cloud
```

## Quick Verification Commands

```bash
# Preflight check
curl -i -X OPTIONS https://your-api-domain/api/auth/login \
  -H "Origin: capacitor://localhost" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization,x-api-key"

# Expected key response headers:
# Access-Control-Allow-Origin: capacitor://localhost
# Access-Control-Allow-Credentials: true
# Access-Control-Allow-Headers: Content-Type,Authorization,x-api-key
```

## Deployment Notes
- Do not use wildcard `*` when `credentials: true` is enabled.
- If API sits behind another reverse proxy, confirm it does not overwrite CORS headers from Express.
- Keep `ALLOWED_ORIGINS` centralized in env and documented per environment.
