import { createFileRoute } from "@tanstack/react-router";
import App from "../App";
import previewAsset from "../assets/vid-og-thumbnail.jpg.asset.json";

const previewImageUrl = `https://id-preview--064af4ad-946f-41f8-807e-2d2af0d045c3.lovable.app${previewAsset.url}`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "vid — Streaming Library" },
      { name: "description", content: "Watch and organize your uploaded videos, synced playlists, and custom streaming rows in vid." },
      { property: "og:title", content: "vid — Streaming Library" },
      { property: "og:description", content: "Watch and organize your uploaded videos, synced playlists, and custom streaming rows in vid." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: previewImageUrl },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: previewImageUrl },
    ],
  }),
  component: App,
});
