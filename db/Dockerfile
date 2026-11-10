# Local and CI database only: Postgres with pgTAP for the rule tests. Production uses DigitalOcean managed Postgres.
FROM postgres:17
RUN apt-get update && apt-get install -y postgresql-17-pgtap && rm -rf /var/lib/apt/lists/*
