# AI Document Chatbot

Nx monorepo for an AI document chatbot.

| Project           | Path          | Stack                                                                |
| ----------------- | ------------- | -------------------------------------------------------------------- |
| `web`             | `apps/web`    | Angular 22 (standalone, signals, zoneless), Tailwind v4, spartan/ui  |
| `api`             | `apps/api`    | NestJS 11                                                            |
| `shared`          | `libs/shared` | Types/DTOs shared by `web` and `api` (`@ai-document-chatbot/shared`) |
| `button`, `utils` | `libs/ui`     | spartan/ui helm primitives (`@spartan-ng/helm/*`)                    |

## Getting started

```sh
npm install
cp .env.example .env   # fill in keys
npm start              # serves api (http://localhost:3000/api) + web (http://localhost:4200)
```

`web` proxies `/api` to the Nest server (`apps/web/proxy.conf.json`).

## Scripts

```sh
npm run build          # build all projects
npm test               # unit tests (Vitest for web, Jest for api/shared)
npm run lint           # ESLint (incl. module-boundary rules)
npm run format         # Prettier
npx nx graph           # project graph
```

Add spartan/ui primitives with `npx nx g @spartan-ng/cli:ui <name>`.
