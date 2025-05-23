import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import Layout from "@theme/Layout";
import clsx from "clsx";
import React from "react";

import Svg from "@site/static/img/agent-forge-diagram.svg?react";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero", styles.heroBanner)}>
      <div className={styles.heroContainer}>
        <div className={styles.heroLeft}>
          <h1 className="hero__title">{siteConfig.title}</h1>
          <p className="hero__subtitle">{siteConfig.tagline}</p>

          <p className={styles.heroIntro}>
            Agent Forge is a comprehensive TypeScript framework for creating
            sophisticated AI agents. Define agents using simple YAML, integrate
            with leading LLM providers, leverage a rich tool ecosystem, and
            orchestrate complex workflows or collaborative agent teams. Start
            forging your intelligent agents today!
          </p>

          <div className={styles.buttons}>
            <Link
              className="button button--secondary button--lg"
              to="/docs/learn/a2a-tutorial"
            >
              Get Started - 5min Tutorial 🚀
            </Link>
            <Link
              className="button button--info button--lg"
              to="/docs/learn/core-concepts/yaml-defined-agents"
            >
              Explore Core Concepts 🔍
            </Link>
          </div>
        </div>

        <div className={styles.heroRight}>
          <Svg
            className={styles.heroImage}
            alt="Agent Forge Architecture Diagram"
          />
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <Layout
      title="Build AI Agents with Ease"
      description="Agent Forge is a TypeScript framework for creating, orchestrating, and deploying AI agents with LLM integration."
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
