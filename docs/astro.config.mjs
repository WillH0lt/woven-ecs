// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "Woven-ECS",
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
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/your-invite-code",
        },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/WillH0lt/woven-ecs",
        },
      ],
      sidebar: [
        {
          label: "🚀 Quick Start",
          link: "quick-start",
        },
        {
          label: "🎓 Learn Woven-ECS",
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
          label: "Editor Store",
          items: [
            { label: "Introduction", slug: "editor-store/introduction" },
            { label: "Components & Singletons", slug: "editor-store/components-singletons" },
            { label: "Client Setup", slug: "editor-store/client-setup" },
            { label: "Server Setup", slug: "editor-store/server-setup" },
            { label: "Undo/Redo", slug: "editor-store/history" },
            { label: "Best Practices", slug: "editor-store/best-practices" },
          ],
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
      customCss: ["./src/styles/global.css"],
      components: {
        Footer: "./src/components/Footer.astro",
      },
    }),
    icon(),
  ],
});
