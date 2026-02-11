// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "Woven-ECS",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/WillH0lt/woven-ecs",
        },
      ],
      sidebar: [
        {
          label: "Guide",
          items: [
            { label: "Introduction", slug: "guide/introduction" },
            { label: "Getting Started", slug: "guide/getting-started" },
          ],
        },
        {
          label: "Architecture",
          items: [
            { label: "Components", slug: "architecture/components" },
            { label: "Systems", slug: "architecture/systems" },
            { label: "Queries", slug: "architecture/queries" },
            { label: "World", slug: "architecture/world" },
            { label: "Multithreading", slug: "architecture/multithreading" },
            { label: "Events & Subscriptions", slug: "architecture/events" },
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
    }),
  ],
});
