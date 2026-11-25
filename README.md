# Shinobi Artillery (Naruto-Bound)

Jogo de artilharia ninja por turnos compatível com os pacotes exportados pelo **Naruto Shinobi Studio Sprite** (`shinobi-phaser-v1` e `*_completo.zip`).

## GitHub Pages

O projeto já está configurado com deploy automático via GitHub Actions (`.github/workflows/deploy.yml`):

1. No repositório do GitHub, acesse **Settings → Pages**.
2. Em **Build and deployment → Source**, selecione **GitHub Actions**.
3. A cada push na branch `main` (ou clicando em **Actions → Deploy Shinobi Artillery to GitHub Pages → Run workflow**), o site será publicado automaticamente.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Build de produção:

```bash
npm run build
```
