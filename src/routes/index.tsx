import { createFileRoute } from "@tanstack/react-router";
import App from "../App";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "vid — Streaming Library" },
      { name: "description", content: "Watch and organize your uploaded videos, synced playlists, and custom streaming rows in vid." },
      { property: "og:title", content: "vid — Streaming Library" },
      { property: "og:description", content: "Watch and organize your uploaded videos, synced playlists, and custom streaming rows in vid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: App,
});
