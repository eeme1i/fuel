# Finnish fuel price web app

SvelteKit on Cloudflare Workers. The page loads estimates from the `fuel-api` Worker:

- **Production:** through the `API` service binding in `wrangler.jsonc` (deploy `fuel-api` first).
- **Override:** set the `API_BASE_URL` variable to use an API at a URL instead.
- **Development:** with neither set, `pnpm dev` uses `http://127.0.0.1:8787`, i.e.
  `pnpm dev` in `apps/api`. `pnpm preview` uses the binding, which connects to a locally running
  `wrangler dev` of the API.

Run `pnpm gen` after changing `wrangler.jsonc` to regenerate `worker-configuration.d.ts`.

# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@0.17.1 create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" tailwindcss="plugins:none" sveltekit-adapter="adapter:cloudflare+cfTarget:workers" --install pnpm apps/web
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
