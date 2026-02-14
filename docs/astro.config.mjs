// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import icon from "astro-icon";


// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "Woven-ECS",
      favicon: '/favicon.png',
      logo: {
        src: './src/assets/logo.png',
      },
      expressiveCode: {
        themes: ["github-dark-default"],
        frames: false,
      },
      social: [
        {
          icon: "blueSky",
          label: "Bluesky",
          href: "https://bsky.app/profile/william.land",
        },
        // {
        //   icon: "discord",
        //   label: "Discord",
        //   href: "https://discord.gg/your-invite-code",
        // },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/WillH0lt/woven-ecs",
        },
      ],
      sidebar: [
        {
          label: "Quick Start",
          link: "quick-start",
        },
        {
          label: "Learn Woven-ECS",
          items: [
            { label: "World", slug: "docs/world" },
            { label: "Entities", slug: "docs/entities" },
            { label: "Components & Singletons", slug: "docs/components-singletons" },
            { label: "Systems", slug: "docs/systems" },
            { label: "Queries", slug: "docs/queries" },
            { label: "Multithreading", slug: "docs/multithreading" },
            { label: "Best Practices", slug: "docs/best-practices" },
          ],
        },
        {
          label: "Canvas Store",
          items: [
            { label: "Introduction", slug: "canvas-store/introduction" },
            { label: "How It Works", slug: "canvas-store/how-it-works" },
            { label: "Components & Singletons", slug: "canvas-store/components-singletons" },
            { label: "Client Setup", slug: "canvas-store/client-setup" },
            { label: "Server Setup", slug: "canvas-store/server-setup" }
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Woven-ECS", slug: "reference/woven-ecs" },
            { label: "Canvas Store", slug: "reference/canvas-store" },
            { label: "Canvas Store Server", slug: "reference/canvas-store-server" },
          ],
        },
      ],
      customCss: ["./src/styles/global.css"],
      components: {
        Footer: "./src/components/Footer.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
    }),
    icon()
  ],
});
