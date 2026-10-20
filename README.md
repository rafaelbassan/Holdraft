# Holdraft

App local em Next.js para consultar o Jira e preparar rascunhos de cards com confirmação explícita.

Documentação técnica completa: [docs/tecnico.md](docs/tecnico.md) (arquitetura, OAuth, fluxos, regras do agente e estado da implementação).

## Requisitos

- Node.js **22.15+** (SQLite nativo via `node:sqlite` e flag `--experimental-sqlite`)
- Jira Cloud (OAuth ou API token) e um LLM com API compatível com OpenAI

## Como rodar

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Configure o app em **Configurações** (`/settings`).

Build de produção:

```bash
npm run build
npm start
```

## Dados locais

O banco SQLite fica em `data/holdraft.db` (pasta `data/` no `.gitignore`).

## Regras de criação

Edite [agent/card-rules.md](agent/card-rules.md) para definir cards companheiros e outras regras que o agente deve seguir ao montar rascunhos.
