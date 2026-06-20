@AGENTS.md

## Deploy

To deploy changes to the homelab server (news.oxleypawnshop.com):

```bash
docker build --platform linux/amd64 -t seanlsk/newsapp:latest .
docker push seanlsk/newsapp:latest
ssh seanlsk@192.168.1.150 "cd ~/newsapp && docker compose pull app && docker compose up -d app"
```

- Server: 192.168.1.150, directory: ~/newsapp
- Host port: 3002, container port: 3000
- Database: PostgreSQL 17 (container: newsapp-db, internal network only)
- Tunnel: Cloudflare, subdomain: news.oxleypawnshop.com
