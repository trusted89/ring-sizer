# Deploy: GitHub repo + Cloudflare Pages

Run these from the project folder (the one containing `public/`). Nothing here needs a build step.

## Rules

- The site must be served from a Cloudflare **Pages** address (`<project>.pages.dev`). Do not deploy it as a Worker on a `workers.dev` address.
- Repository and project name: `ring-sizer`. Keep the repository **private**.
- Do not rename files, change measurement code, or edit `test-set/ground-truth.csv` as part of deploying.

## 1. Check tools

```bash
node -v          # 18 or newer
gh auth status   # if not logged in: gh auth login
npm install
npm test         # must print 11 rows ending in "pass" and exit 0
```

## 2. GitHub (private repository)

The folder is already a git repository with its history.

```bash
gh repo create ring-sizer --private --source . --remote origin --push
```

If the repository already exists: `git remote add origin https://github.com/<user>/ring-sizer.git && git push -u origin main`.

## 3. Cloudflare Pages

```bash
npx wrangler login                                                   # opens the browser once
npx wrangler pages project create ring-sizer --production-branch main
npx wrangler pages deploy public --project-name ring-sizer --branch main
```

The last command prints the live address. Use the production address (`https://ring-sizer.pages.dev`, or the suffixed variant Cloudflare assigns if the name is taken), not the per-deployment preview address.

To redeploy after any change: commit, `git push`, then run the `pages deploy` command again.

## 4. Verify the live site

1. Open the address on a phone and on a desktop browser.
2. Wait for "Measurement engine ready".
3. Open "Try a sample photo" and run each sample: one measures (about 18.8 mm), one asks which ring, two ask for a retake.
4. Download the A4 sheet and confirm the PDF opens.

## 5. Record the links

Put the live address and the repository address in `DELIVERY_NOTES.md` under "Links", and the live address in `README.md` under "Live demo". Commit and push.
