import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "Agent Forge",
  tagline: "Build powerful AI agents",
  favicon: "img/favicon.ico", // We'll add a placeholder favicon later

  // Set the production url of your site here
  url: "https://frostlogic-ab.github.io",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/agent-forge/",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "frostlogic-ab",
  projectName: "agent-forge",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  headTags: [
    {
      tagName: "script",
      attributes: {
        defer: "true",
        src: "https://data.frostlogic.se/script.js",
        "data-website-id": "05311cfd-53ca-4094-8cf2-6e6e8712e9b9",
      },
    },
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/frostlogic-ab/agent-forge/tree/main/",
        },

        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies import("@docusaurus/preset-classic").Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: "img/docusaurus-social-card.jpg", // We'll add a placeholder social card later
    navbar: {
      title: "Agent Forge",
      logo: {
        alt: "Agent Forge Logo",
        src: "img/logo.svg", // We'll add a placeholder logo later
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "learnSidebar",
          position: "left",
          label: "Learn",
        },
        {
          type: "docSidebar",
          sidebarId: "apiSidebar",
          position: "left",
          label: "API Reference",
        },
        {
          href: "https://github.com/frostlogic-ab/agent-forge",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Learn",
              to: "/docs/learn/fundamentals/what-is-agent-forge", // Updated to existing page
            },
            {
              label: "API Reference",
              to: "/docs/api-reference",
            },
          ],
        },
        {
          title: "Community",
          items: [
            // Add community links here if you have them (e.g., Discord, Twitter)
            {
              label: "Forum",
              href: "https://github.com/frostlogic-ab/agent-forge/discussions",
            },
            // {
            //   label: 'Discord',
            //   href: 'https://discordapp.com/invite/docusaurus',
            // },
            // {
            //   label: 'Twitter',
            //   href: 'https://twitter.com/docusaurus',
            // },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/frostlogic-ab/agent-forge",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} FrostLogic AB. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies import("@docusaurus/preset-classic").ThemeConfig,
};

export default config;
