# Mustafa Abdalruhman — Portfolio

Personal portfolio website built with [Next.js](https://nextjs.org) and [Once UI](https://once-ui.com), showcasing my work, experience, and projects as a Finance and Statistics student at UNSW.

Live at: **[mustarfa78.github.io](https://mustarfa78.github.io)**

---

## What's inside

- **About page** — work experience, education, and skills
- **Project page** — write-up of the mean reversion crypto-futures trading algorithm I built in Python, including development timeline, architecture, and live performance results
- **Blog** — MDX-based writing
- **Gallery** — photo collection

---

## Running locally

**Requirements:** Node.js v18.17+

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Editing content

| What | Where |
|------|-------|
| Personal info, experiences, skills | `src/resources/content.tsx` |
| Site theme and config | `src/resources/once-ui.config.ts` |
| Project write-ups | `src/app/work/projects/*.mdx` |
| Blog posts | `src/app/blog/posts/*.mdx` |
| Images and logos | `public/images/` |

---

## Deployment

### Option 1 — Vercel (recommended)

The simplest option. Connect your GitHub repo to [Vercel](https://vercel.com) and it deploys automatically on every push. No configuration needed — it detects Next.js out of the box.

### Option 2 — GitHub Pages (static export)

GitHub Pages requires a fully static build. Add `output: 'export'` to `next.config.mjs` and set `images.unoptimized: true` (Next.js image optimisation does not work in static mode):

```js
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // if deploying to github.com/username/repo (not a custom domain):
  basePath: '/Portfolio',
  // ...rest of config
};
```

Then build and the output goes to the `out/` folder:

```bash
npm run build
```

Push the `out/` folder contents to the `gh-pages` branch, or use a GitHub Actions workflow to automate it. Also add a `.nojekyll` file to the root of the deployed branch to prevent GitHub from processing the files with Jekyll.

---

## Tech stack

- [Next.js 16](https://nextjs.org) — React framework
- [Once UI](https://once-ui.com) — component library and design system
- [MDX](https://mdxjs.com) — markdown with JSX for project and blog content
- TypeScript, Sass

---

## License

Based on the [Magic Portfolio](https://github.com/once-ui-system/magic-portfolio) template, distributed under the CC BY-NC 4.0 License. Attribution required. Commercial use not permitted.
