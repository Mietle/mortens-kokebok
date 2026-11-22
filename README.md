# Mortens Kokebok & Vinkjeller

Webappen til Mortens Kokebok. Publiseres automatisk av Netlify når denne mappen oppdateres.

- `public/` – selve appen (bygget fra Claude-versjonen)
- `netlify/functions/chef.mjs` – «Spør Morten». Trenger miljøvariabelen `ANTHROPIC_API_KEY` i Netlify.
  Valgfritt: `CHEF_LIMIT_PER_HOUR` (standard 40), `CHEF_MODEL`, `CHEF_MODEL_QUICK`.
