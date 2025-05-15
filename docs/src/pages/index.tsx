import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import Layout from "@theme/Layout";
import clsx from "clsx";
import React from "react";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">
          Empowering Developers to Build, Deploy, and Manage Autonomous AI
          Agents with Ease.
        </p>
        <p className={styles.heroIntro}>
          Agent Forge is a comprehensive Typescript framework for creating
          sophisticated AI agents. Define agents using simple YAML, integrate
          with leading LLM providers, leverage a rich tool ecosystem, and
          orchestrate complex workflows or collaborative agent teams. Start
          forging your intelligent agents today!
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/learn/intro"
          >
            Get Started - 5min Tutorial ⏱️
          </Link>
          <Link
            className="button button--info button--lg"
            style={{ marginLeft: "10px" }}
            to="/docs/learn/core-concepts/yaml-defined-agents"
          >
            Explore Core Concepts
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} - Autonomous AI Agent Framework`}
      description="Agent Forge is a comprehensive framework for building, deploying, and managing autonomous AI agents. Create agents with YAML, integrate LLMs, use tools, and orchestrate workflows or teams."
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
