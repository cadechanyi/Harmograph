# Harmograph Frontend

Next.js 14 (App Router) + React + TypeScript application for Harmograph. This is
an independently deployable artifact, separate from the Demucs_Service backend
(Req 12.1).

## Getting started

```bash
npm install
npm run dev
```

## Configuration

The Frontend reaches the Demucs_Service through a configurable endpoint
(Req 12.3). Copy `.env.example` to `.env.local` and set:

```
NEXT_PUBLIC_DEMUCS_ENDPOINT=http://localhost:8000
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build / typecheck via Next
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint (next/core-web-vitals)
- `npm run test` — run the Vitest suite (fast-check available for property tests)
